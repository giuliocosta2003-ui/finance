// src/lib/money-parts.test.js — node --test
// formatMoneyParts spezza l'importo per il componente Amount. Il test che
// conta e' il primo: rimesse insieme, le parti devono dare ESATTAMENTE quello
// che restituisce formatMoney. Se un giorno le due funzioni divergessero, il
// saldo grande e quello in elenco mostrerebbero due numeri diversi.
import test from "node:test";
import assert from "node:assert/strict";
import { formatMoney, formatMoneyParts } from "./money.js";

const CASI = [
  { minor: 123456n,     currency: "EUR", units: 2, locale: "it" },
  { minor: 123456n,     currency: "EUR", units: 2, locale: "en" },
  { minor: -4530n,      currency: "EUR", units: 2, locale: "it" },
  { minor: 123456n,     currency: "USD", units: 2, locale: "en" },
  { minor: 1400000n,    currency: "VND", units: 0, locale: "it" },
  { minor: 1400000n,    currency: "JPY", units: 0, locale: "en" },
  { minor: 12345n,      currency: "KWD", units: 3, locale: "it" },
  { minor: 0n,          currency: "EUR", units: 2, locale: "it" },
  { minor: 900719925474099n, currency: "EUR", units: 2, locale: "it" },
];

test("le parti concatenate danno esattamente formatMoney", () => {
  for (const c of CASI) {
    const { head, tail, rest } = formatMoneyParts(c.minor, c.currency, c.locale, c.units);
    assert.equal(
      head + tail + rest,
      formatMoney(c.minor, c.currency, c.locale, c.units),
      `${c.locale} ${c.currency} ${c.minor}`,
    );
  }
});

test("i decimali finiscono in `tail`, cosi' Amount puo' rimpicciolirli", () => {
  const it = formatMoneyParts(123456n, "EUR", "it", 2);
  assert.equal(it.tail, ",56");
  const en = formatMoneyParts(123456n, "USD", "en", 2);
  assert.equal(en.tail, ".56");
});

test("una valuta senza decimali non ha niente da rimpicciolire", () => {
  // VND e JPY: `tail` vuoto, e Amount non disegna nessuna parte piccola.
  const vnd = formatMoneyParts(1400000n, "VND", "it", 0);
  assert.equal(vnd.tail, "");
  assert.ok(vnd.head.includes("1.400.000"));
});

test("KWD ha tre decimali e restano tutti e tre", () => {
  const kwd = formatMoneyParts(12345n, "KWD", "it", 3);
  assert.equal(kwd.tail, ",345");
});

test("il simbolo dopo i centesimi resta separato dai decimali", () => {
  // In italiano l'euro sta in fondo: deve finire in `rest`, altrimenti
  // verrebbe rimpicciolito insieme ai centesimi.
  const { tail, rest } = formatMoneyParts(123456n, "EUR", "it", 2);
  assert.equal(tail, ",56");
  assert.ok(rest.includes("€"), `il simbolo doveva stare in rest, e' in "${rest}"`);
});

test("una valuta sconosciuta non fa esplodere niente", () => {
  const { head, tail } = formatMoneyParts(100n, "ZZZ", "it", 2);
  assert.ok(head.length > 0);
  assert.equal(typeof tail, "string");
});
