// src/hooks/useImportRun.js
// La procedura di un nuovo import, dal file scelto alla schermata di revisione.
//
// E' una macchina a stati esplicita invece di una catena di promesse, perche'
// in mezzo puo' esserci una domanda all'utente (la mappatura delle colonne) e
// perche' ogni passo deve poter fallire dicendo a che punto era.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { functionErrorCode } from "../lib/edgeError";
import {
  fileTypeOf, readTabular, buildRows, rowsFromExtraction, mergeExtractions,
  headerFingerprint, sha256Bytes,
} from "../lib/import/pipeline.js";
import { persistRows, resumeExtraction } from "../lib/import/persist.js";
import { guessMapping, mappingIsComplete } from "../lib/import/mapping.js";
import { readPdfText, readPdfLayout, chunkPageTexts } from "../lib/import/readers.js";
import { parseStatement } from "../lib/import/statements/index.js";
import { readOfx } from "../lib/import/ofx.js";

/** Passi: idle -> uploading -> mapping (solo se serve) -> parsing -> done | background | failed */
export function useImportRun({ minorUnitsOf }) {
  const [step, setStep] = useState("idle");
  const [progress, setProgress] = useState("");
  // Quando un PDF lungo viene letto a blocchi, l'avanzamento dice a che punto
  // e': "1 di 4" e' un'attesa, una rotella senza numeri e' un dubbio.
  const [progressPart, setProgressPart] = useState(null);
  const [error, setError] = useState(null);
  const [duplicateOf, setDuplicateOf] = useState(null);
  const [mappingProposal, setMappingProposal] = useState(null);
  const [importId, setImportId] = useState(null);
  const [summary, setSummary] = useState(null);

  // Quello che serve al passo dopo la domanda sulla mappatura.
  const pending = useRef(null);
  // Canale Realtime aperto mentre un PDF scansionato viene letto in sottofondo.
  const channel = useRef(null);

  const closeChannel = useCallback(() => {
    if (channel.current) {
      supabase.removeChannel(channel.current);
      channel.current = null;
    }
  }, []);

  useEffect(() => closeChannel, [closeChannel]);

  const fail = useCallback(async (message, id) => {
    closeChannel();
    setError(message);
    setStep("failed");
    if (id) {
      await supabase.from("imports").update({ status: "failed", error: String(message).slice(0, 500) }).eq("id", id);
      await supabase.from("import_events").insert({ import_id: id, event: "error", detail: { message: String(message) } });
    }
    return { ok: false, error: message };
  }, [closeChannel]);

  const reset = useCallback(() => {
    closeChannel();
    setStep("idle"); setProgress(""); setProgressPart(null); setError(null); setDuplicateOf(null);
    setMappingProposal(null); setImportId(null); setSummary(null);
    pending.current = null;
  }, [closeChannel]);

  /** Scrittura delle righe, arricchimento e categorizzazione. */
  const persist = useCallback(async (id, rows, { balanceCheck, period } = {}) => {
    setStep("parsing");
    try {
      const done = await persistRows(supabase, {
        importId: id,
        rows,
        aiConsent: pending.current?.aiConsent,
        balanceCheck: balanceCheck ?? "not_available",
        period,
        onProgress: setProgress,
      });
      setSummary(done);
      setStep("done");
      return { ok: true, importId: id };
    } catch (e) {
      return fail(e.message, id);
    }
  }, [fail]);

  /** Righe gia' estratte (OFX o Claude su PDF) -> stessi controlli del parsing locale. */
  const finishFromExtraction = useCallback(async (extracted) => {
    const { id, account } = pending.current;
    const currency = (account.currency ?? "").trim();

    // Gli stessi controlli del CSV: saldo, valuta e impronta dei doppioni.
    // Senza questo passaggio un PDF reimportato entrerebbe due volte, perche'
    // il riconoscimento dei doppioni si regge tutto sull'impronta.
    const { rows, balanceCheck, period } = await rowsFromExtraction(extracted, {
      accountId: account.account_id ?? account.id,
      accountCurrency: currency,
      minorUnits: minorUnitsOf(currency),
    });
    if (!rows.length) return fail("no_rows", id);

    return persist(id, rows, { balanceCheck, period });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minorUnitsOf, persist, fail]);

  /**
   * PDF scansionato: la Edge Function lo legge dopo aver risposto, e mentre lo
   * fa qui si resta in ascolto della riga di `imports`, che passa dalla RLS
   * come tutto il resto. Quando arriva `rows_total`, le righe estratte sono
   * nel diario e si possono lavorare.
   */
  const watchBackground = useCallback((id) => {
    closeChannel();
    channel.current = supabase
      .channel(`import-${id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "imports", filter: `id=eq.${id}` },
        async ({ new: row }) => {
          if (row.status === "failed") {
            closeChannel();
            setError(row.error ?? "ai_failed");
            setStep("failed");
            return;
          }
          if (row.status === "parsing" && (row.rows_total ?? 0) > 0) {
            closeChannel();
            setStep("parsing");
            const res = await resumeExtraction(supabase, {
              importId: id,
              account: pending.current.account,
              minorUnits: minorUnitsOf((pending.current.account.currency ?? "").trim()),
              aiConsent: pending.current.aiConsent,
              onProgress: setProgress,
            });
            if (!res.ok) { await fail(res.error, id); return; }
            setSummary(res.summary);
            setStep("done");
          }
        })
      .subscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeChannel, minorUnitsOf, fail]);

  /** PDF: prima si prova a leggerne il testo nel browser, che costa zero. */
  const continueWithPdf = useCallback(async () => {
    const { id, bytes, aiConsent } = pending.current;
    setProgress("pdf");

    // ── prima strada: le regole ──────────────────────────────────────────
    // Se la banca e' fra quelle che l'app sa leggere, il PDF si legge qui,
    // nel browser, senza consenso all'AI e senza che un solo byte esca dal
    // dispositivo. Costa zero e non chiede nessuna chiave.
    //
    // Il buffer si copia per ogni lettura: pdf.js passa l'array al proprio
    // worker e lo puo' lasciare staccato, e la lettura dopo troverebbe zero
    // byte.
    try {
      const layout = await readPdfLayout(bytes.slice(0));
      const known = parseStatement(layout);
      if (known.ok) {
        setProgress("rules_parser");
        // La banca e le statistiche vanno nel DIARIO, non nella colonna
        // `parser`: quella e' un enum Postgres con cinque valori fissi
        // ('csv','xlsx','ofx','pdf_text_ai','pdf_vision_ai') e scriverci un
        // sesto valore farebbe fallire l'update. Aggiungerlo e' una migrazione
        // di una riga, ma le migrazioni si fanno una fase alla volta; il
        // diario intanto registra tutto quello che serve a sapere chi ha letto
        // il file.
        await supabase.from("import_events").insert({
          import_id: id,
          event: "parsed_by_rules",
          detail: { bank: known.bank, ...known.stats },
        });
        return finishFromExtraction(known.extracted);
      }
    } catch (e) {
      // Un PDF protetto da password non si apre, e non lo aprirebbe nemmeno
      // l'AI: e' l'unico caso in cui conviene fermarsi subito e dirlo.
      if (e?.name === "PasswordException") return fail("pdf_password_protected", id);
      // Per tutto il resto si tira dritto: la strada con l'AI resta aperta.
    }

    // ── seconda strada: l'AI ─────────────────────────────────────────────
    let pdf;
    try {
      pdf = await readPdfText(bytes.slice(0));
    } catch (e) {
      if (e?.name === "PasswordException") return fail("pdf_password_protected", id);
      return fail(e.message, id);
    }

    if (!aiConsent) return fail("ai_consent_required", id);

    if (pdf.hasText) {
      setProgress("ai_text");
      // Un estratto annuale non entra in una richiesta sola: non tanto per il
      // limite di pagine dell'API quanto per il contesto, che un PDF denso
      // esaurisce molto prima. Si manda a blocchi e si ricuce qui.
      const chunks = chunkPageTexts(pdf.pageTexts);
      const parts = [];
      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) setProgressPart({ part: i + 1, parts: chunks.length });
        const { data, error: aiError } = await supabase.functions.invoke("import-ai", {
          body: { action: "extract_text", importId: id, text: chunks[i], part: i + 1, parts: chunks.length },
        });
        // Il codice vero sta nel corpo della risposta, non in `aiError.message`
        // — che e' sempre "Edge Function returned a non-2xx status code".
        if (aiError) return fail(await functionErrorCode(aiError), id);
        parts.push(data);
      }
      setProgressPart(null);
      await supabase.from("imports").update({ parser: "pdf_text_ai" }).eq("id", id);
      return finishFromExtraction(mergeExtractions(parts));
    }

    // Scansione: la legge la Edge Function, come documento, in sottofondo.
    setProgress("ai_pdf");
    const { error: aiError } = await supabase.functions.invoke("import-ai", {
      body: { action: "extract_pdf", importId: id },
    });
    if (aiError) return fail(await functionErrorCode(aiError), id);
    setStep("background");
    watchBackground(id);
    return { ok: true, background: true, importId: id };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fail, finishFromExtraction, watchBackground]);

  /** OFX/QFX: tracciato fisso, nessuna mappatura da chiedere e nessuna AI. */
  const continueWithOfx = useCallback(async () => {
    const { id, bytes } = pending.current;
    setProgress("parse");

    let parsed;
    try {
      parsed = readOfx(bytes);
    } catch (e) {
      return fail(e.message, id);
    }
    if (!parsed.rows.length) return fail("ofx_no_rows", id);

    await supabase.from("import_events").insert({
      import_id: id,
      event: "parsed",
      detail: { rows: parsed.rows.length, encoding: parsed.encoding, warnings: parsed.warnings },
    });

    return finishFromExtraction(parsed);
  }, [fail, finishFromExtraction]);

  /** Passo 1: carica il file e decide come leggerlo. */
  const start = useCallback(async ({ file, account, aiConsent }) => {
    setError(null); setDuplicateOf(null); setSummary(null);
    setStep("uploading");
    setProgress("upload");

    const fileType = fileTypeOf(file.name);
    if (!fileType) return fail("unsupported_type");

    const bytes = await file.arrayBuffer();
    const sha = await sha256Bytes(bytes);

    // Stesso file gia' caricato: si avvisa e si va avanti lo stesso, perche'
    // puo' avere senso reimportarlo su un altro conto.
    const { data: already } = await supabase
      .from("imports").select("id, file_name, created_at, status")
      .eq("file_sha256", sha).limit(1);
    if (already?.length) setDuplicateOf(already[0]);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: created, error: insertError } = await supabase.from("imports").insert({
      account_id: account.account_id ?? account.id,
      storage_path: "pending",
      file_name: file.name,
      file_type: fileType,
      file_size: file.size,
      file_sha256: sha,
      parser: fileType === "pdf" ? "pdf_text_ai" : fileType,
    }).select().single();
    if (insertError) return fail(insertError.message);

    const id = created.id;
    setImportId(id);

    const path = `${user.id}/${id}/${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("statements").upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (uploadError) return fail(uploadError.message, id);

    await supabase.from("imports").update({ storage_path: path, status: "parsing" }).eq("id", id);
    await supabase.from("import_events").insert({ import_id: id, event: "uploaded", detail: { file: file.name, sha } });

    pending.current = { id, bytes, fileType, account, aiConsent };

    if (fileType === "pdf") return continueWithPdf();
    if (fileType === "ofx") return continueWithOfx();

    // csv / xlsx: si guarda se la banca e' gia' conosciuta.
    setProgress("parse");
    let tabular;
    try {
      tabular = await readTabular(bytes, fileType);
    } catch (e) {
      return fail(e.message, id);
    }
    pending.current.tabular = tabular;

    const fingerprint = await headerFingerprint(tabular.headers);
    pending.current.fingerprint = fingerprint;

    const { data: profile } = await supabase
      .from("parser_profiles").select("*").eq("header_fingerprint", fingerprint).maybeSingle();

    if (profile?.mapping && mappingIsComplete(profile.mapping)) {
      await supabase.from("imports").update({ parser_profile_id: profile.id }).eq("id", id);
      return finish(profile.mapping);
    }

    // Proposta locale. Se basta, la schermata di mappatura parte compilata e
    // non serve chiamare l'AI: un tracciato bancario tipico si riconosce dai
    // nomi delle colonne e dai valori.
    let proposal = guessMapping(tabular.headers, tabular.rows);

    if (!mappingIsComplete(proposal) && aiConsent) {
      setProgress("ai_mapping");
      const { data, error: aiError } = await supabase.functions.invoke("import-ai", {
        body: { action: "suggest_mapping", importId: id, headers: tabular.headers, sampleRows: tabular.rows.slice(0, 5) },
      });
      if (!aiError && data?.mapping) proposal = { ...proposal, ...data.mapping };
    }

    setMappingProposal({ ...proposal, headers: tabular.headers, sample: tabular.rows.slice(0, 5) });
    setStep("mapping");
    return { ok: true, needsMapping: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fail, continueWithPdf, continueWithOfx]);

  /** Mappatura confermata dall'utente (o riusata da un profilo). */
  const finish = useCallback(async (mapping, { saveProfile = null } = {}) => {
    const { id, tabular, account, fingerprint } = pending.current;
    setStep("parsing");
    setProgress("rows");

    if (saveProfile) {
      const { data: profile } = await supabase.from("parser_profiles").insert({
        name: saveProfile,
        header_fingerprint: fingerprint,
        mapping,
      }).select().maybeSingle();
      if (profile) await supabase.from("imports").update({ parser_profile_id: profile.id }).eq("id", id);
    }

    const currency = (account.currency ?? "").trim();
    const { rows, balanceCheck, period } = await buildRows({
      rawRows: tabular.rows,
      mapping,
      accountId: account.account_id ?? account.id,
      accountCurrency: currency,
      minorUnits: minorUnitsOf(currency),
    });

    return persist(id, rows, { balanceCheck, period });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minorUnitsOf, persist]);

  return {
    step, progress, progressPart, error, duplicateOf, mappingProposal, importId, summary,
    start, confirmMapping: finish, reset,
  };
}
