// src/lib/money.js
// Importi: sempre interi in minor units (BIGINT sul database), mai float.
// I decimali arrivano dalla tabella `currencies`; l'ultimo paracadute e' Intl,
// usato solo se la tabella non e' ancora stata caricata.
//
// Il motivo di tutto questo: 0.1 + 0.2 non fa 0.3 in virgola mobile. Su un
// registro di soldi quell'errore si accumula e i conti non tornano piu'.
// Qui si lavora su stringhe e BigInt, dove 25.000 VND e 1,234.56 EUR sono
// esatti per costruzione.

const intlUnitsCache = new Map();

/** Decimali della valuta secondo Intl. Fallback quando non abbiamo `currencies`. */
export function intlMinorUnits(currency) {
  if (!currency) return 2;
  const code = String(currency).trim().toUpperCase();
  if (intlUnitsCache.has(code)) return intlUnitsCache.get(code);
  let units = 2;
  try {
    units = new Intl.NumberFormat("en", { style: "currency", currency: code })
      .resolvedOptions().maximumFractionDigits;
  } catch { /* codice sconosciuto: restano 2 */ }
  intlUnitsCache.set(code, units);
  return units;
}

/** Separatore decimale della lingua: "," per l'italiano, "." per l'inglese. */
export function decimalSeparator(locale) {
  try {
    return new Intl.NumberFormat(locale).formatToParts(1.1)
      .find(p => p.type === "decimal")?.value ?? ".";
  } catch { return "."; }
}

/**
 * Da testo digitato dall'utente a intero in minor units.
 *
 * Accetta sia la virgola sia il punto: con entrambi presenti l'ultimo e' il
 * decimale ("1.234,56" e "1,234.56" valgono lo stesso). Con uno solo decide la
 * lingua, perche' "1.500" vale millecinquecento in italiano e uno virgola
 * cinque in inglese. Se la valuta non ha decimali (VND, JPY) ogni separatore
 * e' una separazione delle migliaia.
 *
 * @returns {bigint|null} null se non c'e' un numero riconoscibile
 */
export function parseAmount(input, minorUnits = 2, locale = "it") {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  // Il segno: meno davanti, meno in coda (alcune banche lo scrivono cosi')
  // oppure importo fra parentesi (lo fanno i fogli di calcolo).
  const negative = s.startsWith("-") || s.endsWith("-") || /^\(.*\)$/.test(s);
  s = s.replace(/[^0-9.,]/g, "");
  if (!s) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decPos = -1;
  if (minorUnits > 0) {
    if (lastDot >= 0 && lastComma >= 0) {
      decPos = Math.max(lastDot, lastComma);
    } else {
      const dec = decimalSeparator(locale);
      if (lastDot >= 0 && dec === ".") decPos = lastDot;
      if (lastComma >= 0 && dec === ",") decPos = lastComma;
    }
  }

  const intDigits = (decPos >= 0 ? s.slice(0, decPos) : s).replace(/\D/g, "");
  const fracDigits = (decPos >= 0 ? s.slice(decPos + 1) : "").replace(/\D/g, "");
  if (!intDigits && !fracDigits) return null;

  const kept = fracDigits.slice(0, minorUnits).padEnd(minorUnits, "0");
  let value = BigInt((intDigits + kept) || "0");

  // Arrotondamento commerciale sulla prima cifra scartata.
  const next = fracDigits[minorUnits];
  if (next && Number(next) >= 5) value += 1n;

  return negative ? -value : value;
}

/**
 * Minor units -> stringa nelle unita' maggiori, esatta (niente float).
 * Es. (2599699, 2) -> "25996.99"
 */
export function toMajorString(minor, minorUnits = 2) {
  const n = BigInt(minor ?? 0);
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(minorUnits + 1, "0");
  const cut = digits.length - minorUnits;
  const intPart = digits.slice(0, cut);
  const fracPart = minorUnits > 0 ? digits.slice(cut) : "";
  return `${negative ? "-" : ""}${intPart}${fracPart ? "." + fracPart : ""}`;
}

/** Comodo per i grafici e i confronti, non per i calcoli sul denaro. */
export function toMajorNumber(minor, minorUnits = 2) {
  return Number(toMajorString(minor, minorUnits));
}

/**
 * Importo formattato nella valuta indicata.
 * Passa `minorUnits` preso da `currencies`; senza, lo chiede a Intl.
 * Il valore viene dato a Intl come STRINGA: cosi' anche un importo enorme in
 * VND resta esatto, mentre come Number perderebbe cifre.
 */
export function formatMoney(minor, currency, locale, minorUnits, opts = {}) {
  const code = String(currency ?? "EUR").trim().toUpperCase();
  const units = minorUnits ?? intlMinorUnits(code);
  const value = toMajorString(minor, units);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: units,
      maximumFractionDigits: units,
      ...opts,
    }).format(value);
  } catch {
    return `${value} ${code}`;
  }
}

/**
 * Lo stesso importo di `formatMoney`, ma spezzato nelle sue parti.
 *
 * Serve al componente Amount, che mostra i decimali piu' piccoli e piu'
 * chiari: per farlo deve sapere dove finisce la parte intera, e la posizione
 * del simbolo e del separatore cambia da lingua a lingua ("1.234,56 €" contro
 * "$1,234.56"). Lo chiede a Intl invece di tagliare la stringa a mano.
 *
 * `head` e' tutto fino alla parte intera compresa, `tail` il separatore
 * decimale con i centesimi, `rest` quello che viene dopo (simbolo e spazio,
 * nelle lingue che lo mettono in fondo). Concatenati danno esattamente quello
 * che restituisce formatMoney.
 */
export function formatMoneyParts(minor, currency, locale, minorUnits) {
  const code = String(currency ?? "EUR").trim().toUpperCase();
  const units = minorUnits ?? intlMinorUnits(code);
  const value = toMajorString(minor, units);

  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: units,
      maximumFractionDigits: units,
    }).formatToParts(value);

    const decimalAt = parts.findIndex(p => p.type === "decimal");
    if (decimalAt < 0) {
      // Valute senza decimali (VND, JPY): non c'e' niente da rimpicciolire.
      return { head: parts.map(p => p.value).join(""), tail: "", rest: "" };
    }

    // Dopo i centesimi puo' restare il simbolo, nelle lingue che lo postpongono.
    let end = decimalAt + 1;
    while (end < parts.length && parts[end].type === "fraction") end++;

    return {
      head: parts.slice(0, decimalAt).map(p => p.value).join(""),
      tail: parts.slice(decimalAt, end).map(p => p.value).join(""),
      rest: parts.slice(end).map(p => p.value).join(""),
    };
  } catch {
    return { head: `${value} ${code}`, tail: "", rest: "" };
  }
}

/** Solo il numero, senza simbolo: serve nei campi di input. */
export function formatAmountPlain(minor, locale, minorUnits = 2) {
  const value = toMajorString(minor, minorUnits);
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: minorUnits,
      maximumFractionDigits: minorUnits,
      useGrouping: false,
    }).format(value);
  } catch {
    return value;
  }
}

/** Il segno decide il colore: entrata, uscita o zero. */
export function amountTone(minor) {
  const n = BigInt(minor ?? 0);
  if (n > 0n) return "in";
  if (n < 0n) return "out";
  return "zero";
}
