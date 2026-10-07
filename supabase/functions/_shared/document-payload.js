// supabase/functions/_shared/document-payload.js
// Cosa si chiede a Claude quando legge un documento, e cosa si accetta indietro.
//
// Sta nel modulo condiviso, come ai-payload.js, per la stessa ragione: la
// validazione e' una promessa fatta all'utente ("non ti scrivo un totale che
// non torna senza dirtelo"), e una promessa senza test e' un'intenzione.
//
// Gli importi arrivano dal modello in forma canonica (cifre e punto decimale,
// niente separatore delle migliaia) e diventano subito interi in minor units.
// Mai float: `parseFloat("0.1") + parseFloat("0.2")` non fa 0,3, e su una
// fattura quell'errore si vede.

// ── schema della risposta ────────────────────────────────────────────────────

const AMOUNT = {
  type: ["string", "null"],
  description: "importo in cifre, punto come separatore decimale, senza separatore delle migliaia (es. 1234.56)",
};

export const DOCUMENT_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["invoice_issued", "invoice_received", "receipt", "payslip", "contract", "other"],
      description: "invoice_issued se l'ha emessa chi legge, invoice_received se l'ha ricevuta",
    },
    issuer:       { type: ["string", "null"], description: "chi ha emesso il documento" },
    counterparty: { type: ["string", "null"], description: "l'altra parte" },
    doc_date:     { type: ["string", "null"], description: "data del documento, formato YYYY-MM-DD" },
    due_date:     { type: ["string", "null"], description: "scadenza, formato YYYY-MM-DD" },
    reference:    { type: ["string", "null"], description: "numero di fattura o riferimento" },
    currency:     { type: ["string", "null"], description: "codice ISO 4217, tre lettere" },
    total:        AMOUNT,
    net:          AMOUNT,
    tax:          AMOUNT,
    tax_rate:     { type: ["number", "null"], description: "aliquota in percentuale, es. 22" },
    // Per una busta paga il totale e' il NETTO; lordo e contributi restano qui
    // e serviranno al tasso di risparmio della fase 5.
    payslip_gross: AMOUNT,
    payslip_contributions: AMOUNT,
    unreadable:   { type: "boolean", description: "true se il documento non si legge abbastanza da estrarre nulla" },
    low_confidence: { type: "boolean", description: "true se i valori estratti sono incerti" },
  },
  required: ["kind", "issuer", "counterparty", "doc_date", "due_date", "reference", "currency",
             "total", "net", "tax", "tax_rate", "payslip_gross", "payslip_contributions",
             "unreadable", "low_confidence"],
  additionalProperties: false,
};

// ── conversione esatta in minor units ────────────────────────────────────────

/**
 * "1234.56" con 2 decimali -> 123456n. Tutto con stringhe e BigInt: nessun
 * passaggio da float, quindi nessun errore di rappresentazione.
 * Le cifre oltre i decimali della valuta si arrotondano commercialmente.
 *
 * @returns {bigint|null} null se non e' un numero in forma canonica
 */
export function decimalToMinor(text, decimals) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim();
  if (s === "") return null;

  const m = s.match(/^(-?)(\d+)(?:\.(\d*))?$/);
  if (!m) return null;

  const sign = m[1];
  const whole = m[2];
  const frac = m[3] ?? "";

  const kept = (frac + "0".repeat(decimals)).slice(0, decimals);
  const dropped = frac.slice(decimals);

  let value = BigInt(whole + kept);
  if (dropped && Number(dropped[0]) >= 5) value += 1n;
  return sign === "-" ? -value : value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Una data valida in forma ISO, oppure null. Il 31 febbraio non passa. */
export function isoDate(text) {
  if (!text || !ISO_DATE.test(String(text).trim())) return null;
  const s = String(text).trim();
  const [y, m, d] = s.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return s;
}

// ── validazione ──────────────────────────────────────────────────────────────

/** Dieci anni in giorni: oltre, la data e' quasi certamente letta male. */
const MAX_AGE_DAYS = 3653;

/**
 * Trasforma la risposta del modello nei campi della tabella, e segnala cosa
 * non torna. Non blocca MAI: un documento con un flag resta archiviato e
 * l'utente corregge. Bloccare vorrebbe dire perdere il documento per colpa di
 * un campo.
 *
 * @param parsed        l'oggetto restituito dal modello
 * @param currencyCodes Set dei codici ISO esistenti in `currencies`
 * @param minorUnitsOf  (code) => numero di decimali
 * @param today         "YYYY-MM-DD"
 */
export function validateDocument(parsed, { currencyCodes, minorUnitsOf, today }) {
  const flags = [];

  const raw = (parsed?.currency ?? "").trim().toUpperCase();
  const currency = raw === "" ? null : raw;
  const known = !!currency && currencyCodes.has(currency);
  // Una valuta inventata non entra nella colonna: c'e' una FK verso
  // `currencies`, e un insert con un codice inesistente fallirebbe tutto.
  if (currency && !known) flags.push("unknown_currency");

  const decimals = known ? minorUnitsOf(currency) : 2;

  const total = decimalToMinor(parsed?.total, decimals);
  const net   = decimalToMinor(parsed?.net, decimals);
  const tax   = decimalToMinor(parsed?.tax, decimals);

  // Netto + imposta deve fare il totale. La tolleranza di una unita' minima
  // c'e' perche' gli arrotondamenti per riga di una fattura non sempre
  // ricompongono il totale al centesimo.
  if (total !== null && net !== null && tax !== null) {
    const diff = net + tax - total;
    if (diff > 1n || diff < -1n) flags.push("amounts_mismatch");
  }

  const docDate = isoDate(parsed?.doc_date);
  if (parsed?.doc_date && !docDate) {
    flags.push("date_suspicious");
  } else if (docDate) {
    const days = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(docDate + "T00:00:00Z")) / 86400000);
    // Nel futuro o piu' vecchia di dieci anni: nessuna delle due e' impossibile,
    // ma entrambe meritano un'occhiata prima di finire in un bilancio.
    if (days < 0 || days > MAX_AGE_DAYS) flags.push("date_suspicious");
  }

  if (parsed?.unreadable === true) flags.push("unreadable");
  if (parsed?.low_confidence === true) flags.push("low_confidence");

  return {
    fields: {
      kind: parsed?.kind ?? "other",
      issuer: parsed?.issuer ?? null,
      counterparty: parsed?.counterparty ?? null,
      doc_date: docDate,
      due_date: isoDate(parsed?.due_date),
      reference: parsed?.reference ?? null,
      currency: known ? currency : null,
      total_minor: total === null ? null : total.toString(),
      net_minor: net === null ? null : net.toString(),
      tax_minor: tax === null ? null : tax.toString(),
      tax_rate: typeof parsed?.tax_rate === "number" && parsed.tax_rate >= 0 && parsed.tax_rate <= 100
        ? parsed.tax_rate : null,
    },
    flags: [...new Set(flags)],
  };
}
