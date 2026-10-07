// src/lib/groupByMerchant.js
// Raggruppa le righe di un import per commerciante.
//
// E' il cuore della revisione di un estratto vero. Su un estratto HSBC di
// prova: 127 movimenti, ma 31 sono lo stesso servizio di trasporto, 16 lo
// stesso supermercato e 6 la stessa catena di minimarket. Categorizzare per
// gruppo trasforma centoventisette decisioni in una sessantina, e le prime
// quattro ne coprono gia' cinquantasei.
//
// Sta qui e non dentro il componente perche' e' logica pura: si prova senza
// montare niente.

/**
 * @param {Array} rows righe di import_rows
 * @returns {Array<{key, merchant, rows, total, categoryId, mixed, skipped}>}
 *   ordinate: prima quelle da categorizzare, poi le piu' numerose.
 */
export function groupByMerchant(rows) {
  const byKey = new Map();

  for (const r of rows ?? []) {
    // Senza un commerciante riconosciuto la riga fa gruppo a se'. Metterle
    // tutte insieme in un gruppo "sconosciuti" sarebbe peggio che inutile:
    // si finirebbe per dare una categoria sola a cose scollegate.
    const key = r.merchant || `riga:${r.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, { key, merchant: r.merchant ?? null, rows: [], total: 0n, categories: new Set() });
    }
    const g = byKey.get(key);
    g.rows.push(r);
    if (r.amount_minor != null) g.total += BigInt(r.amount_minor);
    g.categories.add(r.category_id ?? null);
  }

  return [...byKey.values()]
    .map(g => ({
      key: g.key,
      merchant: g.merchant,
      rows: g.rows,
      total: g.total,
      // Un gruppo "misto" ha righe con categorie diverse: capita quando una
      // l'hai gia' corretta a mano. Il menu allora parte VUOTO, invece di
      // mostrare la categoria di una sola riga facendo credere che valga per
      // tutte.
      categoryId: g.categories.size === 1 ? [...g.categories][0] : null,
      mixed: g.categories.size > 1,
      skipped: g.rows.every(r => r.decision === "skip"),
    }))
    .sort((a, b) => {
      // Prima quello che c'e' ancora da fare, e fra quelli i gruppi piu'
      // grossi: sono quelli che fanno risparmiare piu' tempo.
      const aDone = a.categoryId != null && !a.mixed;
      const bDone = b.categoryId != null && !b.mixed;
      if (aDone !== bDone) return aDone ? 1 : -1;
      if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
      // A parita' di tutto, un ordine stabile: senza, due gruppi uguali si
      // scambiano di posto a ogni ridisegno mentre si categorizza.
      return String(a.key).localeCompare(String(b.key));
    });
}
