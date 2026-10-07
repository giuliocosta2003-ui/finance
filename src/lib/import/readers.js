// src/lib/import/readers.js
// Lettura dei tre formati, tutta nel browser.
//
// Perche' nel browser e non nella Edge Function: una Edge Function ha 2 secondi
// di CPU per richiesta (limite verificato sulla documentazione Supabase) e un
// XLSX di qualche migliaio di righe li supera. Qui invece il file non lascia
// nemmeno il dispositivo finche' non serve, e il parsing non usa chiavi
// segrete: non c'e' niente da proteggere spostandolo sul server.
import Papa from "papaparse";
import * as XLSX from "xlsx";

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * Le banche italiane esportano spesso in Windows-1252: se si legge come UTF-8
 * si ottengono "citt�" invece di "città". Si prova UTF-8 in modo severo e al
 * primo byte non valido si passa al secondo tentativo.
 */
export function decodeText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes),
      encoding: "windows-1252",
    };
  }
}

/**
 * @returns {{headers: string[], rows: object[], delimiter: string, encoding: string, warnings: string[]}}
 */
export function readCsv(arrayBuffer, { skipRows = 0 } = {}) {
  const { text, encoding } = decodeText(arrayBuffer);

  // Papaparse indovina il delimitatore da solo; gli si tolgono prima le righe
  // di intestazione libera (loghi, periodo, numero di conto) che alcune banche
  // mettono sopra la tabella vera.
  const body = skipRows > 0 ? text.split(/\r?\n/).slice(skipRows).join("\n") : text;

  const parsed = Papa.parse(body, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,     // i numeri li interpretiamo noi, con parseAmount
    transformHeader: (h) => String(h ?? "").trim(),
  });

  const warnings = (parsed.errors ?? []).slice(0, 5).map(e => `${e.type}: ${e.message}`);
  const headers = (parsed.meta?.fields ?? []).filter(Boolean);
  return {
    headers,
    rows: parsed.data ?? [],
    delimiter: parsed.meta?.delimiter ?? ",",
    encoding,
    warnings,
  };
}

// ── XLSX ─────────────────────────────────────────────────────────────────────

/**
 * Trova la riga di intestazione: la prima con almeno due celle testuali e
 * almeno una riga di dati sotto. Serve perche' i fogli scaricati dalle banche
 * cominciano quasi sempre con due o tre righe di testata.
 */
function findHeaderRow(matrix) {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const row = matrix[i] ?? [];
    const filled = row.filter(c => c != null && String(c).trim() !== "");
    const textual = filled.filter(c => typeof c === "string" && /[a-z]/i.test(c));
    if (filled.length >= 2 && textual.length >= 2 && (matrix[i + 1] ?? []).length > 0) return i;
  }
  return 0;
}

