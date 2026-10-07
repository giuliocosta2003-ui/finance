// src/lib/import/statements/revolut.test.js — node --test
//
// La fixture e' SINTETICA e riproduce il TRACCIATO, non dati veri: nome, IBAN e
// spese di una persona non entrano in un repository. Cio' che riproduce
// fedelmente sono le trappole misurate sull'estratto vero:
//
//   - il segno sta nella COLONNA (x), non nel testo;
//   - la riga-ancora (data + importo + saldo) apre il movimento, e sotto ci
//     sono righe di dettaglio che portano ALTRI importi nella colonna uscita
//     (il costo, il netto della conversione) ma NON un saldo e NON una data:
//     non sono movimenti;
//   - la data e' testuale all'italiana ("9 apr 2026") e va resa in ISO;
//   - saldo iniziale e finale stanno nella riga "Totale" del riepilogo.
import test from "node:test";
import assert from "node:assert/strict";
import { detect, parse, parseRevolutDate, amountText, columnBands } from "./revolut.js";
import { parseStatement } from "./index.js";
import { rowsFromExtraction } from "../pipeline.js";

// Le X vere, misurate sul documento.
const X = { date: 43, details: 125, withdrawal: 335, deposit: 417, balance: 519 };

const line = (y, items) => ({ y, items: items.map(([x, text]) => ({ x, text })) });

/** L'intestazione di pagina piu' la riga di colonne, come nel documento vero. */
const pageHead = () => [
  line(763, [[360, "Estratto conto in USD"]]),
  line(725, [[432, "Revolut Bank UAB (Italian Branch)"]]),
  line(693, [[X.date, "Data"], [X.details, "Descrizione"], [X.withdrawal, "Denaro in uscita"], [X.deposit, "Denaro in entrata"], [X.balance + 16, "Saldo"]]),
];

// Riepilogo del saldo. I valori formano una catena coerente con i quattro
// movimenti sotto, cosi' saldo progressivo E totali tornano: opening 100,00,
// closing 1.445,32, con uscite 470,23 ed entrate 1.815,55.
const summary = () => [
  line(474, [[43, "Riepilogo del saldo"]]),
  line(443, [[43, "Conto (conto corrente)"], [253, "100,00$"], [335, "470,23$"], [417, "1.815,55$"], [519, "1.445,32$"]]),
  line(424, [[43, "Totale"], [253, "100,00$"], [335, "470,23$"], [417, "1.815,55$"], [519, "1.445,32$"]]),
  line(359, [[43, "Transazioni del conto dal giorno 1 gennaio 2026"]]),
];

function fixture() {
  return {
    pages: [{
      width: 595, height: 842,
      lines: [
        ...pageHead(),
        ...summary(),

        // Entrata: conversione in USD. Sotto, l'importo in valuta originale
        // (20,00€) cade nella colonna entrata ma NON ha saldo ne' data.
        line(314, [[X.date, "9 apr 2026"], [X.details, "Conversione in USD"], [X.deposit, "23,24$"], [X.balance + 12, "123,24$"]]),
        line(307, [[X.details, "ID transazione: 69d7bd81-7797-adb3"]]),
        line(302, [[X.deposit, "20,00€"]]),

        // Uscita con carta.
        line(285, [[X.date, "10 apr 2026"], [X.details, "LootCode"], [X.withdrawal, "21,50$"], [X.balance + 16, "101,74$"]]),
        line(278, [[X.details, "ID transazione: 69d7bdad-fcc0"]]),
        line(272, [[X.details, "A: Moreta Cf, Coinflow.cash"]]),
        line(267, [[X.details, "Carta: 416598******0987"]]),

        // Entrata grossa: stipendio/pagamento. Importo lungo, migliaia col punto.
        line(187, [[X.date, "12 mag 2026"], [X.details, "Pagamento da SAITEX INTERNATIONAL (HK) LIMITED"], [X.deposit, "1.792,31$"], [X.balance, "1.894,05$"]]),
        line(179, [[X.details, "Riferimento: Consultancy fee for Apr.26"]]),

        // Uscita: conversione in EUR. La riga di dettaglio "Costo" porta un
        // importo nella colonna uscita (447,90$) ma non e' un movimento.
        line(150, [[X.date, "12 mag 2026"], [X.details, "Conversione in EUR"], [X.withdrawal, "448,73$"], [X.balance, "1.445,32$"]]),
        line(143, [[X.details, "Costo: 0,83$"], [X.withdrawal, "447,90$"]]),
        line(137, [[X.withdrawal, "380,00€"]]),

        // Sezione legale: da qui in giu' niente movimenti.
        line(100, [[43, "Attenzione"]]),
        line(90, [[43, "I contenuti di questo estratto conto sono da considerarsi approvati."]]),
      ],
    }],
    totalPages: 1,
  };
}

