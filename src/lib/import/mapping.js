// src/lib/import/mapping.js
// Dalla tabella grezza del file alle righe normalizzate.
//
// Tutto qui dentro e' deterministico: stesse colonne, stesso risultato, senza
// AI di mezzo. L'AI serve solo a PROPORRE la mappatura quando l'euristica non
// riconosce le colonne; una volta che la mappatura c'e', il file lo legge
// questo codice, che e' ripetibile e testabile.
import { parseAmount } from "../money.js";
import { normalizeMerchant } from "../merchant.js";

// ── date ─────────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");
const toIso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Una data esiste davvero? Il 31 febbraio no. */
function validDate(y, m, d) {
  if (!(y >= 1900 && y <= 2200) || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function splitDateParts(text) {
  const m = String(text).trim().match(/^(\d{1,4})[/.\-\s](\d{1,2})[/.\-\s](\d{1,4})/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const expandYear = (y) => (y >= 100 ? y : y <= 68 ? 2000 + y : 1900 + y);

/**
 * Deduce il formato guardando i valori: un giorno maggiore di 12 non puo'
 * essere un mese, e questo da solo scioglie quasi sempre l'ambiguita'.
 * @returns {"ISO"|"DMY"|"MDY"|"ambiguous"}
 */
export function inferDateFormat(samples) {
  let sawFirstOverTwelve = false;
  let sawSecondOverTwelve = false;
  let sawAny = false;

  for (const raw of samples ?? []) {
    if (raw instanceof Date) return "ISO";
    const text = String(raw ?? "").trim();
    if (!text) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return "ISO";
    const parts = splitDateParts(text);
    if (!parts) continue;
    sawAny = true;
    const [a, b] = parts;
    if (a > 31) return "ISO";      // primo campo a quattro cifre
    if (a > 12) sawFirstOverTwelve = true;
    if (b > 12) sawSecondOverTwelve = true;
  }

  if (sawFirstOverTwelve && !sawSecondOverTwelve) return "DMY";
  if (sawSecondOverTwelve && !sawFirstOverTwelve) return "MDY";
  return sawAny ? "ambiguous" : "ambiguous";
}

/**
 * @param {string|number|Date} value
 * @param {"ISO"|"DMY"|"MDY"} format
 * @returns {string|null} "YYYY-MM-DD"
 */
export function parseDate(value, format = "DMY") {
  if (value == null || value === "") return null;

  // XLSX con cellDates restituisce Date; il foglio e' gia' in data locale.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  // Excel tiene le date come numero di giorni dal 30/12/1899.
  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    const ms = Math.round(value) * 86400000 + Date.UTC(1899, 11, 30);
    const d = new Date(ms);
    return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso.map(Number);
    return validDate(y, m, d) ? toIso(y, m, d) : null;
  }

  const parts = splitDateParts(text);
  if (!parts) return null;
  let [a, b, c] = parts;

  let y, m, d;
  if (a > 31 || format === "ISO") { y = expandYear(a); m = b; d = c; }
  else if (format === "MDY")      { m = a; d = b; y = expandYear(c); }
  else                            { d = a; m = b; y = expandYear(c); }

  return validDate(y, m, d) ? toIso(y, m, d) : null;
}

// ── importi ──────────────────────────────────────────────────────────────────

/**
 * Virgola o punto come separatore decimale? Si guardano i valori veri: se un
 * numero ha entrambi i segni, l'ultimo e' il decimale; se ne ha uno solo con
 * esattamente tre cifre dopo, quasi sempre sono migliaia.
 */
export function inferDecimalSeparator(samples) {
  let comma = 0, dot = 0;
  for (const raw of samples ?? []) {
    const text = String(raw ?? "").trim();
    if (!text) continue;
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) comma++; else dot++;
      continue;
    }
    const only = lastComma >= 0 ? "," : lastDot >= 0 ? "." : null;
    if (!only) continue;
    const after = text.slice((only === "," ? lastComma : lastDot) + 1).replace(/\D/g, "");
    if (after.length === 3) continue;            // migliaia: non dice niente
    if (only === ",") comma++; else dot++;
  }
  return comma >= dot && comma > 0 ? "," : ".";
}

/** parseAmount ragiona per lingua: qui gli si passa quella giusta per il separatore. */
const localeFor = (separator) => (separator === "," ? "it" : "en");

// ── euristica di mappatura ───────────────────────────────────────────────────

const HINTS = {
  date:        ["data", "data valuta", "data contabile", "data operazione", "date", "booking date",
                "value date", "transaction date", "ngay", "ngay giao dich"],
  description: ["descrizione", "causale", "dettagli", "description", "details", "narrative",
                "memo", "note", "noi dung", "dien giai"],
  amount:      ["importo", "amount", "valore", "so tien", "value"],
  debit:       ["dare", "uscite", "addebiti", "debit", "withdrawal", "paid out", "ghi no"],
  credit:      ["avere", "entrate", "accrediti", "credit", "deposit", "paid in", "ghi co"],
  balance:     ["saldo", "balance", "so du"],
};

const normalizeHeader = (h) =>
  String(h ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function findColumn(headers, hints) {
  const normalized = headers.map(normalizeHeader);
  // Prima il nome esatto, poi il contenimento: "data valuta" deve battere
  // "data" solo se la colonna si chiama proprio cosi'.
  for (const hint of hints) {
    const i = normalized.indexOf(hint);
    if (i >= 0) return headers[i];
  }
  for (const hint of hints) {
    const i = normalized.findIndex(h => h.includes(hint));
    if (i >= 0) return headers[i];
  }
  return null;
}

/**
 * Proposta di mappatura dai soli nomi delle colonne e da qualche riga.
 * Se riconosce data e importo, la schermata di mappatura parte gia' compilata
 * e non serve chiamare l'AI: un CSV bancario tipico si legge senza.
 */
export function guessMapping(headers, sampleRows = []) {
  const dateColumn = findColumn(headers, HINTS.date);
  const amountColumn = findColumn(headers, HINTS.amount);
  const debitColumn = findColumn(headers, HINTS.debit);
  const creditColumn = findColumn(headers, HINTS.credit);
  const balanceColumn = findColumn(headers, HINTS.balance);
  const descriptionColumn = findColumn(headers, HINTS.description);

  const amountMode = !amountColumn && debitColumn && creditColumn ? "debit_credit" : "single";

  const valueSamples = [];
  for (const row of sampleRows.slice(0, 20)) {
    for (const col of [amountColumn, debitColumn, creditColumn].filter(Boolean)) {
      if (row[col] != null && row[col] !== "") valueSamples.push(row[col]);
    }
  }
  const dateSamples = dateColumn ? sampleRows.map(r => r[dateColumn]) : [];
  const detectedFormat = inferDateFormat(dateSamples);

  return {
    dateColumn,
    dateFormat: detectedFormat === "ambiguous" ? "DMY" : detectedFormat,
    dateAmbiguous: detectedFormat === "ambiguous",
    amountMode,
    amountColumn: amountMode === "single" ? amountColumn : null,
    debitColumn: amountMode === "debit_credit" ? debitColumn : null,
    creditColumn: amountMode === "debit_credit" ? creditColumn : null,
    debitSign: "negative",
    signConvention: "as_is",
    descriptionColumns: descriptionColumn ? [descriptionColumn] : [],
    balanceColumn,
    decimalSeparator: inferDecimalSeparator(valueSamples),
    skipRows: 0,
  };
}

/** Una mappatura basta a se stessa? Serve almeno la data e un modo di leggere l'importo. */
export function mappingIsComplete(mapping) {
  if (!mapping?.dateColumn) return false;
  if (mapping.amountMode === "debit_credit") return !!(mapping.debitColumn || mapping.creditColumn);
  return !!mapping.amountColumn;
}

// ── applicazione ─────────────────────────────────────────────────────────────

/**
 * @param {object[]} rows righe grezze (oggetti colonna -> valore)
 * @param {object} mapping
 * @param {object} ctx { currency, minorUnits }
 * @returns {object[]} righe normalizzate, pronte per import_rows
 */
export function applyMapping(rows, mapping, ctx) {
  const { currency, minorUnits } = ctx;
  const locale = localeFor(mapping.decimalSeparator);
  const out = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const flags = [];

    const bookedOn = parseDate(raw[mapping.dateColumn], mapping.dateFormat);
    if (!bookedOn) flags.push("parse_warning");
    else if (mapping.dateAmbiguous) flags.push("date_ambiguous");

    let amountMinor = null;
    if (mapping.amountMode === "debit_credit") {
      const debitRaw = mapping.debitColumn ? raw[mapping.debitColumn] : null;
      const creditRaw = mapping.creditColumn ? raw[mapping.creditColumn] : null;
      const debit = parseAmount(debitRaw, minorUnits, locale);
      const credit = parseAmount(creditRaw, minorUnits, locale);
      if (debit !== null && debit !== 0n) {
        // Alcune banche scrivono i dare gia' col meno, altre no: lo dice la mappatura.
        const magnitude = debit < 0n ? -debit : debit;
        amountMinor = mapping.debitSign === "positive" ? -magnitude : (debit < 0n ? debit : -magnitude);
      } else if (credit !== null && credit !== 0n) {
        amountMinor = credit < 0n ? -credit : credit;
      }
    } else {
      amountMinor = parseAmount(raw[mapping.amountColumn], minorUnits, locale);
      if (amountMinor !== null && mapping.signConvention === "invert") amountMinor = -amountMinor;
    }

    if (amountMinor === null || amountMinor === 0n) {
      // Riga senza importo: quasi sempre un totale o una riga di intestazione
      // ripetuta a meta' file. Si tiene, marcata, e l'utente decide.
      flags.push("parse_warning");
    }

    const description = (mapping.descriptionColumns ?? [])
      .map(col => raw[col])
      .filter(v => v != null && String(v).trim() !== "")
      .map(v => String(v).trim())
      .join(" ")
      .trim();

    const balanceMinor = mapping.balanceColumn
      ? parseAmount(raw[mapping.balanceColumn], minorUnits, locale)
      : null;

    out.push({
      rowIndex: i,
      raw,
      bookedOn,
      description: description || null,
      merchant: normalizeMerchant(description) || null,
      amountMinor,
      balanceMinor,
      currency,
      flags,
    });
  }

  return out;
}