export function readXlsx(arrayBuffer, { sheetName = null, skipRows = null } = {}) {
  const book = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const name = sheetName ?? book.SheetNames[0];
  const sheet = book.Sheets[name];
  if (!sheet) return { headers: [], rows: [], sheetNames: book.SheetNames, headerRow: 0 };

  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  const headerRow = skipRows ?? findHeaderRow(matrix);

  const headers = (matrix[headerRow] ?? []).map((h, i) =>
    h == null || String(h).trim() === "" ? `col_${i + 1}` : String(h).trim());

  const rows = [];
  for (let i = headerRow + 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    if (line.every(c => c == null || String(c).trim() === "")) continue;
    const row = {};
    headers.forEach((h, c) => { row[h] = line[c] ?? null; });
    rows.push(row);
  }

  return { headers, rows, sheetNames: book.SheetNames, headerRow };
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/**
 * Estrae il testo con pdf.js. Se il PDF ha un livello di testo, il contenuto
 * si manda a Claude come testo: costa molto meno della lettura visiva pagina
 * per pagina. Se il testo non c'e' (scansione), lo dice al chiamante, che
 * passera' il file alla Edge Function per la lettura come documento.
 *
 * Il testo torna anche pagina per pagina: e' l'unita' con cui si divide un
 * estratto lungo in piu' richieste, e una richiesta sola non basta mai per un
 * anno intero di movimenti.
 */
export async function readPdfText(arrayBuffer, { maxPages = 2000, pdfjsModule = null } = {}) {
  // `pdfjsModule` si passa solo dai test, che girano in Node e devono usare la
  // build "legacy"; nell'app resta il caricamento normale.
  const pdfjs = pdfjsModule ?? await import("pdfjs-dist");
  if (!pdfjsModule) {
    // Il worker va indicato esplicitamente: con Vite si risolve come URL del bundle.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }

  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pages = [];
  const limit = Math.min(doc.numPages, maxPages);

  for (let p = 1; p <= limit; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(" ").replace(/\s+/g, " ").trim());
  }

  const text = pages.join("\n\n");
  return {
    text,
    pageTexts: pages,
    pages: pages.length,
    totalPages: doc.numPages,
    truncated: doc.numPages > limit,
    // Poche decine di caratteri per pagina significano scansione senza OCR.
    hasText: text.replace(/\s/g, "").length > 40 * pages.length,
  };
}

/**
 * Lo stesso PDF, ma CON le coordinate.
 *
 * `readPdfText` qui sopra appiattisce ogni pagina in una riga sola: va bene per
 * darla in pasto a un modello, che il testo lo legge come lo leggeresti tu, ma
 * butta via l'unica cosa su cui un parser a regole si puo' reggere — la
 * posizione. In un estratto conto la colonna dice il SEGNO: lo stesso
 * "152,500" e' un'uscita a x=365 e un'entrata a x=442, e appiattito diventa lo
 * stesso identico testo.
 *
 * Misurato sull'estratto HSBC di prova: sul testo appiattito una regex trova 55
 * movimenti su 127, e sbaglia il verso di quelli che trova. Con le coordinate
 * li trova tutti.
 *
 * Non sostituisce `readPdfText`: serve alla strada a regole, mentre quella
 * resta per la strada con l'AI. Due usi diversi dello stesso file.
 *
 * @returns {Promise<{pages: Array<{width:number,height:number,lines:Array<{y:number,items:Array<{x:number,text:string}>}>}>, totalPages:number, hasText:boolean}>}
 */
export async function readPdfLayout(arrayBuffer, { maxPages = 2000, pdfjsModule = null, lineTolerance = 2 } = {}) {
  const pdfjs = pdfjsModule ?? await import("pdfjs-dist");
  if (!pdfjsModule) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }

  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const limit = Math.min(doc.numPages, maxPages);
  const pages = [];
  let characters = 0;

  for (let p = 1; p <= limit; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    // Le righe si ricostruiscono dalla Y. La tolleranza serve perche' due
    // frammenti della stessa riga possono differire di una frazione di punto:
    // senza, una riga si spezzerebbe in due a meta'.
    const buckets = [];
    for (const item of content.items) {
      const text = String(item.str ?? "").trim();
      if (!text) continue;
      characters += text.length;

      const x = item.transform[4];
      const y = item.transform[5];
      const bucket = buckets.find(b => Math.abs(b.y - y) <= lineTolerance);
      if (bucket) bucket.items.push({ x, text });
      else buckets.push({ y, items: [{ x, text }] });
    }

    pages.push({
      width: page.view?.[2] ?? 0,
      height: page.view?.[3] ?? 0,
      // Dall'alto al basso, e dentro ogni riga da sinistra a destra: l'ordine
      // in cui si legge, che NON e' quello in cui il PDF elenca i frammenti.
      lines: buckets
        .sort((a, b) => b.y - a.y)
        .map(b => ({ y: b.y, items: b.items.sort((i, j) => i.x - j.x) })),
    });
  }

  return {
    pages,
    totalPages: doc.numPages,
    truncated: doc.numPages > limit,
    hasText: characters > 40 * pages.length,
  };
}

/**
 * Divide le pagine in blocchi da mandare a Claude uno per volta.
 *
 * Il limite vero non e' quello di pagine per richiesta ma la risposta: una
 * pagina fitta di estratto conto sono 20-40 movimenti, e poche pagine bastano a
 * riempire i token in uscita. Si taglia sul primo dei due limiti che scatta, e
 * sempre al confine di una pagina, perche' una riga spezzata a meta' e' una
 * riga persa. Gli stessi numeri valgono nella Edge Function per le scansioni.
 */
export function chunkPageTexts(pageTexts, { maxPages = 8, maxChars = 30000 } = {}) {
  const chunks = [];
  let current = [];
  let chars = 0;

  for (const page of pageTexts ?? []) {
    const size = page.length + 2;
    if (current.length > 0 && (current.length >= maxPages || chars + size > maxChars)) {
      chunks.push(current.join("\n\n"));
      current = [];
      chars = 0;
    }
    current.push(page);
    chars += size;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}
