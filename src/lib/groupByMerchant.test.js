// src/lib/groupByMerchant.test.js — node --test
import test from "node:test";
import assert from "node:assert/strict";
import { groupByMerchant } from "./groupByMerchant.js";

const row = (id, merchant, amount, extra = {}) => ({
  id, merchant, amount_minor: String(amount), decision: "import", category_id: null, ...extra,
});

test("mette insieme le righe dello stesso commerciante", () => {
  const g = groupByMerchant([
    row(1, "grab", -34000),
    row(2, "winmart", -152500),
    row(3, "grab", -21000),
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].merchant, "grab");
  assert.equal(g[0].rows.length, 2);
});

test("somma gli importi del gruppo", () => {
  const g = groupByMerchant([row(1, "grab", -34000), row(2, "grab", -21000)]);
  assert.equal(g[0].total, -55000n);
});

test("una riga senza importo non rompe la somma", () => {
  const g = groupByMerchant([row(1, "grab", -34000), { id: 2, merchant: "grab", amount_minor: null }]);
  assert.equal(g[0].total, -34000n);
  assert.equal(g[0].rows.length, 2);
});

test("le righe senza commerciante NON finiscono in un mucchio unico", () => {
  // Sarebbe il bug peggiore possibile: una categoria sola data a cose
  // scollegate fra loro.
  const g = groupByMerchant([row(1, null, -100), row(2, null, -200), row(3, "", -300)]);
  assert.equal(g.length, 3);
  assert.ok(g.every(x => x.rows.length === 1));
});

test("un gruppo con una sola categoria la espone", () => {
  const g = groupByMerchant([
    row(1, "grab", -100, { category_id: "trasporti" }),
    row(2, "grab", -200, { category_id: "trasporti" }),
  ]);
  assert.equal(g[0].categoryId, "trasporti");
  assert.equal(g[0].mixed, false);
});

test("un gruppo con categorie diverse e' misto e non ne propone nessuna", () => {
  // Il menu deve partire vuoto: mostrare "trasporti" farebbe credere che
  // valga per tutte e due le righe, e non e' vero.
  const g = groupByMerchant([
    row(1, "grab", -100, { category_id: "trasporti" }),
    row(2, "grab", -200, { category_id: "pasti" }),
  ]);
  assert.equal(g[0].mixed, true);
  assert.equal(g[0].categoryId, null);
});

test("categorizzato a meta' conta come misto", () => {
  const g = groupByMerchant([
    row(1, "grab", -100, { category_id: "trasporti" }),
    row(2, "grab", -200),
  ]);
  assert.equal(g[0].mixed, true);
});

test("un gruppo e' scartato solo se lo sono TUTTE le sue righe", () => {
  const tutte = groupByMerchant([
    row(1, "grab", -100, { decision: "skip" }),
    row(2, "grab", -200, { decision: "skip" }),
  ]);
  assert.equal(tutte[0].skipped, true);

  const una = groupByMerchant([
    row(1, "grab", -100, { decision: "skip" }),
    row(2, "grab", -200),
  ]);
  assert.equal(una[0].skipped, false);
});

// ── ordinamento ──────────────────────────────────────────────────────────────

test("prima quelli da categorizzare, poi i gia' fatti", () => {
  const g = groupByMerchant([
    row(1, "fatto", -100, { category_id: "spesa" }),
    row(2, "fatto", -100, { category_id: "spesa" }),
    row(3, "fatto", -100, { category_id: "spesa" }),
    row(4, "dafare", -100),
  ]);
  // "dafare" ha UNA riga contro tre, ma viene prima perche' manca la categoria.
  assert.equal(g[0].merchant, "dafare");
});

test("fra i gruppi da fare, prima il piu' numeroso", () => {
  const g = groupByMerchant([
    row(1, "piccolo", -100),
    row(2, "grande", -100),
    row(3, "grande", -100),
    row(4, "grande", -100),
  ]);
  assert.equal(g[0].merchant, "grande");
  assert.equal(g[0].rows.length, 3);
});

test("l'ordine e' stabile a parita' di tutto", () => {
  // Senza, due gruppi uguali si scambiano di posto a ogni ridisegno mentre
  // stai categorizzando, e il menu ti scappa da sotto il dito.
  const righe = [row(1, "bbb", -100), row(2, "aaa", -100), row(3, "ccc", -100)];
  const uno = groupByMerchant(righe).map(g => g.key);
  const due = groupByMerchant([...righe].reverse()).map(g => g.key);
  assert.deepEqual(uno, due);
  assert.deepEqual(uno, ["aaa", "bbb", "ccc"]);
});

test("nessuna riga, nessun gruppo", () => {
  assert.deepEqual(groupByMerchant([]), []);
  assert.deepEqual(groupByMerchant(null), []);
});

// ── il caso che ha motivato la funzione ──────────────────────────────────────

test("un estratto vero si riduce a una manciata di decisioni", () => {
  // Le proporzioni misurate sull'estratto HSBC di prova: 127 movimenti, di cui
  // 31 dello stesso servizio di trasporto e 16 dello stesso supermercato.
  const righe = [
    ...Array.from({ length: 31 }, (_, i) => row(`g${i}`, "grab a", -20000)),
    ...Array.from({ length: 16 }, (_, i) => row(`w${i}`, "wcm winmart 2ab1 hcm", -50000)),
    ...Array.from({ length: 6 }, (_, i) => row(`m${i}`, "cty tnhh ministop vn", -30000)),
    ...Array.from({ length: 3 }, (_, i) => row(`s${i}`, "shopee", -100000)),
  ];
  const g = groupByMerchant(righe);
  assert.equal(righe.length, 56);
  assert.equal(g.length, 4, "56 movimenti, 4 decisioni");
  assert.equal(g[0].rows.length, 31);
  assert.equal(g[0].total, -620000n);
});
