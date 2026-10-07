// src/lib/import/pipeline.js
// L'orchestrazione di un import, dal file alla schermata di revisione.
//
// Sta nel browser perche' e' li' che avviene il parsing (2 secondi di CPU per
// richiesta in una Edge Function non bastano per un XLSX). Il database fa la
// parte che richiede di guardare TUTTO lo storico dell'utente: duplicati,
// trasferimenti e categoria dallo storico sono tre chiamate SQL, non tremila.
//
// Regola d'oro di tutta la fase: qui dentro non si scrive mai in
// `transactions`. Le righe vivono in `import_rows` finche' l'utente non
// conferma con commit_import.
import { readCsv, readXlsx } from "./readers.js";
import { applyMapping, inferDateFormat, inferDecimalSeparator, parseDate } from "./mapping.js";
import {
  checkRunningBalance, checkTotals, checkCurrency, assignDedupeHashes, periodOf,
} from "./checks.js";
import { headerFingerprint, sha256Bytes } from "./hash.js";
import { pickRule, normalizeMerchant } from "../merchant.js";
import { parseAmount } from "../money.js";
// La ricucitura dei blocchi sta nel modulo condiviso con la Edge Function:
// i blocchi li fa il browser per i PDF con testo e il server per le scansioni,
// e devono ricucirsi allo stesso modo.
import { mergeExtractions } from "../ai-payload.js";

export const FILE_TYPES = {
  csv: ["text/csv", "application/vnd.ms-excel", "text/plain"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pdf: ["application/pdf"],
  ofx: ["application/x-ofx", "application/octet-stream"],
};

/** Il tipo si decide dall'estensione: i MIME che manda il browser sono inaffidabili. */
export function fileTypeOf(fileName) {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "txt") return "csv";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "pdf") return "pdf";
  if (ext === "ofx" || ext === "qfx") return "ofx";
  return null;
}

/** Legge il file e ne ricava intestazione e righe grezze (solo csv e xlsx). */
export async function readTabular(arrayBuffer, fileType, { skipRows = null } = {}) {
  if (fileType === "csv") {
    // Prima lettura senza saltare niente, per capire dove comincia la tabella.
    const first = readCsv(arrayBuffer, { skipRows: skipRows ?? 0 });
    if (skipRows === null && looksLikePreamble(first.headers)) {
      for (let skip = 1; skip <= 8; skip++) {
        const retry = readCsv(arrayBuffer, { skipRows: skip });
        if (!looksLikePreamble(retry.headers)) return { ...retry, skipRows: skip };
      }
    }
    return { ...first, skipRows: skipRows ?? 0 };
  }
  if (fileType === "xlsx") {
    const out = readXlsx(arrayBuffer, { skipRows });
    return { ...out, skipRows: out.headerRow };
  }
  throw new Error(`Tipo non tabellare: ${fileType}`);
}

/**
 * Una testata libera ("Estratto conto", "Periodo: ...") si riconosce perche'
 * produce una sola colonna piena e tante vuote.
 */
function looksLikePreamble(headers) {
  const filled = (headers ?? []).filter(h => h && String(h).trim() !== "");
  return filled.length <= 1;
}

/**
 * Coda comune a tutti i formati: controlli, impronte e periodo.
 *
 * Passa di qui TUTTO quello che finira' in `import_rows`, da qualunque strada
 * arrivi — CSV, XLSX, OFX o righe lette da Claude in un PDF. Le righe lette da
 * un modello sono anzi quelle che ne hanno piu' bisogno: li' non c'e' un
 * tracciato che garantisca niente, e senza impronta il riconoscimento dei
 * doppioni non funzionerebbe affatto.
 */
