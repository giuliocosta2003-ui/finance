// src/i18n/errorText.test.js — node --test
import test from "node:test";
import assert from "node:assert/strict";
import { errorText } from "./errorText.js";
import it from "./it.js";

/** Un `t` come quello di I18nContext: chiave puntata, o la chiave stessa. */
const t = (key, vars) => {
  const found = key.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : undefined), it);
  if (found == null) return key;
  let s = found;
  if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, String(vars[k]));
  return s;
};

test("un codice conosciuto diventa la frase tradotta", () => {
  const text = errorText(t, "imports.errors", "ai_not_configured");
  assert.match(text, /chiave dell'API di Claude/);
  assert.doesNotMatch(text, /ai_not_configured/);
});

test("un codice sconosciuto si mostra com'e', non sparisce", () => {
  // Un messaggio tecnico e' brutto ma dice qualcosa; un generico "errore" no.
  assert.equal(
    errorText(t, "imports.errors", "Failed to fetch"),
    "Failed to fetch",
  );
});

test("senza codice si usa il fallback indicato", () => {
  assert.equal(
    errorText(t, "documents.errors", null, "documents.errors.extraction_failed"),
    it.documents.errors.extraction_failed,
  );
});

test("senza codice e senza fallback resta il messaggio generico", () => {
  assert.equal(errorText(t, "imports.errors", undefined), it.common.errorGeneric);
});

test("lo stesso codice in namespace diversi da' frasi diverse", () => {
  // `ai_not_configured` parla di PDF negli import e di lettura nei documenti:
  // e' il motivo per cui il namespace e' un parametro e non una costante.
  const a = errorText(t, "imports.errors", "ai_not_configured");
  const b = errorText(t, "documents.errors", "ai_not_configured");
  assert.notEqual(a, b);
});
