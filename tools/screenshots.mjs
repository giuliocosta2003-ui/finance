// tools/screenshots.mjs
// Screenshot automatici delle schermate, in tema chiaro e scuro, alle quattro
// larghezze che contano. Servono a confrontare il prima e il dopo del redesign
// e a beccare le regressioni che un test non vede: un titolo che va a capo, una
// card che esce dallo schermo, un contrasto che sparisce in tema chiaro.
//
// Uso:
//   node tools/screenshots.mjs                    (tutte, sul dev server)
//   node tools/screenshots.mjs --base http://localhost:5173
//   node tools/screenshots.mjs --only ui
//
// Il dev server deve essere gia' in esecuzione: lo script non lo avvia, cosi'
// puoi puntarlo anche a un'anteprima di produzione.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(ROOT, "docs", "screenshots");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = flag("base", "http://localhost:5173").replace(/\/$/, "");
const ONLY = flag("only", null);

/** Le larghezze: telefono, tablet, desktop, desktop largo. */
const WIDTHS = [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "768", width: 768, height: 1024, mobile: false },
  { name: "1280", width: 1280, height: 900, mobile: false },
  { name: "1440", width: 1440, height: 900, mobile: false },
];

const THEMES = ["dark", "light"];

/** Le pagine da fotografare. `ready` e' cio' che deve comparire prima dello scatto. */
const PAGES = [
  { id: "ui",           path: "/dev/ui" },
  { id: "shell",        path: "/dev/page/shell" },
  { id: "home",         path: "/dev/page/home" },
  { id: "transactions", path: "/dev/page/transactions" },
  { id: "accounts",     path: "/dev/page/accounts" },
  { id: "investments",  path: "/dev/page/investments" },
  { id: "documents",    path: "/dev/page/documents" },
  { id: "imports",      path: "/dev/page/imports" },
  { id: "taxes",        path: "/dev/page/taxes" },
  { id: "settings",     path: "/dev/page/settings" },
  { id: "categories",   path: "/dev/page/categories" },
  { id: "rules",        path: "/dev/page/rules" },
  { id: "allocation",   path: "/dev/page/allocation" },
  { id: "review",       path: "/dev/page/review" },
  // Le uniche due schermate fuori dal guscio: sono anche le prime che si
  // vedono, quindi devono stare nel giro di verifica come tutte le altre.
  { id: "login",        path: "/login" },
];

async function shoot(page, { id, path: urlPath }, theme, size) {
  const url = `${BASE}${urlPath}${urlPath.includes("?") ? "&" : "?"}theme=${theme}`;
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => page.goto(url));

  // Il tema si forza sull'elemento <html>, come fa ThemeContext. Si forza
  // anche prefers-color-scheme, altrimenti i controlli nativi (date picker,
  // scrollbar) restano dell'altro tema e lo scatto mente.
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);

  // I font vanno aspettati: senza, lo scatto prende il fallback di sistema e
  // le larghezze delle cifre non sono quelle vere.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);

  const file = path.join(OUT, `${id}-${theme}-${size.name}.png`);
  await page.screenshot({ path: file, fullPage: true });

  // Nessuno scroll orizzontale, a nessuna larghezza: e' una regola del brief.
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));

  return {
    file: path.relative(ROOT, file).replace(/\\/g, "/"),
    overflowX: overflow.scroll > overflow.client + 1,
    scrollWidth: overflow.scroll,
    clientWidth: overflow.client,
  };
}

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });

const results = [];
const pages = PAGES.filter(p => !ONLY || p.id === ONLY);

for (const size of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    locale: "it-IT",
  });
  const page = await context.newPage();

  for (const target of pages) {
    for (const theme of THEMES) {
      try {
        const r = await shoot(page, target, theme, size);
        results.push({ page: target.id, theme, width: size.name, ...r });
        const warn = r.overflowX ? `  ⚠ scroll orizzontale (${r.scrollWidth} > ${r.clientWidth})` : "";
        console.log(`${r.file}${warn}`);
      } catch (e) {
        console.error(`${target.id} ${theme} ${size.name}: ${e.message}`);
        results.push({ page: target.id, theme, width: size.name, error: e.message });
      }
    }
  }

  await context.close();
}

await browser.close();

await writeFile(path.join(OUT, "index.json"), JSON.stringify(results, null, 2) + "\n", "utf8");

const overflowing = results.filter(r => r.overflowX);
const failed = results.filter(r => r.error);

console.log(`\n${results.length - failed.length} screenshot in docs/screenshots/`);
if (overflowing.length) {
  console.log(`⚠ scroll orizzontale su: ${overflowing.map(r => `${r.page}/${r.theme}/${r.width}`).join(", ")}`);
}
if (failed.length) {
  console.log(`✖ falliti: ${failed.map(r => `${r.page}/${r.theme}/${r.width}`).join(", ")}`);
  process.exitCode = 1;
}
