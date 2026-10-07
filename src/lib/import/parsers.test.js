// src/lib/import/parsers.test.js — node --test
// Parser e controlli, sulle fixture sintetiche di fixtures/synthetic.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readCsv, readXlsx, readPdfText, decodeText } from "./readers.js";
import { guessMapping, applyMapping, parseDate, inferDateFormat, inferDecimalSeparator, mappingIsComplete } from "./mapping.js";
import { checkRunningBalance, checkTotals, checkCurrency, assignDedupeHashes, periodOf } from "./checks.js";
import { csvItaliano, csvDareAvere, xlsxVietnamita, pdfConTesto, pdfScansionato } from "../../../fixtures/synthetic.js";

const buf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// ── date ─────────────────────────────────────────────────────────────────────

test("formato data dedotto dai valori", () => {
  assert.equal(inferDateFormat(["01/09/2026", "13/09/2026"]), "DMY");
  assert.equal(inferDateFormat(["09/13/2026", "09/01/2026"]), "MDY");
  assert.equal(inferDateFormat(["2026-09-01"]), "ISO");
  assert.equal(inferDateFormat(["01/02/2026", "03/04/2026"]), "ambiguous");
});

test("conversione delle date", () => {
  assert.equal(parseDate("01/09/2026", "DMY"), "2026-09-01");
  assert.equal(parseDate("09/01/2026", "MDY"), "2026-09-01");
  assert.equal(parseDate("2026-09-01", "ISO"), "2026-09-01");
  assert.equal(parseDate("01-09-26", "DMY"), "2026-09-01");
  assert.equal(parseDate("31/02/2026", "DMY"), null);   // non esiste
  assert.equal(parseDate("", "DMY"), null);
  assert.equal(parseDate(new Date(2026, 8, 1), "DMY"), "2026-09-01");
  assert.equal(parseDate(46266, "DMY"), "2026-09-01");  // seriale Excel
});

test("separatore decimale dedotto dai valori", () => {
  assert.equal(inferDecimalSeparator(["-45,30", "1.954,70"]), ",");
  assert.equal(inferDecimalSeparator(["23.40", "2500.00"]), ".");
  assert.equal(inferDecimalSeparator(["1.000", "2.000"]), ".");  // migliaia: nessun indizio
});

// ── CSV italiano ─────────────────────────────────────────────────────────────

test("CSV italiano: Windows-1252, punto e virgola, virgola decimale", async () => {
  const fx = csvItaliano();

  const { encoding } = decodeText(buf(fx.bytes));
  assert.equal(encoding, "windows-1252");

  const parsed = readCsv(buf(fx.bytes), { skipRows: fx.skipRows });
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["Data", "Descrizione", "Importo", "Saldo"]);
  assert.equal(parsed.rows.length, 6);

  const mapping = guessMapping(parsed.headers, parsed.rows);
  assert.ok(mappingIsComplete(mapping));
  assert.equal(mapping.dateColumn, "Data");
  assert.equal(mapping.amountColumn, "Importo");
  assert.equal(mapping.balanceColumn, "Saldo");
  assert.equal(mapping.decimalSeparator, ",");
  assert.equal(mapping.dateFormat, "DMY");

  const rows = applyMapping(parsed.rows, mapping, { currency: "EUR", minorUnits: 2 });
  assert.equal(rows[0].bookedOn, "2026-09-01");
  assert.equal(rows[0].amountMinor, -4530n);
  assert.equal(rows[0].balanceMinor, 195470n);
  assert.equal(rows[0].merchant, "esselunga milano");
  assert.equal(rows[2].amountMinor, 250000n);
  // L'accento sopravvive alla codifica, e il commerciante si normalizza.
  assert.ok(rows[3].description.includes("CAFFÈ"));
  assert.equal(rows[3].merchant, "caffe del corso");
  assert.equal(rows[5].merchant, "netflix com");
});

test("CSV italiano: il saldo progressivo torna", () => {
  const fx = csvItaliano();
  const parsed = readCsv(buf(fx.bytes), { skipRows: fx.skipRows });
  const rows = applyMapping(parsed.rows, guessMapping(parsed.headers, parsed.rows), { currency: "EUR", minorUnits: 2 });
  assert.equal(checkRunningBalance(rows).status, "ok");
  assert.deepEqual(periodOf(rows), { from: "2026-09-01", to: "2026-09-12" });
});

test("un saldo sbagliato viene trovato", () => {
  const rows = [
    { rowIndex: 0, amountMinor: -1000n, balanceMinor: 9000n },
    { rowIndex: 1, amountMinor: -1000n, balanceMinor: 8000n },
    { rowIndex: 2, amountMinor: -1000n, balanceMinor: 5000n },  // manca un movimento
  ];
  const res = checkRunningBalance(rows);
  assert.equal(res.status, "mismatch");
  assert.deepEqual(res.mismatchedIndexes, [2]);
});

test("totali dichiarati contro somma delle righe", () => {
  const rows = [{ amountMinor: -4530n }, { amountMinor: 250000n }];
  assert.equal(checkTotals(rows, { openingMinor: 200000n, closingMinor: 445470n }).status, "ok");
  assert.equal(checkTotals(rows, { openingMinor: 200000n, closingMinor: 999999n }).status, "mismatch");
  assert.equal(checkTotals(rows, { openingMinor: null, closingMinor: null }).status, "not_available");
});

test("valuta diversa da quella del conto", () => {
  const rows = [{ rowIndex: 0, currency: "EUR" }, { rowIndex: 1, currency: "USD" }];
  const res = checkCurrency(rows, "EUR");
  assert.equal(res.status, "mismatch");
  assert.deepEqual(res.mismatchedIndexes, [1]);
});

