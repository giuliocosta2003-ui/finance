// src/lib/import/statements/hsbcVn.js
// Estratto conto HSBC Vietnam, letto a regole. Zero chiamate a un modello.
//
// Come e' fatto il documento (misurato sull'estratto vero, 22 pagine):
//
//   x=53    Ngày / Date            data di contabilizzazione
//   x=123   Chi tiết / Details     descrizione, su piu' righe
//   x=365   Ghi nợ / Withdrawals   uscita
//   x=442   Ghi có / Deposits      entrata
//   x=531   Số dư / Balance        saldo dopo il movimento
//
// Tre cose rendono questo documento ostile a una regex sul testo:
//
//  1. IL SEGNO STA NELLA POSIZIONE. "152,500" e' un'uscita a x=365 e un'entrata
//     a x=442: appiattito, e' la stessa identica stringa. Per questo il parser
//     lavora sulle coordinate (readPdfLayout) e non sul testo.
//  2. UN MOVIMENTO OCCUPA PIU' RIGHE. Importo e saldo stanno su una riga sola —
//     l'ancora — e la descrizione sta sulle righe intorno, spezzata a meta'
//     parola quando va a capo ("...transfers usin" / "g QR code").
//  3. LA DATA SI SCRIVE UNA VOLTA SOLA per gruppo: 24 date per 127 movimenti.
//     Va riportata in avanti, altrimenti cento righe restano senza data.
//
// Le bande delle colonne NON sono costanti scritte qui dentro: si ricavano
// dalla riga di intestazione di ogni pagina. Se HSBC sposta una colonna di
// venti punti il parser continua a funzionare; se cambia i nomi delle
// intestazioni, smette di riconoscere il documento e si passa alla strada con
// l'AI — che e' il modo giusto di fallire, invece di importare numeri storti.

/**
 * Riconoscimento: tutte devono comparire nella prima pagina.
 *
 * NON si cerca la parola "HSBC": nel PDF non c'e'. Il marchio e' il logo, che
 * e' un'immagine, e il testo estratto non lo contiene — verificato su tutte e
 * 22 le pagine dell'estratto di prova. A identificare il documento e' invece
 * la sua struttura: un estratto bilingue vietnamita/inglese con queste
 * intestazioni di colonna.
 */
const MARKERS = [
  /Bảng sao kê tài khoản|Account Statement/i,
  /Số thứ tự|Stmt Sheet Number/i,
  /Ghi nợ|Withdrawals/i,
  /Ghi có|Deposits/i,
];

/**
 * Il blocco dei totali in fondo all'ultima pagina: dichiara quanto e' uscito e
 * quanto e' entrato in tutto il periodo. E' la verifica migliore che esista
 * della lettura, e va riconosciuto anche per non scambiare quei numeri per un
 * movimento.
 */
const TOTALS_BLOCK = /WITHDRAWALS AS AT|TẠI THỜI ĐIỂM|End of Statement|Kết thúc bảng sao kê/i;

/** Intestazioni di colonna, in vietnamita o in inglese. */
const HEADERS = {
  date:       /^(Ngày|Date)$/i,
  details:    /^(Chi tiết|Details)$/i,
  withdrawal: /^(Ghi nợ|Withdrawals)$/i,
  deposit:    /^(Ghi có|Deposits)$/i,
  balance:    /^(Số dư|Balance)$/i,
};

const OPENING = /SỐ DƯ ĐẦU KỲ|BALANCE BROUGHT FORWARD/i;
const CLOSING = /SỐ DƯ CUỐI KỲ|BALANCE CARRIED FORWARD/i;

/**
 * La coda di un movimento con carta: "09AUG26 ELECTRO 10:26:16".
 *
 * E' l'unica riga di descrizione che HSBC stampa SOTTO l'importo invece che
 * sopra. Distinguerla conta: senza, ogni descrizione slitta di un movimento e
 * ogni riga finisce con la descrizione di quella prima.
 *
 * Attenzione: questa data e' quando hai usato la carta, NON quando la banca ha
 * contabilizzato. Resta dentro la descrizione e non diventa mai la data del
 * movimento — quella sta nella colonna di sinistra, e sono spesso giorni
 * diversi.
 */
const TRAILING = /^\d{2}[A-Z]{3}\d{2}\s+\S+\s+\d{1,2}:\d{2}:\d{2}$/;

/** Un numero con separatore di migliaia: "31,070,938". Mai un decimale sciolto. */
const AMOUNT = /^[\d,]+$/;
/** Data di colonna: 11AUG2026 oppure 07AUG26. */
const DATE = /^(\d{2})([A-Z]{3})(\d{2}|\d{4})$/;

