# finance-app

PWA di finanza personale: conti multivaluta, transazioni, import di estratti
conto, investimenti e tasse. React + Vite, Supabase, deploy su Cloudflare Pages.

Le decisioni di progetto e lo stato delle fasi stanno in
[docs/PROMPT.md](docs/PROMPT.md).

## Avvio

```bash
npm install
cp .env.example .env   # poi inserisci la chiave publishable
npm run dev
```

| Comando           | Cosa fa                                              |
| ----------------- | ---------------------------------------------------- |
| `npm run dev`     | server di sviluppo su `http://localhost:5173`        |
| `npm run build`   | build di produzione in `dist/`                       |
| `npm run preview` | serve `dist/` — **l'unico modo di provare il service worker**, spento in dev |
| `npm run lint`    | oxlint                                               |
| `npm test`        | unit test (`node --test`)                            |
| `npm run fixtures`| scrive su disco gli estratti conto finti dei test    |

## Variabili d'ambiente

Solo chiavi pubblicabili, in `.env` (non versionato):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Lato Edge Function servono invece, nei secret del progetto Supabase:

- `ANTHROPIC_API_KEY` — senza, le funzioni AI rispondono `ai_not_configured`
- `ANTHROPIC_MODEL` — facoltativo, default `claude-opus-5`

Le chiavi segrete (Claude API, API prezzi) vivono nei secret delle Edge
Function, mai nel frontend.

## Struttura

```
src/
  theme/primitives.css scale che col tema non cambiano: tipografia, spaziature,
                       raggi, altezze dei controlli, movimento
  theme/tokens.css     i colori, in tema chiaro (predefinito) e scuro
  theme/contrast.test.js  verifica WCAG AA leggendo i token
  ui/                  la libreria di componenti: pulsanti, card, campi, tabelle,
                       righe, stati, impaginazione. Le schermate importano da qui
  index.css            reset e stili di base
  i18n/                dizionari IT/EN e provider; nessuna stringa nei componenti
  lib/                 client Supabase, importi (money.js), formattazione Intl
  contexts/            sessione + profilo, tema, valute
  hooks/               conti, categorie, movimenti, preferenze locali
  components/          guscio, navigazione, icone, moduli, toast
  pages/               login, onboarding, home, conti, movimenti, investimenti,
                       documenti, import, revisione, tasse, impostazioni
  pages/dev/           galleria del design system e banco di prova — solo in sviluppo
  lib/import/          lettura di CSV/XLSX/OFX/PDF, mappatura colonne, controlli
supabase/migrations/   copia versionata delle migrazioni applicate
supabase/functions/    Edge Function (fx-daily: tassi di cambio giornalieri)
supabase/tests/        test SQL di isolamento, da eseguire con la service role
supabase/functions/_shared/  moduli condivisi fra Edge Function e frontend
tools/screenshots.mjs  screenshot di ogni schermata, 4 larghezze x 2 temi
docs/screenshots/      il risultato, piu' index.json con i controlli di overflow
fixtures/              estratti conto finti per i test (i veri vanno in fixtures/private/)
```

## Deploy (Cloudflare Pages)

- Build command: `npm run build`
- Output directory: `dist`
- Variabili d'ambiente: le due `VITE_*` qui sopra
- `public/_redirects` manda tutte le rotte a `index.html` (SPA)