// ── CSV dare/avere ───────────────────────────────────────────────────────────

test("CSV con colonne dare e avere separate", () => {
  const fx = csvDareAvere();
  const parsed = readCsv(buf(fx.bytes));
  const mapping = guessMapping(parsed.headers, parsed.rows);

  assert.equal(mapping.amountMode, "debit_credit");
  assert.equal(mapping.debitColumn, "Paid out");
  assert.equal(mapping.creditColumn, "Paid in");
  assert.equal(mapping.decimalSeparator, ".");

  const rows = applyMapping(parsed.rows, mapping, { currency: "GBP", minorUnits: 2 });
  assert.equal(rows[0].amountMinor, -2340n);   // uscita: segno messo dalla colonna
  assert.equal(rows[1].amountMinor, 250000n);  // entrata
  assert.equal(rows[2].amountMinor, -1500n);
  assert.equal(rows[0].merchant, "tesco london");
});

// ── XLSX vietnamita ──────────────────────────────────────────────────────────

test("XLSX vietnamita: VND senza decimali, testata da saltare", () => {
  const fx = xlsxVietnamita();
  const parsed = readXlsx(buf(fx.bytes));

  assert.equal(parsed.headerRow, fx.headerRow, "la riga di intestazione va trovata da sola");
  assert.deepEqual(parsed.headers, ["Ngay giao dich", "Noi dung", "So tien", "So du"]);
  assert.equal(parsed.rows.length, 4);

  const mapping = guessMapping(parsed.headers, parsed.rows);
  assert.ok(mappingIsComplete(mapping));
  assert.equal(mapping.dateColumn, "Ngay giao dich");
  assert.equal(mapping.amountColumn, "So tien");
  assert.equal(mapping.balanceColumn, "So du");

  const rows = applyMapping(parsed.rows, mapping, { currency: "VND", minorUnits: 0 });
  // 85.000 VND sono ottantacinquemila dong, non ottantacinque.
  assert.equal(rows[0].amountMinor, -85000n);
  assert.equal(rows[1].amountMinor, -2000000n);
  assert.equal(rows[2].amountMinor, 25000000n);
  assert.equal(rows[0].bookedOn, "2026-09-01");
  assert.equal(rows[0].merchant, "highlands coffee d1");
  assert.equal(rows[3].merchant, "grab");
  assert.equal(checkRunningBalance(rows).status, "ok");
});

// ── PDF ──────────────────────────────────────────────────────────────────────

test("PDF con testo: si legge nel browser, senza AI visiva", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fx = pdfConTesto();
  const res = await readPdfText(buf(fx.bytes), { pdfjsModule: pdfjs });
  assert.equal(res.hasText, true);
  assert.ok(res.text.includes("ESSELUNGA MILANO"));
  assert.ok(res.text.includes("STIPENDIO"));
  assert.equal(res.pages, 1);
});

test("PDF scansionato: nessun testo, serve la lettura visiva", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fx = pdfScansionato();
  const res = await readPdfText(buf(fx.bytes), { pdfjsModule: pdfjs });
  assert.equal(res.hasText, false);
});

// ── duplicati ────────────────────────────────────────────────────────────────

test("due caffe' identici nello stesso giorno restano due righe diverse", async () => {
  const rows = [
    { rowIndex: 0, bookedOn: "2026-09-07", amountMinor: -250n, merchant: "caffe del corso" },
    { rowIndex: 1, bookedOn: "2026-09-07", amountMinor: -250n, merchant: "caffe del corso" },
  ];
  const hashed = await assignDedupeHashes(rows, "conto-1");
  assert.notEqual(hashed[0].dedupeHash, hashed[1].dedupeHash);
});

test("la stessa riga in due estratti sovrapposti ha la stessa impronta", async () => {
  const riga = { rowIndex: 0, bookedOn: "2026-09-07", amountMinor: -250n, merchant: "caffe del corso" };
  const primo = await assignDedupeHashes([riga], "conto-1");
  const secondo = await assignDedupeHashes([{ ...riga, rowIndex: 5 }], "conto-1");
  assert.equal(primo[0].dedupeHash, secondo[0].dedupeHash);

  // Su un conto diverso non e' piu' lo stesso movimento.
  const altroConto = await assignDedupeHashes([riga], "conto-2");
  assert.notEqual(primo[0].dedupeHash, altroConto[0].dedupeHash);
});

test("due estratti che si sovrappongono: le righe comuni coincidono una a una", async () => {
  const settembre = [
    { rowIndex: 0, bookedOn: "2026-09-01", amountMinor: -4530n, merchant: "esselunga milano" },
    { rowIndex: 1, bookedOn: "2026-09-10", amountMinor: -1299n, merchant: "netflix com" },
    { rowIndex: 2, bookedOn: "2026-09-20", amountMinor: -2000n, merchant: "ikea" },
  ];
  const secondaMeta = [
    { rowIndex: 0, bookedOn: "2026-09-10", amountMinor: -1299n, merchant: "netflix com" },
    { rowIndex: 1, bookedOn: "2026-09-20", amountMinor: -2000n, merchant: "ikea" },
    { rowIndex: 2, bookedOn: "2026-09-28", amountMinor: -999n,  merchant: "spotify" },
  ];
  const a = await assignDedupeHashes(settembre, "conto-1");
  const b = await assignDedupeHashes(secondaMeta, "conto-1");
  const comuni = b.filter(r => a.some(x => x.dedupeHash === r.dedupeHash));
  assert.equal(comuni.length, 2, "le due righe in comune si riconoscono");
  assert.equal(b[2].merchant, "spotify");
});
