// src/lib/import/ofx.test.js — node --test
// OFX nelle sue due incarnazioni: SGML (1.x) e XML (2.x).
import test from "node:test";
import assert from "node:assert/strict";
import { readOfx, parseOfxDate } from "./ofx.js";
import { rowsFromExtraction } from "./pipeline.js";
import { ofxSgml, ofxXml } from "../../../fixtures/synthetic.js";

const buf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

test("date OFX: giorno della banca, non del fuso di chi guarda", () => {
  assert.equal(parseOfxDate("20260901120000[+1:CET]"), "2026-09-01");
  assert.equal(parseOfxDate("20260901"), "2026-09-01");
  // Anche a mezzanotte con un fuso lontano il giorno resta quello scritto.
  assert.equal(parseOfxDate("20260901000000[+7:ICT]"), "2026-09-01");
  assert.equal(parseOfxDate("20260231"), null);   // non esiste
  assert.equal(parseOfxDate(""), null);
  assert.equal(parseOfxDate(null), null);
});

test("OFX 1.x (SGML): i tag non si chiudono e si legge lo stesso", () => {
  const out = readOfx(buf(ofxSgml().bytes));

  assert.equal(out.currency, "EUR");
  assert.equal(out.closing_balance, "3236.71");
  assert.equal(out.opening_balance, null);        // OFX non lo dichiara mai
  assert.equal(out.rows.length, 3);

  assert.deepEqual(
    out.rows.map(r => [r.date, r.amount]),
    [["2026-09-01", "-45.30"], ["2026-09-05", "2500.00"], ["2026-09-12", "-12.99"]],
  );

  // NAME e MEMO portano pezzi diversi della stessa causale: vanno uniti.
  assert.equal(out.rows[0].description, "POS ESSELUNGA MILANO CARTA 4321");
  assert.equal(out.rows[1].description, "ACCREDITO STIPENDIO SETTEMBRE");
  assert.equal(out.rows[0].fitid, "2026090100001");

  // Il conto e' uno solo: nessun avviso.
  assert.deepEqual(out.warnings, []);
  assert.equal(out.accountIds.length, 1);
});

test("OFX 2.x (XML): stesso risultato con i tag chiusi", () => {
  const out = readOfx(buf(ofxXml().bytes));

  assert.equal(out.currency, "USD");
  assert.equal(out.closing_balance, "1476.60");
  assert.equal(out.rows.length, 2);
  assert.deepEqual(
    out.rows.map(r => [r.date, r.description, r.amount]),
    [["2026-09-03", "TESCO LONDON", "-23.40"], ["2026-09-04", "SALARY", "1500.00"]],
  );
});

test("da OFX a righe pronte: importi in minor units, mai in float", async () => {
  const parsed = readOfx(buf(ofxSgml().bytes));
  const { rows, balanceCheck, period } = await rowsFromExtraction(parsed, {
    accountId: "conto-1",
    accountCurrency: "EUR",
    minorUnits: 2,
  });

  assert.deepEqual(rows.map(r => r.amountMinor), [-4530n, 250000n, -1299n]);
  assert.equal(rows[0].merchant, "esselunga milano");
  assert.equal(rows[2].merchant, "netflix com");
  assert.deepEqual(period, { from: "2026-09-01", to: "2026-09-12" });

  // Senza saldo iniziale e senza saldo riga per riga non c'e' niente da
  // verificare: dirlo e' piu' onesto che dichiarare un "ok" inventato.
  assert.equal(balanceCheck, "not_available");

  // E soprattutto: l'impronta c'e'. Senza, un file reimportato entrerebbe due volte.
  assert.ok(rows.every(r => typeof r.dedupeHash === "string" && r.dedupeHash.length === 64));
});

test("un OFX in un'altra valuta blocca la conferma", async () => {
  const parsed = readOfx(buf(ofxXml().bytes));      // USD
  const { rows } = await rowsFromExtraction(parsed, {
    accountId: "conto-1",
    accountCurrency: "EUR",
    minorUnits: 2,
  });
  assert.ok(rows.every(r => r.flags.includes("currency_mismatch")));
});

test("un file che non e' un OFX non produce righe", () => {
  const out = readOfx(new TextEncoder().encode("Data;Descrizione;Importo\n01/09/2026;X;-1,00").buffer);
  assert.equal(out.rows.length, 0);
});
