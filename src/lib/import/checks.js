// src/lib/import/checks.js
// Controlli che si fanno sulle righe estratte, prima di mostrarle in revisione.
//
// Servono soprattutto quando le righe le ha lette un modello da un PDF: li'
// non c'e' un tracciato che garantisce niente, e l'unico modo di accorgersi di
// una riga saltata o letta male e' far tornare i conti col saldo progressivo.
import { dedupeHash } from "./hash.js";

/**
 * Saldo progressivo: saldo precedente + importo deve dare il saldo della riga.
 * Se una riga non torna, o ne manca una prima, o l'importo e' stato letto male.
 *
 * @returns {{ status: "ok"|"mismatch"|"not_available", mismatchedIndexes: number[] }}
 */
export function checkRunningBalance(rows) {
  const withBalance = rows.filter(r => r.balanceMinor !== null && r.balanceMinor !== undefined);
  if (withBalance.length < 2) return { status: "not_available", mismatchedIndexes: [] };

  const mismatchedIndexes = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];
    if (prev.balanceMinor == null || curr.balanceMinor == null || curr.amountMinor == null) continue;
    const expected = BigInt(prev.balanceMinor) + BigInt(curr.amountMinor);
    if (expected !== BigInt(curr.balanceMinor)) mismatchedIndexes.push(curr.rowIndex);
  }

  return {
    status: mismatchedIndexes.length === 0 ? "ok" : "mismatch",
    mismatchedIndexes,
  };
}

/**
 * Saldo iniziale e finale dichiarati dall'estratto contro la somma delle righe.
 * E' il controllo piu' forte che esista su un import: se torna, non manca
 * nessun movimento.
 */
export function checkTotals(rows, { openingMinor, closingMinor }) {
  if (openingMinor == null || closingMinor == null) return { status: "not_available", deltaMinor: null };
  let sum = 0n;
  for (const r of rows) if (r.amountMinor != null) sum += BigInt(r.amountMinor);
  const expected = BigInt(closingMinor) - BigInt(openingMinor);
  const delta = sum - expected;
  return { status: delta === 0n ? "ok" : "mismatch", deltaMinor: delta };
}

/** La valuta dell'estratto deve essere quella del conto: e' un blocco, non un avviso. */
export function checkCurrency(rows, accountCurrency) {
  const wrong = [];
  for (const r of rows) {
    if (r.currency && accountCurrency && r.currency !== accountCurrency) wrong.push(r.rowIndex);
  }
  return { status: wrong.length ? "mismatch" : "ok", mismatchedIndexes: wrong };
}

/**
 * Assegna l'impronta per il riconoscimento dei doppioni.
 * Il progressivo `occurrence` distingue righe identiche nello stesso file:
 * due caffe' uguali nello stesso giorno sono due caffe' veri, e devono
 * ottenere due impronte diverse per non annullarsi a vicenda.
 */
export async function assignDedupeHashes(rows, accountId) {
  const seen = new Map();
  const out = [];
  for (const row of rows) {
    const key = `${row.bookedOn}|${row.amountMinor}|${row.merchant ?? ""}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    out.push({
      ...row,
      dedupeHash: await dedupeHash({
        accountId,
        bookedOn: row.bookedOn,
        amountMinor: row.amountMinor,
        merchant: row.merchant,
        occurrence,
      }),
    });
  }
  return out;
}

/** Periodo coperto dall'estratto, per la scheda dell'import. */
export function periodOf(rows) {
  const dates = rows.map(r => r.bookedOn).filter(Boolean).sort();
  return { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
}
