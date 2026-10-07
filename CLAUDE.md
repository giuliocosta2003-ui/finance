# finance-app

PWA di finanza personale. React + Vite, Supabase, deploy su Cloudflare Pages.
Il brief completo e le decisioni tecniche stanno in [docs/PROMPT.md](docs/PROMPT.md).

## Regole assolute

- **Mai toccare** il progetto Supabase `saitex-prod` (`cyyymafjofsobvvatogr`): solo
  lettura, come riferimento. Questa app vive su `finance-app`
  (`dmnaxnvxxbqcibefirja`, ap-southeast-1, piano free).
- Si lavora **una fase alla volta**. Chiedere prima di aggiungere qualsiasi cosa
  non prevista dalla fase in corso.
- Spiegare ogni scelta architetturale in una o due righe, nel codice o nella
  risposta.
- Dopo ogni migrazione: test di isolamento con due utenti fittizi (in
  transazione + rollback) e `get_advisors` security e performance.
- Lingua con l'utente: italiano. UI: IT + EN.

## Convenzioni

- **Soldi**: interi in minor units (`BIGINT` con segno). Mai float, mai
  `parseFloat`. Parsing e formattazione in `src/lib/money.js`, con i decimali
  presi dalla tabella `currencies`.
- **Intl per tutto** il resto: date, numeri, percentuali, nomi di valute e paesi
  (`src/lib/format.js`). Niente formattazione a mano.
- **Stringhe**: tutte in `src/i18n/it.js` e `src/i18n/en.js`, con le stesse
  chiavi nei due file. Niente testo visibile nei componenti.
- **Stile**: il design system e' `src/theme/primitives.css` (misure,
  tipografia, raggi, movimento: tutto cio' che non cambia col tema) piu'
  `src/theme/tokens.css` (i colori, in due temi) piu' la libreria di componenti
  in `src/ui/`. Niente valori letterali nei componenti: se un colore o una
  misura serve, il token esiste o si aggiunge ai token. Il vecchio
  `src/components/ui.js` e il blocco di alias verso i nomi vecchi dei token
  sono stati cancellati a fine fase 5: non esiste piu' un secondo modo di
  scrivere uno stile.
- **Linguaggio visivo**: istituzionale, non fintech. Rosso HSBC come accento,
  superfici bianche (tema chiaro predefinito), raggi minimi (2 px sui
  controlli, 4 px sui contenitori), separazione affidata ai BORDI e non alle
  ombre, stato attivo segnato da una barra piena di colore. Il rosso PIENO e'
  riservato all'azione principale: un valore negativo usa `--negative`, che e'
  un rosso diverso e piu' scuro, cosi' un importo non sembra mai un pulsante.
- **RLS**: ogni tabella utente ha `enable` + `force`, quattro policy
  (select/insert/update/delete) su `user_id = (select auth.uid())`, `user_id`
  fuori dai GRANT di UPDATE, e tutto revocato ad `anon`. Nessun ruolo: non si
  copiano le policy di saitex.
- **Integrita' fra utenti**: le FK verso tabelle dell'utente sono **composte**
  con `user_id` (es. `(account_id, user_id) -> accounts(id, user_id)`). La RLS
  nasconde, la FK impedisce.
- **Funzioni**: `security invoker` e `search_path` vuoto, salvo dove serve
  davvero il contrario (`handle_new_user`, `fx_cron_secret`), con l'execute
  revocato a chi non deve chiamarle.
- **Il controvalore non si salva**: si calcola nelle view, cosi' cambiare la
  valuta base non richiede ricalcoli.
- **Parsing nel browser, AI nella Edge Function**: una Edge Function ha 2
  secondi di CPU per richiesta, che un XLSX medio supera; una chiamata a Claude
  invece e' quasi tutta attesa di rete.
- **Moduli condivisi con la Edge Function**: il file vero sta in
  `supabase/functions/_shared/`, e `src/lib/<nome>.js` lo riesporta in una
  riga. Una sola copia, altrimenti browser e server si comportano in modo
  diverso senza che nessuno se ne accorga. **Il deploy di una funzione e' un
  rimpiazzo completo**: vanno sempre inviati anche i file `_shared` che usa.
