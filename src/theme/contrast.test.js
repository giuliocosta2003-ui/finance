// src/theme/contrast.test.js — node --test
// Il design system dichiara "almeno WCAG AA su ogni coppia testo/sfondo".
// Questo test lo verifica leggendo tokens.css, cosi' la promessa non e' una
// riga di commento ma qualcosa che si rompe se qualcuno cambia un colore.
//
// Soglie WCAG 2.1:
//   4.5:1  testo normale (AA)
//   3.0:1  testo grande e elementi grafici non testuali (AA)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// I fine riga si normalizzano subito: un test non deve rompersi perche' il
// file e' passato da un sistema all'altro.
const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

/** I token di un blocco (`:root, [data-theme="dark"]` oppure `[data-theme="light"]`). */
function tokensOf(selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `selettore non trovato: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);

  const out = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

// Il tema CHIARO e' quello predefinito: e' lui a stare su :root.
const LIGHT = tokensOf(':root,\n[data-theme="light"]');
const DARK = tokensOf('[data-theme="dark"]');

// ── contrasto WCAG ───────────────────────────────────────────────────────────

function srgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map(c => c + c).join("");
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = srgb(hex).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const check = (tokens, fg, bg, min, theme) => {
  assert.ok(tokens[fg], `${theme}: token --${fg} mancante`);
  assert.ok(tokens[bg], `${theme}: token --${bg} mancante`);
  const ratio = contrast(tokens[fg], tokens[bg]);
  assert.ok(
    ratio >= min,
    `${theme}: --${fg} su --${bg} fa ${ratio.toFixed(2)}:1, serve almeno ${min}:1`,
  );
};

const SURFACES = ["surface-bg", "surface-1", "surface-2", "surface-hover"];

// ── testo ────────────────────────────────────────────────────────────────────

for (const [theme, tokens] of [["scuro", DARK], ["chiaro", LIGHT]]) {
  test(`${theme}: il testo passa AA su tutte e quattro le superfici`, () => {
    for (const bg of SURFACES) {
      check(tokens, "text", bg, 4.5, theme);
      check(tokens, "text-secondary", bg, 4.5, theme);
    }
  });

  test(`${theme}: anche il testo terziario passa AA`, () => {
    // E' quello delle didascalie: piccolo, quindi vale la soglia del testo
    // normale, non quella del testo grande.
    for (const bg of SURFACES) check(tokens, "text-tertiary", bg, 4.5, theme);
  });

  test(`${theme}: accento e colori semantici si leggono sulle superfici`, () => {
    for (const bg of ["surface-bg", "surface-1", "surface-2"]) {
      for (const fg of ["accent", "positive", "negative", "warning", "info"]) {
        check(tokens, fg, bg, 4.5, theme);
      }
    }
  });

  test(`${theme}: il testo sopra il riempimento dell'accento si legge`, () => {
    // `accent-fill` e' il rosso del marchio usato come RIEMPIMENTO del
    // pulsante primario. E' un token diverso da `accent` (quello che si legge
    // come testo su una superficie) proprio perche' in tema scuro i due
    // divergono: il rosso pieno regge il bianco sopra, ma come testo su fondo
    // scuro non arriverebbe a 4,5:1.
    check(tokens, "text-on-fill", "accent-fill", 4.5, theme);
    check(tokens, "text-on-fill", "accent-fill-hover", 4.5, theme);
  });

  test(`${theme}: le iniziali si leggono su tutti e dodici i colori di categoria`, () => {
    // Gli avatar sono le iniziali su una pastiglia del colore della categoria:
    // se anche uno solo dei dodici non regge, quell'avatar e' illeggibile.
    // Il colore delle iniziali ha un token suo perche' i dodici colori sono
    // scuri in tema chiaro e chiari in tema scuro: sopra ci va, di
    // conseguenza, bianco in un caso e quasi nero nell'altro.
    for (let i = 1; i <= 12; i++) check(tokens, "text-on-cat", `cat-${i}`, 4.5, theme);
  });

  test(`${theme}: i colori di categoria si distinguono dallo sfondo`, () => {
    // Come riempimento di un grafico sono elementi grafici: soglia 3:1.
    for (let i = 1; i <= 12; i++) check(tokens, `cat-${i}`, "surface-1", 3, theme);
  });

  test(`${theme}: il bordo dei campi si vede`, () => {
    // WCAG 1.4.11 chiede 3:1 per gli elementi di interfaccia che comunicano
    // uno stato. Il contorno di un input lo comunica; un separatore
    // decorativo no, e infatti --border resta volutamente tenue.
    check(tokens, "border-control", "surface-1", 3, theme);
    check(tokens, "border-control", "surface-2", 3, theme);
  });

  test(`${theme}: l'anello di focus si vede`, () => {
    // Senza, la navigazione da tastiera su desktop diventa indovinare.
    for (const bg of SURFACES) check(tokens, "border-focus", bg, 3, theme);
  });
}

