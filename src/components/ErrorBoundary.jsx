// src/components/ErrorBoundary.jsx
// Rete di sicurezza: un errore di rendering non deve lasciare lo schermo nero.
// E' un class component perche' componentDidCatch non ha equivalente hook.
// Le stringhe sono in italiano di default: il boundary sta SOPRA il provider
// i18n, quindi non puo' usare t() (se cade il provider, cadrebbe anche il
// messaggio d'errore).
import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Errore non gestito:", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        minHeight: "100dvh", background: "var(--surface-bg)", color: "var(--text)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)",
      }}>
        <div className="fin-card" style={{ maxWidth: 440, padding: "var(--space-5)" }}>
          <p className="fin-h2" style={{ marginBottom: "var(--space-2)" }}>
            L&apos;app si e&apos; fermata
          </p>
          <p className="fin-muted">
            Si e&apos; verificato un errore imprevisto. Ricaricare di solito basta.
          </p>
          <pre style={{
            marginTop: "var(--space-3)", padding: "var(--space-2)", fontSize: "var(--fs-caption)",
            fontFamily: "var(--font-mono)",
            background: "var(--surface-sunken)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-control)", color: "var(--text-secondary)",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>{String(error?.message ?? error)}</pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="fin-btn fin-btn--primary fin-btn--block"
            style={{ marginTop: "var(--space-4)" }}
          >Ricarica</button>
        </div>
      </div>
    );
  }
}
