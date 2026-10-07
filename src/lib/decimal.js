// src/lib/decimal.js
// Quantita' e prezzi unitari: gli unici numeri dell'app che NON sono importi.
//
// Un importo e' sempre un intero in minor units (regola di fase 2). Una
// quantita' di 0,00000001 BTC e un prezzo di 0,0000000234 EUR no: in minor
// units servirebbero decine di decimali inventati, e infatti nel database sono
// NUMERIC. Qui si prende quello che l'utente scrive e lo si porta in forma
// canonica come STRINGA, che Postgres converte in NUMERIC senza perdere nulla.
//
// Mai `parseFloat`: `parseFloat("0.1") + parseFloat("0.2")` non fa 0,3, e su
// una quantita' di crypto quell'errore si propaga a ogni calcolo dopo.

/**
 * "1.234,56" -> "1234.56", "0,5" -> "0.5", "1234.56" -> "1234.56".
 *
 * Se ci sono entrambi i separatori, l'ULTIMO e' quello decimale e l'altro
 * separa le migliaia: e' l'unica lettura che funziona sia per "1.234,56" sia
 * per "1,234.56". Con un separatore solo si assume che sia il decimale, perche'
 * scrivere le migliaia in un campo quantita' e' molto piu' raro che scrivere
 * dei decimali.
 *
 * @returns {string|null} forma canonica col punto, oppure null se non e' un numero
 */
export function parseDecimal(text) {
  if (text === null || text === undefined) return null;
  let s = String(text).trim().replace(/\s/g, "");
  if (s === "") return null;

  let sign = "";
  if (s.startsWith("-")) { sign = "-"; s = s.slice(1); }
  else if (s.startsWith("+")) { s = s.slice(1); }

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    const whole = s.slice(0, decimalAt).replace(/[.,]/g, "");
    const frac = s.slice(decimalAt + 1);
    s = frac === "" ? whole : `${whole}.${frac}`;
  } else if (lastComma >= 0) {
    s = s.replace(",", ".");
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  // "007" -> "7", ma "0.5" resta "0.5".
  const normalized = s.replace(/^0+(?=\d)/, "");
  return sign + normalized;
}

/** Il numero e' valido e maggiore di zero? Serve alle quantita'. */
export function isPositiveDecimal(text) {
  const d = parseDecimal(text);
  return d !== null && !/^-/.test(d) && /[1-9]/.test(d);
}

/** Valido e non negativo: serve ai prezzi, dove lo zero e' ammesso. */
export function isNonNegativeDecimal(text) {
  const d = parseDecimal(text);
  return d !== null && !d.startsWith("-");
}

/** Gli zeri finali di una quantita' a 18 decimali sono solo rumore. */
export function trimDecimal(value) {
  const s = String(value ?? "");
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}
