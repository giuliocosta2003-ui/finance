// src/components/AppMark.jsx
// Il marchio dell'app: le tre barre crescenti dell'icona, in piccolo.
// Stesso segno dell'icona PWA, cosi' la schermata di login e la home screen
// del telefono dicono la stessa cosa.
//
// Le barre hanno angoli vivi e la piu' alta e' del rosso del marchio: e' lo
// stesso registro dei contenitori dell'app, dove il raggio grande non esiste.
export default function AppMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <rect x="78"  y="273" width="88" height="148" fill="var(--text-tertiary)" />
      <rect x="212" y="171" width="88" height="250" fill="var(--text-secondary)" />
      <rect x="346" y="68"  width="88" height="353" fill="var(--accent-fill)" />
    </svg>
  );
}
