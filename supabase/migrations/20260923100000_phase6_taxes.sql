-- phase6_taxes
-- Tasse: voci d'imposta, periodi generati e pagamenti. L'app fa ARITMETICA e
-- tiene il CALENDARIO; non conosce nessuna regola fiscale di nessun paese.
-- Aliquote, coefficienti, soglie, scadenze: li definisce l'utente, sempre.
-- Qui dentro non c'e' un solo numero fiscale, nemmeno come default d'esempio.
--
-- Tutti gli importi delle tasse sono in MINOR UNITS della VALUTA BASE del
-- profilo: imponibile, dovuto e pagamenti si sommano fra loro e si confrontano
-- col conto di accantonamento, e devono stare tutti nella stessa valuta. La
-- conversione dei movimenti in valuta base avviene al tasso della loro data
-- (come in transactions_converted). Un importo FISSO in valuta diversa dalla
-- base si converte al tasso della fine del periodo, dentro le funzioni.

-- ── enum ───────────────────────────────────────────────────────────────────
create type public.tax_base_type    as enum ('gross_income','net_profit','vat_balance','fixed');
create type public.tax_frequency     as enum ('monthly','quarterly','yearly','one_off');
create type public.tax_basis         as enum ('cash','accrual');
create type public.tax_period_status as enum ('projected','due','partially_paid','paid','skipped');

-- ── profilo: anno fiscale e conto di accantonamento ─────────────────────────
-- L'anno fiscale non parte per forza a gennaio: e' un parametro, non un dato di
-- legge. Il conto di accantonamento e' facoltativo; se c'e', la schermata Tasse
-- confronta il suo saldo con quanto dovrebbe esserci.
alter table public.profiles
  add column fiscal_year_start_month smallint not null default 1
    check (fiscal_year_start_month between 1 and 12),
  add column tax_set_aside_account_id uuid;

-- FK composta con l'id del profilo (che E' lo user_id): il conto deve essere
-- dell'utente. La RLS nasconde, la FK impedisce di puntare al conto altrui.
alter table public.profiles
  add constraint profiles_set_aside_account_fkey
    foreign key (tax_set_aside_account_id, id)
    references public.accounts (id, user_id)
    on delete set null (tax_set_aside_account_id);

grant update (fiscal_year_start_month, tax_set_aside_account_id)
  on public.profiles to authenticated;

-- ── tax_items ────────────────────────────────────────────────────────────────
-- Una voce d'imposta e' una regola di calcolo definita dall'utente: su quale
-- base, con quale aliquota o importo fisso, con quale cadenza, su quali conti e
-- categorie, e con quale regola di scadenza.
create table public.tax_items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 80),
  active            boolean not null default true,
  notes             text,

  base_type         public.tax_base_type not null,
  -- Aliquota e coefficiente sono percentuali INSERITE dall'utente. Il
  -- coefficiente serve quando l'imponibile e' una parte dei ricavi: resta un
  -- numero suo, l'app non lo conosce.
  rate_pct          numeric(6,3) check (rate_pct is null or rate_pct >= 0),
  coefficient_pct   numeric(6,3) check (coefficient_pct is null or coefficient_pct >= 0),
  fixed_amount_minor bigint      check (fixed_amount_minor is null or fixed_amount_minor >= 0),
  currency          char(3) references public.currencies(code),

  frequency         public.tax_frequency not null,
  -- Competenza o cassa: default cassa, ma si sceglie per ogni voce.
  basis             public.tax_basis not null default 'cash',

  -- Filtri di calcolo. null = tutte/tutti.
  business_only     boolean not null default true,
  category_ids      uuid[],
  account_ids       uuid[],

  -- Regola di scadenza: mesi di sfasamento dopo la fine del periodo e giorno
  -- del mese. {"month_offset": 1, "day": 16} = un mese dopo la fine, il 16.
  -- E' STRUTTURA, non una scadenza precompilata: i numeri li mette l'utente.
  due_rule          jsonb not null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (id, user_id),

  -- fixed vuole l'importo e la sua valuta; gli altri vogliono l'aliquota.
  constraint tax_items_amounts check (
    (base_type = 'fixed'
       and fixed_amount_minor is not null and currency is not null and rate_pct is null)
    or
    (base_type <> 'fixed' and rate_pct is not null)
  ),
  -- La regola di scadenza deve avere la forma giusta, senza fissare NESSUNA
  -- data: solo che lo sfasamento e il giorno siano numeri sensati.
  constraint tax_items_due_rule_shape check (
    jsonb_typeof(due_rule -> 'month_offset') = 'number'
    and jsonb_typeof(due_rule -> 'day') = 'number'
    and (due_rule ->> 'month_offset')::int between 0 and 24
    and (due_rule ->> 'day')::int between 1 and 31
  )
);
comment on table public.tax_items is
  'Voci d''imposta definite dall''utente. Nessuna regola fiscale e'' cablata: base, aliquota, coefficiente, cadenza e scadenza sono tutti suoi.';

