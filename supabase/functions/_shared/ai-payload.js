// supabase/functions/_shared/ai-payload.js
// Cosa si manda a Claude e cosa si accetta indietro.
//
// Sta in un modulo a parte, condiviso con i test, per due motivi precisi:
// 1. la sanificazione dei dati in uscita e' una promessa fatta all'utente, e
//    una promessa senza test e' un'intenzione;
// 2. la validazione della risposta e' l'unica difesa contro una categoria
//    inventata dal modello, che altrimenti finirebbe dritta nel bilancio.
import { normalizeMerchant } from "./merchant.js";

// ── in uscita ────────────────────────────────────────────────────────────────

/**
 * Riduce una riga a cio' che serve per capire di che spesa si tratta.
 * Fuori restano: nome e id del conto, saldo, importo esatto, IBAN e numeri di
 * carta (li toglie normalizeMerchant). Del valore resta solo il SEGNO, perche'
 * per scegliere la categoria basta sapere se sono soldi che entrano o escono.
 */
export function sanitizeRowForAi(row) {
  return {
    i: row.row_index ?? row.rowIndex ?? 0,
    d: row.booked_on ?? row.bookedOn ?? null,
    t: normalizeMerchant(row.description ?? row.merchant ?? ""),
    s: Number(row.amount_minor ?? row.amountMinor ?? 0) >= 0 ? "+" : "-",
    c: (row.currency ?? "").trim() || null,
  };
}

/** Le categorie fra cui il modello puo' scegliere, con il nome nella lingua dell'utente. */
export function categoriesForAi(categories, labelOf) {
  return (categories ?? [])
    .filter(c => !c.archived_at)
    .map(c => ({
      id: c.id,
      name: labelOf ? labelOf(c) : (c.name ?? c.key),
      kind: c.kind,
      business: !!c.is_business,
    }));
}

export function buildCategorizePayload({ rows, categories, profileType, labelOf }) {
  return {
    profile_type: profileType ?? "other",
    categories: categoriesForAi(categories, labelOf),
    rows: (rows ?? []).map(sanitizeRowForAi),
  };
}

/** Controllo esplicito, usato dai test: nel payload non deve restare niente di sensibile. */
export function payloadLeaks(payload) {
  const text = JSON.stringify(payload);
  const leaks = [];
  if (/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/i.test(text)) leaks.push("iban");
  if (/\b(?:\d[ -]?){13,19}\b/.test(text)) leaks.push("numero_carta");
  if (/\b\d{6,}\b/.test(text)) leaks.push("numero_lungo");
  return leaks;
}

// ── schemi della risposta ────────────────────────────────────────────────────
// Structured outputs: il modello e' vincolato a rispondere in questa forma.
// Resta comunque la validazione qui sotto, perche' lo schema garantisce la
// forma, non che gli id esistano davvero.

export const CATEGORIZE_SCHEMA = {
  type: "object",
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer", description: "indice della riga" },
          category_id: { type: ["string", "null"], description: "id scelto fra quelli forniti, oppure null" },
          unsure: { type: "boolean", description: "true se la scelta e' incerta" },
        },
        required: ["i", "category_id", "unsure"],
        additionalProperties: false,
      },
    },
  },
  required: ["assignments"],
  additionalProperties: false,
};

export const MAPPING_SCHEMA = {
  type: "object",
  properties: {
    dateColumn:  { type: ["string", "null"] },
    dateFormat:  { type: "string", enum: ["ISO", "DMY", "MDY"] },
    amountMode:  { type: "string", enum: ["single", "debit_credit"] },
    amountColumn:  { type: ["string", "null"] },
    debitColumn:   { type: ["string", "null"] },
    creditColumn:  { type: ["string", "null"] },
    descriptionColumns: { type: "array", items: { type: "string" } },
    balanceColumn: { type: ["string", "null"] },
    decimalSeparator: { type: "string", enum: [",", "."] },
    skipRows: { type: "integer" },
  },
  required: ["dateColumn", "dateFormat", "amountMode", "amountColumn", "debitColumn",
             "creditColumn", "descriptionColumns", "balanceColumn", "decimalSeparator", "skipRows"],
  additionalProperties: false,
};

export const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    currency: { type: ["string", "null"], description: "codice ISO della valuta dell'estratto" },
    opening_balance: { type: ["string", "null"], description: "saldo iniziale come scritto sull'estratto" },
    closing_balance: { type: ["string", "null"], description: "saldo finale come scritto sull'estratto" },
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date:        { type: "string", description: "data come scritta sull'estratto" },
          description: { type: "string" },
          amount:      { type: "string", description: "importo come scritto, col segno" },
          balance:     { type: ["string", "null"] },
        },
        required: ["date", "description", "amount", "balance"],
        additionalProperties: false,
      },
    },
  },
  required: ["currency", "opening_balance", "closing_balance", "rows"],
  additionalProperties: false,
};

/**
 * Un estratto letto in piu' blocchi torna a essere uno solo.
 *
 * Sta qui, nel modulo condiviso, perche' i blocchi li fa il browser quando il
 * PDF ha un livello di testo e la Edge Function quando e' una scansione: due
 * punti diversi, ma la ricucitura deve essere la stessa, o lo stesso estratto
 * darebbe due risultati a seconda di come e' stato letto.
 */
export function mergeExtractions(parts) {
  const valid = (parts ?? []).filter(Boolean);
  return {
    currency: valid.find(p => p.currency)?.currency ?? null,
    // Solo il primo blocco puo' conoscere il saldo di partenza e solo l'ultimo
    // quello di arrivo: nei blocchi in mezzo un "saldo iniziale" sarebbe il
    // progressivo di quel punto, che non dice niente sull'estratto intero.
    opening_balance: valid[0]?.opening_balance ?? null,
    closing_balance: valid[valid.length - 1]?.closing_balance ?? null,
    rows: valid.flatMap(p => p.rows ?? []),
  };
}

// ── in entrata ───────────────────────────────────────────────────────────────

/**
 * Tiene solo le assegnazioni che puntano a una categoria davvero esistente.
 * Un id inventato non diventa "categoria sbagliata": diventa "nessuna
 * categoria", che l'utente vede e corregge. Una categoria plausibile ma falsa
 * sarebbe molto peggio di una casella vuota.
 */
export function validateCategorization(parsed, allowedCategoryIds) {
  const allowed = new Set(allowedCategoryIds ?? []);
  const assignments = [];
  const rejected = [];

  for (const item of parsed?.assignments ?? []) {
    if (typeof item?.i !== "number") continue;
    const id = item.category_id ?? null;
    if (id !== null && !allowed.has(id)) {
      rejected.push({ i: item.i, category_id: id });
      assignments.push({ i: item.i, categoryId: null, confidence: "low" });
      continue;
    }
    assignments.push({
      i: item.i,
      categoryId: id,
      // La confidenza non e' un numero inventato dal modello: e' la fonte.
      // Dall'AI il massimo e' "medium", e scende a "low" se il modello stesso
      // dichiara di non esserne sicuro.
      confidence: id === null ? "low" : (item.unsure ? "low" : "medium"),
    });
  }

  return { assignments, rejected };
}
