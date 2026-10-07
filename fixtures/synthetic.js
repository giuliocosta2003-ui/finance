// fixtures/synthetic.js
// Estratti conto FINTI, generati da codice. Nei test si usano solo questi.
//
// I file veri non entrano mai nel repository: se ti serve provare con un tuo
// estratto, mettilo in fixtures/private/, che e' ignorata da git.
//
// `npm run fixtures` li scrive su disco in fixtures/synthetic/ se vuoi aprirli.
import * as XLSX from "xlsx";

/** Testo -> byte in Windows-1252 (le lettere accentate su un byte solo). */
export function toWindows1252(text) {
  const map = { "à": 0xe0, "è": 0xe8, "é": 0xe9, "ì": 0xec, "ò": 0xf2, "ù": 0xf9,
                "À": 0xc0, "È": 0xc8, "É": 0xc9, "€": 0x80, "°": 0xb0 };
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 128) out.push(code);
    else if (map[ch] != null) out.push(map[ch]);
    else out.push(0x3f); // "?"
  }
  return new Uint8Array(out);
}

/**
 * Banca italiana: punto e virgola, virgola decimale, punto per le migliaia,
 * date gg/mm/aaaa, colonna saldo, e due righe di testata sopra la tabella.
 * Codifica Windows-1252, come escono davvero da molti home banking.
 */
export function csvItaliano() {
  const text = [
    "Estratto conto - Conto Corrente",
    "Periodo: 01/09/2026 - 30/09/2026",
    "Data;Descrizione;Importo;Saldo",
    "01/09/2026;POS 01/09 ESSELUNGA MILANO CARTA 4321;-45,30;1.954,70",
    "03/09/2026;BONIFICO A FAVORE DI ACME SRL IT60X0542811101000000123456;-1.200,00;754,70",
    "05/09/2026;ACCREDITO STIPENDIO SETTEMBRE;2.500,00;3.254,70",
    "07/09/2026;POS 07/09 CAFFÈ DEL CORSO;-2,50;3.252,20",
    "07/09/2026;POS 07/09 CAFFÈ DEL CORSO;-2,50;3.249,70",
    "12/09/2026;PAGAMENTO CARTA ****1234 NETFLIX.COM;-12,99;3.236,71",
    "",
  ].join("\r\n");
  return { bytes: toWindows1252(text), skipRows: 2, currency: "EUR" };
}

/** Banca con colonne dare/avere separate, decimali col punto, date gg-mm-aaaa. */
export function csvDareAvere() {
  const text = [
    "Date,Details,Paid out,Paid in,Balance",
    "01-09-2026,CARD PAYMENT TESCO LONDON,23.40,,1976.60",
    "04-09-2026,SALARY SEPTEMBER,,2500.00,4476.60",
    "09-09-2026,DIRECT DEBIT VODAFONE,15.00,,4461.60",
    "",
  ].join("\n");
  return { bytes: new TextEncoder().encode(text), skipRows: 0, currency: "GBP" };
}

