// src/lib/import/statements/hsbcVn.test.js — node --test
//
// La fixture e' SINTETICA e riproduce il tracciato, non i dati: un estratto
// vero contiene nome, numero di conto e ogni spesa fatta in un mese, e quelle
// cose non entrano in un repository. La convenzione del progetto e' gia'
// questa (fixtures/private/ e' ignorata da git, i test usano solo roba finta).
//
// Cio' che la fixture riproduce fedelmente sono le quattro trappole del
// documento vero, misurate su un estratto di 22 pagine:
//
//   - il segno sta nella COLONNA (x), non nel testo;
//   - un movimento occupa piu' righe, con la descrizione sopra l'importo;
//   - la data si scrive una volta per gruppo e va riportata in avanti;
//   - la coda "05AUG26 ELECTRO 21:44:27" sta SOTTO l'importo e appartiene al
//     movimento che la precede, non a quello che la segue.
import test from "node:test";
import assert from "node:assert/strict";
import { detect, parse, parseHsbcDate, columnBands, joinParts } from "./hsbcVn.js";
import { parseStatement } from "./index.js";

// Le X vere, misurate sul documento.
const X = { date: 53, details: 123, withdrawal: 365, deposit: 442, balance: 531 };

const line = (y, items) => ({ y, items: items.map(([x, text]) => ({ x, text })) });

/** L'intestazione di pagina piu' la riga di colonne, come nel documento vero. */
const pageHead = () => [
  line(736, [[53, "Bảng sao kê tài khoản / Account Statement"]]),
  line(708, [[53, "Trang 1 của 22 / Page 1 of 22"]]),
  line(664, [[123, "Mã số khách hàng / Customer Number"], [300, "105-38XXXX"]]),
  line(642, [[123, "Số thứ tự / Stmt Sheet Number"], [300, "112"]]),
  line(630, [[123, "Loại tiền tệ / Currency"], [300, "VND"]]),
  // Le intestazioni stanno su due righe: vietnamita sopra, inglese sotto.
  line(580, [[X.date, "Ngày"], [X.details, "Chi tiết"], [X.withdrawal + 5, "Ghi nợ"], [X.deposit + 8, "Ghi có"], [X.balance, "Số dư"]]),
  line(568, [[X.date, "Date"], [X.details, "Details"], [X.withdrawal - 16, "Withdrawals"], [X.deposit, "Deposits"], [X.balance - 11, "Balance"]]),
];

/** Un estratto finto con due uscite, un'entrata e i riporti. */
function fixture() {
  return {
    pages: [{
      width: 595,
      height: 842,
      lines: [
        ...pageHead(),
        line(550, [[X.details, "SỐ DƯ ĐẦU KỲ"], [X.balance, "1,000,000"]]),
        line(539, [[X.details, "BALANCE BROUGHT FORWARD"]]),

        // Movimento 1: uscita. Data nella colonna di sinistra.
        line(528, [[X.details, "VN271342VND"], [186, "34000.00"]]),
        line(517, [[X.details, "Caffe del porto"]]),
        line(507, [[X.date, "11AUG2026"], [X.details, "REF A895-22913"], [X.withdrawal, "34,000"], [X.balance, "966,000"]]),
        line(496, [[X.details, "09AUG26 ELECTRO 10:26:16"]]),

        // Movimento 2: uscita SENZA data — eredita quella del gruppo.
        line(486, [[X.details, "VN172420VND"], [186, "152500.00"]]),
        line(475, [[X.details, "Libreria Grande"]]),
        line(464, [[X.details, "REF A895-25780"], [X.withdrawal, "152,500"], [X.balance, "813,500"]]),
        line(454, [[X.details, "05AUG26 ELECTRO 17:08:13"]]),

        // Movimento 3: ENTRATA, stesso testo di un'uscita ma altra colonna.
        line(443, [[X.date, "12AUG2026"], [X.details, "Stipendio agosto trasferito"]]),
        line(433, [[X.details, "con bonifico istantan"]]),
        line(422, [[X.details, "eo"]]),
        line(412, [[X.details, "REF YRTW-13636"], [X.deposit, "3,300,000"], [X.balance, "4,113,500"]]),

        line(390, [[X.details, "SỐ DƯ CUỐI KỲ"], [X.balance, "4,113,500"]]),
        line(380, [[X.details, "BALANCE CARRIED FORWARD"]]),
        // Il blocco dei totali, che NON deve diventare un movimento.
        line(360, [[X.date, "GHI NỢ"], [290, "WITHDRAWALS AS AT"], [X.balance, "186,500"]]),
        line(348, [[X.date, "Kết thúc bảng sao kê / End of Statement"]]),
      ],
    }],
  };
}