const MONTHS = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** "11AUG2026" e "07AUG26" -> "2026-08-11". Null se non e' una data. */
export function parseHsbcDate(text) {
  const m = DATE.exec(String(text ?? "").trim().toUpperCase());
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (!month) return null;
  // Anno a due cifre: siamo in un estratto conto, non in un archivio storico.
  // 26 e' il 2026, non il 1926.
  const year = m[3].length === 4 ? m[3] : `20${m[3]}`;
  return `${year}-${month}-${m[1]}`;
}

/**
 * Le bande delle colonne, dalla riga di intestazione.
 *
 * Il confine fra due colonne si mette a meta' strada fra l'inizio dell'una e
 * dell'altra. I numeri sono allineati a DESTRA, quindi un importo lungo comincia
 * piu' a sinistra di uno corto: "26,049,000" parte a x=434 e "3,300,000" a
 * x=358, e le bande devono essere abbastanza larghe da contenerli entrambi.
 */
export function columnBands(lines) {
  const found = {};
  for (const line of lines) {
    for (const item of line.items) {
      for (const [key, re] of Object.entries(HEADERS)) {
        if (found[key] === undefined && re.test(item.text)) found[key] = item.x;
      }
    }
    if (Object.keys(found).length === 5) break;
  }
  if (found.withdrawal === undefined || found.deposit === undefined || found.balance === undefined) {
    return null;
  }

  // Il margine sinistro di ogni colonna numerica: sta a meta' fra la sua
  // intestazione e quella precedente, con un po' di respiro per i numeri lunghi.
  const between = (a, b) => (a + b) / 2;
  return {
    date: found.date ?? 0,
    details: found.details ?? 100,
    withdrawalFrom: between(found.details ?? 100, found.withdrawal),
    depositFrom: between(found.withdrawal, found.deposit),
    balanceFrom: between(found.deposit, found.balance),
  };
}

/**
 * La Y della riga di intestazione della tabella: sotto ci sono i movimenti,
 * sopra l'intestazione della pagina. Si cerca la riga che porta almeno due
 * delle intestazioni numeriche, perche' HSBC le stampa su due righe
 * (vietnamita sopra, inglese sotto) e una sola non basta a identificarla.
 */
export function headerRowY(lines, bands) {
  let found = null;
  for (const line of lines) {
    const hits = line.items.filter(i =>
      i.x >= bands.withdrawalFrom && (HEADERS.withdrawal.test(i.text) || HEADERS.deposit.test(i.text) || HEADERS.balance.test(i.text)),
    ).length;
    // Si tiene la piu' BASSA delle righe di intestazione: quella inglese sta
    // sotto quella vietnamita, e la tabella comincia sotto entrambe.
    if (hits >= 2) found = found === null ? line.y : Math.min(found, line.y);
  }
  return found;
}

/** In quale colonna cade un frammento. */
function columnOf(x, bands) {
  if (x >= bands.balanceFrom) return "balance";
  if (x >= bands.depositFrom) return "deposit";
  if (x >= bands.withdrawalFrom) return "withdrawal";
  if (x >= bands.details - 10) return "details";
  return "date";
}

/**
 * Riconosce un estratto HSBC Vietnam dalla prima pagina.
 * @param {{pages: Array}} layout da readPdfLayout
 */
export function detect(layout) {
  const first = layout?.pages?.[0];
  if (!first) return false;
  const text = first.lines.flatMap(l => l.items.map(i => i.text)).join(" ");
  return MARKERS.every(re => re.test(text));
}

/**
 * Legge l'estratto e restituisce la stessa forma che restituirebbe il modello,
 * cosi' a valle non cambia niente: date e importi restano le STRINGHE scritte
 * dalla banca, e a interpretarle ci pensa `rowsFromExtraction` — che sa gia'
 * dedurre formato data e separatore decimale, e che calcola l'impronta dei
 * doppioni. Un formato parallelo qui vorrebbe dire perdere quell'impronta.
 *
 * @returns {{ok: true, bank: string, extracted: object, stats: object} | {ok: false, reason: string}}
 */
