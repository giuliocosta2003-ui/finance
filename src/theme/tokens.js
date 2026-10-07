// src/theme/tokens.js
// I token che servono anche a JavaScript: colori delle categorie, palette dei
// grafici, breakpoint, durate.
//
// Il brief lo chiamava tokens.ts, ma tutto `src/` e' JavaScript: un solo file
// TypeScript obbligherebbe a una configurazione a parte per zero vantaggi.
// I valori restano gli stessi di tokens.css, che resta la sorgente di verita'
// per il CSS; qui ci sono solo i riferimenti ai token, non copie dei colori.

/** I nomi delle variabili CSS, per chi deve passarli a un attributo SVG. */
export const color = (name) => `var(--${name})`;

/** Quanti colori di categoria esistono. Vedi --cat-1..--cat-12 in tokens.css. */
export const CATEGORY_COLORS = 12;

/**
 * Colore stabile per una categoria, dal suo id.
 *
 * Deve essere STABILE: se il colore di una categoria cambiasse a ogni
 * caricamento, il grafico a torta di ieri non si potrebbe confrontare con
 * quello di oggi. Si ricava quindi dall'id con un hash deterministico, non
 * dall'ordine in cui le categorie arrivano dal database.
 */
export function categoryColor(key) {
  const s = String(key ?? "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `var(--cat-${(hash % CATEGORY_COLORS) + 1})`;
}

/** Le iniziali per l'avatar di un commerciante: al massimo due lettere. */
export function initials(text) {
  const words = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Gli stessi valori dei @media di tokens.css: qui servono a useIsMobile e simili. */
export const BREAKPOINTS = {
  mobile: 767,    // <= mobile
  tablet: 1199,   // <= tablet, oltre e' desktop
};

export const DURATION = {
  fast: 150,
  base: 200,
  slow: 250,
};

/**
 * `true` se l'utente ha chiesto meno movimento. Le animazioni in CSS lo
 * rispettano gia' da sole (le durate vanno a 0), ma quelle scritte in
 * JavaScript — come il conteggio animato del saldo — devono chiederlo.
 */
export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