export async function checkAndHash(mapped, { accountId, accountCurrency, openingMinor = null, closingMinor = null }) {
  const balance = checkRunningBalance(mapped);
  const totals = checkTotals(mapped, { openingMinor, closingMinor });
  const currency = checkCurrency(mapped, accountCurrency);
  const withHashes = await assignDedupeHashes(mapped, accountId);

  const mismatched = new Set(balance.mismatchedIndexes);
  const wrongCurrency = new Set(currency.mismatchedIndexes);

  const rows = withHashes.map(row => {
    const flags = [...row.flags];
    if (mismatched.has(row.rowIndex)) flags.push("balance_mismatch");
    if (wrongCurrency.has(row.rowIndex)) flags.push("currency_mismatch");
    return { ...row, flags: [...new Set(flags)] };
  });

  // Due controlli, un solo esito: basta che uno dei due non torni perche'
  // l'estratto vada guardato. "Non disponibile" solo se non se ne e' potuto
  // fare nemmeno uno.
  const balanceCheck =
    balance.status === "mismatch" || totals.status === "mismatch" ? "mismatch"
      : balance.status === "ok" || totals.status === "ok" ? "ok"
        : "not_available";

  return { rows, balanceCheck, totals, period: periodOf(rows) };
}

/**
 * Dalle righe grezze alle righe pronte per `import_rows`, applicando i
 * controlli. Puro: nessuna chiamata di rete, quindi testabile da solo.
 */
export async function buildRows({ rawRows, mapping, accountId, accountCurrency, minorUnits }) {
  const mapped = applyMapping(rawRows, mapping, { currency: accountCurrency, minorUnits });
  return checkAndHash(mapped, { accountId, accountCurrency });
}

/**
 * Righe che arrivano gia' estratte — da un OFX o da Claude che ha letto un PDF
 * — con date e importi ancora come li ha scritti la banca.
 *
 * Il formato della data e il separatore decimale si deducono dai valori, non
 * si danno per scontati: un estratto americano scrive 09/13/2026 e 1,234.56,
 * uno italiano 13/09/2026 e 1.234,56, e sbagliare vuol dire sbagliare ogni
 * importo del file.
 */
export async function rowsFromExtraction(extracted, { accountId, accountCurrency, minorUnits }) {
  const source = extracted?.rows ?? [];

  const dateFormat = inferDateFormat(source.map(r => r.date));
  const ambiguous = dateFormat === "ambiguous";
  const separator = inferDecimalSeparator(
    source.flatMap(r => [r.amount, r.balance]).filter(v => v != null),
  );
  const locale = separator === "," ? "it" : "en";
  const currency = (extracted?.currency ?? accountCurrency ?? "").trim() || accountCurrency;

  const mapped = source.map((r, i) => {
    const flags = [];
    const bookedOn = parseDate(r.date, ambiguous ? "DMY" : dateFormat);
    if (!bookedOn) flags.push("parse_warning");
    else if (ambiguous) flags.push("date_ambiguous");

    const amountMinor = parseAmount(r.amount, minorUnits, locale);
    if (amountMinor === null || amountMinor === 0n) flags.push("parse_warning");

    const description = String(r.description ?? "").trim();

    return {
      rowIndex: i,
      raw: r,
      bookedOn,
      description: description || null,
      merchant: normalizeMerchant(description) || null,
      amountMinor,
      balanceMinor: r.balance == null || r.balance === ""
        ? null : parseAmount(r.balance, minorUnits, locale),
      currency,
      flags,
    };
  });

  return checkAndHash(mapped, {
    accountId,
    accountCurrency,
    openingMinor: parseAmount(extracted?.opening_balance, minorUnits, locale),
    closingMinor: parseAmount(extracted?.closing_balance, minorUnits, locale),
  });
}

/** Le regole dell'utente, applicate in locale: sono poche e il confronto e' esatto. */
export function applyRules(rows, rules) {
  let applied = 0;
  const used = new Map();
  const out = rows.map(row => {
    if (row.categoryId) return row;
    const rule = pickRule(row.merchant, rules);
    if (!rule) return row;
    applied += 1;
    used.set(rule.id, (used.get(rule.id) ?? 0) + 1);
    return {
      ...row,
      categoryId: rule.category_id,
      categorySource: "rule",
      // Una regola l'ha scritta l'utente: e' la fonte piu' affidabile che c'e'.
      confidence: "high",
    };
  });
  return { rows: out, applied, used };
}

