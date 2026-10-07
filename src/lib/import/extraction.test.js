// src/lib/import/extraction.test.js — node --test
// Le righe lette da un modello passano dagli stessi controlli di un CSV.
//
// E' il punto piu' delicato della fase: da un PDF non arriva nessun tracciato
// che garantisca niente, quindi se qui salta un controllo nessuno se ne accorge
// finche' i conti non tornano piu'.
import test from "node:test";
import assert from "node:assert/strict";
import { rowsFromExtraction, mergeExtractions } from "./pipeline.js";
import { chunkPageTexts } from "./readers.js";

/** Come le restituisce Claude: date e importi ESATTAMENTE come sul documento. */
const estrattoItaliano = {
  currency: "EUR",
  opening_balance: "2.000,00",
  // 2.000,00 - 45,30 + 2.500,00 - 12,99 = 4.441,71: l'estratto quadra.
  closing_balance: "4.441,71",
  rows: [
    { date: "01/09/2026", description: "POS 01/09 ESSELUNGA MILANO CARTA 4321", amount: "-45,30", balance: "1.954,70" },
    { date: "05/09/2026", description: "ACCREDITO STIPENDIO SETTEMBRE", amount: "2.500,00", balance: "4.454,70" },
    { date: "12/09/2026", description: "PAGAMENTO CARTA ****1234 NETFLIX.COM", amount: "-12,99", balance: "4.441,71" },
  ],
};

const ctx = { accountId: "conto-1", accountCurrency: "EUR", minorUnits: 2 };

test("importi e date si deducono dai valori, non si danno per scontati", async () => {
  const { rows } = await rowsFromExtraction(estrattoItaliano, ctx);
  assert.deepEqual(rows.map(r => r.bookedOn), ["2026-09-01", "2026-09-05", "2026-09-12"]);
  assert.deepEqual(rows.map(r => r.amountMinor), [-4530n, 250000n, -1299n]);
  assert.equal(rows[0].merchant, "esselunga milano");
});

test("lo stesso estratto scritto all'americana si legge comunque bene", async () => {
  const americano = {
    currency: "USD",
    opening_balance: null,
    closing_balance: null,
    rows: [
      { date: "09/13/2026", description: "CARD PAYMENT TESCO", amount: "-1,234.56", balance: null },
      { date: "09/14/2026", description: "SALARY", amount: "2,500.00", balance: null },
    ],
  };
  const { rows } = await rowsFromExtraction(americano, { ...ctx, accountCurrency: "USD" });
  assert.deepEqual(rows.map(r => r.bookedOn), ["2026-09-13", "2026-09-14"]);
  assert.deepEqual(rows.map(r => r.amountMinor), [-123456n, 250000n]);
});

test("ogni riga estratta ha la sua impronta: senza, un PDF entrerebbe due volte", async () => {
  const primo = await rowsFromExtraction(estrattoItaliano, ctx);
  const secondo = await rowsFromExtraction(estrattoItaliano, ctx);
  assert.ok(primo.rows.every(r => typeof r.dedupeHash === "string"));
  assert.deepEqual(
    primo.rows.map(r => r.dedupeHash),
    secondo.rows.map(r => r.dedupeHash),
  );
});

test("il saldo progressivo si controlla anche sulle righe lette dall'AI", async () => {
  const { rows, balanceCheck } = await rowsFromExtraction(estrattoItaliano, ctx);
  assert.equal(balanceCheck, "ok");
  assert.ok(rows.every(r => !r.flags.includes("balance_mismatch")));

  // Una riga saltata dal modello: il saldo non torna piu' e si vede.
  const conBuco = {
    ...estrattoItaliano,
    rows: [estrattoItaliano.rows[0], estrattoItaliano.rows[2]],
  };
  const rotto = await rowsFromExtraction(conBuco, ctx);
  assert.equal(rotto.balanceCheck, "mismatch");
  assert.ok(rotto.rows.some(r => r.flags.includes("balance_mismatch")));
});

