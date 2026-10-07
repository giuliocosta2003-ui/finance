// src/ui/Amount.jsx
// Il componente piu' importante del design system: l'app e' fatta di numeri, e
// questo e' il modo in cui si mostrano.
//
// Tre decisioni, tutte e tre discutibili e tutte e tre volute:
//
// 1. In modalita' `hero` i centesimi sono piu' piccoli e piu' chiari. Chi apre
//    l'app guarda gli euro, non i centesimi: la gerarchia deve dirlo, e i
//    centesimi restano comunque leggibili per chi li cerca.
// 2. Le entrate sono verdi, le uscite rosse, lo zero neutro — ed e' sempre il
//    ROSSO TRATTENUTO dei semantici, mai quello del marchio: un importo non
//    deve mai sembrare un pulsante. Il segno resta comunque sempre scritto,
//    perche' per chi non distingue i colori il colore non e' un segnale.
// 3. I decimali li decide la tabella `currencies`, non Intl: VND e JPY non ne
//    hanno, e mostrare "1.400.000,00 ₫" sarebbe sbagliato.
import { useI18n } from "../i18n/I18nContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { formatMoneyParts } from "../lib/money";

const TONE_CLASS = {
  in: "fin-amount--in",
  out: "fin-amount--out",
  /** Nero, per i totali e i saldi: un patrimonio non e' ne' un'entrata ne' una spesa. */
  neutral: "fin-amount--neutral",
  muted: "fin-amount--muted",
  plain: "",
};

const VARIANT_CLASS = {
  hero: "fin-amount--hero",
  lg: "fin-amount--lg",
  sm: "fin-amount--sm",
  default: "",
};

export default function Amount({
  minor,
  currency,
  /** "hero" per il saldo principale, "lg" per le cifre di riepilogo, "sm" in tabella. */
  variant = "default",
  /** "auto" colora di verde solo le entrate; gli altri valori forzano. */
  tone = "auto",
  /** "exceptZero" per mostrare il + davanti a un guadagno. */
  signDisplay,
  className = "",
  style,
  title,
}) {
  const { lang } = useI18n();
  const { minorUnits } = useCurrencies();

  const code = String(currency ?? "").trim();

  // Senza importo o senza valuta non c'e' niente da mostrare. Un numero senza
  // simbolo sarebbe peggio di un trattino: sembrerebbe un dato buono.
  if (minor === null || minor === undefined || code === "") {
    return <span className={`fin-amount fin-amount--muted ${className}`} style={style}>—</span>;
  }

  const units = minorUnits(code);
  const value = typeof minor === "bigint" ? minor : BigInt(minor);

  // Lo zero non e' ne' un'entrata ne' una spesa: colorarlo di rosso perche'
  // non e' positivo direbbe una cosa falsa.
  const resolved = tone === "auto"
    ? (value > 0n ? "in" : value < 0n ? "out" : "muted")
    : tone;
  const { head, tail, rest } = formatMoneyParts(value, code, lang, units);

  // Il "+" davanti a un guadagno lo mette Intl solo se glielo si chiede; qui
  // si aggiunge a mano perche' formatMoneyParts non prende opzioni, e serve
  // solo in due punti (P&L ed effetti).
  const plus = signDisplay === "exceptZero" && value > 0n ? "+" : "";

  return (
    <span
      className={[
        "fin-amount",
        VARIANT_CLASS[variant] ?? "",
        TONE_CLASS[resolved] ?? "",
        className,
      ].filter(Boolean).join(" ")}
      style={style}
      title={title}
    >
      <span className="fin-amount__head">{plus}{head}</span>
      {tail && <span className="fin-amount__tail">{tail}</span>}
      {rest && <span className="fin-amount__rest">{rest}</span>}
    </span>
  );
}