// ── coerenza fra i due temi ──────────────────────────────────────────────────

test("i due temi definiscono esattamente gli stessi token", () => {
  const onlyDark = Object.keys(DARK).filter(k => !(k in LIGHT));
  const onlyLight = Object.keys(LIGHT).filter(k => !(k in DARK));
  assert.deepEqual(onlyDark, [], "token presenti solo nel tema scuro");
  assert.deepEqual(onlyLight, [], "token presenti solo nel tema chiaro");
});

/** Tonalita' in gradi, per misurare quanto due colori sono lontani. */
function hue(hex) {
  const [r, g, b] = srgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

const hueGap = (a, b) => {
  const diff = Math.abs(hue(a) - hue(b)) % 360;
  return diff > 180 ? 360 - diff : diff;
};

test("entrate e uscite non si confondono fra loro", () => {
  // Qui il rapporto di contrasto NON e' la misura giusta: due colori possono
  // avere la stessa luminosita' (1:1) e distinguersi benissimo, perche' a
  // distinguerli e' la TONALITA'. Si misura quella.
  //
  // Il colore non e' comunque mai l'unico segnale: accanto a un importo ci
  // sono sempre il segno e un'etichetta, per chi i colori non li distingue.
  for (const [theme, tokens] of [["scuro", DARK], ["chiaro", LIGHT]]) {
    const pairs = [
      ["accent", "positive"],
      ["positive", "negative"],
    ];
    for (const [a, b] of pairs) {
      const gap = hueGap(tokens[a], tokens[b]);
      assert.ok(
        gap >= 40,
        `${theme}: --${a} e --${b} distano solo ${gap.toFixed(0)}° di tonalita'`,
      );
    }
  }
});

test("accento e negativo restano due rossi diversi", () => {
  // Il marchio e' rosso e le perdite sono rosse: la coppia accento/negativo
  // NON puo' essere separata dalla tonalita', ed e' inutile fingere il
  // contrario con una soglia che il marchio non potrebbe mai rispettare.
  //
  // A separarli e' la FORMA, non il colore: un'azione e' sempre un rettangolo
  // pieno di --accent-fill con sopra il bianco, un valore negativo e' sempre
  // una cifra in --negative preceduta dal segno, e un messaggio di errore
  // porta sempre la sua icona. Nessuno dei tre puo' essere scambiato per un
  // altro anche a colori identici.
  //
  // Cio' che si verifica e' quindi l'unica cosa che conta davvero: che le due
  // sfumature siano distinguibili l'una accanto all'altra, cosi' un testo di
  // errore non sembri un collegamento.
  for (const [theme, tokens] of [["scuro", DARK], ["chiaro", LIGHT]]) {
    const ratio = contrast(tokens.accent, tokens.negative);
    const gap = hueGap(tokens.accent, tokens.negative);
    assert.ok(
      ratio >= 1.1 || gap >= 40,
      `${theme}: --accent e --negative sono lo stesso colore (${ratio.toFixed(2)}:1, ${gap.toFixed(0)}°)`,
    );
  }
});

test("i dodici colori di categoria si distinguono l'uno dall'altro", () => {
  // In una legenda o in un anello vanno riconosciuti a colpo d'occhio: due
  // tonalita' quasi uguali renderebbero due voci indistinguibili.
  for (const [theme, tokens] of [["scuro", DARK], ["chiaro", LIGHT]]) {
    const cats = Array.from({ length: 12 }, (_, i) => tokens[`cat-${i + 1}`]);
    for (let i = 0; i < cats.length; i++) {
      for (let j = i + 1; j < cats.length; j++) {
        // --cat-12 e' il grigio di riserva: non ha tonalita' da confrontare.
        if (i === 11 || j === 11) continue;
        const gap = hueGap(cats[i], cats[j]);
        assert.ok(gap >= 20, `${theme}: --cat-${i + 1} e --cat-${j + 1} distano ${gap.toFixed(0)}°`);
      }
    }
  }
});
