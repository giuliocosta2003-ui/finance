-- phase3_imports
-- Import degli estratti conto: file caricato, righe in area di appoggio,
-- profili di mappatura per banca e regole sui commercianti.
--
-- Il principio dell'intera fase: fino alla conferma esplicita dell'utente
-- nulla entra in `transactions`. Le righe estratte vivono in `import_rows`,
-- dove si possono correggere, scartare e ricontrollare quante volte si vuole.

create extension if not exists pg_trgm with schema extensions;

create type public.import_file_type  as enum ('csv','xlsx','ofx','pdf');
create type public.import_status     as enum ('uploaded','parsing','review','committing','committed','rolled_back','failed');
create type public.import_parser     as enum ('csv','xlsx','ofx','pdf_text_ai','pdf_vision_ai');
create type public.balance_check     as enum ('ok','mismatch','not_available');
create type public.import_event      as enum ('uploaded','parsed','ai_extract','categorized','edited','committed','rolled_back','error');
create type public.category_source   as enum ('rule','history','ai','user','none');
create type public.confidence_level  as enum ('high','medium','low');
create type public.row_decision      as enum ('import','skip');
create type public.match_type        as enum ('exact','starts_with','contains');
create type public.rule_origin       as enum ('correction','manual');

-- `transactions` e `import_rows` diventano bersaglio di FK composte, quindi
-- serve la coppia unica (id, user_id) come gia' su accounts e categories.
alter table public.transactions add constraint transactions_id_user_key unique (id, user_id);

-- ── parser_profiles ──────────────────────────────────────────────────────────
-- La mappatura delle colonne di una banca si configura una volta sola:
-- `header_fingerprint` e' l'impronta dell'intestazione del file, e al secondo
-- estratto della stessa banca la schermata di mappatura non compare piu'.
create table public.parser_profiles (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name               text not null check (char_length(btrim(name)) between 1 and 80),
  header_fingerprint text not null,
  mapping            jsonb not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, header_fingerprint)
);
comment on column public.parser_profiles.mapping is
  'Colonna data e formato, importo unico o dare/avere, convenzione del segno, separatore decimale, encoding, righe da saltare, colonna del saldo.';
create trigger parser_profiles_updated_at before update on public.parser_profiles
for each row execute function public.set_updated_at();

-- ── imports ──────────────────────────────────────────────────────────────────
create table public.imports (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  account_id        uuid not null,
  storage_path      text not null,
  file_name         text not null,
  file_type         public.import_file_type not null,
  file_size         bigint,
  file_sha256       text,
  status            public.import_status not null default 'uploaded',
  parser            public.import_parser,
  parser_profile_id uuid,
  period_from       date,
  period_to         date,
  rows_total        integer not null default 0,
  rows_imported     integer not null default 0,
  rows_skipped      integer not null default 0,
  balance_check     public.balance_check not null default 'not_available',
  ai_input_tokens   integer not null default 0,
  ai_output_tokens  integer not null default 0,
  error             text,
  created_at        timestamptz not null default now(),
  committed_at      timestamptz,
  rolled_back_at    timestamptz,
  unique (id, user_id),
  constraint imports_account_fkey foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete cascade,
  constraint imports_profile_fkey foreign key (parser_profile_id, user_id)
    references public.parser_profiles (id, user_id) on delete set null (parser_profile_id)
);
-- Stesso file caricato due volte: si avvisa, non si blocca. Puo' capitare di
-- volerlo reimportare su un altro conto.
create index imports_user_sha_idx  on public.imports (user_id, file_sha256);
create index imports_user_date_idx on public.imports (user_id, created_at desc);

-- ── import_events ────────────────────────────────────────────────────────────
-- Diario di ogni import: si aggiunge soltanto. Nessun update e nessun delete
-- dal client, altrimenti non sarebbe un registro ma un appunto.
create table public.import_events (
  id        bigint generated always as identity primary key,
  import_id uuid not null,
  user_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  at        timestamptz not null default now(),
  event     public.import_event not null,
  detail    jsonb,
  constraint import_events_import_fkey foreign key (import_id, user_id)
    references public.imports (id, user_id) on delete cascade
);
create index import_events_import_idx on public.import_events (import_id, at);

