// src/i18n/parity.test.js — node --test
// Le regole del progetto dicono: "tutte le stringhe in it.js e en.js, con le
// stesse chiavi nei due file". Finora era una convenzione scritta in un
// commento, cioe' qualcosa che si scopre rotto quando un utente inglese vede
// "home.monthSaved" al posto di "Saved".
//
// Qui diventa un test. Confronta le due strutture per intero, a qualsiasi
// profondita', e verifica anche i segnaposto: una stringa che promette {count}
// in una lingua e non nell'altra produce un buco nel testo tradotto.
import test from "node:test";
import assert from "node:assert/strict";
import it from "./it.js";
import en from "./en.js";

/** Tutte le chiavi, appiattite in "sezione.chiave.sottochiave". */
function flatten(obj, prefix = "") {
  const out = new Map();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of flatten(value, path)) out.set(k, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

const IT = flatten(it);
const EN = flatten(en);

/** I segnaposto di una stringa, es. "Ciao {name}" -> ["name"]. */
const placeholders = (text) =>
  typeof text === "string"
    ? [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
    : [];

test("i due dizionari hanno esattamente le stesse chiavi", () => {
  const onlyIt = [...IT.keys()].filter(k => !EN.has(k)).sort();
  const onlyEn = [...EN.keys()].filter(k => !IT.has(k)).sort();
  assert.deepEqual(onlyIt, [], "chiavi presenti solo in italiano");
  assert.deepEqual(onlyEn, [], "chiavi presenti solo in inglese");
});

test("ogni chiave ha una stringa non vuota in tutte e due le lingue", () => {
  for (const [key, value] of IT) {
    assert.equal(typeof value, "string", `it: ${key} non e' una stringa`);
    assert.notEqual(value.trim(), "", `it: ${key} e' vuota`);
  }
  for (const [key, value] of EN) {
    assert.equal(typeof value, "string", `en: ${key} non e' una stringa`);
    assert.notEqual(value.trim(), "", `en: ${key} e' vuota`);
  }
});

test("i segnaposto coincidono fra le due lingue", () => {
  // Una traduzione che perde {count} non da' errore: stampa una frase a cui
  // manca il numero, e nessuno se ne accorge finche' non la legge.
  for (const [key, itText] of IT) {
    const a = placeholders(itText);
    const b = placeholders(EN.get(key));
    assert.deepEqual(
      a, b,
      `${key}: segnaposto diversi — it ${JSON.stringify(a)}, en ${JSON.stringify(b)}`,
    );
  }
});
