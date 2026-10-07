// src/lib/import/statements/revolut.js
// Estratto conto Revolut (filiale italiana), letto a regole. Zero AI.
//
// Come e' fatto il documento (misurato su un estratto vero, "Estratto conto in
// USD", 5 pagine, tracciato it-it):
//
//   x=43    Data                 data di contabilizzazione ("9 apr 2026")
//   x=125   Descrizione          il commerciante ("Netlify", "Apple", ...)
//   x=335   Denaro in uscita     uscita, allineata a SINISTRA al bordo colonna
//   x=417   Denaro in entrata    entrata, idem
//   x=519+  Saldo                saldo dopo il movimento, allineato a DESTRA
//
// Due cose distinguono questo tracciato da quello HSBC, e obbligano a un
// algoritmo diverso:
//
//  1. IL SEGNO STA NELLA COLONNA, come in HSBC: "448,73" e' un'uscita a x=335 e
//     un'entrata a x=417. Per questo si lavora sulle coordinate.
//  2. LA RIGA-ANCORA VIENE PRIMA. In HSBC la descrizione sta SOPRA l'importo;
//     qui la riga con data + importo + saldo apre il movimento, e le righe di
//     dettaglio ("ID transazione", "A:", "Da:", "Carta:", "Costo:", il tasso di
//     cambio, l'importo in valuta originale) stanno SOTTO. Quelle righe portano
//     altri importi nella colonna uscita/entrata (il costo, il netto della
//     conversione): NON sono movimenti, e si riconoscono perche' NON hanno un
//     saldo e NON hanno una data. Contano solo le righe con una data valida.
//
// Le bande delle colonne si ricavano dalla riga di intestazione, come in HSBC:
// se Revolut sposta una colonna il parser regge; se cambia i nomi delle
// intestazioni smette di riconoscere il documento e si passa all'AI, che e' il
// modo giusto di fallire.

/** Riconoscimento: marchio + le due colonne del denaro, sulla prima pagina. */
const MARKERS = [
  /Revolut/i,
  /Denaro in uscita|Money out|Paid out/i,
  /Denaro in entrata|Money in|Paid in/i,
];

/** Intestazioni di colonna, in italiano o in inglese. */
const HEADERS = {
  date:       /^(Data|Date)$/i,
  details:    /^(Descrizione|Description)$/i,
  withdrawal: /^(Denaro in uscita|Money out|Paid out)$/i,
  deposit:    /^(Denaro in entrata|Money in|Paid in)$/i,
  balance:    /^(Saldo|Balance)$/i,
};

/**
 * Dove finisce la tabella dei movimenti su una pagina: sotto queste
 * intestazioni ci sono solo prosa legale e condizioni economiche, non altri
 * movimenti. Riconoscerle non e' strettamente necessario (senza data non
 * nascono righe), ma taglia corto ed e' una rete di sicurezza.
 */
const TERMINATORS = /^(Attenzione|Avviso|Altre informazioni|Condizioni economiche|Important information|Notice)/i;

/** Mesi abbreviati, italiani e inglesi, per prime tre lettere (accenti tolti). */
const MONTHS = {
  gen: "01", feb: "02", mar: "03", apr: "04", mag: "05", giu: "06",
  lug: "07", ago: "08", set: "09", ott: "10", nov: "11", dic: "12",
  jan: "01", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", dec: "12",
};

/**
 * "9 apr 2026" e "12 mag 2026" -> "2026-04-09". Null se non e' una data.
 * Il mese e' testuale e per prime tre lettere, cosi' "apr", "apr." e "aprile"
 * cadono tutti sullo stesso valore.
 */
export function parseRevolutDate(text) {
  const s = String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const m = /^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/.exec(s);
  if (!m) return null;
  const month = MONTHS[m[2].slice(0, 3)];
  if (!month) return null;
  return `${m[3]}-${month}-${String(m[1]).padStart(2, "0")}`;
}

/** Un importo con eventuale simbolo di valuta: "1.792,31$", "23,24$", "9,00". */
const AMOUNT = /^[\d.,]+$/;

/** Il testo numerico di un importo, senza simbolo. Null se non e' un importo. */
export function amountText(text) {
  const s = String(text ?? "").replace(/[^\d.,]/g, "").trim();
  return s && AMOUNT.test(s) ? s : null;
}

/**
 * Le bande delle colonne, dalla riga di intestazione. Il confine sta a meta'
 * strada fra un'intestazione e la precedente.
 */
export function columnBands(lines) {
  const found = {};
  for (const line of lines) {
    for (const item of line.items) {
      for (const [key, re] of Object.entries(HEADERS)) {
        if (found[key] === undefined && re.test(item.text.trim())) found[key] = item.x;
      }
    }
    if (Object.keys(found).length === 5) break;
  }
  if (found.withdrawal === undefined || found.deposit === undefined || found.balance === undefined) {
    return null;
  }
  const between = (a, b) => (a + b) / 2;
  const date = found.date ?? 0;
  const details = found.details ?? date + 80;
  return {
    date,
    detailsFrom: between(date, details),
    withdrawalFrom: between(details, found.withdrawal),
    depositFrom: between(found.withdrawal, found.deposit),
    balanceFrom: between(found.deposit, found.balance),
  };
}