// ── riconoscimento ───────────────────────────────────────────────────────────

test("riconosce un estratto HSBC Vietnam", () => {
  assert.equal(detect(fixture()), true);
});

test("non riconosce un PDF qualsiasi", () => {
  const altro = { pages: [{ lines: [line(700, [[50, "Fattura n. 12 del 2026"]])] }] };
  assert.equal(detect(altro), false);
  assert.equal(parseStatement(altro).reason, "unknown_bank");
});

test("il dispatcher non esplode su un PDF vuoto", () => {
  assert.equal(parseStatement({ pages: [] }).reason, "empty_pdf");
  assert.equal(parseStatement(null).reason, "empty_pdf");
});

// ── date ─────────────────────────────────────────────────────────────────────

test("legge i due formati di data del documento", () => {
  assert.equal(parseHsbcDate("11AUG2026"), "2026-08-11");
  assert.equal(parseHsbcDate("07AUG26"), "2026-08-07");
  assert.equal(parseHsbcDate("31DEC26"), "2026-12-31");
});

test("una data che non e' una data resta null", () => {
  for (const v of ["", null, "ELECTRO", "11XXX2026", "2026-08-11"]) {
    assert.equal(parseHsbcDate(v), null, `${v} non dovrebbe passare`);
  }
});

// ── colonne ──────────────────────────────────────────────────────────────────

test("le bande delle colonne si ricavano dall'intestazione, non sono scritte a mano", () => {
  const bands = columnBands(fixture().pages[0].lines);
  assert.ok(bands.withdrawalFrom > X.details && bands.withdrawalFrom < X.withdrawal);
  assert.ok(bands.depositFrom > X.withdrawal && bands.depositFrom < X.deposit);
  assert.ok(bands.balanceFrom > X.deposit && bands.balanceFrom < X.balance);
});

test("senza le intestazioni non si tenta nemmeno di leggere", () => {
  // Se HSBC rinomina le colonne e' meglio fermarsi che indovinare.
  const rotto = fixture();
  rotto.pages[0].lines = rotto.pages[0].lines.filter(
    l => !l.items.some(i => /Withdrawals|Ghi nợ/.test(i.text)),
  );
  assert.equal(columnBands(rotto.pages[0].lines), null);
  assert.equal(parse(rotto).ok, false);
});

// ── lettura ──────────────────────────────────────────────────────────────────

test("legge tutti i movimenti, con il segno preso dalla colonna", () => {
  const res = parse(fixture());
  assert.equal(res.ok, true);
  assert.equal(res.bank, "hsbc_vn");
  assert.equal(res.extracted.rows.length, 3);

  const [uno, due, tre] = res.extracted.rows;
  assert.equal(uno.amount, "-34,000");
  assert.equal(due.amount, "-152,500");
  // Stessa forma testuale di un'uscita: a distinguerla e' solo la posizione.
  assert.equal(tre.amount, "3,300,000");
});

test("la data si riporta in avanti quando la riga non ce l'ha", () => {
  const rows = parse(fixture()).extracted.rows;
  assert.equal(rows[0].date, "2026-08-11");
  assert.equal(rows[1].date, "2026-08-11", "il secondo eredita la data del gruppo");
  assert.equal(rows[2].date, "2026-08-12");
});

test("riporto e saldo finale si leggono", () => {
  const { extracted } = parse(fixture());
  assert.equal(extracted.opening_balance, "1,000,000");
  assert.equal(extracted.closing_balance, "4,113,500");
  assert.equal(extracted.currency, "VND");
});

