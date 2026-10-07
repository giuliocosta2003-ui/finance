// src/lib/groupByDay.test.js — node --test
import test from "node:test";
import assert from "node:assert/strict";
import { groupByDay, periodFlows, previousIso, spendingByCategory, todayIso } from "./groupByDay.js";

const OGGI = "2026-09-22";

test("oggi e ieri diventano etichette, il resto resta una data", () => {
  const rows = [
    { id: 1, booked_on: "2026-09-22" },
    { id: 2, booked_on: "2026-09-21" },
    { id: 3, booked_on: "2026-09-15" },
  ];
  const groups = groupByDay(rows, { today: OGGI });
  assert.deepEqual(groups.map(g => g.label), ["today", "yesterday", null]);
  assert.deepEqual(groups.map(g => g.key), ["2026-09-22", "2026-09-21", "2026-09-15"]);
});

test("i gruppi vanno dal piu' recente al piu' vecchio", () => {
  const rows = [
    { booked_on: "2026-09-01" },
    { booked_on: "2026-09-22" },
    { booked_on: "2026-09-10" },
  ];
  assert.deepEqual(
    groupByDay(rows, { today: OGGI }).map(g => g.key),
    ["2026-09-22", "2026-09-10", "2026-09-01"],
  );
});

test("le righe dello stesso giorno restano insieme e nell'ordine ricevuto", () => {
  const rows = [
    { id: "a", booked_on: "2026-09-22" },
    { id: "b", booked_on: "2026-09-21" },
    { id: "c", booked_on: "2026-09-22" },
  ];
  const [oggi] = groupByDay(rows, { today: OGGI });
  assert.deepEqual(oggi.rows.map(r => r.id), ["a", "c"]);
});

test("il giorno prima funziona anche a cavallo di mese e di anno", () => {
  assert.equal(previousIso("2026-09-01"), "2026-08-31");
  assert.equal(previousIso("2026-01-01"), "2025-12-31");
  // Il 2028 e' bisestile: il giorno prima del primo marzo e' il 29 febbraio.
  assert.equal(previousIso("2028-03-01"), "2028-02-29");
  assert.equal(previousIso("2026-03-01"), "2026-02-28");
});

test("righe senza data si ignorano invece di creare un gruppo vuoto", () => {
  const groups = groupByDay([{ booked_on: null }, { booked_on: "2026-09-22" }], { today: OGGI });
  assert.equal(groups.length, 1);
});

test("nessuna riga, nessun gruppo", () => {
  assert.deepEqual(groupByDay([], { today: OGGI }), []);
  assert.deepEqual(groupByDay(null, { today: OGGI }), []);
});

test("todayIso usa il giorno LOCALE, non quello UTC", () => {
  // A Hanoi (UTC+7) l'una di notte del 22 e' ancora il 21 in UTC: "oggi" deve
  // restare il 22, perche' e' il giorno di chi sta guardando lo schermo.
  const mezzanottePassata = new Date(2026, 8, 22, 1, 0, 0);
  assert.equal(todayIso(mezzanottePassata), "2026-09-22");
});

// ── spese per categoria ──────────────────────────────────────────────────────

test("le spese si sommano per categoria, le entrate no", () => {
  const rows = [
    { kind: "expense", category_id: "cibo", amount_base_minor: -3000 },
    { kind: "expense", category_id: "cibo", amount_base_minor: -1500 },
    { kind: "expense", category_id: "casa", amount_base_minor: -95000 },
    { kind: "income",  category_id: "stip", amount_base_minor: 250000 },
  ];
  const { total, rows: out } = spendingByCategory(rows);
  assert.equal(total, 99500n);
  assert.deepEqual(out, [
    { categoryId: "casa", minor: 95000n },
    { categoryId: "cibo", minor: 4500n },
  ]);
});

test("trasferimenti e acquisti di investimenti non sono spese", () => {
  // Spostare soldi fra due conti propri, o comprare un ETF, non e' spendere:
  // contarli gonfierebbe le spese del mese di tutto il capitale investito.
  const rows = [
    { kind: "transfer",   category_id: null, amount_base_minor: -50000 },
    { kind: "investment", category_id: null, amount_base_minor: -500000 },
    { kind: "expense",    category_id: "cibo", amount_base_minor: -3000 },
  ];
  const { total, rows: out } = spendingByCategory(rows);
  assert.equal(total, 3000n);
  assert.equal(out.length, 1);
});

test("un movimento senza controvalore non si conta a zero: si salta", () => {
  // amount_base_minor null vuol dire "manca il tasso di cambio". Contarlo come
  // zero direbbe che quel giorno non hai speso niente, che e' falso.
  const { total } = spendingByCategory([
    { kind: "expense", category_id: "cibo", amount_base_minor: null },
    { kind: "expense", category_id: "cibo", amount_base_minor: -1000 },
  ]);
  assert.equal(total, 1000n);
});

test("le spese senza categoria finiscono sotto 'none'", () => {
  const { rows } = spendingByCategory([
    { kind: "expense", category_id: null, amount_base_minor: -700 },
  ]);
  assert.deepEqual(rows, [{ categoryId: "none", minor: 700n }]);
});

// ── periodFlows ──────────────────────────────────────────────────────────────

test("periodFlows separa entrate e uscite e ne fa la differenza", () => {
  const { income, expenses, saved } = periodFlows([
    { kind: "income",  amount_base_minor: "250000" },
    { kind: "expense", amount_base_minor: "-80000" },
    { kind: "expense", amount_base_minor: "-20000" },
  ]);
  assert.equal(income, 250000n);
  assert.equal(expenses, 100000n);
  assert.equal(saved, 150000n);
});

test("periodFlows ignora trasferimenti e investimenti", () => {
  // Le due righe di un trasferimento si annullerebbero nel saldo ma
  // gonfierebbero di pari importo sia le entrate sia le uscite: il risparmio
  // resterebbe giusto e le due colonne sopra sarebbero false.
  const { income, expenses, saved } = periodFlows([
    { kind: "income",     amount_base_minor: "100000" },
    { kind: "transfer",   amount_base_minor: "-500000" },
    { kind: "transfer",   amount_base_minor: "500000" },
    { kind: "investment", amount_base_minor: "-300000" },
  ]);
  assert.equal(income, 100000n);
  assert.equal(expenses, 0n);
  assert.equal(saved, 100000n);
});

test("periodFlows salta le righe senza controvalore invece di contarle zero", () => {
  // Un movimento senza tasso di cambio non vale zero: vale "non si sa".
  const { income, expenses } = periodFlows([
    { kind: "income",  amount_base_minor: null },
    { kind: "expense", amount_base_minor: "-4200" },
  ]);
  assert.equal(income, 0n);
  assert.equal(expenses, 4200n);
});

test("periodFlows dichiara un risparmio negativo invece di fermarlo a zero", () => {
  const { saved } = periodFlows([
    { kind: "income",  amount_base_minor: "50000" },
    { kind: "expense", amount_base_minor: "-90000" },
  ]);
  assert.equal(saved, -40000n);
});
