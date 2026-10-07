# finance-app — brief e decisioni

App PWA di finanza personale. Questo file raccoglie le decisioni prese: dove
sono in contrasto con idee precedenti, valgono queste. Il nome `finance-app` è
provvisorio.

## Regole assolute

- Il progetto Supabase di questa app è **finance-app**, id `dmnaxnvxxbqcibefirja`,
  regione `ap-southeast-1`, piano free.
- Il progetto **saitex-prod** (`cyyymafjofsobvvatogr`) non si tocca mai: solo
  lettura, come riferimento.
- Si lavora **una fase alla volta**. Niente che non sia previsto senza chiedere.
- Dopo ogni migrazione: test di isolamento con due utenti fittizi (in
  transazione, poi rollback) e controllo degli advisor di sicurezza.

## Stack

- React + Vite, PWA (`vite-plugin-pwa`), i18n IT/EN con **tutte** le stringhe
  nei dizionari (`src/i18n/it.js`, `src/i18n/en.js`).
- Numeri, date e valute formattati con `Intl` in base alla lingua, mai a mano
  (`src/lib/format.js`).
- Supabase: Postgres, Auth, RLS, Storage, Edge Function, pg_cron + pg_net,
  segreti nel Vault.
- Deploy su Cloudflare Pages: SPA via `public/_redirects`; nel frontend solo la
  chiave publishable (`VITE_*`).
- Tutte le chiavi segrete (Claude API, API prezzi) solo nei secret delle Edge
  Function.

## Cosa si prende da saitex e cosa no

**Si prende:** lo stile visivo (colori, tipografia, card, spaziature,
animazioni), il trigger `handle_new_user` su `auth.users`, e la regola per cui
il profilo si legge dalla tabella dopo login e refresh, mai dal JWT.

**Non si prende:** le policy RLS. saitex è un'app di squadra con dati condivisi
(`profiles` leggibile da tutti, `is_manager()`). Qui ogni tabella utente ha
policy `user_id = (select auth.uid())` su ogni operazione, senza eccezioni, e
non esistono ruoli.

**Storage:** bucket privati `statements` e `documents`, percorsi `{user_id}/...`,
policy su `storage.objects` limitate alla propria cartella.

## Decisioni tecniche

- **Soldi:** importi in `BIGINT` minor units con segno; tabella `currencies` con
  le minor units ISO 4217 (VND e JPY 0, KWD e BHD 3). Quantità degli
  investimenti in `NUMERIC(38,18)`.
- **Cambi:** `fx_rates(rate_date, quote, rate NUMERIC(28,12), source)` con pivot
  su USD; le coppie si calcolano come rapporto.
  - Catena delle fonti: fawazahmed0
    (`cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date}/v1/...`) → mirror
    `{date}.currency-api.pages.dev` → Frankfurter v2 (`api.frankfurter.dev`).
    **Verificato il 2026-09-21**: Frankfurter v2 (`/v2/rates?base=USD&date=…`)
    copre il VND con dati **giornalieri**, non mensili — 166 valute, e risponde
    anche di sabato e domenica. L'endpoint v1, invece, è solo BCE: 30 valute,
    senza VND. Per gli intervalli si usa `from`/`to` (niente parametro
    `symbols` o `quote`: rispondono 422).
  - **Non** si usa `open.er-api.com`: niente storico, obbligo di attribuzione,
    redistribuzione vietata.
  - Tasso mancante (weekend, festivi): si usa l'ultimo con data ≤ quella della
    transazione.
  - Backfill automatico dei giorni mancanti (il piano free mette in pausa i
    progetti inattivi).
  - Il controvalore **non si salva**: si calcola in una view, così cambiare la
    valuta base non richiede ricalcoli. Override manuale in `fx_override_rate`,
    segnalato nella UI.
- **Claude API:** i PDF si mandano direttamente come documento. Nome del modello
  in configurazione. Consenso esplicito (`profiles.ai_consent_at`) prima di
  inviare file. La "confidence" della categoria è la **fonte** (regola utente /
  match commerciante / AI), non un numero inventato dal modello.
- **Tasse:** `tax_items` con base scelta dall'utente (ricavi lordi, profitto,
  saldo IVA, importo fisso), aliquota, coefficiente facoltativo, frequenza.
  Nessuna regola cablata di un paese specifico.
- **Offline:** da decidere con l'utente in fase 5 (sola lettura in cache oppure
  coda di scritture).

## Schema (da creare fase per fase)

`profiles` ✅, `currencies`, `fx_rates`, `accounts`, `categories`,
`transactions`, `recurring_items`, `merchant_rules`, `imports`, `import_rows`
(staging per la schermata di revisione), `documents`, `holdings`,
`holding_lots`, `asset_prices`, `target_allocations`, `tax_items`,
`tax_deadlines`.

Edge Function: `fx-daily`, `fx-backfill` (da pg_cron, con secret nel Vault);
`parse-statement`, `categorize`, `extract-document` (JWT utente obbligatorio);
`prices-daily` (facoltativa).

## Fasi

1. **Auth, profilo, onboarding, tema, i18n, guscio PWA** ← fatta
2. **Conti, transazioni, multivaluta, job FX giornaliero** ← fatta
3. **Import estratti conto, categorizzazione AI, schermata di revisione, regole** ← fatta
4. Investimenti, allocazione, upload documenti e fatture
5. Tasse, dashboard, rifinitura, offline, test

## Stato

- ✅ **Fase 1**: migrazione `phase1_profiles`, frontend di login, onboarding in
  3 passi, i18n, tema, guscio PWA. Test di isolamento superati.
- ✅ **Fase 2**: migrazioni `phase2_currencies_fx`,
  `phase2_accounts_categories`, `phase2_transactions`, `phase2_views`,
  `phase2_fx_cron`, `phase2_fk_indexes`; Edge Function `fx-daily` schedulata
  due volte al giorno; storico FX dal 2026-01-01; schermate Conti, Movimenti e
  Categorie. Test di isolamento e unit test superati.
- ✅ **Fase 3**: migrazioni `phase3_storage`, `phase3_imports`,
  `phase3_commit_rollback`, `phase3_matching`, `phase3_fk_indexes`; bucket
  privato `statements`; Edge Function `import-ai`; parsing di CSV, XLSX e PDF
  nel browser; schermate Import, Revisione e Regole. Test di isolamento e unit
  test superati. OFX non ancora gestito (il valore resta nell'enum).
- ⏭️ Prossimo: fase 4.

Lo stato aggiornato in forma breve sta in [CLAUDE.md](../CLAUDE.md).
