// supabase/functions/_shared/merchant.js
// Normalizzazione della descrizione bancaria in un nome di commerciante.
//
// Vive qui, sotto le Edge Function, ed e' lo STESSO file che usa il frontend
// (src/lib/merchant.js lo riesporta). Deve essere uno solo: se il browser
// normalizzasse in un modo e il server in un altro, le regole salvate dal
// browser non scatterebbero mai lato server, e nessuno capirebbe perche'.
//
// Serve a tre cose: raggruppare i movimenti dello stesso negozio, far
// funzionare le regole, e togliere IBAN e numeri di carta PRIMA che una
// descrizione finisca in una richiesta a Claude.
import { NOISE_PHRASES, NOISE_WORDS, AGGREGATOR_PREFIXES, LEGAL_FORMS } from "./merchant-noise.js";

const NOISE_SET = new Set(NOISE_WORDS);
const LEGAL_SET = new Set(LEGAL_FORMS.map(f => f.replace(/\s+/g, " ")));

/** Escape di un termine da usare dentro una regex costruita a runtime. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "PROCESSORE *ESERCENTE" -> "ESERCENTE". L'asterisco (con o senza spazi, e
 * qualunque cosa venga prima di esso) e' la firma dei circuiti di pagamento:
 * chi ha incassato sta dopo. Si applica sul testo grezzo, prima che la
 * punteggiatura diventi spazio e l'asterisco sparisca.
 */
const AGGREGATOR_RE = new RegExp(
  `^\\s*(?:${AGGREGATOR_PREFIXES.map(escapeRe).join("|")})\\s*\\*\\s*`,
  "i",
);

/**
 * Forme societarie scritte con i punti ("s.r.l.", "s.p.a", "s.a r.l"): vanno
 * tolte PRIMA della punteggiatura, perche' dopo "s.r.l" diventa "s r l" e non
 * si riconosce piu'. Le stesse sigle senza punti le prende il filtro dei token.
 */
/**
 * "Pagamento da SAITEX", "Payment to Netlify", "Bonifico a favore di ACME":
 * l'intestazione di un bonifico o di un'entrata. Si toglie come PREFISSO (con
 * lo spazio in coda obbligatorio), non come sottostringa: cosi' "pagamento
 * abbonamento" resta intatto, mentre "da saitex" contro "saitex" non farebbero
 * mai gruppo se il "da" restasse.
 */
const PAYMENT_PREFIX = /^(?:pagamento|payment|bonifico|transfer|trasferimento)\s+(?:ricevuto\s+da|inviato\s+a|a\s+favore\s+di|da|a|to|from|per|verso)\s+/i;

const DOTTED_LEGAL = [
  /\bs\.?\s*r\.?\s*l\.?s?\b/gi,   // s.r.l / s.r.l.s
  /\bs\.?\s*p\.?\s*a\.?\b/gi,     // s.p.a
  /\bs\.?\s*a\.?\s*r\.?\s*l\.?\b/gi, // s.a.r.l
  /\bs\.?\s*a\.?\s*s\.?\b/gi,     // s.a.s
  /\bs\.?\s*n\.?\s*c\.?\b/gi,     // s.n.c
];

// Questi si applicano PRIMA di togliere la punteggiatura: sono tutti pattern
// che la punteggiatura la contengono. Se si pulisse prima, "12/09" sarebbe
// gia' diventato "12 09" e nessuna regola sulle date lo riconoscerebbe.
const STRIP_PATTERNS = [
  // IBAN: due lettere, due cifre di controllo, poi il resto
  /\b[a-z]{2}\d{2}[a-z0-9]{10,30}\b/g,
  // carte mascherate: ****1234, 4321********1234, xxxx1234
  /\b[x*]{3,}\s?\d{2,4}\b/g,
  /\b\d{4}[x*\s-]{4,}\d{4}\b/g,
  // numeri di carta per esteso
  /\b(?:\d[ -]?){13,19}\b/g,
  // date: 12/09, 12-09-2026, 2026-09-12
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g,
  // orari
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  // codici di riferimento: lunghi e con almeno due cifre dentro
  /\b(?=[a-z0-9]*\d[a-z0-9]*\d)[a-z0-9]{8,}\b/g,
  // Token molto lunghi con anche UNA sola cifra: gli identificativi di Grab e
  // simili ("9mamdwpwwlnfav") a volte ne hanno una sola e sfuggivano alla
  // regola qui sopra, che ne chiede due. Dieci caratteri di lettere e cifre
  // attaccate non sono il nome di un negozio.
  /\b(?=[a-z0-9]*\d)[a-z0-9]{10,}\b/g,
  // date scritte in lettere: 09AUG26, 11AUG2026. Le usano gli estratti in
  // inglese, e sopravvivevano a tutti i pattern qui sopra: finivano dentro il
  // nome del commerciante e spezzavano in venti gruppi quello che era un
  // negozio solo.
  /\b\d{1,2}[a-z]{3}\d{2,4}\b/g,
  // riferimenti corti ma di forma inconfondibile, lettere-cifre col trattino:
  // "A895-22913", "IB12-34430", "YRTW-13636". Troppo corti per la regola sopra
  // (che ne chiede otto di caratteri), e nessun esercente si chiama cosi'.
  /\b[a-z]{1,4}\d{2,}-[a-z0-9]{3,}\b/g,
  // importi con i decimali: "34000.00". Un numero col punto e due decimali e'
  // una cifra, mai un nome. Senza questo restava un "00" appiccicato a ogni
  // riga, perche' la parte intera se la portava via il filtro dei numeri lunghi
  // e i due zeri no.
  /\b\d+\.\d{2}\b/g,
];

