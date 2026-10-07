// src/components/ValueChart.jsx
// Andamento del valore del portafoglio.
//
// Niente libreria di grafici: un grafico a linea con i punti stimati
// tratteggiati sono ottanta righe di SVG, mentre la piu' leggera delle
// librerie ne porta centinaia di kilobyte, ridisegna i colori con un tema suo
// e per i tratteggi condizionali va comunque forzata. Qui i colori sono i
// token del tema e funzionano in chiaro e in scuro senza altro codice.
//
// I punti `estimated` sono quelli calcolati senza un prezzo abbastanza
// recente: si disegnano tratteggiati perche' una linea continua su dati
// inventati e' peggio di un buco.
//
// Il registro e' quello di un prospetto, non di un cruscotto: nessun
// riempimento sfumato sotto la linea (il gradiente era l'unico dell'app e
// stonava con tutto il resto), una griglia orizzontale appena accennata, e gli
// estremi dell'asse scritti come testo secondario.
import { useMemo } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { formatMoney } from "../lib/money";
import { formatDate } from "../lib/format";

const W = 720;
const H = 200;
const PAD = { top: 14, right: 8, bottom: 24, left: 8 };

/** Quante linee orizzontali di riferimento. Tre: oltre, la griglia urla. */
const GRID = 3;

export default function ValueChart({ series, currency, height = 200 }) {
  const { t, lang } = useI18n();
  const { minorUnits } = useCurrencies();

  const model = useMemo(() => {
    const points = (series ?? []).filter(p => p.value_base_minor !== null);
    if (points.length < 2) return null;

    const values = points.map(p => Number(p.value_base_minor));
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }   // linea piatta: serve comunque un'altezza
    const span = max - min;

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const xy = points.map((p, i) => [
      PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW),
      PAD.top + innerH - ((Number(p.value_base_minor) - min) / span) * innerH,
    ]);

    // Un segmento e' "stimato" se lo e' almeno uno dei due estremi: e' il
    // tratto che poggia su un dato incerto.
    const segments = [];
    let current = { estimated: !!points[0].estimated, pts: [xy[0]] };
    for (let i = 1; i < xy.length; i++) {
      const est = !!points[i].estimated || !!points[i - 1].estimated;
      if (est !== current.estimated) {
        current.pts.push(xy[i]);
        segments.push(current);
        current = { estimated: est, pts: [xy[i]] };
      } else {
        current.pts.push(xy[i]);
      }
    }
    segments.push(current);

    return {
      points, xy, segments, min, max,
      first: points[0],
      last: points[points.length - 1],
      anyEstimated: points.some(p => p.estimated),
    };
  }, [series]);

  if (!model) {
    return (
      <div style={{
        height, display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-secondary)", fontSize: "var(--fs-body-sm)",
      }}>{t("investments.chartEmpty")}</div>
    );
  }

  const units = minorUnits(currency);
  // Sull'asse il numero va letto di sfuggita: notazione compatta e nessun
  // decimale, che a colpo d'occhio sono solo rumore.
  const label = (minor) => formatMoney(BigInt(Math.round(minor)), currency, lang, units, {
    notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1,
  });

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height, display: "block", overflow: "visible" }}
        role="img"
        aria-label={t("investments.chartLabel", {
          from: formatDate(model.first.d, lang),
          to: formatDate(model.last.d, lang),
        })}
      >
        {/* Griglia: fili orizzontali sottilissimi, nessuna linea verticale.
            Servono a leggere un'altezza, non a fare da decorazione. */}
        {Array.from({ length: GRID + 1 }, (_, i) => {
          const y = PAD.top + ((H - PAD.top - PAD.bottom) / GRID) * i;
          return (
            <line
              key={i}
              x1={PAD.left} x2={W - PAD.right} y1={y} y2={y}
              stroke="var(--border)" strokeWidth="1" shapeRendering="crispEdges"
            />
          );
        })}

        {model.segments.map((seg, i) => (
          <polyline
            key={i}
            points={seg.pts.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            stroke="var(--accent-fill)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={seg.estimated ? "5 4" : undefined}
            opacity={seg.estimated ? 0.65 : 1}
          />
        ))}

        <circle
          cx={model.xy[model.xy.length - 1][0]}
          cy={model.xy[model.xy.length - 1][1]}
          r="3"
          fill="var(--accent-fill)"
        />

        <text x={PAD.left} y={H - 6} fill="var(--text-secondary)" fontSize="11">
          {formatDate(model.first.d, lang)}
        </text>
        <text x={W - PAD.right} y={H - 6} fill="var(--text-secondary)" fontSize="11" textAnchor="end">
          {formatDate(model.last.d, lang)}
        </text>
        {/* Massimo in alto e minimo in basso: due riferimenti bastano a dare
            la scala, e riempire l'asse di valori intermedi in un grafico alto
            200 px li farebbe solo accavallare. */}
        <text x={PAD.left} y={PAD.top - 4} fill="var(--text-secondary)" fontSize="11">
          {label(model.max)}
        </text>
        <text x={PAD.left} y={H - PAD.bottom - 4} fill="var(--text-secondary)" fontSize="11">
          {label(model.min)}
        </text>
      </svg>

      {model.anyEstimated && (
        <figcaption className="fin-caption" style={{ marginTop: "var(--space-2)" }}>
          {t("investments.chartEstimated")}
        </figcaption>
      )}
    </figure>
  );
}
