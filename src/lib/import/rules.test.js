// src/lib/import/rules.test.js — node --test
// Le regole nate dalle correzioni, e il loro effetto sul secondo import:
// se coprono tutto, l'AI non viene nemmeno chiamata.
import test from "node:test";
import assert from "node:assert/strict";
import { applyRules } from "./pipeline.js";
import { normalizeMerchant } from "../merchant.js";

const righe = (descrizioni) => descrizioni.map((d, i) => ({
  rowIndex: i,
  description: d,
  merchant: normalizeMerchant(d),
  amountMinor: -1000n,
  flags: [],
}));

test("una correzione diventa una regola che copre il commerciante", () => {
  // L'utente ha corretto "POS 01/09 ESSELUNGA MILANO CARTA 4321" -> Spesa.
  // La regola nasce sul commerciante normalizzato, non sulla descrizione
  // grezza: cosi' scatta anche quando la banca cambia data e numero di carta.
  const pattern = normalizeMerchant("POS 01/09 ESSELUNGA MILANO CARTA 4321");
  assert.equal(pattern, "esselunga milano");

  const regole = [{ id: "r1", pattern, match_type: "exact", category_id: "cat-spesa", priority: 100 }];
  const { rows, applied } = applyRules(
    righe(["POS 14/10 ESSELUNGA MILANO CARTA 9988"]),
    regole,
  );

  assert.equal(applied, 1);
  assert.equal(rows[0].categoryId, "cat-spesa");
  assert.equal(rows[0].categorySource, "rule");
  assert.equal(rows[0].confidence, "high");
});

test("il secondo import non chiama l'AI se le regole coprono tutto", () => {
  const regole = [
    { id: "r1", pattern: "esselunga milano", match_type: "exact", category_id: "cat-spesa", priority: 100 },
    { id: "r2", pattern: "netflix com", match_type: "exact", category_id: "cat-abbonamenti", priority: 100 },
  ];
  const { rows, applied, used } = applyRules(
    righe([
      "POS 02/10 ESSELUNGA MILANO CARTA 1111",
      "PAGAMENTO CARTA ****2222 NETFLIX.COM",
    ]),
    regole,
  );

  assert.equal(applied, 2);
  // E' questa la condizione che il codice usa per decidere se chiamare l'AI.
  const senzaCategoria = rows.filter(r => !r.categoryId).length;
  assert.equal(senzaCategoria, 0, "niente da categorizzare: nessuna chiamata AI");
  assert.deepEqual([...used.entries()].sort(), [["r1", 1], ["r2", 1]]);
});

test("se una riga resta scoperta, quella sola andrebbe all'AI", () => {
  const regole = [{ id: "r1", pattern: "esselunga milano", match_type: "exact", category_id: "cat-spesa", priority: 100 }];
  const { rows, applied } = applyRules(
    righe(["POS ESSELUNGA MILANO", "POS NEGOZIO MAI VISTO"]),
    regole,
  );
  assert.equal(applied, 1);
  assert.equal(rows.filter(r => !r.categoryId).length, 1);
  assert.equal(rows[1].merchant, "negozio mai visto");
});

test("una regola conta gli usi, anche piu' volte nello stesso import", () => {
  const regole = [{ id: "r1", pattern: "caffe del corso", match_type: "exact", category_id: "cat-bar", priority: 100 }];
  const { used } = applyRules(
    righe(["POS 07/09 CAFFE DEL CORSO", "POS 08/09 CAFFE DEL CORSO", "POS 09/09 CAFFE DEL CORSO"]),
    regole,
  );
  assert.equal(used.get("r1"), 3);
});

test("le regole non sovrascrivono una categoria gia' decisa", () => {
  const regole = [{ id: "r1", pattern: "esselunga milano", match_type: "exact", category_id: "cat-spesa", priority: 100 }];
  const partenza = righe(["POS ESSELUNGA MILANO"]);
  partenza[0].categoryId = "cat-scelta-dall-utente";
  const { rows, applied } = applyRules(partenza, regole);
  assert.equal(applied, 0);
  assert.equal(rows[0].categoryId, "cat-scelta-dall-utente");
});

test("starts_with e contains funzionano come promesso", () => {
  const regole = [{ id: "r1", pattern: "esselunga", match_type: "starts_with", category_id: "cat-spesa", priority: 100 }];
  const { rows } = applyRules(righe(["ESSELUNGA TORINO CORSO GIULIO"]), regole);
  assert.equal(rows[0].categoryId, "cat-spesa");

  const contiene = [{ id: "r2", pattern: "farmacia", match_type: "contains", category_id: "cat-salute", priority: 100 }];
  const { rows: r2 } = applyRules(righe(["POS GRANDE FARMACIA CENTRALE"]), contiene);
  assert.equal(r2[0].categoryId, "cat-salute");
});