test("saldo iniziale e finale dichiarati contro la somma delle righe", async () => {
  // Senza i saldi riga per riga resta solo il confronto fra i totali: e' il
  // controllo che si accorge di una riga saltata anche quando l'estratto non
  // riporta il progressivo.
  const senzaProgressivo = estrattoItaliano.rows.map(r => ({ ...r, balance: null }));

  const quadra = await rowsFromExtraction(
    { ...estrattoItaliano, rows: senzaProgressivo }, ctx,
  );
  assert.equal(quadra.balanceCheck, "ok");

  // Stesso estratto, ma il modello ha saltato lo stipendio: i totali non tornano.
  const conBuco = await rowsFromExtraction(
    { ...estrattoItaliano, rows: [senzaProgressivo[0], senzaProgressivo[2]] }, ctx,
  );
  assert.equal(conBuco.balanceCheck, "mismatch");

  // Nessun totale dichiarato e nessun progressivo: non c'e' niente da
  // verificare, e dirlo e' piu' onesto di un "ok" inventato.
  const alBuio = await rowsFromExtraction(
    { ...estrattoItaliano, opening_balance: null, closing_balance: null, rows: senzaProgressivo }, ctx,
  );
  assert.equal(alBuio.balanceCheck, "not_available");
});

test("la valuta dell'estratto diversa da quella del conto blocca la conferma", async () => {
  const { rows } = await rowsFromExtraction({ ...estrattoItaliano, currency: "USD" }, ctx);
  assert.ok(rows.every(r => r.flags.includes("currency_mismatch")));
});

test("date ambigue: nessun giorno sopra il 12, e si dice", async () => {
  const ambiguo = {
    currency: "EUR", opening_balance: null, closing_balance: null,
    rows: [
      { date: "01/02/2026", description: "A", amount: "-1,00", balance: null },
      { date: "03/04/2026", description: "B", amount: "-2,00", balance: null },
    ],
  };
  const { rows } = await rowsFromExtraction(ambiguo, ctx);
  assert.ok(rows.every(r => r.flags.includes("date_ambiguous")));
});

test("una riga illeggibile resta, marcata: la scarta l'utente, non il codice", async () => {
  const conRigaRotta = {
    ...estrattoItaliano,
    rows: [...estrattoItaliano.rows, { date: "boh", description: "TOTALE", amount: null, balance: null }],
  };
  const { rows } = await rowsFromExtraction(conRigaRotta, ctx);
  assert.equal(rows.length, 4);
  assert.ok(rows[3].flags.includes("parse_warning"));
});

// ── divisione in blocchi ─────────────────────────────────────────────────────

test("un PDF lungo si divide per pagine, mai a meta' riga", () => {
  const pagine = Array.from({ length: 50 }, (_, i) => `pagina ${i}`);
  const blocchi = chunkPageTexts(pagine, { maxPages: 20, maxChars: 1e9 });
  assert.equal(blocchi.length, 3);
  assert.ok(blocchi.every(b => b.startsWith("pagina")));
  // Nessuna pagina persa e nessuna ripetuta.
  assert.equal(blocchi.join("\n\n").split("\n\n").length, 50);
});

test("il limite vero e' il contesto: un blocco denso si chiude prima", () => {
  const pagine = Array.from({ length: 10 }, () => "x".repeat(1000));
  const blocchi = chunkPageTexts(pagine, { maxPages: 20, maxChars: 2500 });
  assert.equal(blocchi.length, 5);   // due pagine per blocco
});

test("i blocchi si ricuciono in un estratto solo", () => {
  const unito = mergeExtractions([
    { currency: "EUR", opening_balance: "100,00", closing_balance: "150,00", rows: [{ date: "a" }] },
    { currency: null,  opening_balance: "150,00", closing_balance: "200,00", rows: [{ date: "b" }, { date: "c" }] },
  ]);
  assert.equal(unito.currency, "EUR");
  assert.equal(unito.rows.length, 3);
  // Il saldo di partenza e' quello del primo blocco e l'arrivo quello
  // dell'ultimo: il "150,00" in mezzo e' solo un progressivo di passaggio.
  assert.equal(unito.opening_balance, "100,00");
  assert.equal(unito.closing_balance, "200,00");
});
