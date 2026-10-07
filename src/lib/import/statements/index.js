// src/lib/import/statements/index.js
// Il selettore: dato un PDF letto con le coordinate, trova la banca e le
// affida il documento.
//
// Ogni parser espone due funzioni sole — `detect(layout)` e `parse(layout)` —
// e registrarne uno nuovo vuol dire aggiungere una riga a PARSERS. Il
// riconoscimento e' esplicito e per banca: non esiste un parser "generico" che
// tenta la sorte su un tracciato che non conosce, perche' un estratto letto
// male e' peggio di un estratto non letto. Se nessuno lo riconosce si torna
// alla strada con l'AI, che almeno sa leggere prosa.
import * as hsbcVn from "./hsbcVn.js";
import * as revolut from "./revolut.js";

/** L'ordine conta: il primo che riconosce il documento se lo prende. */
const PARSERS = [hsbcVn, revolut];

/**
 * @param {object} layout da readPdfLayout
 * @returns {{ok: true, bank: string, extracted: object, stats: object}
 *          | {ok: false, reason: "unknown_bank" | string, bank?: string}}
 */
export function parseStatement(layout) {
  if (!layout?.pages?.length) return { ok: false, reason: "empty_pdf" };

  for (const parser of PARSERS) {
    let recognised = false;
    try {
      recognised = parser.detect(layout);
    } catch {
      // Un riconoscimento che esplode non deve fermare gli altri parser.
      continue;
    }
    if (!recognised) continue;

    try {
      return parser.parse(layout);
    } catch (e) {
      // Riconosciuta la banca ma la lettura e' fallita: si dice quale, cosi'
      // nel diario dell'import resta scritto dove andare a guardare.
      return { ok: false, reason: String(e?.message ?? e).slice(0, 200) };
    }
  }

  return { ok: false, reason: "unknown_bank" };
}

/** Le banche che l'app sa leggere senza AI. Serve a spiegarlo nell'interfaccia. */
export const SUPPORTED_BANKS = ["hsbc_vn", "revolut"];