// Questi si applicano DOPO, quando il testo e' fatto di soli token separati da
// spazi: numeri sciolti di tre o piu' cifre. "d1" e "11" restano, perche' sono
// pezzi di nome (distretto 1, Seven 11).
const STRIP_PATTERNS_AFTER = [
  /\b\d{3,}\b/g,
];

/**
 * Descrizione grezza della banca -> nome del commerciante, minuscolo e pulito.
 *
 * "POS 12/09 STARBUCKS D1 HCMC CARD 4321" -> "starbucks d1 hcmc"
 *
 * @param {string} text
 * @returns {string} stringa vuota se non resta niente di utile
 */
export function normalizeMerchant(text) {
  if (!text) return "";

  // Accenti via: "caffè" e "caffe" sono lo stesso bar, e la banca scrive in
  // entrambi i modi a seconda del canale.
  let s = String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  // Il prefisso del circuito ("paypal *", "sq *"): via, resta l'esercente vero.
  s = s.replace(AGGREGATOR_RE, " ");

  // Il prefisso "pagamento da/a NOME": via la preposizione insieme al verbo.
  s = s.replace(PAYMENT_PREFIX, " ");

  // Le forme societarie coi punti, finche' i punti ci sono ancora.
  for (const pattern of DOTTED_LEGAL) s = s.replace(pattern, " ");

  for (const pattern of STRIP_PATTERNS) {
    s = s.replace(pattern, " ");
  }

  // Solo ora la punteggiatura diventa spazio, cosi' i token si separano.
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

  for (const phrase of NOISE_PHRASES) {
    s = s.replaceAll(phrase, " ");
  }

  for (const pattern of STRIP_PATTERNS_AFTER) {
    s = s.replace(pattern, " ");
  }

  const tokens = s
    .split(/\s+/)
    .filter(tok => tok && !NOISE_SET.has(tok) && !LEGAL_SET.has(tok));

  return tokens.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Confronto fra un commerciante normalizzato e il pattern di una regola.
 * Nessuna espressione regolare dell'utente: tre modi bastano, e un pattern
 * patologico non puo' bloccare niente.
 */
export function merchantMatches(merchant, pattern, matchType = "exact") {
  if (!merchant || !pattern) return false;
  const m = merchant.toLowerCase();
  const p = pattern.toLowerCase();
  if (matchType === "starts_with") return m.startsWith(p);
  if (matchType === "contains") return m.includes(p);
  return m === p;
}

/**
 * Sceglie la regola da applicare: priorita' piu' alta, e a parita' vince il
 * confronto piu' stretto (esatto > inizia con > contiene), perche' e' quello
 * che l'utente ha descritto in modo piu' preciso.
 */
export function pickRule(merchant, rules) {
  const specificity = { exact: 3, starts_with: 2, contains: 1 };
  let best = null;
  for (const rule of rules ?? []) {
    if (!merchantMatches(merchant, rule.pattern, rule.match_type)) continue;
    if (
      best === null ||
      rule.priority > best.priority ||
      (rule.priority === best.priority &&
        specificity[rule.match_type] > specificity[best.match_type])
    ) {
      best = rule;
    }
  }
  return best;
}
