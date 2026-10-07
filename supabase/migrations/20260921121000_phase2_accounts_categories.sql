-- phase2_accounts_categories
-- Conti e categorie dell'utente, piu' il seed delle categorie predefinite.

create type public.account_type  as enum ('checking','savings','cash','credit_card','e_wallet','broker','other');
create type public.category_kind as enum ('income','expense');

-- ── accounts ─────────────────────────────────────────────────────────────────
-- `unique (id, user_id)` sembra ridondante (id e' gia' PK) ma serve: e' il
-- bersaglio della FK composta di transactions, che e' cio' che impedisce di
-- agganciare una transazione al conto di un altro utente.
create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name                  text not null check (char_length(btrim(name)) between 1 and 80),
  type                  public.account_type not null,
  currency              char(3) not null references public.currencies(code),
  opening_balance_minor bigint not null default 0,
  opening_date          date,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, user_id)
);
comment on table public.accounts is 'Conti dell''utente. La valuta del conto e'' quella in cui si registrano i suoi movimenti.';
create index accounts_user_idx on public.accounts (user_id);
create trigger accounts_updated_at before update on public.accounts
for each row execute function public.set_updated_at();

-- ── categories ───────────────────────────────────────────────────────────────
-- `key` identifica una categoria predefinita e la UI la traduce; `name` e'
-- nullo finche' l'utente non la rinomina, e da quel momento vince sul nome
-- tradotto. Le categorie create dall'utente hanno key nulla e name valorizzato.
-- Il trasferimento non e' una categoria: e' un kind di transazione.
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  parent_id   uuid,
  key         text,
  name        text check (name is null or char_length(btrim(name)) between 1 and 60),
  kind        public.category_kind not null,
  is_business boolean not null default false,
  sort_order  integer not null default 100,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, key),
  constraint categories_key_or_name check (key is not null or name is not null),
  constraint categories_parent_fkey foreign key (parent_id, user_id)
    references public.categories (id, user_id) on delete set null
);
create index categories_user_idx on public.categories (user_id, kind, sort_order);
create trigger categories_updated_at before update on public.categories
for each row execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Una policy per operazione, sempre sulla stessa condizione. `(select auth.uid())`
-- invece di auth.uid() perche' cosi' Postgres lo valuta una volta sola invece
-- che riga per riga.
alter table public.accounts   enable row level security;
alter table public.accounts   force  row level security;
alter table public.categories enable row level security;
alter table public.categories force  row level security;

create policy accounts_select_own on public.accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy accounts_insert_own on public.accounts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy accounts_update_own on public.accounts
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy accounts_delete_own on public.accounts
  for delete to authenticated using (user_id = (select auth.uid()));

create policy categories_select_own on public.categories
  for select to authenticated using (user_id = (select auth.uid()));
create policy categories_insert_own on public.categories
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy categories_update_own on public.categories
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy categories_delete_own on public.categories
  for delete to authenticated using (user_id = (select auth.uid()));

-- user_id fuori dai GRANT di UPDATE: cosi' non e' proprio aggiornabile, e non
-- si dipende solo dal with check della policy.
revoke all on public.accounts   from anon, authenticated;
revoke all on public.categories from anon, authenticated;
grant select, insert, delete on public.accounts to authenticated;
grant update (name, type, currency, opening_balance_minor, opening_date, archived_at)
  on public.accounts to authenticated;
grant select, insert, delete on public.categories to authenticated;
grant update (parent_id, name, kind, is_business, sort_order, archived_at)
  on public.categories to authenticated;

-- ── seed_default_categories() ────────────────────────────────────────────────
-- Crea le categorie predefinite adatte al profile_type dell'utente.
-- Idempotente: `on conflict (user_id, key) do nothing`, quindi richiamarla dopo
-- un cambio di profilo aggiunge solo le mancanti e non tocca ne' cancella nulla
-- di quello che l'utente ha gia' rinominato o archiviato.
-- security invoker: scrive con i diritti del chiamante, quindi la RLS vale.
create or replace function public.seed_default_categories()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_type  public.profile_type;
  v_count integer;
begin
  if v_user is null then
    raise exception 'seed_default_categories richiede un utente autenticato';
  end if;

  select p.profile_type into v_type from public.profiles p where p.id = v_user;

  with defaults (key, kind, is_business, only_for, sort_order) as (
    values
      -- comuni a tutti i profili
      ('other_income',        'income'::public.category_kind,  false, null::text,     90),
      ('gifts_received',      'income'::public.category_kind,  false, null::text,     80),
      ('groceries',           'expense'::public.category_kind, false, null::text,     10),
      ('eating_out',          'expense'::public.category_kind, false, null::text,     20),
      ('transport',           'expense'::public.category_kind, false, null::text,     30),
      ('rent',                'expense'::public.category_kind, false, null::text,     40),
      ('utilities',           'expense'::public.category_kind, false, null::text,     50),
      ('health',              'expense'::public.category_kind, false, null::text,     60),
      ('shopping',            'expense'::public.category_kind, false, null::text,     70),
      ('entertainment',       'expense'::public.category_kind, false, null::text,     80),
      ('travel',              'expense'::public.category_kind, false, null::text,     90),
      ('subscriptions',       'expense'::public.category_kind, false, null::text,    100),
      ('bank_fees',           'expense'::public.category_kind, false, null::text,    110),
      ('gifts_given',         'expense'::public.category_kind, false, null::text,    120),
      ('other_expense',       'expense'::public.category_kind, false, null::text,    900),
      -- studente
      ('scholarship',         'income'::public.category_kind,  false, 'student',      10),
      ('allowance',           'income'::public.category_kind,  false, 'student',      20),
      ('part_time_job',       'income'::public.category_kind,  false, 'student',      30),
      ('tuition',             'expense'::public.category_kind, false, 'student',       5),
      ('books_supplies',      'expense'::public.category_kind, false, 'student',       6),
      -- lavoro dipendente
      ('salary',              'income'::public.category_kind,  false, 'employee',     10),
      ('bonus',               'income'::public.category_kind,  false, 'employee',     20),
      ('expense_refund',      'income'::public.category_kind,  false, 'employee',     30),
      ('commuting',           'expense'::public.category_kind, false, 'employee',     31),
      -- lavoro autonomo o impresa
      ('business_revenue',    'income'::public.category_kind,  true,  'entrepreneur', 10),
      ('interest_income',     'income'::public.category_kind,  false, 'entrepreneur', 20),
      ('business_software',   'expense'::public.category_kind, true,  'entrepreneur',  5),
      ('business_services',   'expense'::public.category_kind, true,  'entrepreneur',  6),
      ('business_marketing',  'expense'::public.category_kind, true,  'entrepreneur',  7),
      ('business_travel',     'expense'::public.category_kind, true,  'entrepreneur',  8),
      ('business_office',     'expense'::public.category_kind, true,  'entrepreneur',  9),
      ('accountant_fees',     'expense'::public.category_kind, true,  'entrepreneur', 11),
      ('social_contributions','expense'::public.category_kind, true,  'entrepreneur', 12),
      ('income_tax',          'expense'::public.category_kind, true,  'entrepreneur', 13),
      ('vat_payment',         'expense'::public.category_kind, true,  'entrepreneur', 14)
  )
  insert into public.categories (user_id, key, kind, is_business, sort_order)
  select v_user, d.key, d.kind, d.is_business, d.sort_order
  from defaults d
  where d.only_for is null or d.only_for = v_type::text
  on conflict (user_id, key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.seed_default_categories() from public, anon;
grant   execute on function public.seed_default_categories() to authenticated;