/** Foglio vietnamita: VND senza decimali, migliaia col punto, tre righe di testata. */
export function xlsxVietnamita() {
  const matrix = [
    ["NGAN HANG HSBC VIET NAM", null, null, null],
    ["Sao ke tai khoan", null, null, null],
    [null, null, null, null],
    ["Ngay giao dich", "Noi dung", "So tien", "So du"],
    ["01/09/2026", "THANH TOAN HIGHLANDS COFFEE D1", "-85.000", "12.415.000"],
    ["02/09/2026", "CHUYEN KHOAN DEN NGUYEN VAN A", "-2.000.000", "10.415.000"],
    ["05/09/2026", "LUONG THANG 9", "25.000.000", "35.415.000"],
    ["06/09/2026", "THANH TOAN GRAB 0912345678", "-120.000", "35.295.000"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sao ke");
  const out = XLSX.write(book, { type: "array", bookType: "xlsx" });
  // headerRow 2 e non 3: la riga completamente vuota sparisce in lettura
  // (blankrows: false), quindi l'intestazione risale di un posto.
  return { bytes: new Uint8Array(out), headerRow: 2, currency: "VND" };
}

// ── PDF ──────────────────────────────────────────────────────────────────────

function pdfEscape(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * PDF minimo ma valido, con un livello di testo vero. Si costruisce a mano
 * (niente librerie) perche' serve solo a verificare che l'estrazione del testo
 * funzioni e riconosca un PDF "leggibile" da uno scansionato.
 */
export function pdfConTesto(lines = null) {
  const righe = lines ?? [
    "ESTRATTO CONTO SETTEMBRE 2026",
    "01/09/2026  ESSELUNGA MILANO      -45,30   1.954,70",
    "03/09/2026  BONIFICO ACME SRL   -1.200,00    754,70",
    "05/09/2026  STIPENDIO SETTEMBRE  2.500,00  3.254,70",
  ];

  let y = 800;
  const content =
    "BT /F1 11 Tf\n" +
    righe.map(r => { const line = `1 0 0 1 40 ${y} Tm (${pdfEscape(r)}) Tj\n`; y -= 18; return line; }).join("") +
    "ET";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return { bytes: new TextEncoder().encode(pdf), currency: "EUR" };
}

/** Stessa struttura ma senza testo: e' cosi' che si presenta una scansione. */
export function pdfScansionato() {
  return pdfConTesto([""]);
}

/**
 * OFX 1.x, cioe' SGML: intestazione a due punti, tag che non si chiudono,
 * date con ora e fuso. E' la forma in cui esce dalla maggior parte delle
 * banche, e quella che un parser XML non riuscirebbe a leggere.
 */
export function ofxSgml() {
  const text = [
    "OFXHEADER:100",
    "DATA:OFXSGML",
    "VERSION:102",
    "SECURITY:NONE",
    "ENCODING:USASCII",
    "CHARSET:1252",
    "COMPRESSION:NONE",
    "OLDFILEUID:NONE",
    "NEWFILEUID:NONE",
    "",
    "<OFX>",
    "<BANKMSGSRSV1><STMTTRNRS><STMTRS>",
    "<CURDEF>EUR",
    "<BANKACCTFROM><BANKID>03069<ACCTID>IT60X0542811101000000123456<ACCTTYPE>CHECKING</BANKACCTFROM>",
    "<BANKTRANLIST>",
    "<DTSTART>20260901000000[+1:CET]",
    "<DTEND>20260930235959[+1:CET]",
    "<STMTTRN>",
    "<TRNTYPE>DEBIT",
    "<DTPOSTED>20260901120000[+1:CET]",
    "<TRNAMT>-45.30",
    "<FITID>2026090100001",
    "<NAME>POS ESSELUNGA MILANO",
    "<MEMO>CARTA 4321",
    "</STMTTRN>",
    "<STMTTRN>",
    "<TRNTYPE>CREDIT",
    "<DTPOSTED>20260905090000[+1:CET]",
    "<TRNAMT>2500.00",
    "<FITID>2026090500002",
    "<NAME>ACCREDITO STIPENDIO SETTEMBRE",
    "</STMTTRN>",
    "<STMTTRN>",
    "<TRNTYPE>DEBIT",
    "<DTPOSTED>20260912103000[+1:CET]",
    "<TRNAMT>-12.99",
    "<FITID>2026091200003",
    "<NAME>NETFLIX.COM",
    "<MEMO>PAGAMENTO CARTA ****1234",
    "</STMTTRN>",
    "</BANKTRANLIST>",
    "<LEDGERBAL><BALAMT>3236.71<DTASOF>20260930235959[+1:CET]</LEDGERBAL>",
    "</STMTRS></STMTTRNRS></BANKMSGSRSV1>",
    "</OFX>",
    "",
  ].join("\r\n");
  return { bytes: toWindows1252(text), currency: "EUR" };
}

/** OFX 2.x: XML vero, con i tag chiusi. Stesso contenuto, altra sintassi. */
export function ofxXml() {
  const text = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE"?>',
    "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>",
    "<CURDEF>USD</CURDEF>",
    "<BANKACCTFROM><ACCTID>000123456789</ACCTID></BANKACCTFROM>",
    "<BANKTRANLIST>",
    "<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260903</DTPOSTED>",
    "<TRNAMT>-23.40</TRNAMT><FITID>A1</FITID><NAME>TESCO LONDON</NAME></STMTTRN>",
    "<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260904</DTPOSTED>",
    "<TRNAMT>1500.00</TRNAMT><FITID>A2</FITID><NAME>SALARY</NAME></STMTTRN>",
    "</BANKTRANLIST>",
    "<LEDGERBAL><BALAMT>1476.60</BALAMT></LEDGERBAL>",
    "</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
    "",
  ].join("\n");
  return { bytes: new TextEncoder().encode(text), currency: "USD" };
}

export const FIXTURES = {
  "csv-italiano.csv":    () => csvItaliano().bytes,
  "csv-dare-avere.csv":  () => csvDareAvere().bytes,
  "xlsx-vietnamita.xlsx": () => xlsxVietnamita().bytes,
  "pdf-con-testo.pdf":   () => pdfConTesto().bytes,
  "pdf-scansionato.pdf": () => pdfScansionato().bytes,
  "ofx-sgml.ofx":        () => ofxSgml().bytes,
  "ofx-xml.ofx":         () => ofxXml().bytes,
};