-- ── import_rows ──────────────────────────────────────────────────────────────
create table public.import_rows (
  id                           uuid primary key default gen_random_uuid(),
  import_id                    uuid not null,
  user_id                      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  row_index                    integer not null,
  raw                          jsonb,
  booked_on                    date,
  description                  text,
  merchant                     text,
  amount_minor                 bigint,
  currency                     char(3) references public.currencies(code),
  balance_minor                bigint,
  kind                         public.transaction_kind,
  category_id                  uuid,
  category_source              public.category_source  not null default 'none',
  confidence                   public.confidence_level not null default 'low',
  flags                        text[] not null default '{}',
  decision                     public.row_decision not null default 'import',
  dedupe_hash                  text,
  matched_transaction_id       uuid,
  transfer_match_transaction_id uuid,
  transfer_match_row_id        uuid,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  unique (id, user_id),
  unique (import_id, row_index),
  constraint import_rows_import_fkey foreign key (import_id, user_id)
    references public.imports (id, user_id) on delete cascade,
  constraint import_rows_category_fkey foreign key (category_id, user_id)
    references public.categories (id, user_id) on delete set null (category_id),
  constraint import_rows_matched_fkey foreign key (matched_transaction_id, user_id)
    references public.transactions (id, user_id) on delete set null (matched_transaction_id),
  constraint import_rows_transfer_tx_fkey foreign key (transfer_match_transaction_id, user_id)
    references public.transactions (id, user_id) on delete set null (transfer_match_transaction_id),
  constraint import_rows_transfer_row_fkey foreign key (transfer_match_row_id, user_id)
    references public.import_rows (id, user_id) on delete set null (transfer_match_row_id),
  -- I flag sono un insieme chiuso: un valore scritto male non deve passare
  -- inosservato e poi sparire dai filtri della revisione.
  constraint import_rows_flags_valid check (
    flags <@ array['duplicate_exact','duplicate_probable','transfer_candidate',
                   'balance_mismatch','parse_warning','date_ambiguous','currency_mismatch']::text[]
  )
);
create index import_rows_import_idx on public.import_rows (import_id, row_index);
create index import_rows_dedupe_idx on public.import_rows (user_id, dedupe_hash) where dedupe_hash is not null;
create trigger import_rows_updated_at before update on public.import_rows
for each row execute function public.set_updated_at();

-- ── merchant_rules ───────────────────────────────────────────────────────────
-- Il `pattern` e' gia' normalizzato (stesso modulo del frontend). Niente
-- espressioni regolari scritte dall'utente: un pattern patologico bloccherebbe
-- il database, e tre modi di confronto coprono i casi veri.
create table public.merchant_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  pattern      text not null check (char_length(btrim(pattern)) between 1 and 200),
  match_type   public.match_type not null default 'exact',
  category_id  uuid not null,
  kind         public.transaction_kind,
  priority     integer not null default 100,
  hits         integer not null default 0,
  last_used_at timestamptz,
  created_from public.rule_origin not null default 'manual',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, pattern, match_type),
  constraint merchant_rules_category_fkey foreign key (category_id, user_id)
    references public.categories (id, user_id) on delete cascade
);
create index merchant_rules_user_idx on public.merchant_rules (user_id, priority desc, match_type);
create trigger merchant_rules_updated_at before update on public.merchant_rules
for each row execute function public.set_updated_at();

-- ── transactions: legame con l'import ────────────────────────────────────────
-- `restrict`: un import non si cancella finche' le sue transazioni esistono.
-- Prima si annulla l'import (rollback_import), poi lo si elimina.
alter table public.transactions
  add constraint transactions_import_fkey foreign key (import_id, user_id)
  references public.imports (id, user_id) on delete restrict;
