-- phase2_transactions
-- Movimenti. L'importo e' SEMPRE nella valuta del conto: e' quello che muove
-- il saldo. L'eventuale importo estero originale (250.000 VND pagati con una
-- carta in EUR) e' un dato accessorio in original_amount_minor/original_currency.

create type public.transaction_kind as enum ('income','expense','transfer');

create table public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  account_id            uuid not null,
  booked_on             date not null,
  description           text,
  merchant              text,
  amount_minor          bigint not null check (amount_minor <> 0),
  currency              char(3) not null references public.currencies(code),
  kind                  public.transaction_kind not null,
  category_id           uuid,
  transfer_group_id     uuid,
  original_amount_minor bigint,
  original_currency     char(3) references public.currencies(code),
  fx_override_rate      numeric(28,12) check (fx_override_rate is null or fx_override_rate > 0),
  fx_override_note      text,
  import_id             uuid,           -- la FK verso imports arriva in fase 3
  dedupe_hash           text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Integrita' fra utenti: le FK sono COMPOSTE con user_id. La RLS nasconde le
  -- righe altrui, ma da sola non impedirebbe di agganciare una propria
  -- transazione al conto di un altro utente indovinandone l'UUID. Con queste
  -- FK il database lo rifiuta comunque.
  constraint transactions_account_fkey foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete cascade,
  constraint transactions_category_fkey foreign key (category_id, user_id)
    references public.categories (id, user_id) on delete set null (category_id),

  constraint transactions_sign check (
    (kind = 'income'   and amount_minor > 0) or
    (kind = 'expense'  and amount_minor < 0) or
    (kind = 'transfer')
  ),
  constraint transactions_transfer_has_no_category check (
    kind <> 'transfer' or category_id is null
  ),
  constraint transactions_original_pair check (
    (original_amount_minor is null) = (original_currency is null)
  )
);

create index transactions_user_date_idx    on public.transactions (user_id, booked_on desc);
create index transactions_account_date_idx on public.transactions (account_id, booked_on);
create index transactions_transfer_idx     on public.transactions (transfer_group_id)
  where transfer_group_id is not null;

create trigger transactions_updated_at before update on public.transactions
for each row execute function public.set_updated_at();

-- La valuta della transazione deve essere quella del conto. Non e' esprimibile
-- con un CHECK (serve leggere un'altra tabella), quindi trigger.
create or replace function public.transactions_check_currency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency char(3);
begin
  select a.currency into v_currency from public.accounts a where a.id = new.account_id;
  if v_currency is null then
    raise exception 'Conto inesistente';
  end if;
  if new.currency is distinct from v_currency then
    raise exception 'La valuta della transazione (%) deve essere quella del conto (%)', new.currency, v_currency;
  end if;
  return new;
end $$;

create trigger transactions_currency_matches_account
before insert or update of account_id, currency on public.transactions
for each row execute function public.transactions_check_currency();

-- Cambiare la valuta di un conto che ha gia' movimenti reinterpreterebbe tutti
-- gli importi gia' registrati: si blocca qui, non solo nella UI.
create or replace function public.accounts_block_currency_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.currency is distinct from old.currency
     and exists (select 1 from public.transactions t where t.account_id = old.id) then
    raise exception 'La valuta del conto non si puo'' cambiare: ci sono gia'' movimenti registrati';
  end if;
  return new;
end $$;

create trigger accounts_currency_locked
before update of currency on public.accounts
for each row execute function public.accounts_block_currency_change();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.transactions enable row level security;
alter table public.transactions force  row level security;

create policy transactions_select_own on public.transactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy transactions_insert_own on public.transactions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy transactions_update_own on public.transactions
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy transactions_delete_own on public.transactions
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.transactions from anon, authenticated;
grant select, insert, delete on public.transactions to authenticated;
grant update (account_id, booked_on, description, merchant, amount_minor, currency, kind,
              category_id, transfer_group_id, original_amount_minor, original_currency,
              fx_override_rate, fx_override_note, import_id, dedupe_hash, notes)
  on public.transactions to authenticated;

-- ── create_transfer() ────────────────────────────────────────────────────────
-- Un trasferimento sono due movimenti legati dallo stesso transfer_group_id,
-- scritti in un'unica transazione: o ci sono entrambi o non ce n'e' nessuno.
-- Gli importi sono due perche' fra conti in valute diverse l'uscita e l'entrata
-- non coincidono; entrambi si passano positivi, ai segni pensa la funzione.
create or replace function public.create_transfer(
  p_from_account      uuid,
  p_to_account        uuid,
  p_booked_on         date,
  p_from_amount_minor bigint,
  p_to_amount_minor   bigint,
  p_description       text default null,
  p_notes             text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_group    uuid := gen_random_uuid();
  v_from_cur char(3);
  v_to_cur   char(3);
begin
  if v_user is null then
    raise exception 'Serve un utente autenticato';
  end if;
  if p_from_account = p_to_account then
    raise exception 'Il conto di partenza e quello di arrivo devono essere diversi';
  end if;
  if p_from_amount_minor is null or p_from_amount_minor <= 0
     or p_to_amount_minor is null or p_to_amount_minor <= 0 then
    raise exception 'Gli importi di un trasferimento devono essere positivi';
  end if;

  -- La RLS filtra gia' i conti altrui: se una delle due select non trova nulla,
  -- il conto o non esiste o non e' dell'utente.
  select a.currency into v_from_cur from public.accounts a where a.id = p_from_account;
  select a.currency into v_to_cur   from public.accounts a where a.id = p_to_account;
  if v_from_cur is null or v_to_cur is null then
    raise exception 'Conto non trovato';
  end if;

  insert into public.transactions
    (user_id, account_id, booked_on, description, notes, amount_minor, currency, kind, transfer_group_id)
  values
    (v_user, p_from_account, p_booked_on, p_description, p_notes, -p_from_amount_minor, v_from_cur, 'transfer', v_group),
    (v_user, p_to_account,   p_booked_on, p_description, p_notes,  p_to_amount_minor,   v_to_cur,   'transfer', v_group);

  return v_group;
end $$;

revoke execute on function public.create_transfer(uuid, uuid, date, bigint, bigint, text, text) from public, anon;
grant   execute on function public.create_transfer(uuid, uuid, date, bigint, bigint, text, text) to authenticated;
