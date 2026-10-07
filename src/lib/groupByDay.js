// src/lib/groupByDay.js
// Raggruppa righe datate per giorno, con "Oggi" e "Ieri" al posto della data.
//
// Il confronto si fa fra STRINGHE "YYYY-MM-DD", non fra oggetti Date. Le date
// dei movimenti sono giorni di calendario, non istanti: `booked_on` e' un
// `date` in Postgres. Passando da Date si tirerebbe dentro il fuso orario del
// browser, e a Hanoi un movimento del 1 settembre diventerebbe del 31 agosto
// per chi guarda da Roma.

/** "YYYY-MM-DD" di oggi nel fuso LOCALE: "oggi" e' quello di chi guarda. */
export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Il giorno prima di una data ISO, sempre come stringa. */
export function previousIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  probe.setUTCDate(probe.getUTCDate() - 1);
  return probe.toISOString().slice(0, 10);
}

/**
 * @param rows   le righe da raggruppare
 * @param dateOf come si ricava la data da una riga (default: `booked_on`)
 * @param today  "YYYY-MM-DD", per poterlo fissare nei test
 * @returns [{ key, label: "today"|"yesterday"|null, rows }] in ordine di data
 *          decrescente: l'ultimo movimento e' quello che si vuole vedere per
 *          primo.
 */
export function groupByDay(rows, { dateOf = r => r.booked_on, today = todayIso() } = {}) {
  const yesterday = previousIso(today);
  const byKey = new Map();

  for (const row of rows ?? []) {
    const key = dateOf(row);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }

  return [...byKey.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map(key => ({
      key,
      label: key === today ? "today" : key === yesterday ? "yesterday" : null,
      rows: byKey.get(key),
    }));
}

/**
 * Somma per categoria, in valuta base. Serve al mini-grafico delle spese.
 * I trasferimenti e gli acquisti di investimenti restano FUORI: non sono
 * spese, sono soldi che cambiano posto.
 */
export function spendingByCategory(rows) {
  const totals = new Map();
  let total = 0n;

  for (const r of rows ?? []) {
    if (r.kind === "transfer" || r.kind === "investment") continue;
    if (r.amount_base_minor === null || r.amount_base_minor === undefined) continue;
    const v = BigInt(r.amount_base_minor);
    if (v >= 0n) continue;              // le entrate non sono spese

    const key = r.category_id ?? "none";
    totals.set(key, (totals.get(key) ?? 0n) + (-v));
    total += -v;
  }

  return {
    total,
    rows: [...totals.entries()]
      .map(([categoryId, minor]) => ({ categoryId, minor }))
      .sort((a, b) => (b.minor > a.minor ? 1 : b.minor < a.minor ? -1 : 0)),
  };
}

/**
 * Entrate e uscite di un periodo, in valuta base.
 *
 * Serve al prospetto della Home, che il brief chiede di aprire con entrate,
 * uscite e risparmio del mese. Come `spendingByCategory`, lascia FUORI
 * trasferimenti e acquisti di investimenti: spostare soldi fra due conti
 * propri o comprare un ETF non e' ne' guadagnare ne' spendere, e contarli
 * gonfierebbe tutte e due le colonne con la stessa cifra.
 *
 * `saved` puo' essere negativo: in un mese in cui si e' speso piu' di quanto
 * si e' incassato, dirlo e' il punto.
 */
export function periodFlows(rows) {
  let income = 0n;
  let expenses = 0n;

  for (const r of rows ?? []) {
    if (r.kind === "transfer" || r.kind === "investment") continue;
    if (r.amount_base_minor === null || r.amount_base_minor === undefined) continue;
    const v = BigInt(r.amount_base_minor);
    if (v > 0n) income += v;
    else expenses += -v;
  }

  return { income, expenses, saved: income - expenses };
}