- **Verso Claude** vanno solo data, descrizione ripulita, segno e valuta. Mai
  nomi di conto, mai importi esatti. La sanificazione e la validazione delle
  risposte stanno in `_shared/ai-payload.js`, con i test.

## Comandi

```bash
npm run dev      # sviluppo su http://localhost:5173
npm run build    # build di produzione
npm run preview  # unico modo di provare il service worker
npm run lint     # oxlint
npm test         # unit test (node --test)
```

I test SQL stanno in `supabase/tests/` e si eseguono con la service role.

## Stato attuale

**Fase 1 — auth, profilo, onboarding, tema, i18n, guscio PWA: fatta.**
- Migrazione `phase1_profiles`: enum `profile_type` e `app_locale`, tabella
  `profiles` col vincolo `onboarding_requires_fields`, trigger
  `on_auth_user_created`, RLS con force.
- Frontend: login/registrazione/recupero password, onboarding in 3 passi,
  IT/EN, tema chiaro/scuro, guscio PWA.

**Fase 2 — conti, transazioni, multivaluta, FX giornaliero: fatta.**
- Migrazioni: `phase2_currencies_fx`, `phase2_accounts_categories`,
  `phase2_transactions`, `phase2_views`, `phase2_fx_cron`, `phase2_fk_indexes`.
- `currencies` (155 valute ISO 4217), `fx_rates` (pivot USD), `fx_fetch_log`,
  funzione `fx_rate(from, to, on)`.
- `accounts`, `categories` + `seed_default_categories()`, `transactions` +
  `create_transfer()`.
