// src/lib/documents/index.js
// Il selettore dei documenti a regole: dato un PDF letto con le coordinate,
// trova il tracciato e gli affida il documento. Speculare a
// import/statements/index.js.
//
// Ogni parser espone `detect(layout)` e `parse(layout)`, e registrarne uno
// nuovo e' una riga in PARSERS. Il riconoscimento e' esplicito per tracciato:
// nessun parser "generico" che tenta la sorte. Se nessuno riconosce il
// documento si torna alla strada con l'AI (document-ai), che sa leggere prosa.
import * as consultantInvoice from "./consultantInvoice.js";

/** L'ordine conta: il primo che riconosce il documento se lo prende. */
const PARSERS = [consultantInvoice];

/**
 * @param {object} layout da readPdfLayout
 * @returns {{ok:true, template:string, extracted:object}
 *          | {ok:false, reason:string}}
 */
export function parseDocument(layout) {
  if (!layout?.pages?.length) return { ok: false, reason: "empty_pdf" };

  for (const parser of PARSERS) {
    let recognised = false;
    try {
      recognised = parser.detect(layout);
    } catch {
      continue;
    }
    if (!recognised) continue;

    try {
      return parser.parse(layout);
    } catch (e) {
      return { ok: false, reason: String(e?.message ?? e).slice(0, 200) };
    }
  }

  return { ok: false, reason: "unknown_template" };
}

/** I tracciati di documento che l'app sa leggere senza AI. */
export const SUPPORTED_TEMPLATES = ["consultant_invoice"];
