// src/lib/documents/consultantInvoice.test.js — node --test
//
// Fixture SINTETICA che riproduce il tracciato del generatore di fatture, non
// dati veri. Riproduce le trappole misurate sulle fatture vere:
//
//   - il valore sta a DESTRA dell'etichetta ("Invoice No." poi "004");
//   - la riga di dettaglio porta l'aliquota ("0,00%") ma il suo primo numero e'
//     la QUANTITA' ("1"): l'imponibile va letto nel "Summary Data", non li';
//   - "TOTAL" e' sia un'intestazione di colonna (senza importo) sia la riga del
//     totale (con "$" e importo): conta la seconda;
//   - "LTD" nel nome del cliente e' tre lettere maiuscole come un codice valuta,
//     ma la valuta ("USD") va presa dalla riga di dettaglio;
//   - importi anglosassoni ("1,300.00"), percentuali all'italiana ("0,00%").
import test from "node:test";
import assert from "node:assert/strict";
import { detect, parse, canonicalAmount } from "./consultantInvoice.js";
import { parseDocument } from "./index.js";
import { validateDocument } from "../document-payload.js";

const line = (y, items) => ({ y, items: items.map(([x, text]) => ({ x, text })) });

function fixture() {
  return {
    pages: [{
      width: 595, height: 842,
      lines: [
        line(813, [[20, "Costa Giulio Antonio - C.F. CSTGNT03T03D862K - P.IVA"]]),
        line(803, [[18, "Regime fiscale: Regime forfettario (art.1, c.54-89, L. 190/2014)"]]),
        line(764, [[46, "CLIENT"], [479, "INVOICE"]]),
        line(750, [[46, "SAITEX INTERNATIONAL (HK) LTD"], [453, "Invoice No."], [515, "004"]]),
        line(738, [[46, "Room 901, 9th floor, Finance"], [449, "Invoice Date"], [503, "03/08/2026"]]),
        line(719, [[46, "Central"], [479, "Costa Giulio Antonio"]]),
        line(655, [[53, "DETAILS"], [175, "QTY"], [259, "UNIT RATE"], [379, "TOTAL"], [496, "VAT"]]),
        line(630, [[51, "Consultancy for Laundry Renovation"], [181, "1"], [274, "USD"], [374, "$"], [382, "1,300.00"], [494, "0,00%"]]),
        line(583, [[46, "Summary Data"]]),
        line(568, [[50, "VAT RATE"], [151, "VAT CATEGORY"], [242, "TAXABLE AMOUNT"], [385, "TAX"], [466, "ADDITIONAL COST"]]),
        line(546, [[60, "0,00%"], [126, "Articles 7 to 7-septies of"], [257, "$"], [277, "1,300.00"], [385, "####"], [498, "$"], [523, "-"]]),
        line(516, [[413, "TOTAL"], [444, "$"], [505, "1,300.00"]]),
        line(460, [[51, "TERMS & CONDITIONS"]]),
        line(387, [[51, "CONSULTANT BANK INFORMATION"]]),
      ],
    }],
    totalPages: 1,
  };
}

test("canonicalAmount: anglosassone e italiano allo stesso canonico", () => {
  assert.equal(canonicalAmount("1,300.00"), "1300.00");
  assert.equal(canonicalAmount("2.000,00"), "2000.00");
  assert.equal(canonicalAmount("$ 1,300.00"), "1300.00");
  assert.equal(canonicalAmount("1,300"), "1300");     // migliaia, non decimali
  assert.equal(canonicalAmount("1"), "1");
  assert.equal(canonicalAmount("-"), null);
});

test("detect riconosce il tracciato", () => {
  assert.equal(detect(fixture()), true);
  assert.equal(detect({ pages: [{ lines: [line(1, [[1, "Una fattura qualsiasi Total 10"]])] }] }), false);
});

test("parse: tutti i campi, senza confondere QTY con imponibile", () => {
  const out = parse(fixture());
  assert.equal(out.ok, true);
  assert.equal(out.template, "consultant_invoice");
  assert.deepEqual(out.extracted, {
    kind: "invoice_issued",
    issuer: "Costa Giulio Antonio",
    counterparty: "SAITEX INTERNATIONAL (HK) LTD",
    doc_date: "2026-08-03",
    due_date: null,
    reference: "004",
    currency: "USD",
    total: "1300.00",
    net: "1300.00",
    tax: "0.00",
    tax_rate: 0,
    payslip_gross: null,
    payslip_contributions: null,
    unreadable: false,
    low_confidence: false,
  });
});

test("il selettore instrada al tracciato fattura", () => {
  const out = parseDocument(fixture());
  assert.equal(out.ok, true);
  assert.equal(out.template, "consultant_invoice");
});

test("a valle: validateDocument non alza flag", () => {
  const out = parse(fixture());
  const { fields, flags } = validateDocument(out.extracted, {
    currencyCodes: new Set(["USD", "EUR"]),
    minorUnitsOf: () => 2,
    today: "2026-09-23",
  });
  assert.equal(fields.total_minor, "130000");
  assert.equal(fields.net_minor, "130000");
  assert.equal(fields.tax_minor, "0");
  assert.equal(fields.currency, "USD");
  assert.deepEqual(flags, []);
});
