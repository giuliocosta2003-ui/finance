// src/lib/import/persist.js
// Dalla lista di righe in memoria a un import pronto per la revisione.
//
// Sta fuori dal hook perche' ci si arriva da due strade: la procedura di
// import normale, e il recupero di un PDF scansionato che la Edge Function ha
// letto in sottofondo mentre l'utente era altrove. Due strade, un solo codice:
// altrimenti le regole si applicherebbero in un caso e non nell'altro, e se ne
// accorgerebbe solo chi conta i movimenti a mano.
import { applyRules, insertRows, enrichRows, rowsFromExtraction } from "./pipeline.js";
import { functionErrorCode } from "../edgeError.js";

/** Ordine fisso: regole dell'utente, poi storico e corrispondenze, poi l'AI. */
export async function persistRows(supabase, {
  importId, rows, aiConsent, balanceCheck = "not_available", period = null, onProgress = () => {},
}) {
  onProgress("rules");
  const { data: rules } = await supabase.from("merchant_rules").select("*");
  const { rows: ruled, used } = applyRules(rows, rules ?? []);

  onProgress("rows");
  await insertRows(supabase, importId, ruled);

  for (const [ruleId, times] of used) {
    const rule = (rules ?? []).find(r => r.id === ruleId);
    if (rule) {
      await supabase.from("merchant_rules")
        .update({ hits: (rule.hits ?? 0) + times, last_used_at: new Date().toISOString() })
        .eq("id", ruleId);
    }
  }

  onProgress("matching");
  const enrich = await enrichRows(supabase, importId);

  // AI solo per quello che e' rimasto scoperto: e' l'ultimo gradino, non il
  // primo, e su un secondo import della stessa banca spesso non serve.
  let ai = null;
  const { count: uncategorized } = await supabase
    .from("import_rows").select("id", { count: "exact", head: true })
    .eq("import_id", importId).is("category_id", null);

  let aiError = null;
  if (aiConsent && (uncategorized ?? 0) > 0) {
    onProgress("ai_categorize");
    const { data, error } = await supabase.functions.invoke("import-ai", {
      body: { action: "categorize", importId },
    });
    // La categorizzazione che non riesce NON fa fallire l'import: le righe ci
    // sono gia', e restano da categorizzare a mano. Ma il motivo si scrive nel
    // diario, altrimenti una chiave API scaduta si manifesta solo come
    // "stranamente non categorizza piu' niente", che nessuno collega.
    if (error) aiError = await functionErrorCode(error);
    else ai = data;
  }

  await supabase.from("imports").update({
    status: "review",
    rows_total: ruled.length,
    balance_check: balanceCheck,
    period_from: period?.from ?? null,
    period_to: period?.to ?? null,
    error: null,
  }).eq("id", importId);

  await supabase.from("import_events").insert({
    import_id: importId,
    event: "parsed",
    detail: { rows: ruled.length, ...enrich, ...(aiError ? { ai_error: aiError } : {}) },
  });

  return { rows: ruled.length, ...enrich, ai, aiError };
}

/**
 * Recupero di un'estrazione fatta in sottofondo.
 *
 * Quando il PDF e' una scansione, la Edge Function lo legge dopo aver gia'
 * risposto e deposita le righe in un evento `ai_extract`. Le righe grezze pero'
 * non sono ancora un import: mancano controlli, impronte e regole, che si fanno
 * qui, quando l'utente torna. Finche' non succede l'import resta in `parsing`,
 * cosi' lo stato dice la verita' invece di promettere una revisione vuota.
 */
export async function resumeExtraction(supabase, { importId, account, minorUnits, aiConsent, onProgress }) {
  // Gli eventi `ai_extract` sono piu' d'uno quando il PDF e' stato letto a
  // blocchi: quello che porta le righe e' l'ultimo che ha `extracted`.
  const { data: events } = await supabase
    .from("import_events")
    .select("detail")
    .eq("import_id", importId)
    .eq("event", "ai_extract")
    .order("at", { ascending: false })
    .limit(5);

  const extracted = (events ?? []).map(e => e.detail?.extracted).find(e => e?.rows?.length);
  if (!extracted) return { ok: false, error: "no_extraction" };

  const accountCurrency = (account?.currency ?? "").trim();
  const { rows, balanceCheck, period } = await rowsFromExtraction(extracted, {
    accountId: account?.id,
    accountCurrency,
    minorUnits,
  });

  const summary = await persistRows(supabase, {
    importId, rows, aiConsent, balanceCheck, period, onProgress,
  });
  return { ok: true, summary };
}
