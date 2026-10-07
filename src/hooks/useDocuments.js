// src/hooks/useDocuments.js
// Caricamento, estrazione e conferma dei documenti.
//
// L'originale non si apre mai con un URL pubblico: si chiede a Storage un URL
// firmato che scade in 60 secondi. Un bucket privato con dentro buste paga e
// fatture non deve produrre link che restano validi in una chat.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { functionErrorCode } from "../lib/edgeError";
import { sha256Bytes } from "../lib/import/hash.js";
import { prepareImage } from "../lib/image.js";
import { readPdfLayout } from "../lib/import/readers.js";
import { parseDocument } from "../lib/documents/index.js";
import { validateDocument } from "../lib/document-payload.js";

const SIGNED_URL_SECONDS = 60;

export function useDocuments({ kind = "", status = "", holdingId = "", transactionId = "" } = {}) {
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    let q = supabase.from("documents").select("*").order("created_at", { ascending: false });
    if (kind) q = q.eq("kind", kind);
    if (status) q = q.eq("status", status);
    if (holdingId) q = q.eq("holding_id", holdingId);
    if (transactionId) q = q.eq("transaction_id", transactionId);
    const { data, error: err } = await q;
    if (err) { setError(err.message); return; }
    setError(null);
    setDocuments(data ?? []);
  }, [kind, status, holdingId, transactionId]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const remove = useCallback(async (doc) => {
    // Prima il file, poi la riga: se fallisce il primo passo la riga resta e
    // si puo' riprovare, mentre il contrario lascerebbe un file orfano che
    // nessuna schermata mostra piu'.
    if (doc.storage_path) await supabase.storage.from("documents").remove([doc.storage_path]);
    const { error: err } = await supabase.from("documents").delete().eq("id", doc.id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  return { documents, loading: documents === null, error, reload, remove };
}

/**
 * Un documento solo, con lo stato che si aggiorna da solo mentre l'AI lavora.
 * La sottoscrizione Realtime e' sulla riga di `documents`, che passa dalla RLS
 * come ogni altra lettura.
 */
export function useDocument(documentId) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const channel = useRef(null);

  const reload = useCallback(async () => {
    if (!documentId) return;
    const { data, error: err } = await supabase
      .from("documents").select("*").eq("id", documentId).maybeSingle();
    if (err) { setError(err.message); return; }
    setError(null);
    setDoc(data ?? null);
  }, [documentId]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!documentId) return undefined;
    channel.current = supabase
      .channel(`document-${documentId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "documents", filter: `id=eq.${documentId}` },
        ({ new: row }) => setDoc(row))
      .subscribe();
    return () => {
      if (channel.current) supabase.removeChannel(channel.current);
      channel.current = null;
    };
  }, [documentId]);

  const update = useCallback(async (patch) => {
    const { error: err } = await supabase.from("documents").update(patch).eq("id", documentId);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [documentId, reload]);

  const confirm = useCallback(async (patch) => {
    return update({ ...patch, status: "confirmed", confirmed_at: new Date().toISOString() });
  }, [update]);

  /** Rilegge il documento con l'AI, per esempio dopo un fallimento. */
  const extract = useCallback(async () => {
    const { data, error: err } = await supabase.functions.invoke("document-ai", {
      body: { action: "extract", documentId },
    });
    if (err) return { ok: false, error: await functionErrorCode(err) };
    return { ok: true, ...data };
  }, [documentId]);

  const suggestions = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("suggest_document_links", { p_document_id: documentId });
    if (err) return [];
    return data ?? [];
  }, [documentId]);

  return { doc, loading: doc === null, error, reload, update, confirm, extract, suggestions };
}

/** URL firmato a breve scadenza per aprire l'originale. */
export async function signedUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from("documents").createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Carica un file e fa partire l'estrazione.
 *
 * L'ordine conta: prima la riga (serve il suo id per il percorso), poi il
 * file, poi l'aggiornamento del percorso. Se qualcosa si rompe a meta' resta
 * una riga senza file, che si vede ed e' cancellabile, invece di un file senza
 * riga, che non lo vede piu' nessuno.
 */
export async function uploadDocument(file, { aiConsent, currencyCodes = null, minorUnitsOf = null } = {}) {
  let prepared;
  try {
    prepared = await prepareImage(file);
  } catch (e) {
    return { ok: false, error: e.code === "unsupported_image" ? "unsupported_image" : e.message };
  }

  const bytes = await prepared.arrayBuffer();
  const sha = await sha256Bytes(bytes);

  const { data: { user } } = await supabase.auth.getUser();
  const { data: created, error: insertError } = await supabase.from("documents").insert({
    storage_path: "pending",
    file_name: prepared.name,
    mime_type: prepared.type || "application/octet-stream",
    file_size: prepared.size,
    file_sha256: sha,
  }).select().single();
  if (insertError) return { ok: false, error: insertError.message };

  const path = `${user.id}/${created.id}/${prepared.name}`;
  const { error: uploadError } = await supabase.storage
    .from("documents").upload(path, prepared, { upsert: false, contentType: prepared.type });
  if (uploadError) {
    await supabase.from("documents").delete().eq("id", created.id);
    return { ok: false, error: uploadError.message };
  }

  await supabase.from("documents").update({ storage_path: path }).eq("id", created.id);

  // ── prima strada: le regole ──────────────────────────────────────────────
  // Se il PDF e' un tracciato che l'app sa leggere (fattura di consulenza), lo
  // si legge qui, nel browser, senza consenso AI e senza che un byte esca dal
  // dispositivo. Vale anche senza consenso: e' l'analogo degli estratti.
  if (prepared.type === "application/pdf") {
    const byRules = await tryDocumentRules(bytes, created.id, { currencyCodes, minorUnitsOf });
    if (byRules) return { ok: true, documentId: created.id, extracted: true, byRules: true };
  }

  if (!aiConsent) {
    // Senza consenso non parte nessuna chiamata: il documento resta
    // archiviato e i campi si compilano a mano.
    await supabase.from("documents").update({ status: "pending_review" }).eq("id", created.id);
    return { ok: true, documentId: created.id, extracted: false };
  }

  const { error: aiError } = await supabase.functions.invoke("document-ai", {
    body: { action: "extract", documentId: created.id },
  });
  if (aiError) {
    // Si salva il CODICE, non la frase fissa di supabase-js: e' quello che la
    // schermata sa tradurre quando riapre il documento.
    const code = await functionErrorCode(aiError);
    await supabase.from("documents").update({ status: "failed", error: code }).eq("id", created.id);
    return { ok: true, documentId: created.id, extracted: false, error: code };
  }

  return { ok: true, documentId: created.id, extracted: true };
}

/**
 * Prova a leggere il PDF con un parser a regole. Se un tracciato lo riconosce,
 * scrive i campi sulla riga del documento — passando dalla STESSA
 * `validateDocument` che usa la Edge Function, cosi' i flag e i campi sono
 * identici — e lo lascia in `pending_review` per la conferma dell'utente.
 *
 * @returns {Promise<boolean>} true se un tracciato ha letto il documento.
 */
async function tryDocumentRules(bytes, documentId, { currencyCodes, minorUnitsOf }) {
  try {
    // Il buffer si copia: pdf.js lo passa al worker e lo puo' lasciare staccato.
    const layout = await readPdfLayout(bytes.slice(0));
    const parsed = parseDocument(layout);
    if (!parsed.ok) return false;

    const codes = currencyCodes instanceof Set ? currencyCodes : new Set(currencyCodes ?? []);
    const { fields, flags } = validateDocument(parsed.extracted, {
      currencyCodes: codes,
      minorUnitsOf: typeof minorUnitsOf === "function" ? minorUnitsOf : () => 2,
      today: new Date().toISOString().slice(0, 10),
    });

    // Rete di sicurezza: se le valute non erano ancora caricate, la valuta del
    // tracciato (un codice ISO vero) non va persa per un elenco vuoto.
    if (!fields.currency && codes.size === 0) {
      const c = String(parsed.extracted.currency ?? "").toUpperCase();
      if (/^[A-Z]{3}$/.test(c)) fields.currency = c;
    }

    await supabase.from("documents").update({
      ...fields,
      flags,
      extraction: parsed.extracted,
      status: "pending_review",
      error: null,
    }).eq("id", documentId);
    return true;
  } catch {
    // PDF protetto, scansione senza testo, o tracciato non riconosciuto: si
    // lascia decidere alla strada con l'AI (o alla compilazione a mano).
    return false;
  }
}
