// supabase/functions/document-ai/index.ts
//
// Legge un documento caricato (fattura, ricevuta, busta paga, contratto) e ne
// estrae i campi. Come import-ai: JWT obbligatorio, client Supabase con
// l'header dell'utente, mai la service role. Se la RLS non fa vedere un
// documento, non lo vede nemmeno questo codice.
//
// Il lavoro vero gira in sottofondo con EdgeRuntime.waitUntil: leggere un PDF
// e' quasi tutta attesa di rete, ma puo' durare piu' del tempo che ha senso
// tenere aperta una richiesta. Il client segue lo stato via Realtime sulla
// riga di `documents`.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { DOCUMENT_SCHEMA, validateDocument } from "../_shared/document-payload.js";

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MAX_ATTEMPTS = 3;
const MAX_TOKENS = 8000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function publishableKey(): string {
  const single = Deno.env.get("SUPABASE_ANON_KEY");
  if (single) return single;
  try {
    return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}").default ?? "";
  } catch { return ""; }
}

const userClient = (req: Request) =>
  createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });

type Db = ReturnType<typeof userClient>;

// ── Claude ───────────────────────────────────────────────────────────────────

const anthropic = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function retryable(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError) return true;              // 429
  if (error instanceof Anthropic.APIConnectionError) return true;          // rete
  if (error instanceof Anthropic.APIError) {
    const status = (error as { status?: number }).status ?? 0;
    return status === 529 || status >= 500;                                // sovraccarico
  }
  return false;
}

const SYSTEM = `Leggi documenti amministrativi: fatture, ricevute, buste paga, contratti.
Estrai i campi ESATTAMENTE come stanno sul documento: non convertire valute,
non arrotondare, non tradurre i nomi propri. Se un campo non c'e', usa null:
non dedurlo e non inventarlo.

Gli importi vanno restituiti in forma canonica: solo cifre e punto decimale,
senza separatore delle migliaia e senza simbolo di valuta. "1.234,56 EUR"
diventa "1234.56", e la valuta va nel suo campo come codice ISO.

Su una fattura, "total" e' il totale a pagare, "net" l'imponibile e "tax"
l'imposta. Su una busta paga "total" e' il NETTO in busta, mentre lordo e
contributi vanno in payslip_gross e payslip_contributions.

kind: invoice_issued se l'ha emessa il destinatario di questa lettura,
invoice_received se l'ha ricevuta. Nel dubbio, other.

Se il documento e' troppo sfocato o tagliato per leggerlo, metti unreadable a
true invece di indovinare. Se i valori ci sono ma non sei sicuro, low_confidence
a true: un campo vuoto l'utente lo riempie, un campo sbagliato non lo nota.`;

async function askClaude(content: Anthropic.ContentBlockParam[]) {
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY non configurata nei secret della funzione");

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        output_config: { effort: "medium" },
        tools: [{
          name: "estrai_documento",
          description: "Restituisce i campi del documento in forma strutturata.",
          strict: true,
          input_schema: DOCUMENT_SCHEMA as Anthropic.Tool.InputSchema,
        }],
        tool_choice: { type: "tool", name: "estrai_documento" },
        messages: [{ role: "user", content }],
      });

      if (response.stop_reason === "max_tokens") {
        throw new Error("La risposta del modello e' stata troncata.");
      }
      const block = response.content.find(b => b.type === "tool_use");
      if (!block || block.type !== "tool_use") {
        throw new Error(`Il modello non ha usato lo strumento (stop: ${response.stop_reason})`);
      }
      return {
        data: block.input,
        usage: {
          input: response.usage.input_tokens ?? 0,
          output: response.usage.output_tokens ?? 0,
        },
      };
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === MAX_ATTEMPTS) break;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/**
 * Un PDF va come blocco `document`, un'immagine come blocco `image`. Gli HEIC
 * non arrivano mai qui: li converte il browser in JPEG prima di caricarli,
 * e il bucket non li accetta proprio.
 */
