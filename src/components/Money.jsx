// src/components/Money.jsx
// Ora e' un guscio sottile attorno a <Amount>.
//
// Prima erano due componenti diversi per mostrare un importo: Money (sei
// schermate) e Amount (sette). Colori diversi per lo stesso segno, gerarchia
// dei centesimi in uno solo, e due modi di gestire il valore mancante. In
// un'app fatta di numeri, due trattamenti del numero sono due app.
//
// Tenendo il nome e la firma, le schermate che lo usano hanno preso il
// trattamento nuovo senza essere toccate.
import Amount from "../ui/Amount.jsx";
import { useI18n } from "../i18n/I18nContext";

/**
 * `size` e `weight` erano stringhe CSS passate a mano da ogni chiamante. Ora
 * si traducono nelle varianti della scala: un importo non puo' piu' avere una
 * dimensione che il design system non conosce.
 */
function variantOf(size) {
  const s = String(size ?? "");
  if (s === "default") return "default";
  if (s.includes("2xl") || s.includes("display") || s.includes("h1")) return "hero";
  if (s.includes("xl") || s.includes("h2") || s.includes("h3")) return "lg";
  if (s.includes("sm") || s.includes("xs") || s.includes("caption") || s.includes("micro")) return "sm";
  return "default";
}

export default function Money({
  minor,
  currency,
  colored = true,
  size = "default",
  signDisplay,
  style,
  className,
}) {
  return (
    <Amount
      minor={minor}
      currency={currency}
      variant={variantOf(size)}
      // `colored={false}` era il modo di dire "questo e' un saldo, non un
      // movimento": nero, non verde ne' rosso.
      tone={colored ? "auto" : "neutral"}
      signDisplay={signDisplay}
      style={style}
      className={className}
    />
  );
}

/** `status`: "auto" | "manual" | "missing". Su "auto" non mostra nulla. */
export function FxBadge({ status, title }) {
  const { t } = useI18n();

  if (status === "manual") {
    return (
      <span className="fin-badge" style={{ color: "var(--warning)", background: "var(--warning-soft)" }} title={title}>
        {t("fx.manual")}
      </span>
    );
  }
  if (status === "missing") {
    return (
      <span className="fin-badge" style={{ color: "var(--negative)", background: "var(--negative-soft)" }} title={title}>
        {t("fx.missing")}
      </span>
    );
  }
  return null;
}
