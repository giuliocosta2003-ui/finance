// src/components/Loading.jsx
// Indicatore di caricamento riusabile: spinner discreto + etichetta.
export default function Loading({ label = "", fullScreen = false }) {
  const content = (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: "var(--space-2)", color: "var(--text-secondary)", fontSize: "var(--fs-body-sm)",
      padding: "var(--space-6) 0",
    }}>
      <span
        aria-hidden="true"
        style={{
          width: 14, height: 14, borderRadius: "50%",
          border: "2px solid var(--border-strong)", borderTopColor: "var(--accent-fill)",
          animation: "fin-spin .7s linear infinite",
          display: "inline-block", flexShrink: 0,
        }}
      />
      {label}
    </div>
  );

  if (!fullScreen) return content;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "var(--surface-bg)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {content}
    </div>
  );
}
