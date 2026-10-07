// src/lib/documents/consultantInvoice.js
// Legge a regole le fatture di consulenza emesse dall'utente, senza AI.
//
// Sono fatture prodotte da un generatore fisso (lo stesso tracciato per ogni
// cliente): intestazione a due colonne CLIENT / INVOICE, una riga di dettaglio,
// un "Summary Data" e un totale. Come per gli estratti conto, un tracciato
// conosciuto si legge nel browser gratis, senza consenso AI e senza che il file
// esca dal dispositivo; l'AI resta per i documenti che non si riconoscono.
//
// Restituisce ESATTAMENTE la forma che restituirebbe il modello (lo schema di
// document-payload.js): cosi' a valle passa dalla stessa `validateDocument`,
// che alza gli stessi flag (netto+imposta che non fa il totale, data sospetta)
// e scrive gli stessi campi. Una sola strada di validazione, come per gli
// estratti una sola strada di controllo.
//
// Il parser lavora sulle COORDINATE, non sul testo appiattito: su una fattura i
// valori stanno a destra della loro etichetta ("Invoice No." poi "004"), e
// appiattito l'ordine si perde. Gli importi qui sono in formato anglosassone
// ("1,300.00": migliaia con la virgola, decimali col punto), mentre le
// percentuali sono all'italiana ("0,00%"): due formati nello stesso foglio, e
// per questo l'importo si normalizza guardando l'ultimo separatore, non la
// lingua.

import { parseDate } from "../import/mapping.js";

/**
 * Marcatori del tracciato. Sono cinque perche' devono escludere QUALSIASI altra
 * fattura: bastano due etichette generiche ("Invoice", "Total") a far scattare
 * un parser su un documento che non e' questo, e leggerlo male e' peggio che
 * mandarlo all'AI.
 */
const MARKERS = [
  /\bInvoice No\.?/i,
  /\bInvoice Date\b/i,
  /\bSummary Data\b/i,
  /TAXABLE AMOUNT/i,
  /CONSULTANT BANK INFORMATION|The Consultant shall/i,
];

/** Un importo anglosassone ("1,300.00") o italiano -> canonico "1300.00". */
export function canonicalAmount(text) {
  const s = String(text ?? "").replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;
  const negative = s.startsWith("-");
  const digits = s.replace(/-/g, "");
  const decPos = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));

  let intPart, fracPart;
  if (decPos >= 0) {
    const after = digits.slice(decPos + 1).replace(/\D/g, "");
    // Una o due cifre dopo l'ultimo separatore: e' il decimale. Tre: erano le
    // migliaia, e non c'e' parte decimale.
    if (after.length >= 1 && after.length <= 2) {
      intPart = digits.slice(0, decPos).replace(/\D/g, "");
      fracPart = after;
    } else {
      intPart = digits.replace(/\D/g, "");
      fracPart = "";
    }
  } else {
    intPart = digits;
    fracPart = "";
  }
  if (!intPart && !fracPart) return null;
  const body = fracPart ? `${intPart || "0"}.${fracPart}` : (intPart || "0");
  return (negative ? "-" : "") + body;
}

