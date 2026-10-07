// src/lib/document-payload.test.js — node --test
// Conversione esatta degli importi e validazione di quello che torna dall'AI.
import test from "node:test";
import assert from "node:assert/strict";
import { decimalToMinor, isoDate, validateDocument, DOCUMENT_SCHEMA } from "./document-payload.js";

const VALUTE = new Set(["EUR", "USD", "VND", "KWD"]);
const decimali = { EUR: 2, USD: 2, VND: 0, KWD: 3 };
const ctx = (today = "2026-09-22") => ({
  currencyCodes: VALUTE,
  minorUnitsOf: (c) => decimali[c] ?? 2,
  today,
});

// ── conversione ──────────────────────────────────────────────────────────────

test("da stringa canonica a minor units, senza mai passare da float", () => {
  assert.equal(decimalToMinor("1234.56", 2), 123456n);
  assert.equal(decimalToMinor("0.1", 2), 10n);
  assert.equal(decimalToMinor("1000", 2), 100000n);
  assert.equal(decimalToMinor("-45.30", 2), -4530n);
  // VND non ha decimali, KWD ne ha tre: li decide la tabella, non Intl.
  assert.equal(decimalToMinor("1400000", 0), 1400000n);
  assert.equal(decimalToMinor("12.345", 3), 12345n);
});

test("le cifre oltre i decimali della valuta si arrotondano commercialmente", () => {
  assert.equal(decimalToMinor("1.005", 2), 101n);   // scarta 5 -> su
  assert.equal(decimalToMinor("1.004", 2), 100n);   // scarta 4 -> giu'
  assert.equal(decimalToMinor("1.5", 0), 2n);
  assert.equal(decimalToMinor("1.4", 0), 1n);
});

test("oltre i 2^53 resta esatto: e' BigInt, non un numero in virgola mobile", () => {
  assert.equal(decimalToMinor("90071992547409.93", 2), 9007199254740993n);
});

test("quello che non e' un numero canonico non diventa un importo", () => {
  assert.equal(decimalToMinor("1.234,56", 2), null);   // formato italiano: il modello non deve mandarlo
  assert.equal(decimalToMinor("1,234.56", 2), null);   // separatore delle migliaia
  assert.equal(decimalToMinor("circa 100", 2), null);
  assert.equal(decimalToMinor("", 2), null);
  assert.equal(decimalToMinor(null, 2), null);
});

test("date: solo ISO valide", () => {
  assert.equal(isoDate("2026-09-22"), "2026-09-22");
  assert.equal(isoDate("2026-02-31"), null);   // non esiste
  assert.equal(isoDate("22/09/2026"), null);
  assert.equal(isoDate(null), null);
});

// ── validazione ──────────────────────────────────────────────────────────────

const fattura = {
  kind: "invoice_received",
  issuer: "ACME SRL",
  counterparty: "Io",
  doc_date: "2026-09-01",
  due_date: "2026-10-01",
  reference: "2026/123",
  currency: "EUR",
  total: "1220.00",
  net: "1000.00",
  tax: "220.00",
  tax_rate: 22,
  payslip_gross: null,
  payslip_contributions: null,
  unreadable: false,
  low_confidence: false,
};

test("una fattura che torna non alza nessun flag", () => {
  const { fields, flags } = validateDocument(fattura, ctx());
  assert.deepEqual(flags, []);
  assert.equal(fields.total_minor, "122000");
  assert.equal(fields.net_minor, "100000");
  assert.equal(fields.tax_minor, "22000");
  assert.equal(fields.currency, "EUR");
  assert.equal(fields.kind, "invoice_received");
});

test("netto piu' imposta che non fa il totale viene segnalato", () => {
  const { flags } = validateDocument({ ...fattura, tax: "200.00" }, ctx());
  assert.ok(flags.includes("amounts_mismatch"));
});

test("un centesimo di scarto si perdona: gli arrotondamenti per riga capitano", () => {
  const { flags } = validateDocument({ ...fattura, net: "1000.01" }, ctx());
  assert.deepEqual(flags, []);
  const due = validateDocument({ ...fattura, net: "1000.02" }, ctx());
  assert.ok(due.flags.includes("amounts_mismatch"));
});

test("una valuta inventata non entra nella colonna", () => {
  const { fields, flags } = validateDocument({ ...fattura, currency: "XYZ" }, ctx());
  assert.ok(flags.includes("unknown_currency"));
  // Deve restare null: c'e' una FK verso currencies, e un codice inesistente
  // farebbe fallire l'intero inserimento.
  assert.equal(fields.currency, null);
});

test("date nel futuro o troppo vecchie si segnalano", () => {
  assert.ok(validateDocument({ ...fattura, doc_date: "2027-01-01" }, ctx()).flags.includes("date_suspicious"));
  assert.ok(validateDocument({ ...fattura, doc_date: "2010-01-01" }, ctx()).flags.includes("date_suspicious"));
  assert.deepEqual(validateDocument({ ...fattura, doc_date: "2026-09-22" }, ctx()).flags, []);
  // Una data illeggibile non e' una data: si segnala invece di inventarla.
  assert.ok(validateDocument({ ...fattura, doc_date: "22 settembre" }, ctx()).flags.includes("date_suspicious"));
});

test("il modello che si dichiara incerto viene creduto", () => {
  assert.ok(validateDocument({ ...fattura, low_confidence: true }, ctx()).flags.includes("low_confidence"));
  assert.ok(validateDocument({ ...fattura, unreadable: true }, ctx()).flags.includes("unreadable"));
});

test("un documento vuoto non fa danni", () => {
  const { fields, flags } = validateDocument({}, ctx());
  assert.equal(fields.kind, "other");
  assert.equal(fields.total_minor, null);
  assert.equal(fields.currency, null);
  assert.deepEqual(flags, []);
});

test("VND non ha decimali: 1.400.000 restano 1.400.000", () => {
  const { fields } = validateDocument(
    { ...fattura, currency: "VND", total: "1400000", net: "1400000", tax: "0" }, ctx(),
  );
  assert.equal(fields.total_minor, "1400000");
});

test("lo schema vincola la forma: nessun campo in piu', tutti obbligatori", () => {
  assert.equal(DOCUMENT_SCHEMA.additionalProperties, false);
  for (const key of Object.keys(DOCUMENT_SCHEMA.properties)) {
    assert.ok(DOCUMENT_SCHEMA.required.includes(key), `${key} non e' fra i required`);
  }
});