create index tax_items_user_idx on public.tax_items (user_id, active);

create trigger tax_items_updated_at before update on public.tax_items
for each row execute function public.set_updated_at();

-- ── tax_periods ──────────────────────────────────────────────────────────────
-- I periodi di una voce, generati dalla cadenza. base_minor e amount_due_minor
-- li calcola il cron; un periodo pagato non si ricalcola mai.
create table public.tax_periods (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  tax_item_id      uuid not null,

  period_start     date not null,
  period_end       date not null,
  due_date         date not null,

  base_minor       bigint,        -- imponibile in valuta base
  amount_due_minor bigint,        -- dovuto in valuta base
  computed_at      timestamptz,

  status           public.tax_period_status not null default 'projected',
  -- Se l'imponibile cambia DOPO che il periodo e' stato pagato, non si
  -- ricalcola l'importo (sarebbe riscrivere la storia), ma lo si segnala.
  base_changed_after_payment boolean not null default false,
  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (tax_item_id, period_start),
  unique (id, user_id),
  constraint tax_periods_item_fkey foreign key (tax_item_id, user_id)
    references public.tax_items (id, user_id) on delete cascade,
  constraint tax_periods_dates check (period_end >= period_start)
);
comment on table public.tax_periods is
  'Periodi di una voce d''imposta. Un periodo pagato non si ricalcola: se la base cambia dopo, si alza base_changed_after_payment.';

create index tax_periods_item_idx on public.tax_periods (tax_item_id, period_start);
create index tax_periods_due_idx  on public.tax_periods (user_id, due_date) where status <> 'paid';

create trigger tax_periods_updated_at before update on public.tax_periods
for each row execute function public.set_updated_at();

-- ── tax_payments ─────────────────────────────────────────────────────────────
-- I pagamenti, anche parziali (che sono la norma). Il collegamento a una
-- transazione e' facoltativo: si puo' registrare l'importo e basta.
create table public.tax_payments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  tax_period_id  uuid not null,
  transaction_id uuid,
  amount_minor   bigint not null check (amount_minor > 0),  -- in valuta base
  paid_on        date not null,
  notes          text,
  created_at     timestamptz not null default now(),

  constraint tax_payments_period_fkey foreign key (tax_period_id, user_id)
    references public.tax_periods (id, user_id) on delete cascade,
  constraint tax_payments_transaction_fkey foreign key (transaction_id, user_id)
    references public.transactions (id, user_id) on delete set null (transaction_id)
);
comment on table public.tax_payments is
  'Pagamenti di un periodo d''imposta, in valuta base. Parziali ammessi; il collegamento a una transazione e'' facoltativo.';

create index tax_payments_period_idx on public.tax_payments (tax_period_id);
create index tax_payments_tx_idx     on public.tax_payments (transaction_id, user_id) where transaction_id is not null;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.tax_items    enable row level security;
alter table public.tax_items    force  row level security;
alter table public.tax_periods  enable row level security;
alter table public.tax_periods  force  row level security;
alter table public.tax_payments enable row level security;
alter table public.tax_payments force  row level security;

create policy tax_items_select_own on public.tax_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy tax_items_insert_own on public.tax_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy tax_items_update_own on public.tax_items
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy tax_items_delete_own on public.tax_items
  for delete to authenticated using (user_id = (select auth.uid()));

create policy tax_periods_select_own on public.tax_periods
  for select to authenticated using (user_id = (select auth.uid()));
create policy tax_periods_insert_own on public.tax_periods
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy tax_periods_update_own on public.tax_periods
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy tax_periods_delete_own on public.tax_periods
  for delete to authenticated using (user_id = (select auth.uid()));

create policy tax_payments_select_own on public.tax_payments
  for select to authenticated using (user_id = (select auth.uid()));
create policy tax_payments_insert_own on public.tax_payments
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy tax_payments_update_own on public.tax_payments
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy tax_payments_delete_own on public.tax_payments
  for delete to authenticated using (user_id = (select auth.uid()));

-- ── grant (user_id mai in UPDATE) ────────────────────────────────────────────
revoke all on public.tax_items    from anon, authenticated;
revoke all on public.tax_periods  from anon, authenticated;
revoke all on public.tax_payments from anon, authenticated;

grant select, insert, delete on public.tax_items to authenticated;
grant update (name, active, notes, base_type, rate_pct, coefficient_pct,
              fixed_amount_minor, currency, frequency, basis, business_only,
              category_ids, account_ids, due_rule)
  on public.tax_items to authenticated;

grant select, insert, delete on public.tax_periods to authenticated;
-- L'utente puo' saltare un periodo o annotarlo; base_minor, amount_due_minor,
-- computed_at, status e il flag li muovono le funzioni di calcolo, ma la scelta
-- di segnare "skipped" e' sua, quindi status resta aggiornabile.
grant update (status, notes) on public.tax_periods to authenticated;

grant select, insert, delete on public.tax_payments to authenticated;
grant update (transaction_id, amount_minor, paid_on, notes)
  on public.tax_payments to authenticated;
