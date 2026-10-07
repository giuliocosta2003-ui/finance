// src/i18n/errorText.js
// Traduce un codice di errore, e se non lo conosce mostra quello che ha.
//
// Il motivo per cui esiste: `t()` su una chiave mancante restituisce la chiave
// stessa, quindi tre schermate si erano scritte a mano lo stesso confronto —
//
//   t(`imports.errors.${code}`) === `imports.errors.${code}` ? code : t(...)
//
// — con la stessa riga copiata in ImportsPage, DocumentsPage e DocumentPage, e
// dimenticata in ReviewPage e in Investimenti. Qui e' una funzione sola.
//
// Serve perche' gli errori che arrivano dalle Edge Function sono CODICI
// (`ai_not_configured`), mentre quelli che arrivano da Postgres o dalla rete
// sono frasi in inglese: le prime vanno tradotte, le seconde mostrate cosi'
// come sono, che e' comunque meglio di niente.

/**
 * @param {(key: string, vars?: object) => string} t  da useI18n()
 * @param {string} namespace  es. "imports.errors"
 * @param {string|null|undefined} code
 * @param {string} [fallbackKey]  chiave da usare quando `code` e' vuoto
 * @returns {string}
 */
export function errorText(t, namespace, code, fallbackKey) {
  if (!code) return fallbackKey ? t(fallbackKey) : t("common.errorGeneric");

  const key = `${namespace}.${code}`;
  const translated = t(key);
  // `t` non ha trovato niente e ha restituito la chiave: il codice non e' uno
  // dei nostri. E' un messaggio tecnico, e mostrarlo com'e' aiuta piu' che
  // sostituirlo con un generico "qualcosa e' andato storto".
  if (translated !== key) return translated;

  return String(code);
}
