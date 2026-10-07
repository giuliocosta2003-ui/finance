// supabase/functions/import-ai/index.ts
//
// L'unico punto in cui questa app parla con Claude. Qui non si legge nessun
// file e non si fa nessun parsing deterministico: quello sta nel browser,
// perche' una Edge Function ha 2 secondi di CPU per richiesta e un XLSX li
// brucia. Qui si sta in attesa della rete, che di CPU non ne consuma.
//
// Autenticazione: JWT dell'utente obbligatorio (verify_jwt = true), e il
// client Supabase viene creato con l'header Authorization di chi chiama, MAI
// con la service role. Cosi' anche dentro questa funzione valgono le policy
// RLS: se l'utente non vede una riga, non la vede nemmeno il codice qui.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import {
  buildCategorizePayload,
  validateCategorization,
  mergeExtractions,
  CATEGORIZE_SCHEMA,
  MAPPING_SCHEMA,
  EXTRACT_SCHEMA,
} from "../_shared/ai-payload.js";

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MAX_ATTEMPTS = 3;
const CATEGORIZE_BATCH = 100;
// L'API accetta 600 pagine per richiesta su un modello da 1M di contesto, ma il
// limite che scatta davvero e' quello dei token in USCITA: una pagina fitta di
// estratto conto sono 20-40 movimenti, e otto pagine bastano a riempire una
// risposta. Blocchi piccoli costano una richiesta in piu' e in cambio evitano
// l'unico errore che non si vedrebbe: una risposta troncata a meta' elenco.
const PAGES_PER_CHUNK = 8;
const MAX_TOKENS = 16000;
const MAX_TOKENS_EXTRACT = 32000;

// Senza questi header il browser non arriva nemmeno a chiamare la funzione:
// blocca tutto al preflight. L'origine e' aperta perche' l'autorizzazione qui
// la fa il JWT, non il dominio da cui parte la richiesta.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

// ── client Supabase con i diritti dell'utente ────────────────────────────────

function publishableKey(): string {
  const single = Deno.env.get("SUPABASE_ANON_KEY");
  if (single) return single;
  try {
    return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}").default ?? "";
  } catch { return ""; }
}

function userClient(req: Request) {
  return createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
}

// ── chiamata a Claude ────────────────────────────────────────────────────────

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

/**
 * Una chiamata con un solo strumento obbligatorio: e' il modo documentato di
 * ottenere JSON conforme a uno schema. `strict: true` garantisce che gli
 * argomenti rispettino lo schema; che gli id citati esistano davvero lo
 * verifica comunque validateCategorization, perche' lo schema garantisce la
 * forma, non la verita'.
 */