export function parse(layout) {
  const bands = columnBands(layout?.pages?.[0]?.lines ?? []);
  if (!bands) return { ok: false, reason: "headers_not_found" };

  const rows = [];
  let opening = null;
  let closing = null;
  let currentDate = null;
  let pending = [];          // righe di descrizione in attesa della loro ancora
  let unmatched = 0;

  for (const page of layout.pages) {
    const pageBands = columnBands(page.lines) ?? bands;

    // La tabella comincia SOTTO la riga di intestazione. Sopra c'e' il nome
    // dell'intestatario, l'indirizzo, il numero di pagina: roba che senza
    // questo taglio finiva dentro la descrizione del primo movimento, e ci
    // finiva davvero — il primo movimento cominciava con "Chi tiet Details".
    const headerY = headerRowY(page.lines, pageBands);
    if (headerY === null) continue;

    pending = [];
    currentDate = currentDate ?? null;

    for (const line of page.lines) {
      if (line.y >= headerY) continue;

      const cells = { date: [], details: [], withdrawal: [], deposit: [], balance: [] };
      for (const item of line.items) cells[columnOf(item.x, pageBands)].push(item.text);

      const details = cells.details.join(" ").trim();
      const balance = cells.balance.find(t => AMOUNT.test(t)) ?? null;

      // Le righe di RIEPILOGO (riporto, saldo finale, totali) non rispettano
      // le colonne: "BALANCE CARRIED FORWARD" sta a meta' pagina, dove sulle
      // righe normali ci sono gli importi. Vanno quindi riconosciute sul testo
      // dell'INTERA riga, non sulla sola colonna descrizione — altrimenti
      // passano inosservate e il saldo di chiusura non si legge.
      const lineText = line.items.map(i => i.text).join(" ");

      // Saldo di apertura e di chiusura. Ogni pagina ha i suoi: conta il primo
      // riporto in assoluto e l'ultimo saldo finale.
      if (OPENING.test(lineText)) { if (balance && opening === null) opening = balance; pending = []; continue; }
      if (CLOSING.test(lineText)) { if (balance) closing = balance; pending = []; continue; }

      // Il blocco dei totali: da qui in giu' non ci sono piu' movimenti, solo
      // somme che gli assomigliano. Non si esce dal ciclo perche' il saldo di
      // chiusura e' stampato IN MEZZO ai totali, e uscendo lo si perderebbe.
      if (TOTALS_BLOCK.test(lineText)) { pending = []; continue; }

      // La data compare una volta per gruppo: si tiene e si riusa.
      const dateCell = cells.date.map(parseHsbcDate).find(Boolean);
      if (dateCell) currentDate = dateCell;

      const withdrawal = cells.withdrawal.find(t => AMOUNT.test(t)) ?? null;
      const deposit = cells.deposit.find(t => AMOUNT.test(t)) ?? null;

      // Ancora: la riga che porta un importo E il saldo.
      if ((withdrawal || deposit) && balance) {
        const before = joinParts(pending);
        pending = [];
        rows.push({
          date: currentDate,
          description: joinParts([before, details]),
          // Il segno lo decide la COLONNA, non il testo.
          amount: deposit ? deposit : `-${withdrawal}`,
          balance,
        });
        continue;
      }

      if (!details) continue;

      // Le righe di descrizione appartengono al movimento che VIENE DOPO, con
      // una sola eccezione: la data-canale-ora della carta, che HSBC stampa
      // SOTTO la riga dell'importo. Senza questa distinzione ogni descrizione
      // slittava di un movimento.
      if (TRAILING.test(details) && rows.length > 0) {
        const last = rows[rows.length - 1];
        last.description = joinParts([last.description, details]);
      } else {
        pending.push(details);
      }
    }
  }

  for (const r of rows) if (!r.date) unmatched++;

  if (rows.length === 0) return { ok: false, reason: "no_rows" };

  return {
    ok: true,
    bank: "hsbc_vn",
    extracted: {
      currency: detectCurrency(layout),
      opening_balance: opening,
      closing_balance: closing,
      rows,
    },
    stats: { rows: rows.length, withoutDate: unmatched },
  };
}

/**
 * Unisce i pezzi di una descrizione sparsi su piu' righe.
 *
 * NON prova a ricucire le parole spezzate dall'andata a capo, e la rinuncia e'
 * deliberata. HSBC manda a capo in mezzo alla parola ("...transfers usin" +
 * "g QR code"), e la tentazione e' riattaccare quando il pezzo prima finisce
 * con una lettera e quello dopo comincia con una minuscola. Quella regola pero'
 * trasforma anche "Caffe" + "del porto" in "Caffedel porto": dal testo non si
 * distingue un a-capo da due parole separate, perche' l'informazione che
 * servirebbe — dove finisce la riga — sta nella geometria, non nei caratteri.
 *
 * Fra una descrizione un po' brutta e un nome di esercente corrotto vince la
 * prima: la descrizione la legge una persona, mentre il nome corrotto
 * finirebbe in una regola di categorizzazione e sbaglierebbe in silenzio per
 * sempre.
 */
export function joinParts(parts) {
  return parts
    .map(p => String(p ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** La valuta sta accanto al numero di conto o nell'intestazione della colonna. */
function detectCurrency(layout) {
  const text = layout.pages
    .slice(0, 2)
    .flatMap(p => p.lines.flatMap(l => l.items.map(i => i.text)))
    .join(" ");
  const m = /\b(VND|USD|EUR|AUD|GBP|SGD|JPY)\b/.exec(text);
  return m ? m[1] : null;
}
