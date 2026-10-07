// src/lib/money.test.js — node --test
import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, toMajorString, formatMoney, formatAmountPlain, intlMinorUnits } from "./money.js";

test("minor units: quelle che sbagliano piu' spesso", () => {
  assert.equal(intlMinorUnits("EUR"), 2);
  assert.equal(intlMinorUnits("VND"), 0);
  assert.equal(intlMinorUnits("JPY"), 0);
  assert.equal(intlMinorUnits("KWD"), 3);
});

test("parse EUR in italiano", () => {
  assert.equal(parseAmount("1.234,56", 2, "it"), 123456n);
  assert.equal(parseAmount("1234,56", 2, "it"), 123456n);
  assert.equal(parseAmount("0,05", 2, "it"), 5n);
  assert.equal(parseAmount(",50", 2, "it"), 50n);
  assert.equal(parseAmount("12", 2, "it"), 1200n);
});

test("parse EUR in inglese", () => {
  assert.equal(parseAmount("1,234.56", 2, "en"), 123456n);
  assert.equal(parseAmount("1234.56", 2, "en"), 123456n);
  assert.equal(parseAmount("1,234", 2, "en"), 123400n);   // migliaia, non decimali
  assert.equal(parseAmount("1.234", 2, "en"), 123n);      // qui e' decimale: 1.23
});

test("VND e JPY non hanno decimali: ogni separatore e' migliaia", () => {
  assert.equal(parseAmount("250.000", 0, "it"), 250000n);
  assert.equal(parseAmount("250,000", 0, "en"), 250000n);
  assert.equal(parseAmount("25000", 0, "it"), 25000n);
  assert.equal(parseAmount("1.234.567", 0, "it"), 1234567n);
  assert.equal(parseAmount("15000", 0, "en"), 15000n);     // JPY
});

test("KWD ha tre decimali", () => {
  assert.equal(parseAmount("1,500", 3, "it"), 1500n);      // 1,5 KWD = 1500 fils
  assert.equal(parseAmount("0,001", 3, "it"), 1n);
  assert.equal(parseAmount("12.345,678", 3, "it"), 12345678n);
});

test("segni e formati strani delle banche", () => {
  assert.equal(parseAmount("-12,34", 2, "it"), -1234n);
  assert.equal(parseAmount("12,34-", 2, "it"), -1234n);
  assert.equal(parseAmount("(12,34)", 2, "it"), -1234n);
  assert.equal(parseAmount("€ 1.234,56", 2, "it"), 123456n);
  assert.equal(parseAmount("1 234,56", 2, "it"), 123456n);
  assert.equal(parseAmount("", 2, "it"), null);
  assert.equal(parseAmount("abc", 2, "it"), null);
  assert.equal(parseAmount(null, 2, "it"), null);
});

test("arrotondamento commerciale sulla prima cifra scartata", () => {
  assert.equal(parseAmount("1234.564", 2, "en"), 123456n);
  assert.equal(parseAmount("1234.565", 2, "en"), 123457n);
  assert.equal(parseAmount("1234.567", 2, "en"), 123457n);
  assert.equal(parseAmount("0.999", 2, "en"), 100n);
  assert.equal(parseAmount("-0.005", 2, "en"), -1n);       // il segno non sposta l'arrotondamento
});

test("minor units -> stringa esatta, anche oltre i 2^53", () => {
  assert.equal(toMajorString(123456n, 2), "1234.56");
  assert.equal(toMajorString(5n, 2), "0.05");
  assert.equal(toMajorString(-5n, 2), "-0.05");
  assert.equal(toMajorString(25000n, 0), "25000");
  assert.equal(toMajorString(1500n, 3), "1.500");
  assert.equal(toMajorString(0n, 2), "0.00");
  assert.equal(toMajorString(9007199254740993n, 0), "9007199254740993");
});

test("andata e ritorno: quello che l'utente scrive torna come l'ha scritto", () => {
  for (const [text, units, locale] of [
    ["1.234,56", 2, "it"], ["250.000", 0, "it"], ["12.345,678", 3, "it"],
  ]) {
    const minor = parseAmount(text, units, locale);
    assert.equal(formatAmountPlain(minor, locale, units).replace(/ /g, " "),
      text.replace(/\./g, ""));
  }
});

test("formattazione nelle quattro valute di controllo", () => {
  const strip = (s) => s.replace(/ | /g, " ");
  // In italiano il separatore delle migliaia compare da cinque cifre in su
  // (regola CLDR minimumGroupingDigits=2): "1234,56" ma "10.000,00". E' Intl
  // a deciderlo, e va bene cosi': la regola non la riscriviamo noi.
  assert.equal(strip(formatMoney(123456n, "EUR", "it", 2)), "1234,56 €");
  assert.equal(strip(formatMoney(1000000n, "EUR", "it", 2)), "10.000,00 €");
  assert.equal(strip(formatMoney(123456n, "EUR", "en", 2)), "€1,234.56");
  assert.equal(strip(formatMoney(250000n, "VND", "it", 0)), "250.000 VND");
  assert.equal(strip(formatMoney(15000n, "JPY", "en", 0)), "¥15,000");
  assert.equal(strip(formatMoney(1500n, "KWD", "en", 3)), "KWD 1.500");
});

test("i decimali arrivano dalla tabella, non da Intl", () => {
  // Se un giorno `currencies` dicesse 2 per il VND, formatMoney deve obbedire:
  // la fonte di verita' e' il database, non la libreria.
  const strip = (s) => s.replace(/ | /g, " ");
  assert.equal(strip(formatMoney(250000n, "VND", "it", 2)), "2500,00 VND");
});