test("i conti tornano: apertura - uscite + entrate = chiusura", () => {
  // E' la verifica che ha trovato ogni errore di questo parser mentre lo
  // scrivevo. Se un movimento manca o ha il segno girato, questa somma salta.
  const { extracted } = parse(fixture());
  const n = s => Number(String(s).replace(/,/g, ""));
  const somma = extracted.rows.reduce((acc, r) => acc + n(r.amount), 0);
  assert.equal(n(extracted.opening_balance) + somma, n(extracted.closing_balance));
});

test("il saldo progressivo di ogni riga e' coerente", () => {
  const { extracted } = parse(fixture());
  const n = s => Number(String(s).replace(/,/g, ""));
  let prev = n(extracted.opening_balance);
  for (const r of extracted.rows) {
    assert.equal(prev + n(r.amount), n(r.balance), `saldo rotto su "${r.description}"`);
    prev = n(r.balance);
  }
});

test("il blocco dei totali non diventa un movimento", () => {
  // "186,500" in fondo e' la somma delle uscite, non un'uscita.
  const rows = parse(fixture()).extracted.rows;
  assert.equal(rows.length, 3);
  assert.ok(!rows.some(r => r.amount.includes("186,500")));
});

// ── descrizioni ──────────────────────────────────────────────────────────────

test("la coda con data e ora resta attaccata al movimento che la precede", () => {
  const rows = parse(fixture()).extracted.rows;
  // La riga "09AUG26 ELECTRO 10:26:16" sta SOTTO l'importo del primo
  // movimento: se finisse al secondo, ogni descrizione slitterebbe di uno.
  assert.match(rows[0].description, /09AUG26 ELECTRO 10:26:16/);
  assert.doesNotMatch(rows[1].description, /09AUG26/);
});

test("la descrizione prende le righe sopra il proprio importo", () => {
  const rows = parse(fixture()).extracted.rows;
  assert.match(rows[0].description, /Caffe del porto/);
  assert.match(rows[1].description, /Libreria Grande/);
});

test("i pezzi di descrizione si uniscono senza corrompere le parole", () => {
  // La scelta deliberata: NON si ricuciono le parole andate a capo, perche'
  // la stessa regola che aggiusta "usin"+"g" rovina "Caffe"+"del porto".
  assert.equal(joinParts(["Caffe", "del porto"]), "Caffe del porto");
  assert.equal(joinParts(["REF A895-1", "09AUG26"]), "REF A895-1 09AUG26");
  assert.equal(joinParts(["", null, "solo"]), "solo");
  assert.equal(joinParts([]), "");
  // Gli spazi doppi si riducono: la descrizione arriva da frammenti.
  assert.equal(joinParts(["a  b", "  c "]), "a b c");
});

test("la descrizione tiene tutti i pezzi sparsi su piu' righe", () => {
  const rows = parse(fixture()).extracted.rows;
  // Il testo va a capo in mezzo alla parola nel documento vero: i pezzi ci
  // sono tutti, separati, e nessuno si perde.
  assert.match(rows[2].description, /Stipendio agosto trasferito/);
  assert.match(rows[2].description, /istantan/);
  assert.match(rows[2].description, /eo/);
});

// ── robustezza ───────────────────────────────────────────────────────────────

test("un estratto senza nessun movimento non finge di averne letti", () => {
  const vuoto = fixture();
  vuoto.pages[0].lines = [...pageHead()];
  const res = parse(vuoto);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "no_rows");
});

test("le colonne spostate non rompono la lettura", () => {
  // Il caso che il brief chiede: la banca ritocca il tracciato. Finche' le
  // intestazioni restano, le bande si ricalcolano e i movimenti si leggono.
  const spostato = fixture();
  const SHIFT = 18;
  for (const l of spostato.pages[0].lines) {
    for (const i of l.items) if (i.x > 200) i.x += SHIFT;
  }
  const res = parse(spostato);
  assert.equal(res.ok, true);
  assert.equal(res.extracted.rows.length, 3);
  assert.equal(res.extracted.rows[2].amount, "3,300,000", "l'entrata resta un'entrata");
});