/** Una percentuale "0,00%" / "22%" -> numero. Null se non c'e'. */
function parsePercent(text) {
  const m = /(-?\d+(?:[.,]\d+)?)\s*%/.exec(String(text ?? ""));
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Tutti gli item della prima riga che contiene `labelRe`, a destra dell'etichetta. */
function valueRightOf(lines, labelRe) {
  for (const line of lines) {
    const label = line.items.find(i => labelRe.test(i.text.trim()));
    if (!label) continue;
    const right = line.items
      .filter(i => i.x > label.x)
      .map(i => i.text.trim())
      .filter(Boolean);
    if (right.length) return right.join(" ").replace(/\s+/g, " ").trim();
  }
  return null;
}

const isAmountItem = (t) => /\d/.test(t) && /^[\d.,]+$/.test(String(t).replace(/[^\d.,]/g, "")) && /^[\s$€£\d.,]+$/.test(t);

export function detect(layout) {
  const first = layout?.pages?.[0];
  if (!first) return false;
  const text = first.lines.flatMap(l => l.items.map(i => i.text)).join(" ");
  return MARKERS.every(re => re.test(text));
}

/**
 * @returns {{ok:true, template:string, extracted:object} | {ok:false, reason:string}}
 */
export function parse(layout) {
  const page = layout?.pages?.[0];
  const lines = page?.lines ?? [];
  if (!lines.length) return { ok: false, reason: "empty" };

  // Ordine di lettura: dall'alto in basso (Y decrescente).
  const ordered = [...lines].sort((a, b) => b.y - a.y);

  // Riferimento e data: valore a destra dell'etichetta.
  const reference = valueRightOf(ordered, /^Invoice No\.?$/i);
  const dateRaw = valueRightOf(ordered, /^Invoice Date$/i);
  // Le fatture italiane scrivono la data GG/MM/AAAA.
  const doc_date = dateRaw ? parseDate(dateRaw, "DMY") : null;

  // Emittente: il nome in cima, prima di " - C.F.".
  const topText = ordered[0]?.items?.map(i => i.text).join(" ") ?? "";
  const issuer = (topText.split(/\s+-\s+/)[0] || "").trim() || null;

  // Cliente (controparte): la prima riga sotto l'intestazione "CLIENT", colonna
  // di sinistra. E' li' che il generatore mette il nome dell'azienda cliente.
  let counterparty = null;
  const clientHeader = ordered.find(l => l.items.some(i => /^CLIENT$/i.test(i.text.trim())));
  if (clientHeader) {
    const below = ordered.filter(l => l.y < clientHeader.y);
    for (const l of below) {
      const left = l.items.find(i => i.x < 220);
      const txt = left?.text?.trim();
      if (txt && !/^Room\b/i.test(txt)) { counterparty = txt; break; }
    }
  }

  // La riga di dettaglio: quella con un importo e un "$"/valuta, sotto le
  // intestazioni della tabella. Da li' si prende il codice valuta (l'unico
  // token di tre lettere maiuscole su quella riga; "LTD" sta altrove).
  let currency = null;
  const itemLine = ordered.find(l =>
    l.items.some(i => /^[$€£]$/.test(i.text.trim()) || /[$€£]\s*\d/.test(i.text))
    && l.items.some(i => isAmountItem(i.text)),
  );
  if (itemLine) {
    const code = itemLine.items.map(i => i.text.trim()).find(t => /^[A-Z]{3}$/.test(t));
    if (code) currency = code;
  }
  if (!currency) {
    // Ripiego: il simbolo $ senza codice vale USD, gli altri restano vuoti.
    const text = lines.flatMap(l => l.items.map(i => i.text)).join(" ");
    if (/\$/.test(text) && !/[€£]/.test(text)) currency = "USD";
  }

  // Totale: la riga "TOTAL" del riepilogo, quella con "$" e un numero (non
  // l'intestazione di colonna "TOTAL", che non ne ha).
  let total = null;
  const totalLine = ordered.find(l =>
    l.items.some(i => /^TOTAL$/i.test(i.text.trim()))
    && l.items.some(i => isAmountItem(i.text)),
  );
  if (totalLine) {
    const amt = totalLine.items.map(i => i.text).find(isAmountItem);
    total = canonicalAmount(amt);
  }

  // Aliquota IVA e imponibile dal "Summary Data": la riga che porta una
  // percentuale. Va cercata DENTRO quella sezione, non nella riga di dettaglio
  // (che porta anch'essa l'aliquota, ma il cui primo numero e' la QUANTITA').
  let tax_rate = null;
  let net = null;
  const summaryHeader = ordered.find(l => l.items.some(i => /Summary Data/i.test(i.text.trim())));
  const summaryLines = summaryHeader ? ordered.filter(l => l.y < summaryHeader.y) : ordered;
  const vatLine = summaryLines.find(l => l.items.some(i => /%$/.test(i.text.trim())));
  if (vatLine) {
    tax_rate = parsePercent(vatLine.items.map(i => i.text).find(t => /%/.test(t)));
    const amt = vatLine.items.map(i => i.text).find(isAmountItem);
    if (amt) net = canonicalAmount(amt);
  }
  if (net === null) net = total;

  // L'imposta: se l'aliquota e' zero, e' zero (queste fatture sono fuori campo
  // IVA); il campo "TAX" sul foglio e' spesso mascherato ("####") e non si
  // legge. Con un'aliquota diversa e nessun imponibile leggibile, si lascia
  // che sia validateDocument a segnalare l'incoerenza.
  let tax = null;
  if (tax_rate === 0) tax = "0.00";
  else if (total !== null && net !== null) {
    const t = Number(total) - Number(net);
    if (Number.isFinite(t) && t >= 0) tax = t.toFixed(2);
  }

  const extracted = {
    // E' una fattura EMESSA dall'utente (l'emittente in cima e' l'utente, il
    // documento e' intestato a un CLIENTE).
    kind: "invoice_issued",
    issuer,
    counterparty,
    doc_date,
    due_date: null,
    reference,
    currency,
    total,
    net,
    tax,
    tax_rate,
    payslip_gross: null,
    payslip_contributions: null,
    unreadable: false,
    low_confidence: false,
  };

  return { ok: true, template: "consultant_invoice", extracted };
}