test("parseRevolutDate: mesi italiani e inglesi, in ISO", () => {
  assert.equal(parseRevolutDate("9 apr 2026"), "2026-04-09");
  assert.equal(parseRevolutDate("12 mag 2026"), "2026-05-12");
  assert.equal(parseRevolutDate("1 gen 2026"), "2026-01-01");
  assert.equal(parseRevolutDate("31 dic 2025"), "2025-12-31");
  assert.equal(parseRevolutDate("9 Apr 2026"), "2026-04-09");
  assert.equal(parseRevolutDate("non una data"), null);
  assert.equal(parseRevolutDate("9 xyz 2026"), null);
});

test("amountText toglie il simbolo di valuta", () => {
  assert.equal(amountText("1.792,31$"), "1.792,31");
  assert.equal(amountText("23,24$"), "23,24");
  assert.equal(amountText("380,00€"), "380,00");
  assert.equal(amountText("Netlify"), null);
  assert.equal(amountText(""), null);
});

test("detect riconosce l'estratto Revolut", () => {
  assert.equal(detect(fixture()), true);
  assert.equal(detect({ pages: [{ lines: [line(1, [[1, "Un altro documento"]])] }] }), false);
});

test("columnBands: le bande dalle intestazioni", () => {
  const b = columnBands(fixture().pages[0].lines);
  assert.ok(b);
  // 23,24$ a x=417 deve cadere in entrata, 448,73$ a x=335 in uscita.
  assert.ok(417 >= b.depositFrom && 417 < b.balanceFrom);
  assert.ok(335 >= b.withdrawalFrom && 335 < b.depositFrom);
});

test("parse: quattro movimenti col segno dalla colonna", () => {
  const out = parse(fixture());
  assert.equal(out.ok, true);
  assert.equal(out.bank, "revolut");
  assert.equal(out.extracted.currency, "USD");
  assert.equal(out.extracted.opening_balance, "100,00");
  assert.equal(out.extracted.closing_balance, "1.445,32");

  const r = out.extracted.rows;
  assert.equal(r.length, 4);

  assert.deepEqual(r[0], { date: "2026-04-09", description: "Conversione in USD", amount: "23,24", balance: "123,24" });
  assert.deepEqual(r[1], { date: "2026-04-10", description: "LootCode", amount: "-21,50", balance: "101,74" });
  assert.deepEqual(r[2], { date: "2026-05-12", description: "Pagamento da SAITEX INTERNATIONAL (HK) LIMITED", amount: "1.792,31", balance: "1.894,05" });
  assert.deepEqual(r[3], { date: "2026-05-12", description: "Conversione in EUR", amount: "-448,73", balance: "1.445,32" });
});

test("le righe di dettaglio non diventano movimenti", () => {
  const out = parse(fixture());
  // Costo, conversione in valuta originale e ID transazione porterebbero
  // importi in colonna: se contassero, i movimenti sarebbero piu' di quattro.
  assert.equal(out.extracted.rows.length, 4);
});

test("il selettore instrada a Revolut", () => {
  const out = parseStatement(fixture());
  assert.equal(out.ok, true);
  assert.equal(out.bank, "revolut");
});

test("a valle: importi, segno e controlli tornano", async () => {
  const out = parse(fixture());
  const { rows, balanceCheck } = await rowsFromExtraction(out.extracted, {
    accountId: "acc-1",
    accountCurrency: "USD",
    minorUnits: 2,
  });
  assert.equal(rows.length, 4);
  // Segno e centesimi esatti.
  assert.equal(rows[0].amountMinor, 2324n);
  assert.equal(rows[1].amountMinor, -2150n);
  assert.equal(rows[2].amountMinor, 179231n);
  assert.equal(rows[3].amountMinor, -44873n);
  // Il saldo progressivo e/o i totali devono tornare.
  assert.equal(balanceCheck, "ok");
});
