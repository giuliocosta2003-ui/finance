// src/pages/statusTones.js
// Il colore di ogni stato, in un posto solo.
//
// Prima queste tabelle stavano dentro le schermate: `STATUS_TONE` in
// DocumentsPage, un'altra in DocumentPage, una terza in ImportsPage — e i
// colori non coincidevano. Lo stesso stato "in attesa di revisione" era blu in
// un elenco e arancione nel dettaglio dello stesso documento.
//
// Sono token, non colori letterali: cambiare il giallo degli avvisi resta una
// riga in tokens.css.

/** Stati di un documento (documents.status). */
export const DOC_STATUS_TONE = {
  uploaded:       "var(--text-secondary)",
  extracting:     "var(--warning)",
  pending_review: "var(--info)",
  confirmed:      "var(--positive)",
  failed:         "var(--negative)",
};

/** Stati di un import (imports.status). */
export const IMPORT_STATUS_TONE = {
  uploaded:  "var(--text-secondary)",
  parsing:   "var(--warning)",
  review:    "var(--info)",
  committed: "var(--positive)",
  rolled_back: "var(--text-secondary)",
  failed:    "var(--negative)",
};

/**
 * Quanto ci si puo' fidare della categoria proposta. Non e' una probabilita'
 * dell'AI ma la FONTE: una regola scritta dall'utente vale piu' di un'ipotesi.
 */
export const CONFIDENCE_TONE = {
  rule:    "var(--positive)",
  history: "var(--info)",
  ai:      "var(--warning)",
  none:    "var(--text-secondary)",
};
