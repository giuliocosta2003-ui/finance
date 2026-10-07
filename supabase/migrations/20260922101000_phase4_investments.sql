-- phase4_investments
-- Investimenti, lotti, prezzi e obiettivi di allocazione.
--
-- Due scelte di tipo che vale la pena spiegare subito:
--
-- * quantita' e prezzi sono NUMERIC, non minor units. E' l'unica eccezione
--   alla regola dei soldi interi, e vale solo qui: 0,00000001 BTC a
--   0,0000234 EUR sono numeri veri, e in minor units servirebbero decine di
--   cifre decimali inventate. Gli IMPORTI restano interi ovunque: le
--   commissioni sono `fees_minor`, e i controvalori escono in minor units.
-- * il controvalore non si salva, si calcola (regola di fase 2): cosi'
--   cambiare valuta base o correggere un tasso non richiede ricalcoli.

-- ── tipi ─────────────────────────────────────────────────────────────────────

create type public.asset_class as enum
  ('stock','etf','bond','crypto','real_estate','cash','other');

-- Solo i provider che esistono davvero oggi. Quello per le azioni e gli ETF
-- si aggiunge quando sara' scelto sui ticker veri dell'utente: e' una riga di
-- migrazione, mentre un valore di enum che non porta a nessun codice e' una
-- promessa che la UI mostrerebbe senza poterla mantenere.
create type public.price_provider as enum ('manual','coingecko');

create type public.lot_side     as enum ('buy','sell');
create type public.price_source as enum ('manual','provider');

create type public.allocation_dimension as enum ('asset_class','currency','holding');

-- Il metodo decide quale costo si scarica quando si vende, e quindi quanto
-- risulta realizzato. Cambia da paese a paese, percio' lo sceglie l'utente.
-- Default `lifo`: per titoli e cripto-attivita' l'art. 67 TUIR considera
-- cedute per prime le quote acquisite piu' di recente.
create type public.pnl_method as enum ('lifo','average','fifo');

alter table public.profiles
  add column pnl_method public.pnl_method not null default 'lifo';
grant update (pnl_method) on public.profiles to authenticated;

-- ── transactions: il nuovo tipo entra nei vincoli ────────────────────────────
-- Un acquisto ha importo negativo e una vendita positivo, ma il segno non e'
-- vincolato al tipo come per entrate e uscite: conta solo che non sia zero.
alter table public.transactions drop constraint transactions_sign;
alter table public.transactions add constraint transactions_sign check (
  (kind = 'income'  and amount_minor > 0) or
  (kind = 'expense' and amount_minor < 0) or
  (kind in ('transfer','investment'))
);

-- Niente categoria sui movimenti neutri. Un giroconto o un acquisto di titoli
-- con una categoria comparirebbe nei riepiloghi di spesa della fase 5 e
-- conterebbe due volte gli stessi soldi.
alter table public.transactions drop constraint transactions_transfer_has_no_category;
alter table public.transactions add constraint transactions_neutral_has_no_category check (
  kind not in ('transfer','investment') or category_id is null
);

-- ── holdings ─────────────────────────────────────────────────────────────────

create table public.holdings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  -- Il conto e' facoltativo: un immobile o un portafoglio presso un broker
  -- non censito qui non hanno un conto corrispondente nell'app.
  account_id     uuid,
  name           text not null check (length(btrim(name)) > 0),
  symbol         text,
  isin           char(12) check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  asset_class    public.asset_class not null,
  -- Valuta in cui l'investimento e' QUOTATO, non quella del conto: un ETF
  -- comprato in euro su Borsa Italiana puo' essere quotato in dollari.
  currency       char(3) not null references public.currencies(code),
  price_provider public.price_provider not null default 'manual',
  provider_ref   text,
  notes          text,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (id, user_id),
  constraint holdings_account_fkey foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete set null (account_id),
  -- Un provider senza riferimento non sa cosa chiedere: meglio rifiutarlo qui
  -- che scoprirlo ogni notte nel log del job prezzi.
  constraint holdings_provider_needs_ref check (
    price_provider = 'manual' or coalesce(btrim(provider_ref), '') <> ''
  )
);

comment on table public.holdings is
  'Un investimento. Immobili: quantita 1 e valutazione manuale. Liquidita: la quantita e l importo e il prezzo vale 1.';

create index holdings_user_idx     on public.holdings (user_id, archived_at);
create index holdings_account_idx  on public.holdings (account_id, user_id) where account_id is not null;
create index holdings_currency_idx on public.holdings (currency);
create index holdings_provider_idx on public.holdings (price_provider, provider_ref)
  where price_provider <> 'manual';