async function askClaude(
  { system, content, toolName, schema, effort, maxTokens }: {
    system: string;
    content: Anthropic.ContentBlockParam[] | string;
    toolName: string;
    schema: Record<string, unknown>;
    effort?: "low" | "medium" | "high";
    maxTokens?: number;
  },
): Promise<{ data: unknown; usage: { input: number; output: number } }> {
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY non configurata nei secret della funzione");
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: maxTokens ?? MAX_TOKENS,
        system,
        output_config: { effort: effort ?? "low" },
        tools: [{
          name: toolName,
          description: "Restituisce il risultato in forma strutturata.",
          strict: true,
          input_schema: schema as Anthropic.Tool.InputSchema,
        }],
        tool_choice: { type: "tool", name: toolName },
        messages: [{ role: "user", content: content as never }],
      });

      // Una risposta troncata e' l'unico errore che passerebbe inosservato: lo
      // strumento c'e', il JSON e' valido, e mancano solo le ultime righe. Un
      // import a meta' e' peggio di un import fallito, quindi si ferma qui.
      if (response.stop_reason === "max_tokens") {
        throw new Error(
          "La risposta del modello e' stata troncata: il blocco e' troppo grande. " +
          "Riprova con un file piu' corto.",
        );
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
      // Attesa crescente: 1s, 2s. Un 429 che si ripresenta subito resta un 429.
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

// ── contabilita' dei token ───────────────────────────────────────────────────

async function addTokens(db: ReturnType<typeof userClient>, importId: string | null,
                         usage: { input: number; output: number }) {
  if (!importId) return;
  const { data } = await db.from("imports")
    .select("ai_input_tokens, ai_output_tokens").eq("id", importId).maybeSingle();
  if (!data) return;
  await db.from("imports").update({
    ai_input_tokens: (data.ai_input_tokens ?? 0) + usage.input,
    ai_output_tokens: (data.ai_output_tokens ?? 0) + usage.output,
  }).eq("id", importId);
}

const logEvent = (db: ReturnType<typeof userClient>, importId: string,
                  event: string, detail: unknown) =>
  db.from("import_events").insert({ import_id: importId, event, detail });

// ── azioni ───────────────────────────────────────────────────────────────────

const SYSTEM_MAPPING = `Sei un lettore di estratti conto bancari.
Ricevi l'intestazione di un file e alcune righe di esempio.
Individua quale colonna contiene la data, quale l'importo (oppure quali due
colonne contengono dare e avere separati), quale la descrizione e quale
l'eventuale saldo. Deduci il formato della data e il separatore decimale dai
valori che vedi, non dai nomi delle colonne.
Se una colonna non esiste, restituisci null: non inventarla.`;

const SYSTEM_EXTRACT = `Sei un lettore di estratti conto bancari.
Estrai TUTTE le righe di movimento, in ordine, senza saltarne e senza
inventarne. Riporta date, descrizioni e importi ESATTAMENTE come sono scritti
sul documento: non convertire, non arrotondare, non tradurre. Se un valore non
c'e', usa null. Non includere righe di totale, di intestazione o di saldo.`;

const SYSTEM_CATEGORIZE = `Assegni una categoria a movimenti bancari.
Ricevi l'elenco delle categorie disponibili e alcune righe, ognuna con data,
descrizione ripulita, segno (+ entrata, - uscita) e valuta.
Regole: usa SOLO gli id di categoria che ti sono stati forniti; rispetta il
segno (a un'entrata non assegnare una categoria di spesa); se non sei
ragionevolmente sicuro metti category_id a null oppure unsure a true.
Meglio nessuna categoria che una categoria sbagliata: l'utente correggera'
una casella vuota, mentre una categoria plausibile ma errata gli passera'
sotto il naso.`;

async function suggestMapping(body: { headers: string[]; sampleRows: unknown[] }) {
  const { data, usage } = await askClaude({
    system: SYSTEM_MAPPING,
    content: JSON.stringify({ headers: body.headers, rows: (body.sampleRows ?? []).slice(0, 5) }),
    toolName: "proponi_mappatura",
    schema: MAPPING_SCHEMA,
    effort: "low",
  });
  return { mapping: data, usage };
}

async function extractFromText(text: string) {
  const { data, usage } = await askClaude({
    system: SYSTEM_EXTRACT,
    content: text,
    toolName: "estrai_movimenti",
    schema: EXTRACT_SCHEMA,
    effort: "medium",
    maxTokens: MAX_TOKENS_EXTRACT,
  });
  return { extracted: data, usage };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/**
 * Divide un PDF lungo in piu' PDF da poche pagine.
 *
 * I limiti dell'API sono 32 MB e 600 pagine per richiesta (100 sui modelli con
 * contesto da 200k), ma nessuno dei due e' quello che scatta per primo: la
 * risposta si riempie molto prima. Un PDF che sta gia' in un blocco non viene
 * nemmeno riscritto — e' il caso normale, e ricostruirlo per niente costerebbe
 * CPU, che qui e' contata.
 */
async function splitPdf(bytes: Uint8Array): Promise<Uint8Array[]> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = source.getPageCount();
  if (total <= PAGES_PER_CHUNK) return [bytes];

  const chunks: Uint8Array[] = [];
  for (let start = 0; start < total; start += PAGES_PER_CHUNK) {
    const indices = [];
    for (let i = start; i < Math.min(start + PAGES_PER_CHUNK, total); i++) indices.push(i);
    const part = await PDFDocument.create();
    const pages = await part.copyPages(source, indices);
    for (const page of pages) part.addPage(page);
    chunks.push(await part.save());
  }
  return chunks;
}

async function extractFromPdf(db: ReturnType<typeof userClient>, storagePath: string) {
  const { data: file, error } = await db.storage.from("statements").download(storagePath);
  if (error || !file) throw new Error(`File non leggibile: ${error?.message ?? "assente"}`);

  const chunks = await splitPdf(new Uint8Array(await file.arrayBuffer()));
  const parts: unknown[] = [];
  const usage = { input: 0, output: 0 };

  for (let i = 0; i < chunks.length; i++) {
    const { data, usage: used } = await askClaude({
      system: SYSTEM_EXTRACT,
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(chunks[i]) } },
        {
          type: "text",
          text: chunks.length > 1
            ? `Estrai i movimenti di questo estratto conto (parte ${i + 1} di ${chunks.length}).`
            : "Estrai i movimenti di questo estratto conto.",
        },
      ] as Anthropic.ContentBlockParam[],
      toolName: "estrai_movimenti",
      schema: EXTRACT_SCHEMA,
      effort: "medium",
      maxTokens: MAX_TOKENS_EXTRACT,
    });
    usage.input += used.input;
    usage.output += used.output;
    parts.push(data);
  }

  return { extracted: mergeExtractions(parts), usage, parts: chunks.length };
}