/** La Y della riga di intestazione: porta almeno due delle colonne numeriche. */
export function headerRowY(lines, bands) {
  for (const line of lines) {
    const hits = line.items.filter(i =>
      i.x >= bands.withdrawalFrom
      && (HEADERS.withdrawal.test(i.text.trim()) || HEADERS.deposit.test(i.text.trim()) || HEADERS.balance.test(i.text.trim())),
    ).length;
    if (hits >= 2) return line.y;
  }
  return null;
}

/** In quale colonna cade un frammento. */
function columnOf(x, bands) {
  if (x >= bands.balanceFrom) return "balance";
  if (x >= bands.depositFrom) return "deposit";
  if (x >= bands.withdrawalFrom) return "withdrawal";
  if (x >= bands.detailsFrom) return "details";
  return "date";
}

/** Riconosce un estratto Revolut dalla prima pagina. */
export function detect(layout) {
  const first = layout?.pages?.[0];
  if (!first) return false;
  const text = first.lines.flatMap(l => l.items.map(i => i.text)).join(" ");
  return MARKERS.every(re => re.test(text));
}

/**
 * Saldo iniziale e finale dal "Riepilogo del saldo" della prima pagina: la riga
 * "Totale" porta, in ordine, saldo iniziale, uscite, entrate e saldo di
 * chiusura. Si prende il primo importo e l'ultimo. E' il controllo piu' forte
 * che esista sull'import (checkTotals), e vale piu' della fatica di leggerlo.
 */
function summaryBalances(page) {
  for (const line of page?.lines ?? []) {
    const first = line.items[0]?.text?.trim() ?? "";
    if (!/^(Totale|Total)$/i.test(first)) continue;
    const amounts = line.items.map(i => amountText(i.text)).filter(Boolean);
    if (amounts.length >= 2) return { opening: amounts[0], closing: amounts[amounts.length - 1] };
  }
  return { opening: null, closing: null };
}

/** La valuta sta nel titolo: "Estratto conto in USD" / "Account Statement in USD". */
function detectCurrency(layout) {
  const text = layout.pages.slice(0, 1)
    .flatMap(p => p.lines.flatMap(l => l.items.map(i => i.text))).join(" ");
  const m = /(?:conto|statement)\s+in\s+([A-Z]{3})\b/i.exec(text);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Legge l'estratto e restituisce la stessa forma che restituirebbe il modello,
 * cosi' a valle non cambia niente: date gia' in ISO (il resto della pipeline
 * deduce da solo il formato, e "9 apr 2026" non lo saprebbe leggere), importi
 * ancora come stringhe con il separatore della banca. A interpretarli e a
 * calcolare l'impronta dei doppioni ci pensa `rowsFromExtraction`.
 */
export function parse(layout) {
  const bands = columnBands(layout?.pages?.[0]?.lines ?? []);
  if (!bands) return { ok: false, reason: "headers_not_found" };

  const rows = [];
  let unmatched = 0;

  for (const page of layout.pages) {
    const pageBands = columnBands(page.lines) ?? bands;
    const headerY = headerRowY(page.lines, pageBands);
    if (headerY === null) continue;   // pagina senza tabella: condizioni, legale

    for (const line of page.lines) {
      if (line.y >= headerY) continue;

      const lineText = line.items.map(i => i.text).join(" ").trim();
      if (TERMINATORS.test(lineText)) break;   // da qui in giu' non ci sono movimenti

      const cells = { date: [], details: [], withdrawal: [], deposit: [], balance: [] };
      for (const item of line.items) cells[columnOf(item.x, pageBands)].push(item.text);

      // Solo una riga con una data valida apre un movimento. Le righe di
      // dettaglio (ID, "A:", "Carta:", "Costo:", conversione) non ne hanno e
      // vengono ignorate: il loro importo e' gia' dentro l'ancora.
      const date = cells.date.map(parseRevolutDate).find(Boolean);
      if (!date) continue;

      const withdrawal = cells.withdrawal.map(amountText).find(Boolean) ?? null;
      const deposit = cells.deposit.map(amountText).find(Boolean) ?? null;
      const balance = cells.balance.map(amountText).find(Boolean) ?? null;

      // Il segno lo decide la COLONNA, non il testo.
      const amount = deposit ? deposit : withdrawal ? `-${withdrawal}` : null;
      if (amount === null) { unmatched++; continue; }

      rows.push({
        date,
        description: cells.details.join(" ").replace(/\s+/g, " ").trim(),
        amount,
        balance,
      });
    }
  }

  if (rows.length === 0) return { ok: false, reason: "no_rows" };

  const { opening, closing } = summaryBalances(layout.pages[0]);

  return {
    ok: true,
    bank: "revolut",
    extracted: {
      currency: detectCurrency(layout),
      opening_balance: opening,
      closing_balance: closing,
      rows,
    },
    stats: { rows: rows.length, withoutAmount: unmatched },
  };
}