create trigger holdings_updated_at before update on public.holdings
for each row execute function public.set_updated_at();

-- ── holding_lots ─────────────────────────────────────────────────────────────

create table public.holding_lots (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  holding_id       uuid not null,
  side             public.lot_side not null,
  trade_date       date not null,
  quantity         numeric(38,18) not null check (quantity > 0),
  -- Nella valuta dell'investimento. Zero e' ammesso: le azioni gratuite di un
  -- piano aziendale o uno split registrato a mano hanno prezzo nullo.
  unit_price       numeric(28,10) not null check (unit_price >= 0),
  -- Commissioni in minor units della valuta dell'investimento: sono un
  -- importo di denaro, e gli importi restano interi.
  fees_minor       bigint not null default 0 check (fees_minor >= 0),
  fx_override_rate numeric(28,12) check (fx_override_rate is null or fx_override_rate > 0),
  -- Il movimento con cui e' stato pagato, se registrato.
  transaction_id   uuid,
  -- La FK verso documents arriva nella migrazione successiva.
  document_id      uuid,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (id, user_id),
  constraint holding_lots_holding_fkey foreign key (holding_id, user_id)
    references public.holdings (id, user_id) on delete cascade,
  constraint holding_lots_transaction_fkey foreign key (transaction_id, user_id)
    references public.transactions (id, user_id) on delete set null (transaction_id)
);

create index holding_lots_holding_idx     on public.holding_lots (holding_id, trade_date);
create index holding_lots_holding_user_idx on public.holding_lots (holding_id, user_id);
create index holding_lots_user_idx        on public.holding_lots (user_id, trade_date desc);
create index holding_lots_transaction_idx on public.holding_lots (transaction_id, user_id)
  where transaction_id is not null;

create trigger holding_lots_updated_at before update on public.holding_lots
for each row execute function public.set_updated_at();

/*
 * La giacenza non puo' mai diventare negativa, a nessuna data.
 *
 * Non basta controllare la singola vendita: inserire una vendita in mezzo alla
 * storia puo' rendere impossibile una vendita gia' registrata piu' avanti. Si
 * ricalcola quindi il progressivo su tutte le date e si guarda il minimo.
 *
 * E' un trigger AFTER perche' deve vedere la riga appena scritta, e prende un
 * advisory lock per investimento: due vendite inviate insieme vedrebbero
 * entrambe la stessa giacenza e passerebbero entrambe.
 */
create or replace function public.holding_lots_check_balance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_holding uuid := coalesce(new.holding_id, old.holding_id);
  v_min     numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_holding::text, 0::bigint));

  select min(s.running) into v_min
  from (
    select sum(case when l.side = 'buy' then l.quantity else -l.quantity end)
           over (order by l.trade_date, l.created_at, l.id) as running
    from public.holding_lots l
    where l.holding_id = v_holding
  ) s;

  if v_min is not null and v_min < 0 then
    raise exception 'Non si puo'' vendere piu'' di quanto se ne possiede: la giacenza diventerebbe negativa';
  end if;
  return null;
end $$;

create trigger holding_lots_balance_non_negative
after insert or update or delete on public.holding_lots
for each row execute function public.holding_lots_check_balance();

-- ── asset_prices ─────────────────────────────────────────────────────────────

create table public.asset_prices (
  holding_id uuid not null,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  price_date date not null,
  price      numeric(28,10) not null check (price > 0),
  source     public.price_source not null,
  fetched_at timestamptz not null default now(),

  primary key (holding_id, price_date),
  constraint asset_prices_holding_fkey foreign key (holding_id, user_id)
    references public.holdings (id, user_id) on delete cascade
);

comment on table public.asset_prices is
  'Un prezzo per investimento e per giorno. Il prezzo scritto a mano batte sempre quello del provider.';

create index asset_prices_holding_user_idx on public.asset_prices (holding_id, user_id);
create index asset_prices_user_idx         on public.asset_prices (user_id, price_date desc);

/*
 * Il prezzo messo a mano dall'utente non viene mai sostituito da quello del
 * provider. Il job usa `on conflict do nothing` e non arriva nemmeno qui; il
 * trigger c'e' perche' una promessa fatta all'utente non deve dipendere dal
 * fatto che chi scrive il job si ricordi di una clausola.
 */
create or replace function public.asset_prices_protect_manual()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.source = 'manual' and new.source = 'provider' then
    raise exception 'Un prezzo inserito a mano non viene sostituito da quello del provider';
  end if;
  return new;
end $$;

create trigger asset_prices_manual_wins
before update on public.asset_prices
for each row execute function public.asset_prices_protect_manual();