create index transactions_import_idx on public.transactions (import_id, user_id) where import_id is not null;

-- Ricerca dei duplicati probabili: descrizioni simili, non identiche.
create index transactions_merchant_trgm_idx on public.transactions
  using gin (merchant extensions.gin_trgm_ops);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.parser_profiles enable row level security;
alter table public.parser_profiles force  row level security;
alter table public.imports         enable row level security;
alter table public.imports         force  row level security;
alter table public.import_events   enable row level security;
alter table public.import_events   force  row level security;
alter table public.import_rows     enable row level security;
alter table public.import_rows     force  row level security;
alter table public.merchant_rules  enable row level security;
alter table public.merchant_rules  force  row level security;

create policy parser_profiles_select_own on public.parser_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy parser_profiles_insert_own on public.parser_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy parser_profiles_update_own on public.parser_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy parser_profiles_delete_own on public.parser_profiles for delete to authenticated using (user_id = (select auth.uid()));

create policy imports_select_own on public.imports for select to authenticated using (user_id = (select auth.uid()));
create policy imports_insert_own on public.imports for insert to authenticated with check (user_id = (select auth.uid()));
create policy imports_update_own on public.imports for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy imports_delete_own on public.imports for delete to authenticated using (user_id = (select auth.uid()));

-- import_events: solo lettura e inserimento, per tutti (anche per l'utente).
create policy import_events_select_own on public.import_events for select to authenticated using (user_id = (select auth.uid()));
create policy import_events_insert_own on public.import_events for insert to authenticated with check (user_id = (select auth.uid()));

create policy import_rows_select_own on public.import_rows for select to authenticated using (user_id = (select auth.uid()));
create policy import_rows_insert_own on public.import_rows for insert to authenticated with check (user_id = (select auth.uid()));
create policy import_rows_update_own on public.import_rows for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy import_rows_delete_own on public.import_rows for delete to authenticated using (user_id = (select auth.uid()));

create policy merchant_rules_select_own on public.merchant_rules for select to authenticated using (user_id = (select auth.uid()));
create policy merchant_rules_insert_own on public.merchant_rules for insert to authenticated with check (user_id = (select auth.uid()));
create policy merchant_rules_update_own on public.merchant_rules for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy merchant_rules_delete_own on public.merchant_rules for delete to authenticated using (user_id = (select auth.uid()));

-- ── permessi per colonna: user_id non e' mai aggiornabile ────────────────────
revoke all on public.parser_profiles from anon, authenticated;
revoke all on public.imports         from anon, authenticated;
revoke all on public.import_events   from anon, authenticated;
revoke all on public.import_rows     from anon, authenticated;
revoke all on public.merchant_rules  from anon, authenticated;

grant select, insert, delete on public.parser_profiles to authenticated;
grant update (name, header_fingerprint, mapping) on public.parser_profiles to authenticated;

grant select, insert, delete on public.imports to authenticated;
grant update (account_id, storage_path, file_name, file_type, file_size, file_sha256, status,
              parser, parser_profile_id, period_from, period_to, rows_total, rows_imported,
              rows_skipped, balance_check, ai_input_tokens, ai_output_tokens, error,
              committed_at, rolled_back_at)
  on public.imports to authenticated;

grant select, insert on public.import_events to authenticated;

grant select, insert, delete on public.import_rows to authenticated;
grant update (row_index, raw, booked_on, description, merchant, amount_minor, currency,
              balance_minor, kind, category_id, category_source, confidence, flags, decision,
              dedupe_hash, matched_transaction_id, transfer_match_transaction_id, transfer_match_row_id)
  on public.import_rows to authenticated;

grant select, insert, delete on public.merchant_rules to authenticated;
grant update (pattern, match_type, category_id, kind, priority, hits, last_used_at, created_from)
  on public.merchant_rules to authenticated;
