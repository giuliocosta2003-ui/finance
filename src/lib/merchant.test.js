// src/lib/merchant.test.js — node --test
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMerchant, merchantMatches, pickRule } from "./merchant.js";

test("l'esempio di riferimento", () => {
  assert.equal(
    normalizeMerchant("POS 12/09 STARBUCKS D1 HCMC CARD 4321"),
    "starbucks d1 hcmc",
  );
});

test("via IBAN, carte e codici di riferimento", () => {
  assert.equal(
    normalizeMerchant("BONIFICO A FAVORE DI ACME SRL IT60X0542811101000000123456"),
    "acme",
  );
  assert.equal(normalizeMerchant("PAGAMENTO CARTA ****1234 ESSELUNGA MILANO"), "esselunga milano");
  assert.equal(normalizeMerchant("VISA 4321 0000 0000 1234 IKEA"), "ikea");
  assert.equal(normalizeMerchant("AMAZON EU RIF. 7Y2K9QW4RT88"), "amazon eu");
});

test("i circuiti di pagamento non sono l'esercente", () => {
  // "PROCESSORE *ESERCENTE": chi ha incassato sta dopo l'asterisco.
  assert.equal(normalizeMerchant("PAYPAL *NETFLIX"), "netflix");
  assert.equal(normalizeMerchant("PayPal *Steam Games 90021456777"), "steam games");
  assert.equal(normalizeMerchant("SumUp *Bar Roma"), "bar roma");
  assert.equal(normalizeMerchant("SQ *Blue Bottle Coffee"), "blue bottle coffee");
  assert.equal(normalizeMerchant("GOOGLE*YouTubePremium"), "youtubepremium");
  // Due esercenti diversi passati dallo stesso PayPal NON fanno gruppo.
  assert.notEqual(normalizeMerchant("PAYPAL *NETFLIX"), normalizeMerchant("PAYPAL *SPOTIFY"));
  // Un "paypal" senza asterisco resta: potrebbe essere il conto dell'utente.
  assert.equal(normalizeMerchant("PayPal Europe"), "paypal europe");
});

test("le forme societarie si tolgono, coi punti e senza", () => {
  assert.equal(normalizeMerchant("ESSELUNGA SPA MILANO"), "esselunga milano");
  assert.equal(normalizeMerchant("ENEL ENERGIA S.P.A."), "enel energia");
  assert.equal(normalizeMerchant("AMAZON EU S.A R.L."), "amazon eu");
  assert.equal(normalizeMerchant("SAITEX INTERNATIONAL (HK) LIMITED"), "saitex international hk");
  // Cosi' "ACME" e "ACME SRL" finiscono nello stesso gruppo.
  assert.equal(normalizeMerchant("ACME SRL"), normalizeMerchant("ACME"));
});

test("prefissi 'Pagamento da/a NOME' (Revolut), senza mangiare le parole vere", () => {
  assert.equal(normalizeMerchant("Pagamento da SAITEX INTERNATIONAL (HK) LIMITED"), "saitex international hk");
  assert.equal(normalizeMerchant("Payment to Netlify"), "netlify");
  // Il prefisso si toglie solo con lo spazio in coda: "abbonamento" resta.
  assert.equal(normalizeMerchant("Pagamento abbonamento palestra"), "abbonamento palestra");
});

test("i tipi di operazione (istantaneo, cart) sono rumore", () => {
  assert.equal(normalizeMerchant("COMMISSIONE BONIFICO ISTANTANEO"), "");
  assert.equal(normalizeMerchant("PAGAMENTO POS 05/03 ESSELUNGA SPA MILANO CART 4587"), "esselunga milano");
});

test("via date e orari", () => {
  assert.equal(normalizeMerchant("POS 03/02/2026 14:35 LIDL"), "lidl");
  assert.equal(normalizeMerchant("2026-09-12 CARREFOUR EXPRESS"), "carrefour express");
});

test("accenti e maiuscole non contano", () => {
  assert.equal(normalizeMerchant("CAFFÈ DEL CORSO"), "caffe del corso");
  assert.equal(normalizeMerchant("caffe del corso"), "caffe del corso");
});

test("descrizioni vietnamite", () => {
  assert.equal(normalizeMerchant("CHUYEN KHOAN DEN HIGHLANDS COFFEE D1"), "den highlands coffee d1");
  assert.equal(normalizeMerchant("THANH TOAN GRAB 0912345678"), "grab");
});

test("i numeri corti che fanno parte del nome restano", () => {
  // "d1" e' il distretto 1 di Ho Chi Minh, non un codice da buttare.
  assert.equal(normalizeMerchant("STARBUCKS D1"), "starbucks d1");
  assert.equal(normalizeMerchant("SEVEN 11 SAIGON"), "seven 11 saigon");
});

test("casi vuoti", () => {
  assert.equal(normalizeMerchant(""), "");
  assert.equal(normalizeMerchant(null), "");
  assert.equal(normalizeMerchant("POS CARTA PAGAMENTO"), "");
  assert.equal(normalizeMerchant("   "), "");
});

test("stessa descrizione da canali diversi, stesso commerciante", () => {
  const a = normalizeMerchant("POS 12/09 STARBUCKS D1 HCMC CARD 4321");
  const b = normalizeMerchant("PAGAMENTO CARTA STARBUCKS D1 HCMC 01/10 ****9988");
  assert.equal(a, b);
});

test("confronto delle regole", () => {
  assert.ok(merchantMatches("esselunga milano", "esselunga milano", "exact"));
  assert.ok(!merchantMatches("esselunga milano", "esselunga", "exact"));
  assert.ok(merchantMatches("esselunga milano", "esselunga", "starts_with"));
  assert.ok(merchantMatches("esselunga milano", "milano", "contains"));
  assert.ok(!merchantMatches("", "esselunga", "contains"));
});

test("fra piu' regole vince la priorita', poi la piu' precisa", () => {
  const rules = [
    { id: "generica", pattern: "esselunga", match_type: "starts_with", priority: 100 },
    { id: "precisa",  pattern: "esselunga milano", match_type: "exact", priority: 100 },
    { id: "debole",   pattern: "milano", match_type: "contains", priority: 100 },
  ];
  assert.equal(pickRule("esselunga milano", rules).id, "precisa");

  const conPriorita = [
    { id: "alta", pattern: "milano", match_type: "contains", priority: 500 },
    { id: "bassa", pattern: "esselunga milano", match_type: "exact", priority: 100 },
  ];
  assert.equal(pickRule("esselunga milano", conPriorita).id, "alta");
  assert.equal(pickRule("ikea", rules), null);
});
