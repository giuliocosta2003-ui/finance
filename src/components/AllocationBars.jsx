// src/components/AllocationBars.jsx
// Allocazione attuale contro obiettivo.
//
// Una barra per riga, con una tacca dove sta l'obiettivo: il confronto si
// legge senza dover sottrarre due percentuali a mente. La torta sarebbe piu'
// decorativa e meno utile, perche' su una torta l'obiettivo non si disegna.
import { useI18n } from "../i18n/I18nContext";
import { Amount, Badge } from "../ui";
import { formatPercent } from "../lib/format";

export default function AllocationBars({ rows, currency, labelOf }) {
  const { t, lang } = useI18n();

  if (!rows?.length) return <p className="fin-hint">{t("investments.allocationEmpty")}</p>;

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {rows.map(row => {
        const pct = Number(row.pct ?? 0);
        const target = row.target_pct === null ? null : Number(row.target_pct);
        const drift = row.drift_pct === null ? null : Number(row.drift_pct);

        return (
          <div key={`${row.dimension}-${row.key}`}>
            <div style={{
              display: "flex", alignItems: "baseline", gap: "var(--space-2)",
              marginBottom: "var(--space-1)", flexWrap: "wrap",
            }}>
              <span style={{ fontSize: "var(--fs-body)", color: "var(--text)" }}>
                {labelOf ? labelOf(row) : row.label}
              </span>
              <span className="num" style={{
                fontSize: "var(--fs-body)", fontWeight: "var(--fw-semibold)", color: "var(--text)",
              }}>
                {formatPercent(pct / 100, lang, { maximumFractionDigits: 1 })}
              </span>
              {target !== null && (
                <span className="fin-caption">
                  {t("investments.target", {
                    pct: formatPercent(target / 100, lang, { maximumFractionDigits: 1 }),
                  })}
                </span>
              )}
              {row.out_of_band && (
                <Badge tone="var(--warning)">
                  {drift > 0 ? "+" : ""}{formatPercent(drift / 100, lang, { maximumFractionDigits: 1 })}
                </Badge>
              )}
              <span style={{ marginLeft: "auto" }}>
                <Amount minor={row.value_base_minor} currency={currency} tone="neutral" variant="sm" />
              </span>
            </div>

            {/* La barra e' rettangolare e la tacca dell'obiettivo la attraversa
                tutta: con gli angoli tondi una quota del 2% sembrerebbe piu'
                grande di quello che e'. */}
            <div className="fin-bar" style={{ position: "relative", overflow: "visible" }}>
              <div
                className="fin-bar__fill"
                style={{
                  width: `${Math.min(100, Math.max(0, pct))}%`,
                  background: row.out_of_band ? "var(--warning)" : "var(--accent-fill)",
                }}
              />
              {target !== null && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute", top: -3, bottom: -3,
                    left: `${Math.min(100, Math.max(0, target))}%`,
                    width: 2, background: "var(--text)",
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