function contentFor(mime: string, data: string): Anthropic.ContentBlockParam[] {
  const media = mime === "application/pdf" ? null : mime;
  const first: Anthropic.ContentBlockParam = media
    ? { type: "image", source: { type: "base64", media_type: media as never, data } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  return [first, { type: "text", text: "Estrai i campi di questo documento." }];
}

// ── estrazione ───────────────────────────────────────────────────────────────

async function extract(db: Db, documentId: string) {
  const { data: doc } = await db
    .from("documents")
    .select("id, storage_path, mime_type, file_sha256")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { error: "document_not_found", status: 404 };

  await db.from("documents")
    .update({ status: "extracting", error: null })
    .eq("id", documentId);

  const lavoro = (async () => {
    try {
      const { data: file, error } = await db.storage.from("documents").download(doc.storage_path);
      if (error || !file) throw new Error(`File non leggibile: ${error?.message ?? "assente"}`);

      const bytes = new Uint8Array(await file.arrayBuffer());
      const out = await askClaude(contentFor(doc.mime_type, toBase64(bytes)));

      // Le valute ammesse si leggono dal database, non da una lista scritta
      // qui: c'e' una FK verso `currencies`, e un codice inventato farebbe
      // fallire l'intero aggiornamento invece di alzare un flag.
      const { data: currencies } = await db.from("currencies").select("code, minor_units");
      const codes = new Set((currencies ?? []).map(c => c.code));
      const units = new Map((currencies ?? []).map(c => [c.code, c.minor_units]));

      const { fields, flags } = validateDocument(out.data, {
        currencyCodes: codes,
        minorUnitsOf: (c: string) => units.get(c) ?? 2,
        today: new Date().toISOString().slice(0, 10),
      });

      // Stesso file gia' archiviato: si segnala, non si blocca. Puo' avere
      // senso tenere due copie della stessa fattura in due pratiche diverse.
      if (doc.file_sha256) {
        const { data: same } = await db
          .from("documents")
          .select("id")
          .eq("file_sha256", doc.file_sha256)
          .neq("id", documentId)
          .limit(1);
        if (same?.length) flags.push("duplicate_file");
      }

      const { data: before } = await db.from("documents")
        .select("ai_input_tokens, ai_output_tokens").eq("id", documentId).maybeSingle();

      await db.from("documents").update({
        ...fields,
        flags,
        extraction: out.data as Record<string, unknown>,
        status: "pending_review",
        error: null,
        ai_input_tokens: (before?.ai_input_tokens ?? 0) + out.usage.input,
        ai_output_tokens: (before?.ai_output_tokens ?? 0) + out.usage.output,
      }).eq("id", documentId);

    } catch (e) {
      // Il file resta dov'e': si potra' riprovare senza ricaricarlo.
      await db.from("documents").update({
        status: "failed",
        error: String(e instanceof Error ? e.message : e).slice(0, 500),
      }).eq("id", documentId);
    }
  })();

  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(lavoro); else await lavoro;
  return { ok: true, started: true };
}

// ── handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const db = userClient(req);
  const { data: { user } } = await db.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  // Senza consenso non parte nessuna chiamata e nessun file esce dal progetto.
  // I campi si compilano a mano: il documento resta comunque archiviato.
  const { data: profile } = await db.from("profiles").select("ai_consent_at").maybeSingle();
  if (!profile?.ai_consent_at) return json({ error: "ai_consent_required" }, 403);

  if (!API_KEY) return json({ error: "ai_not_configured" }, 503);

  try {
    if (String(body.action ?? "extract") !== "extract") {
      return json({ error: "unknown_action" }, 400);
    }
    const documentId = String(body.documentId ?? "");
    if (!documentId) return json({ error: "document_id_required" }, 400);

    const out = await extract(db, documentId);
    if ("error" in out) return json({ error: out.error }, out.status);
    return json(out);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: "ai_failed", message: message.slice(0, 500) }, 502);
  }
});