/**
 * Le righe NON arrivano dal client: si rileggono dal database con i diritti
 * dell'utente e si sanificano qui. Cosi' cosa esce verso Claude lo decide
 * questo codice, non chi chiama la funzione.
 */
async function categorize(db: ReturnType<typeof userClient>, importId: string) {
  const [{ data: rows }, { data: categories }, { data: profile }] = await Promise.all([
    db.from("import_rows")
      .select("id, row_index, booked_on, description, merchant, amount_minor, currency")
      .eq("import_id", importId)
      .is("category_id", null)
      .order("row_index"),
    db.from("categories").select("id, key, name, kind, is_business, archived_at"),
    db.from("profiles").select("profile_type").maybeSingle(),
  ]);

  if (!rows?.length) return { assigned: 0, rejected: 0, usage: { input: 0, output: 0 } };

  const allowedIds = (categories ?? []).filter(c => !c.archived_at).map(c => c.id);
  const byIndex = new Map(rows.map(r => [r.row_index, r.id]));
  const total = { input: 0, output: 0 };
  let assigned = 0;
  let rejectedTotal = 0;

  for (let start = 0; start < rows.length; start += CATEGORIZE_BATCH) {
    const batch = rows.slice(start, start + CATEGORIZE_BATCH);
    const payload = buildCategorizePayload({
      rows: batch,
      categories: categories ?? [],
      profileType: profile?.profile_type,
      // Il nome tradotto lo manda il client insieme alle categorie in fase 4;
      // qui si usa quello salvato, con la chiave come ripiego.
      labelOf: (c: { name?: string; key?: string }) => c.name ?? c.key ?? "",
    });

    const { data, usage } = await askClaude({
      system: SYSTEM_CATEGORIZE,
      content: JSON.stringify(payload),
      toolName: "assegna_categorie",
      schema: CATEGORIZE_SCHEMA,
      effort: "low",
    });
    total.input += usage.input;
    total.output += usage.output;

    const { assignments, rejected } = validateCategorization(data, allowedIds);
    rejectedTotal += rejected.length;

    for (const a of assignments) {
      const rowId = byIndex.get(a.i);
      if (!rowId || !a.categoryId) continue;
      await db.from("import_rows").update({
        category_id: a.categoryId,
        category_source: "ai",
        confidence: a.confidence,
      }).eq("id", rowId);
      assigned += 1;
    }
  }

  return { assigned, rejected: rejectedTotal, usage: total };
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
  const action = String(body.action ?? "");

  // Il consenso e' un interruttore, non una formalita': senza, qui non parte
  // nessuna chiamata e nessun dato esce dal progetto.
  const { data: profile } = await db.from("profiles").select("ai_consent_at").maybeSingle();
  if (!profile?.ai_consent_at) {
    return json({ error: "ai_consent_required" }, 403);
  }

  if (!API_KEY) return json({ error: "ai_not_configured" }, 503);

  try {
    switch (action) {
      case "suggest_mapping": {
        const out = await suggestMapping(body as never);
        await addTokens(db, (body.importId as string) ?? null, out.usage);
        return json({ ok: true, mapping: out.mapping });
      }

      case "extract_text": {
        const importId = String(body.importId ?? "");
        const out = await extractFromText(String(body.text ?? ""));
        await addTokens(db, importId, out.usage);
        if (importId) {
          await logEvent(db, importId, "ai_extract", {
            source: "text",
            part: body.part ?? 1,
            parts: body.parts ?? 1,
            ...out.usage,
          });
        }
        return json({ ok: true, ...(out.extracted as object) });
      }

      case "extract_pdf": {
        // Lavoro lungo: si risponde subito e si continua in sottofondo. Il
        // client segue l'avanzamento con Realtime sulla riga di `imports`,
        // che passa anch'essa dalla RLS.
        const importId = String(body.importId ?? "");
        const { data: imp } = await db.from("imports")
          .select("id, storage_path").eq("id", importId).maybeSingle();
        if (!imp) return json({ error: "import_not_found" }, 404);

        await db.from("imports")
          .update({ status: "parsing", parser: "pdf_vision_ai", rows_total: 0, error: null })
          .eq("id", importId);

        // In produzione il lavoro prosegue dopo la risposta; in locale, dove
        // EdgeRuntime non esiste, si attende e basta.
        const lavoro = (async () => {
          try {
            const out = await extractFromPdf(db, imp.storage_path);
            await addTokens(db, importId, out.usage);

            // Le righe grezze restano nel diario, e l'import NON passa in
            // revisione: mancano ancora controlli, impronte e regole, che il
            // client applica con lo stesso codice del parsing locale. Uno stato
            // `review` adesso prometterebbe una revisione vuota.
            const extracted = out.extracted as { rows?: unknown[] };
            await logEvent(db, importId, "ai_extract", {
              source: "pdf",
              parts: out.parts,
              rows: extracted.rows?.length ?? 0,
              extracted,
              ...out.usage,
            });
            // Una sola colonna che cambia sulla riga di `imports`: e' il segnale
            // che il client aspetta in Realtime, e resta piccola anche quando
            // l'estrazione e' di migliaia di righe.
            await db.from("imports")
              .update({ rows_total: extracted.rows?.length ?? 0 })
              .eq("id", importId);
          } catch (e) {
            await db.from("imports").update({
              status: "failed",
              error: String(e instanceof Error ? e.message : e).slice(0, 500),
            }).eq("id", importId);
            await logEvent(db, importId, "error", { message: String(e) });
          }
        })();
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(lavoro); else await lavoro;

        return json({ ok: true, started: true });
      }

      case "categorize": {
        const importId = String(body.importId ?? "");
        const out = await categorize(db, importId);
        await addTokens(db, importId, out.usage);
        await logEvent(db, importId, "categorized", {
          assigned: out.assigned, rejected: out.rejected, ...out.usage,
        });
        return json({ ok: true, assigned: out.assigned, rejected: out.rejected });
      }

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: "ai_failed", message: message.slice(0, 500) }, 502);
  }
});
