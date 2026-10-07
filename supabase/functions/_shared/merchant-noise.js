// supabase/functions/_shared/merchant-noise.js
// Parole che le banche mettono nelle descrizioni e che non dicono niente su
// CHI ha incassato. Sta in un file suo perche' e' una lista destinata a
// crescere: ogni banca nuova ne porta due o tre.
//
// Regola per aggiungerne: solo termini che non possono essere il nome di un
// esercente. "momo", "grab", "vinmart" sono commercianti veri, non rumore.

/** Termini di piu' parole: si tolgono per primi, prima dello spezzettamento. */
export const NOISE_PHRASES = [
  // italiano
  "pagamento pos", "pagamento carta", "addebito diretto", "bonifico a favore di",
  "bonifico da", "bonifico per", "operazione carta", "acquisto carta",
  "pagamento tramite", "disposizione di bonifico", "sepa direct debit",
  "bonifico istantaneo", "bonifico sepa", "giroconto",
  "id transazione", "tasso revolut", "tasso ecb",
  // inglese
  "point of sale", "card payment", "debit card purchase", "credit card purchase",
  "direct debit", "standing order", "bank transfer", "wire transfer",
  "purchase authorized on", "recurring payment",
  // vietnamita
  "chuyen khoan", "chuyen tien", "thanh toan", "giao dich", "tai khoan",
  "rut tien", "nop tien", "phi dich vu",
];

/**
 * Circuiti di pagamento che stampano "PROCESSORE *ESERCENTE": PayPal, Square,
 * SumUp, Toast e simili. Chi ha incassato e' quello DOPO l'asterisco, non il
 * circuito. Togliere il prefisso raggruppa "PAYPAL *NETFLIX" con "NETFLIX" e
 * due esercenti diversi passati dallo stesso PayPal non finiscono insieme.
 * Solo la forma "prefisso *" viene tolta: un "paypal" senza asterisco resta,
 * perche' potrebbe essere davvero il conto PayPal dell'utente.
 */
export const AGGREGATOR_PREFIXES = [
  "paypal", "pp", "sumup", "sq", "sqc", "sq c", "tst", "toast",
  "zettle", "izettle", "nexi", "satispay", "stripe", "klarna",
  "viva", "adyen", "dlocal", "checkout", "google", "gpay", "amzn mktp",
];

/**
 * Forme societarie: non dicono CHI ha incassato, e compaiono in modo
 * incostante ("ACME" oggi, "ACME SRL" domani). Si tolgono come token interi.
 * Le sigle troppo corte e ambigue (sa, ag, co, ab, bv, nv) restano fuori di
 * proposito: "sa" e' anche una sillaba di troppi nomi.
 */
export const LEGAL_FORMS = [
  "srl", "srls", "spa", "sapa", "sas", "snc", "sarl", "sagl",
  "ltd", "ltda", "limited", "llc", "llp", "plc", "inc", "incorporated",
  "gmbh", "ug", "kft", "oyj", "pte", "bhd", "sdn",
];

/** Parole singole. Si tolgono solo se sono un token intero. */
export const NOISE_WORDS = [
  // italiano
  "pos", "carta", "pagamento", "pagamenti", "addebito", "accredito", "bonifico",
  "prelievo", "versamento", "commissione", "commissioni", "disposizione",
  "operazione", "acquisto", "rif", "riferimento", "cro", "trn", "sdd", "rid",
  // inglese
  "card", "payment", "purchase", "debit", "credit", "transaction", "transfer",
  "withdrawal", "deposit", "fee", "ref", "reference", "auth", "authorization",
  "pmt", "txn", "tx", "atm",
  // circuiti
  "visa", "mastercard", "maestro", "amex", "jcb", "unionpay", "sepa", "swift",
  // "CART" e' il troncamento di "carta" che alcune banche stampano prima del
  // numero; "istantaneo" e "ricorrente" qualificano il tipo di operazione, non
  // l'esercente.
  "cart", "istantaneo", "ricorrente", "mandato", "creditore", "debitore",
  // vietnamita
  "ck", "tt", "ngan hang", "phi", "lai",
  // Canali e tipi di operazione che le banche stampano accanto al movimento.
  // "electro" e' il canale delle carte negli estratti HSBC e "rtp" il
  // bonifico istantaneo: compaiono su meta' dei movimenti e non dicono
  // niente su chi ha incassato.
  "electro", "rtp", "ecom", "ibft", "napas",
];
