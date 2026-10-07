// src/lib/import/ofx.js
// Lettura di OFX e QFX, nel browser come gli altri formati.
//
// OFX esiste in due versioni molto diverse: la 1.x e' SGML, con i tag che non
// si chiudono quasi mai, la 2.x e' XML vero. Invece di due parser si usa una
// sola regola che vale per entrambe: il valore di un tag e' il testo che sta
// fra `<TAG>` e il `<` successivo. In SGML quel `<` e' il tag dopo, in XML e'
// `</TAG>`: in tutti e due i casi il valore e' lo stesso, e non serve un
// parser SGML completo per un formato cosi' regolare.
//
// Il risultato ha la stessa forma dell'estrazione AI di un PDF
// ({ currency, opening_balance, closing_balance, rows }), cosi' a valle c'e'
// una sola strada: controlli, impronte e regole sono gli stessi per tutti.
import { decodeText } from "./readers.js";
import { parseDate } from "./mapping.js";

/** Valore di un tag: dal `>` fino al `<` successivo, senza andare a capo. */
function tagValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  const value = match ? match[1].trim() : "";
  return value === "" ? null : value;
}

/**
 * Le date OFX sono `YYYYMMDD` con, in coda, ora e fuso orario fra parentesi
 * quadre. Del fuso non si tiene conto di proposito: un movimento appartiene al
 * giorno in cui la banca lo ha contabilizzato, non a quello dell'osservatore.
 */
export function parseOfxDate(value) {
  const match = String(value ?? "").trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return parseDate(`${match[1]}-${match[2]}-${match[3]}`, "ISO");
}

/** I blocchi `<STMTTRN>`, sia con il tag di chiusura sia senza. */
function transactionBlocks(text) {
  const closed = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map(m => m[1]);
  if (closed.length) return closed;

  // Senza `</STMTTRN>` un movimento finisce dove comincia il prossimo, o dove
  // finisce la lista dei movimenti.
  const parts = text.split(/<STMTTRN>/i).slice(1);
  return parts.map(part => part.split(/<\/BANKTRANLIST>|<STMTTRN>/i)[0]);
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{currency: string|null, opening_balance: string|null, closing_balance: string|null,
 *            rows: {date: string|null, description: string, amount: string|null, balance: null, fitid: string|null}[],
 *            encoding: string, accountIds: string[], warnings: string[]}}
 */
export function readOfx(arrayBuffer) {
  const { text, encoding } = decodeText(arrayBuffer);
  const warnings = [];

  // L'intestazione (SGML `OFXHEADER:100...` o il prologo XML) non contiene
  // movimenti e ha una sintassi tutta sua: si taglia via.
  const start = text.search(/<OFX[\s>]/i);
  const body = start >= 0 ? text.slice(start) : text;

  const rows = transactionBlocks(body).map((block, i) => {
    const name = tagValue(block, "NAME") ?? "";
    const memo = tagValue(block, "MEMO") ?? "";
    const payee = tagValue(block, "PAYEE") ?? "";
    // NAME e MEMO portano pezzi diversi della stessa causale e spesso uno dei
    // due ripete l'altro: si uniscono, senza ripetizioni.
    const description = [payee, name, memo]
      .map(v => v.trim())
      .filter((v, idx, all) => v && all.indexOf(v) === idx)
      .join(" ")
      .trim();

    return {
      date: parseOfxDate(tagValue(block, "DTPOSTED") ?? tagValue(block, "DTUSER")),
      description,
      amount: tagValue(block, "TRNAMT"),
      // OFX non riporta il saldo movimento per movimento: solo quello finale.
      balance: null,
      fitid: tagValue(block, "FITID"),
      trnType: tagValue(block, "TRNTYPE"),
      rowIndex: i,
    };
  });

  const accountIds = [...new Set(
    [...body.matchAll(/<ACCTID>([^<\r\n]*)/gi)].map(m => m[1].trim()).filter(Boolean),
  )];
  if (accountIds.length > 1) warnings.push("multiple_accounts");
  if (/<INVSTMTRS>/i.test(body)) warnings.push("investment_statement");

  return {
    currency: tagValue(body, "CURDEF"),
    // OFX dichiara solo il saldo finale (`LEDGERBAL`), mai quello iniziale:
    // il confronto fra totali dichiarati e somma delle righe resta quindi
    // impossibile, e il controllo del saldo risultera' "non disponibile".
    opening_balance: null,
    closing_balance: tagValue(body.match(/<LEDGERBAL>[\s\S]*?(?=<\/LEDGERBAL>|$)/i)?.[0] ?? "", "BALAMT"),
    rows,
    encoding,
    accountIds,
    warnings,
  };
}