-- ── target_allocations ───────────────────────────────────────────────────────

create table public.target_allocations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  dimension     public.allocation_dimension not null,
  -- Il valore della dimensione: il nome della classe, il codice valuta, o
  -- l'id dell'investimento. Testo libero perche' le tre cose hanno tipi
  -- diversi, e una FK verso una sola di esse non varrebbe per le altre.
  key           text not null check (length(btrim(key)) > 0),
  target_pct    numeric(5,2) not null check (target_pct >= 0 and target_pct <= 100),
  tolerance_pct numeric(5,2) not null default 5 check (tolerance_pct >= 0 and tolerance_pct <= 100),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (user_id, dimension, key)
);

comment on table public.target_allocations is
  'Obiettivi di allocazione. Se la somma per dimensione non fa 100 la UI avvisa, senza bloccare: un obiettivo parziale e legittimo.';

create trigger target_allocations_updated_at before update on public.target_allocations
for each row execute function public.set_updated_at();

-- ── price_fetch_log ──────────────────────────────────────────────────────────
-- Stesso trattamento di fx_fetch_log: nessuna policy, lo legge la service role.

create table public.price_fetch_log (
  id           bigint generated always as identity primary key,
  ran_at       timestamptz not null default now(),
  provider     text,
  outcome      text not null check (outcome in ('ok','empty','error','skipped','partial')),
  prices_saved integer not null default 0,
  holdings     integer not null default 0,
  error        text
);
comment on table public.price_fetch_log is 'Diario del job prezzi. Nessuna policy: lo legge solo la service role.';
create index price_fetch_log_ran_at_idx on public.price_fetch_log (ran_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.holdings           enable row level security;
alter table public.holdings           force  row level security;
alter table public.holding_lots       enable row level security;
alter table public.holding_lots       force  row level security;
alter table public.asset_prices       enable row level security;
alter table public.asset_prices       force  row level security;
alter table public.target_allocations enable row level security;
alter table public.target_allocations force  row level security;
alter table public.price_fetch_log    enable row level security;

create policy holdings_select_own on public.holdings
  for select to authenticated using (user_id = (select auth.uid()));
create policy holdings_insert_own on public.holdings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy holdings_update_own on public.holdings
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy holdings_delete_own on public.holdings
  for delete to authenticated using (user_id = (select auth.uid()));

create policy holding_lots_select_own on public.holding_lots
  for select to authenticated using (user_id = (select auth.uid()));
create policy holding_lots_insert_own on public.holding_lots
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy holding_lots_update_own on public.holding_lots
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy holding_lots_delete_own on public.holding_lots
  for delete to authenticated using (user_id = (select auth.uid()));

create policy asset_prices_select_own on public.asset_prices
  for select to authenticated using (user_id = (select auth.uid()));
create policy asset_prices_insert_own on public.asset_prices
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy asset_prices_update_own on public.asset_prices
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy asset_prices_delete_own on public.asset_prices
  for delete to authenticated using (user_id = (select auth.uid()));

create policy target_allocations_select_own on public.target_allocations
  for select to authenticated using (user_id = (select auth.uid()));
create policy target_allocations_insert_own on public.target_allocations
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy target_allocations_update_own on public.target_allocations
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy target_allocations_delete_own on public.target_allocations
  for delete to authenticated using (user_id = (select auth.uid()));

-- ── permessi ─────────────────────────────────────────────────────────────────
-- `user_id` resta fuori dai GRANT di UPDATE: la RLS impedisce di leggere le
-- righe altrui, il permesso per colonna impedisce di regalare le proprie.

revoke all on public.holdings           from anon, authenticated;
revoke all on public.holding_lots       from anon, authenticated;
revoke all on public.asset_prices       from anon, authenticated;
revoke all on public.target_allocations from anon, authenticated;
revoke all on public.price_fetch_log    from anon, authenticated;

grant select, insert, delete on public.holdings to authenticated;
grant update (account_id, name, symbol, isin, asset_class, currency,
              price_provider, provider_ref, notes, archived_at)
  on public.holdings to authenticated;

grant select, insert, delete on public.holding_lots to authenticated;
grant update (holding_id, side, trade_date, quantity, unit_price, fees_minor,
              fx_override_rate, transaction_id, document_id, notes)
  on public.holding_lots to authenticated;

grant select, insert, delete on public.asset_prices to authenticated;
grant update (price, source, fetched_at) on public.asset_prices to authenticated;

grant select, insert, delete on public.target_allocations to authenticated;
grant update (dimension, key, target_pct, tolerance_pct)
  on public.target_allocations to authenticated;
