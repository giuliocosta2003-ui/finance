// src/lib/ai-payload.test.js — node --test
// Cosa esce verso Claude e cosa si accetta indietro.
import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeRowForAi, buildCategorizePayload, payloadLeaks, validateCategorization,
} from "./ai-payload.js";

const righe = [
  {
    row_index: 0,
    booked_on: "2026-09-03",
    description: "BONIFICO A FAVORE DI ACME SRL IT60X0542811101000000123456",
    amount_minor: -120000,
    currency: "EUR",
  },
  {
    row_index: 1,
    booked_on: "2026-09-01",
    description: "POS 01/09 ESSELUNGA MILANO CARTA 4321 0000 0000 1234",
    amount_minor: -4530,
    currency: "EUR",
  },
  {
    row_index: 2,
    booked_on: "2026-09-05",
    description: "ACCREDITO STIPENDIO SETTEMBRE",
    amount_minor: 250000,
    currency: "EUR",
  },
];

const categorie = [
  { id: "cat-spesa",     key: "groceries", name: null, kind: "expense", is_business: false, archived_at: null },
  { id: "cat-stipendio", key: "salary",    name: null, kind: "income",  is_business: false, archived_at: null },
  { id: "cat-archiviata", key: "old",      name: "Vecchia", kind: "expense", is_business: false, archived_at: "2026-01-01" },
];

test("della riga escono solo data, testo pulito, segno e valuta", () => {
  const out = sanitizeRowForAi(righe[1]);
  assert.deepEqual(out, { i: 1, d: "2026-09-01", t: "esselunga milano", s: "-", c: "EUR" });
  // L'importo esatto non serve per scegliere la categoria, quindi non parte.
  assert.equal("amount_minor" in out, false);
  assert.equal(Object.values(out).includes(-4530), false);
});

test("IBAN e numeri di carta non arrivano mai nel payload", () => {
  const payload = buildCategorizePayload({ rows: righe, categories: categorie, profileType: "entrepreneur" });
  const testo = JSON.stringify(payload);

  assert.ok(!testo.includes("IT60X0542811101000000123456"), "l'IBAN e' sparito");
  assert.ok(!testo.includes("4321"), "il numero di carta e' sparito");
  assert.deepEqual(payloadLeaks(payload), [], "nessuna perdita riconoscibile");

  // Quello che serve invece c'e'. La forma societaria ("srl") si toglie: cosi'
  // "acme" e "acme srl" finiscono nello stesso gruppo e nella stessa regola.
  assert.equal(payload.rows[0].t, "acme");
  assert.equal(payload.rows[2].s, "+");
  assert.equal(payload.profile_type, "entrepreneur");
});

test("le categorie archiviate non vengono proposte al modello", () => {
  const payload = buildCategorizePayload({ rows: righe, categories: categorie });
  assert.deepEqual(payload.categories.map(c => c.id), ["cat-spesa", "cat-stipendio"]);
});

test("il nome della categoria e' quello tradotto che vede l'utente", () => {
  const payload = buildCategorizePayload({
    rows: righe, categories: categorie,
    labelOf: (c) => ({ groceries: "Spesa", salary: "Stipendio" })[c.key] ?? c.key,
  });
  assert.deepEqual(payload.categories.map(c => c.name), ["Spesa", "Stipendio"]);
});

test("una categoria inventata dal modello viene scartata", () => {
  const risposta = {
    assignments: [
      { i: 0, category_id: "cat-spesa", unsure: false },
      { i: 1, category_id: "cat-inventata-dal-modello", unsure: false },
      { i: 2, category_id: null, unsure: false },
    ],
  };
  const { assignments, rejected } = validateCategorization(risposta, ["cat-spesa", "cat-stipendio"]);

  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].category_id, "cat-inventata-dal-modello");
  // La riga rifiutata resta senza categoria, non con una categoria a caso.
  assert.deepEqual(assignments[1], { i: 1, categoryId: null, confidence: "low" });
  assert.deepEqual(assignments[0], { i: 0, categoryId: "cat-spesa", confidence: "medium" });
  assert.deepEqual(assignments[2], { i: 2, categoryId: null, confidence: "low" });
});

test("la confidenza e' la fonte, non un numero del modello", () => {
  const { assignments } = validateCategorization({
    assignments: [
      { i: 0, category_id: "cat-spesa", unsure: false },
      { i: 1, category_id: "cat-spesa", unsure: true },
    ],
  }, ["cat-spesa"]);
  // Dall'AI non si sale mai sopra "medium", e l'incertezza dichiarata scende a "low".
  assert.equal(assignments[0].confidence, "medium");
  assert.equal(assignments[1].confidence, "low");
});

test("risposte malformate non fanno danni", () => {
  assert.deepEqual(validateCategorization(null, ["x"]), { assignments: [], rejected: [] });
  assert.deepEqual(validateCategorization({}, ["x"]), { assignments: [], rejected: [] });
  const { assignments } = validateCategorization(
    { assignments: [{ category_id: "x" }, { i: "due", category_id: "x" }] }, ["x"]);
  assert.equal(assignments.length, 0, "le righe senza indice numerico si ignorano");
});
