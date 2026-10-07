// src/lib/format.js
// Formattazione con Intl, mai a mano: date, numeri, percentuali, nomi.
// Gli IMPORTI stanno in money.js, perche' hanno regole proprie (minor units
// dalla tabella `currencies`, interi e BigInt invece di float).

export function formatNumber(value, locale, opts = {}) {
  return new Intl.NumberFormat(locale, opts).format(Number(value ?? 0));
}

/** Tassi di cambio: molte cifre significative, nessun arrotondamento a 2. */
export function formatRate(value, locale) {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 8 }).format(Number(value ?? 0));
}

export function formatPercent(value, locale, opts = {}) {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2, ...opts })
    .format(Number(value ?? 0));
}

/** Accetta Date, timestamp o stringa ISO / "YYYY-MM-DD" (date pure, senza fuso). */
function asDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

export function formatDate(value, locale, opts = { dateStyle: "medium" }) {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

export function formatDateTime(value, locale) {
  return formatDate(value, locale, { dateStyle: "medium", timeStyle: "short" });
}

/** Nome della valuta nella lingua corrente ("Euro", "Dong vietnamita", ...). */
export function currencyName(code, locale) {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch { return code; }
}

/** Nome del paese nella lingua corrente, da codice ISO 3166-1 alpha-2. */
export function countryName(code, locale) {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch { return code; }
}
