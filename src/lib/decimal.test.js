// src/lib/decimal.test.js — node --test
// Quantita' e prezzi: gli unici numeri dell'app che non sono importi interi.
import test from "node:test";
import assert from "node:assert/strict";
import { parseDecimal, isPositiveDecimal, isNonNegativeDecimal, trimDecimal } from "./decimal.js";

test("con due separatori l'ultimo e' il decimale", () => {
  assert.equal(parseDecimal("1.234,56"), "1234.56");   // italiano
  assert.equal(parseDecimal("1,234.56"), "1234.56");   // inglese
  assert.equal(parseDecimal("1.234.567,89"), "1234567.89");
  assert.equal(parseDecimal("1,234,567.89"), "1234567.89");
});

test("con un separatore solo si assume che sia il decimale", () => {
  // In un campo quantita' i decimali sono molto piu' frequenti delle migliaia.
  assert.equal(parseDecimal("0,5"), "0.5");
  assert.equal(parseDecimal("0.5"), "0.5");
  assert.equal(parseDecimal("1,5"), "1.5");
});

test("la precisione delle crypto non si perde per strada", () => {
  assert.equal(parseDecimal("0,00000001"), "0.00000001");
  assert.equal(parseDecimal("123456789,000000000000000001"), "123456789.000000000000000001");
  assert.equal(parseDecimal("0.0000000234"), "0.0000000234");
});

test("segni e spazi", () => {
  assert.equal(parseDecimal(" 12 "), "12");
  assert.equal(parseDecimal("+12"), "12");
  assert.equal(parseDecimal("-12,5"), "-12.5");
  assert.equal(parseDecimal("1 234,56"), "1234.56");
});

test("gli zeri iniziali spariscono, quelli dopo la virgola no", () => {
  assert.equal(parseDecimal("007"), "7");
  assert.equal(parseDecimal("0,50"), "0.50");
  assert.equal(parseDecimal("0"), "0");
});

test("quello che non e' un numero non diventa una quantita'", () => {
  assert.equal(parseDecimal("dieci"), null);
  assert.equal(parseDecimal(""), null);
  assert.equal(parseDecimal("1..2"), null);
  assert.equal(parseDecimal("1,2,3,"), null);
  assert.equal(parseDecimal(null), null);
});

test("una quantita' deve essere positiva, un prezzo puo' essere zero", () => {
  assert.equal(isPositiveDecimal("0,5"), true);
  assert.equal(isPositiveDecimal("0"), false);
  assert.equal(isPositiveDecimal("0,000"), false);
  assert.equal(isPositiveDecimal("-1"), false);

  // Zero e' un prezzo legittimo: azioni gratuite di un piano aziendale.
  assert.equal(isNonNegativeDecimal("0"), true);
  assert.equal(isNonNegativeDecimal("-1"), false);
  assert.equal(isNonNegativeDecimal("abc"), false);
});

test("gli zeri finali di una quantita' a 18 decimali sono rumore", () => {
  assert.equal(trimDecimal("10.000000000000000000"), "10");
  assert.equal(trimDecimal("0.500000000000000000"), "0.5");
  assert.equal(trimDecimal("15"), "15");
});
