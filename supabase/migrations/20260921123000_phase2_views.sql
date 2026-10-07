-- phase2_views
-- Conversioni in valuta base. Il controvalore non si salda mai su disco: se
-- l'utente cambia valuta base, queste view danno subito i numeri giusti senza
-- ricalcolare niente.
-- `security_invoker = true`: la view legge con i diritti di chi interroga,
-- quindi valgono le policy RLS delle tabelle sotto.

-- ── transactions_converted ───────────────────────────────────────────────────
-- Tasso della DATA della transazione (i flussi si valutano quando accadono).
-- fx_status dice da dove arriva il numero: auto = tasso di mercato,
-- manual = tasso forzato dall'utente, missing = nessun tasso utilizzabile.
create view public.transactions_converted
with (security_invoker = true) as
select
  t.id,
  t.user_id,
  t.account_id,
  t.booked_on,
  t.description,
  t.merchant,
  t.amount_minor,
  t.currency,
  t.kind,
  t.category_id,
  t.transfer_group_id,
  t.original_amount_minor,
  t.original_currency,
  t.fx_override_rate,
  t.fx_override_note,
  t.import_id,
  t.dedupe_hash,
  t.notes,
  t.created_at,
  t.updated_at,
  p.base_currency,
  cf.minor_units as currency_minor_units,
  cb.minor_units as base_minor_units,
  coalesce(t.fx_override_rate, fx.rate) as fx_rate_used,
  case when t.fx_override_rate is null then fx.effective_date end as fx_rate_date,
  case
    when t.fx_override_rate is not null                     then 'manual'
    when p.base_currency is null or cb.minor_units is null  then 'missing'
    when fx.rate is null                                    then 'missing'
    else 'auto'
  end as fx_status,
  case
    when coalesce(t.fx_override_rate, fx.rate) is null or cb.minor_units is null then null
    else round(
           t.amount_minor::numeric
           / power(10::numeric, cf.minor_units)
           * coalesce(t.fx_override_rate, fx.rate)
           * power(10::numeric, cb.minor_units)
         )::bigint
  end as amount_base_minor
from public.transactions t
join public.profiles   p  on p.id   = t.user_id
join public.currencies cf on cf.code = t.currency
left join public.currencies cb on cb.code = p.base_currency
left join lateral public.fx_rate(t.currency, p.base_currency, t.booked_on) fx on true;

comment on view public.transactions_converted is
  'Transazioni con il controvalore in valuta base al tasso della data del movimento.';

-- ── account_balances ─────────────────────────────────────────────────────────
-- Saldo = saldo iniziale + somma dei movimenti, nella valuta del conto.
-- Il controvalore usa il tasso PIU' RECENTE, non quello storico: un saldo e'
-- una fotografia di oggi, mentre i flussi di transactions_converted restano al
-- tasso del giorno in cui sono avvenuti.
create view public.account_balances
with (security_invoker = true) as
select
  a.id   as account_id,
  a.user_id,
  a.name,
  a.type,
  a.currency,
  a.archived_at,
  a.opening_balance_minor,
  a.opening_balance_minor + coalesce(s.sum_minor, 0) as balance_minor,
  coalesce(s.tx_count, 0) as tx_count,
  p.base_currency,
  fx.rate           as fx_rate_used,
  fx.effective_date as fx_rate_date,
  case
    when fx.rate is null or cb.minor_units is null then null
    else round(
           (a.opening_balance_minor + coalesce(s.sum_minor, 0))::numeric
           / power(10::numeric, ca.minor_units)
           * fx.rate
           * power(10::numeric, cb.minor_units)
         )::bigint
  end as balance_base_minor
from public.accounts a
join public.profiles   p  on p.id   = a.user_id
join public.currencies ca on ca.code = a.currency
left join public.currencies cb on cb.code = p.base_currency
left join lateral (
  select sum(t.amount_minor) as sum_minor, count(*) as tx_count
  from public.transactions t
  where t.account_id = a.id
) s on true
left join lateral public.fx_rate(a.currency, p.base_currency, current_date) fx on true;

comment on view public.account_balances is
  'Saldo per conto, in valuta del conto e in valuta base al tasso piu'' recente.';

revoke all on public.transactions_converted from anon, authenticated;
revoke all on public.account_balances       from anon, authenticated;
grant select on public.transactions_converted to authenticated;
grant select on public.account_balances       to authenticated;
