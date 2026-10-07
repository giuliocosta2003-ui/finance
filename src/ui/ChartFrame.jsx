// src/ui/ChartFrame.jsx
// La cornice attorno a un grafico: titolo, cifra in evidenza, comandi di
// intervallo, e il grafico sotto.
//
// Esiste perche' i grafici dell'app sono SVG scritti a mano (niente libreria,
// vedi ValueChart): senza una cornice comune, ognuno finirebbe per avere il
// proprio modo di mettere titolo e legenda, e tre grafici sembrerebbero tre
// app diverse.
import { Card } from "./primitives";

export function ChartFrame({ title, value, actions, legend, children, ...rest }) {
  return (
    <Card {...rest}>
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-3)",
        marginBottom: "var(--space-4)",
        flexWrap: "wrap",
      }}>
        <div style={{ minWidth: 0 }}>
          {title && <p className="fin-card__title">{title}</p>}
          {value && <div style={{ marginTop: "var(--space-1)" }}>{value}</div>}
        </div>
        {actions && <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>{actions}</div>}
      </div>

      {children}

      {legend && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-3)",
          marginTop: "var(--space-4)",
        }}>
          {legend}
        </div>
      )}
    </Card>
  );
}

/** Una voce di legenda: pastiglia del colore piu' etichetta. */
export function LegendItem({ color, label, value }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
      <span
        aria-hidden="true"
        style={{ width: 10, height: 10, borderRadius: 3, background: color, flex: "0 0 auto" }}
      />
      <span className="fin-caption" style={{ color: "var(--text-secondary)" }}>{label}</span>
      {value && <span className="fin-caption num">{value}</span>}
    </span>
  );
}