- View `transactions_converted` (tasso della data del movimento) e
  `account_balances` (tasso piu' recente), entrambe `security_invoker`.
- Edge Function `fx-daily` (`verify_jwt = false`, header `x-cron-secret`),
  schedulata da pg_cron alle 01:30 e 07:30 UTC via `net.http_post`, con URL e
  segreto letti dal Vault.
- Storico FX caricato dal **2026-01-01**: 264 giorni, ~40.000 tassi.
- Frontend: schermate Conti, Movimenti (con filtri, trasferimenti, tasso
  manuale) e Impostazioni > Categorie.

**Fase 3 — import estratti conto, categorizzazione AI, revisione, regole: fatta.**
- Migrazioni: `phase3_storage`, `phase3_imports`, `phase3_commit_rollback`,
  `phase3_matching`, `phase3_fk_indexes`, `phase3_realtime`.
- Bucket privato `statements` (20 MB, percorsi `{user_id}/{import_id}/{file}`),
  tabelle `imports`, `import_events` (solo in aggiunta), `import_rows`,
  `parser_profiles`, `merchant_rules`; `pg_trgm` con indice su
  `transactions.merchant`.
- RPC: `commit_import` / `rollback_import` (anteprima, poi `p_confirm`),
  `find_duplicate_candidates`, `find_transfer_candidates`,
  `suggest_categories_from_history`.
- Edge Function `import-ai` (JWT obbligatorio, client con i diritti
  dell'utente, mai la service role): `suggest_mapping`, `extract_text`,
  `extract_pdf` (in sottofondo con `EdgeRuntime.waitUntil`), `categorize`.
- Parsing di CSV, XLSX, OFX/QFX e PDF **nel browser** (una Edge Function ha 2s
  di CPU per richiesta); l'AI serve solo dove serve davvero.
- **Una sola strada a valle**: CSV, XLSX, OFX e righe lette da Claude passano
  tutte da `checkAndHash` (saldo progressivo, totali dichiarati, valuta,
  impronta dei doppioni) e da `persistRows` (regole, storico, AI). Chi salta
  quel passaggio importa senza impronta, e senza impronta i doppioni non si
  riconoscono.
- **PDF a blocchi**: 8 pagine per richiesta. Il limite che scatta per primo non
  e' quello di pagine dell'API ma la risposta, e una risposta troncata
  (`stop_reason = "max_tokens"`) fa fallire l'import invece di importarne meta'.
  I blocchi li fa il browser sul testo e `pdf-lib` nella Edge Function sulle
  scansioni; `mergeExtractions` in `_shared/` li ricuce allo stesso modo.
- **PDF scansionati**: la Edge Function estrae in sottofondo, deposita le righe
  in un evento `ai_extract` e scrive `rows_total` su `imports`, che e' l'unica
  tabella in Realtime. L'import resta in `parsing` finche' il client non applica
  controlli e regole (`resumeExtraction`), anche riaprendolo giorni dopo: uno
  stato `review` prima di allora prometterebbe una revisione vuota.
- Frontend: schermate Import, Revisione (tabella su desktop, card su mobile,
  conferma dei trasferimenti riga per riga o in blocco), Impostazioni > Regole,
  e l'interruttore del consenso AI in Impostazioni. Le regole nascono dalle
  correzioni sia in revisione sia in Movimenti, con avviso annullabile.

**Fase 4 — investimenti, allocazione, documenti e fatture: fatta.**
- Migrazioni: `phase4_transaction_kind`, `phase4_investments`, `phase4_documents`,
  `phase4_positions`, `phase4_prices_cron`, `phase4_document_links`.
- `investment` aggiunto a `transaction_kind`: come i trasferimenti, resta fuori
  da entrate e uscite e non puo' avere categoria. Sta in una migrazione da solo
  perche' PostgreSQL rifiuta di usare un valore di enum nella stessa
  transazione in cui lo si aggiunge.
- `holdings`, `holding_lots`, `asset_prices`, `target_allocations`,
  `price_fetch_log`, `documents`; bucket privato `documents` (20 MB, solo PDF e
  JPEG/PNG/WebP); Realtime anche su `documents`.
- **Quantita' e prezzi sono NUMERIC, non minor units**: e' l'unica eccezione
  alla regola dei soldi interi, e vale solo per gli investimenti. 0,00000001
  BTC a 0,0000000234 EUR sono numeri veri; in minor units servirebbero decine
  di decimali inventati. Gli IMPORTI restano interi ovunque: commissioni in
  `fees_minor`, controvalori in minor units. Parsing in `src/lib/decimal.js`.
- **Metodo P&L scelto dall'utente**, default **LIFO**: per titoli e
  cripto-attivita' l'art. 67 TUIR considera cedute per prime le quote
  acquisite piu' di recente. Costo medio e FIFO restano in Impostazioni.
- `holding_positions(as_of)`, `portfolio_allocation(dim)`,
  `portfolio_value_series(da, a, passo)`: funzioni con parametro di data, non
  view, cosi' lo stesso codice risponde per "oggi" e per il grafico storico.
  Il P&L non realizzato e' diviso in **effetto prezzo** ed **effetto cambio**,
  e la somma dei due e' esattamente il totale.
- Edge Function `prices-daily` (`verify_jwt = false`): col segreto
  `x-cron-secret` fa il giro quotidiano per tutti con la service role, col JWT
  dell'utente fa solo il recupero storico di un proprio investimento, e li'
  **non** usa la service role. CoinGecko piano Demo: 100 chiamate/min,
  10.000/mese, **storico limitato a 365 giorni**.
- Edge Function `document-ai` (JWT obbligatorio, client dell'utente): legge
  fatture, ricevute, buste paga e contratti in sottofondo con
  `EdgeRuntime.waitUntil`. Validazione e schema in
  `_shared/document-payload.js`, con i test: valuta inesistente, netto+imposta
  che non fa il totale, data sospetta, file duplicato sono **flag**, non
  blocchi — un documento con un campo storto resta comunque archiviato.
- `suggest_document_links` sta in SQL e non nella Edge Function: non c'entra
  l'AI, e' una ricerca su tutto lo storico. Suggerisce e basta: collega
  l'utente.
- **Niente libreria di grafici**: la linea con i punti stimati tratteggiati
  sono ottanta righe di SVG in `ValueChart.jsx`, mentre una libreria porta
  centinaia di kilobyte e un tema proprio da riallineare.
- HEIC: convertito in JPEG e ridotto a 2000 px **nel browser**
  (`src/lib/image.js`), col decodificatore del browser. Il bucket non accetta
  HEIC di proposito: ammetterlo vorrebbe dire archiviare file illeggibili.

**Estratti PDF a regole, senza AI**: `src/lib/import/statements/` contiene un
parser per banca piu' un dispatcher. Se il tracciato e' riconosciuto il PDF si
legge nel browser, gratis, senza consenso AI e senza chiave. La strada con
Claude resta solo per le banche sconosciute e per le scansioni. Tre vincoli:
il parser lavora sulle COORDINATE (`readPdfLayout`), non sul testo appiattito,
perche' in un estratto il segno sta nella colonna e non nel testo; restituisce
la stessa forma `extracted` che restituirebbe il modello, cosi' a valle
`rowsFromExtraction` fa gli stessi controlli e calcola la stessa impronta dei
doppioni; e non indovina mai — se le intestazioni non si riconoscono si passa
all'AI invece di leggere numeri a caso. Nota: `imports.parser` e' un enum con
cinque valori fissi, quindi chi ha letto il file si registra in
`import_events`, non li'. Banche lette a regole: **HSBC Vietnam** (`hsbcVn.js`)
e **Revolut** filiale italiana (`revolut.js`). I due tracciati sono opposti:
in HSBC la descrizione sta SOPRA la riga di importo e saldo; in Revolut la
riga-ancora (data + importo + saldo) apre il movimento e le righe di dettaglio
("ID transazione", "A:", "Carta:", "Costo:", conversione) stanno SOTTO e NON
sono movimenti — si riconoscono perche' senza data e senza saldo. In entrambi
il segno lo decide la COLONNA. Le date Revolut sono testuali all'italiana
("9 apr 2026") e il parser le rende in ISO, perche' la pipeline a valle non
saprebbe leggerle. Verificato sull'estratto vero: 24 movimenti, saldo
progressivo e totali riconciliati esatti, zero flag.

**Documenti a regole, senza AI**: speculare agli estratti, `src/lib/documents/`
contiene un parser per tracciato piu' un dispatcher (`parseDocument`). Oggi c'e'
`consultantInvoice.js`, il generatore di fatture di consulenza dell'utente: un
tracciato fisso valido per qualunque cliente. `uploadDocument` prova le regole
PRIMA dell'AI e vale **anche senza consenso** (nessun byte esce dal
dispositivo). Il parser restituisce la stessa forma dello schema di
`document-payload.js` e passa dalla STESSA `validateDocument` della Edge
Function: gli stessi flag, gli stessi campi. Lavora sulle COORDINATE perche' il
valore sta a destra della sua etichetta; gli importi qui sono anglosassoni
("1,300.00") ma le percentuali all'italiana ("0,00%"), quindi si normalizza
guardando l'ultimo separatore, non la lingua. Verificato sulle fatture vere:
tutti i campi giusti, zero flag.

**Revisione per commerciante**: la schermata di revisione raggruppa per
commerciante (`src/lib/groupByMerchant.js`, vista predefinita). Su un estratto
vero di 127 movimenti i gruppi sono 68, e i primi quattro ne coprono 56:
scegliere una categoria sul gruppo la applica a tutte le sue righe e crea la
regola, quindi il mese dopo arrivano gia' categorizzate. Perche' funzioni, la
normalizzazione del commerciante deve togliere il rumore per-movimento — date
in lettere (09AUG26), riferimenti corti col trattino (A895-22913), importi coi
decimali, canali come "electro": senza, 127 movimenti facevano 103 gruppi e il
raggruppamento non serviva a niente. La normalizzazione (`_shared/merchant.js`,
`merchant-noise.js`) toglie anche: i prefissi dei circuiti di pagamento
("PAYPAL \*NETFLIX" -> "netflix", "SumUp \*...", "SQ \*..."), le forme
societarie coi punti e senza ("srl", "s.p.a", "ltd", "limited" -> via, cosi'
"ACME" e "ACME SRL" fanno un gruppo solo), e il prefisso "Pagamento da/a NOME"
di Revolut (tolto come prefisso ancorato, non come sottostringa, per non
mangiare "pagamento abbonamento"). Le liste stanno in `merchant-noise.js` e
crescono con ogni banca nuova.

**Errori delle Edge Function**: la funzione risponde con un CODICE
(`{"error":"ai_not_configured"}`), non con una frase. `supabase-js` pero' su
una risposta non-2xx NON guarda il corpo: alza un errore il cui `.message` e'
sempre "Edge Function returned a non-2xx status code" e mette la `Response` in
`.context`. Il codice vero si tira fuori con `functionErrorCode()` in
`src/lib/edgeError.js`, e si traduce con `errorText()` in
`src/i18n/errorText.js`. Chi scrive `error.message` mostra all'utente quella
frase fissa qualunque cosa sia successa: e' gia' successo una volta.

**Da fare quando l'utente li fornisce**: i secret nel Vault
(`PRICES_CRON_SECRET`, `PRICES_FUNCTION_URL`) e `COINGECKO_API_KEY` nei secret
della funzione; il provider di prezzi per azioni ed ETF, da scegliere sui suoi
ISIN reali (oggi `price_provider` ha solo `manual` e `coingecko`).

**Fase 5 — redesign della UI: fatta.** Linguaggio visivo istituzionale,
ispirato all'home banking di HSBC Hong Kong, applicato a tutte le schermate.
- **Token in due file**: `src/theme/primitives.css` tiene le scale che col tema
  non cambiano (tipografia, spaziature, raggi, altezze, movimento);
  `src/theme/tokens.css` tiene i colori, in tema chiaro e scuro. Il blocco di
  alias verso i nomi vecchi e' stato cancellato: non e' rimasto niente che lo
  usasse.
- **Tema chiaro di default**, scuro come secondo tema curato. Accento **rosso
  HSBC** (`#DB0011`). `--accent` e `--accent-fill` sono due token diversi:
  in tema scuro il rosso pieno non si legge come testo (2,97:1) ma regge
  benissimo il bianco sopra, quindi l'uno schiarisce e l'altro resta il rosso
  del marchio.
- `src/theme/contrast.test.js` verifica WCAG AA su ogni coppia testo/sfondo
  leggendo i token: la conformita' non e' un commento, e' un test che si rompe.
  L'unica soglia tolta e' quella sulla tonalita' fra accento e negativo: con un
  marchio rosso e le perdite rosse non e' rispettabile, e a separarli e' la
  forma (riempimento contro cifra col segno), non il colore. Sta scritto li'.
- Font **Inter** variabile, self-hosted (niente CDN di terzi): grottesca
  neutra, la piu' vicina con licenza aperta alle facce che le banche usano da
  sempre. Sostituisce Plus Jakarta Sans, che era geometrico e caratterizzato.
- `src/i18n/parity.test.js` verifica che i due dizionari abbiano le stesse
  chiavi e gli stessi segnaposto: prima era una convenzione in un commento.
- Libreria in `src/ui/`, con `ui.css` per gli stati che gli stili inline non
  sanno fare (`:hover`, `:focus-visible`, media query). Galleria in `/dev/ui`,
  montata solo in sviluppo e fuori dal bundle di produzione.
- Screenshot automatici: `node tools/screenshots.mjs`, in `docs/screenshots/`.
  Copre 14 schermate x 4 larghezze x 2 temi e segnala lo scroll orizzontale.

**Prossima: fase 6** — tasse, dashboard, rifinitura, offline, test.

## Fasi

1. Auth, profilo, onboarding, tema, i18n, guscio PWA ✅
2. Conti, transazioni, multivaluta, job FX giornaliero ✅
3. Import estratti conto, categorizzazione AI, revisione, regole ✅
4. Investimenti, allocazione, upload documenti e fatture ✅
5. Redesign della UI: design system, layout desktop, tutte le schermate ✅
6. Tasse, dashboard, rifinitura, offline, test