// ── scrittura su database ────────────────────────────────────────────────────

const toDbRow = (importId, row) => ({
  import_id: importId,
  row_index: row.rowIndex,
  raw: row.raw ?? null,
  booked_on: row.bookedOn,
  description: row.description,
  merchant: row.merchant,
  amount_minor: row.amountMinor === null || row.amountMinor === undefined
    ? null : row.amountMinor.toString(),
  currency: row.currency,
  balance_minor: row.balanceMinor === null || row.balanceMinor === undefined
    ? null : row.balanceMinor.toString(),
  kind: row.amountMinor == null ? null : (row.amountMinor > 0n ? "income" : "expense"),
  category_id: row.categoryId ?? null,
  category_source: row.categorySource ?? "none",
  confidence: row.confidence ?? "low",
  flags: row.flags ?? [],
  decision: "import",
  dedupe_hash: row.dedupeHash ?? null,
});

export async function insertRows(supabase, importId, rows) {
  // A blocchi: un estratto annuale puo' avere qualche migliaio di righe e una
  // sola insert gigante rischia di sforare i limiti della richiesta.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("import_rows")
      .insert(rows.slice(i, i + CHUNK).map(r => toDbRow(importId, r)));
    if (error) throw new Error(error.message);
  }
}

/**
 * Duplicati, trasferimenti e categoria dallo storico: tre chiamate al
 * database, che fa il lavoro pesante dove stanno i dati.
 */
export async function enrichRows(supabase, importId) {
  const summary = { exact: 0, probable: 0, transfers: 0, fromHistory: 0 };

  const { data: dupes } = await supabase.rpc("find_duplicate_candidates", { p_import_id: importId });
  for (const d of dupes ?? []) {
    const flags = [];
    const patch = {};
    if (d.exact_transaction_id) {
      flags.push("duplicate_exact");
      patch.matched_transaction_id = d.exact_transaction_id;
      // Un doppione esatto si scarta per default: e' gia' nei conti.
      patch.decision = "skip";
      summary.exact += 1;
    } else if (d.probable_transaction_id) {
      flags.push("duplicate_probable");
      patch.matched_transaction_id = d.probable_transaction_id;
      // Probabile non vuol dire certo: resta da importare, ma in evidenza.
      summary.probable += 1;
    }
    if (flags.length) await addFlags(supabase, d.row_id, flags, patch);
  }

  const { data: transfers } = await supabase.rpc("find_transfer_candidates", { p_import_id: importId });
  const seen = new Set();
  for (const t of transfers ?? []) {
    if (seen.has(t.row_id)) continue;   // il primo candidato basta
    seen.add(t.row_id);
    await addFlags(supabase, t.row_id, ["transfer_candidate"], {
      transfer_match_transaction_id: t.match_transaction_id ?? null,
      transfer_match_row_id: t.match_row_id ?? null,
    });
    summary.transfers += 1;
  }

  const { data: history } = await supabase.rpc("suggest_categories_from_history", { p_import_id: importId });
  for (const h of history ?? []) {
    const { data: row } = await supabase
      .from("import_rows").select("category_id").eq("id", h.row_id).maybeSingle();
    if (row?.category_id) continue;     // regola o AI hanno gia' deciso
    await supabase.from("import_rows").update({
      category_id: h.category_id,
      category_source: "history",
      // Lo storico e' fatto di scelte dell'utente: vale quanto una regola.
      confidence: "high",
    }).eq("id", h.row_id);
    summary.fromHistory += 1;
  }

  return summary;
}

async function addFlags(supabase, rowId, newFlags, patch) {
  const { data } = await supabase.from("import_rows").select("flags").eq("id", rowId).maybeSingle();
  const flags = [...new Set([...(data?.flags ?? []), ...newFlags])];
  await supabase.from("import_rows").update({ flags, ...patch }).eq("id", rowId);
}

/** Impronta dell'intestazione: serve a ritrovare il profilo di mappatura della banca. */
export { headerFingerprint, sha256Bytes, mergeExtractions };
