-- phase6_tax_functions
-- Calcoli delle tasse. L'app fa ARITMETICA: prende la base che l'utente ha
-- descritto (quali movimenti, quali fatture), la moltiplica per il coefficiente
-- e l'aliquota che l'utente ha inserito, e tiene il calendario delle scadenze
-- secondo la regola che l'utente ha scritto. Nessun numero fiscale e' cablato.
--
-- Perche' queste funzioni sono security DEFINER (di solito il progetto usa
-- invoker): devono (1) scrivere le colonne calcolate di tax_periods, che sono
-- di proposito FUORI dai GRANT di UPDATE dell'utente (cosi' nessuno puo'
-- falsare a mano un importo dovuto), e (2) essere ricalcolabili da un cron
-- giornaliero, dove auth.uid() e' null. Per non perdere l'isolamento, OGNI
-- funzione filtra ESPLICITAMENTE per user_id e AUTORIZZA il chiamante: se
-- auth.uid() e' presente e non e' il proprietario della voce, alza 'forbidden'.
-- Le funzioni di sola LETTURA verso la UI restano invoker e si appoggiano alla
-- RLS. I helper interni (_prefissati) non sono concessi a nessun ruolo client.
--
-- Tutti gli importi sono in minor units della valuta BASE del profilo. Le
-- conversioni usano il tasso della data giusta: la data del movimento per i
-- flussi (via transactions_converted), la data del documento (competenza) o del
-- pagamento (cassa) per le fatture, la fine del periodo per gli importi fissi.

-- ── helper: fine anno fiscale su/prima di una data ──────────────────────────
create or replace function public._fy_start(p_d date, p_fysm int)
returns date language sql immutable set search_path = '' as $$
  select make_date(
    extract(year from p_d)::int - case when extract(month from p_d)::int < p_fysm then 1 else 0 end,
    p_fysm, 1);
$$;

-- ── helper: data di scadenza dalla due_rule ─────────────────────────────────
-- period_end + month_offset mesi, poi il giorno indicato (troncato all'ultimo
-- giorno del mese). Nessuno spostamento per weekend o festivi: la scadenza e'
-- ESATTAMENTE quella che dice la regola dell'utente, e questa scelta e'
-- dichiarata anche nella UI. Spostarla vorrebbe dire conoscere i giorni non
-- lavorativi di un paese, cioe' una regola che qui non deve esistere.
create or replace function public._due_date(p_period_end date, p_rule jsonb)
returns date language plpgsql immutable set search_path = '' as $$
declare
  v_off int := (p_rule ->> 'month_offset')::int;
  v_day int := (p_rule ->> 'day')::int;
  v_m   date;
  v_dim int;
begin
  v_m := (date_trunc('month', p_period_end) + (v_off || ' months')::interval)::date;
  v_dim := extract(day from (date_trunc('month', v_m) + interval '1 month - 1 day'))::int;
  return make_date(extract(year from v_m)::int, extract(month from v_m)::int, least(v_day, v_dim));
end $$;

-- ── helper: converte un importo in valuta base al tasso di una data ─────────
create or replace function public._to_base_minor(
  p_amount_minor bigint, p_from char(3), p_base char(3), p_base_units int, p_on date)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_from_units int; v_rate numeric;
begin
  if p_amount_minor is null or p_base is null then return null; end if;
  select minor_units into v_from_units from public.currencies where code = p_from;
  if v_from_units is null then return null; end if;
  if p_from = p_base then
    v_rate := 1;
  else
    select rate into v_rate from public.fx_rate(p_from, p_base, p_on);
  end if;
  if v_rate is null then return null; end if;
  return round(
    p_amount_minor::numeric / power(10::numeric, v_from_units)
    * v_rate * power(10::numeric, p_base_units)
  )::bigint;
end $$;

-- ── nucleo: la base imponibile in valuta base ───────────────────────────────
create or replace function public._tax_base_core(
  p_user_id uuid, p_base_type public.tax_base_type, p_business_only boolean,
  p_category_ids uuid[], p_account_ids uuid[], p_basis public.tax_basis,
  p_from date, p_to date)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_base char(3); v_units int; v bigint;
begin
  select base_currency into v_base from public.profiles where id = p_user_id;
  if v_base is null then return 0; end if;
  select minor_units into v_units from public.currencies where code = v_base;

  if p_base_type = 'gross_income' then
    if p_basis = 'cash' then
      select coalesce(sum(tc.amount_base_minor), 0) into v
      from public.transactions_converted tc
      where tc.user_id = p_user_id and tc.kind = 'income'
        and tc.booked_on between p_from and p_to and tc.amount_base_minor is not null
        and (p_account_ids is null or tc.account_id = any(p_account_ids))
        and (p_category_ids is null or tc.category_id = any(p_category_ids))
        and (not p_business_only or exists (
              select 1 from public.categories c where c.id = tc.category_id and c.business));
    else
      select coalesce(sum(public._to_base_minor(d.total_minor, d.currency, v_base, v_units, d.doc_date)), 0) into v
      from public.documents d
      where d.user_id = p_user_id and d.kind = 'invoice_issued'
        and d.doc_date between p_from and p_to and d.total_minor is not null;
    end if;
    return v;

  elsif p_base_type = 'net_profit' then
    if p_basis = 'cash' then
      select coalesce(sum(tc.amount_base_minor), 0) into v
      from public.transactions_converted tc
      where tc.user_id = p_user_id and tc.kind in ('income','expense')
        and tc.booked_on between p_from and p_to and tc.amount_base_minor is not null
        and (p_account_ids is null or tc.account_id = any(p_account_ids))
        and (p_category_ids is null or tc.category_id = any(p_category_ids))
        and (not p_business_only or exists (
              select 1 from public.categories c where c.id = tc.category_id and c.business));
    else
      select coalesce(sum(
        case d.kind
          when 'invoice_issued'   then  public._to_base_minor(d.total_minor, d.currency, v_base, v_units, d.doc_date)
          when 'invoice_received' then -public._to_base_minor(d.total_minor, d.currency, v_base, v_units, d.doc_date)
        end), 0) into v
      from public.documents d
      where d.user_id = p_user_id and d.kind in ('invoice_issued','invoice_received')
        and d.doc_date between p_from and p_to and d.total_minor is not null;
    end if;
    return v;

  elsif p_base_type = 'vat_balance' then
    if p_basis = 'accrual' then
      -- competenza: per data documento.
      select coalesce(sum(
        case d.kind
          when 'invoice_issued'   then  public._to_base_minor(d.tax_minor, d.currency, v_base, v_units, d.doc_date)
          when 'invoice_received' then -public._to_base_minor(d.tax_minor, d.currency, v_base, v_units, d.doc_date)
        end), 0) into v
      from public.documents d
      where d.user_id = p_user_id and d.kind in ('invoice_issued','invoice_received')
        and d.doc_date between p_from and p_to and d.tax_minor is not null;
    else
      -- cassa: per data del pagamento, cioe' la data della transazione
      -- collegata al documento. Un documento non pagato non entra.
      select coalesce(sum(
        case d.kind
          when 'invoice_issued'   then  public._to_base_minor(d.tax_minor, d.currency, v_base, v_units, t.booked_on)
          when 'invoice_received' then -public._to_base_minor(d.tax_minor, d.currency, v_base, v_units, t.booked_on)
        end), 0) into v
      from public.documents d
      join public.transactions t on t.id = d.transaction_id and t.user_id = p_user_id
      where d.user_id = p_user_id and d.kind in ('invoice_issued','invoice_received')
        and t.booked_on between p_from and p_to and d.tax_minor is not null;
    end if;
    return v;

  else -- fixed: nessun imponibile
    return 0;
  end if;
end $$;

-- ── nucleo: l'importo dovuto da base + parametri ────────────────────────────
create or replace function public._tax_amount_from_base(
  p_base_minor bigint, p_base_type public.tax_base_type, p_rate_pct numeric,
  p_coefficient_pct numeric, p_fixed_amount_minor bigint, p_currency char(3),
  p_user_id uuid, p_as_of date)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_base char(3); v_units int; v_amt numeric;
begin
  if p_base_type = 'fixed' then
    select base_currency into v_base from public.profiles where id = p_user_id;
    select minor_units into v_units from public.currencies where code = v_base;
    return coalesce(public._to_base_minor(p_fixed_amount_minor, p_currency, v_base, v_units, p_as_of), 0);
  end if;
  -- base <= 0 (per esempio un anno in perdita sul netto) -> nessuna imposta.
  if p_base_minor is null or p_base_minor <= 0 or p_rate_pct is null then return 0; end if;
  v_amt := p_base_minor::numeric
    * (case when p_coefficient_pct is null then 1 else p_coefficient_pct / 100 end)
    * (p_rate_pct / 100);
  return round(v_amt)::bigint;   -- si arrotonda solo alla fine
end $$;

-- ── anteprima (UI): base e dovuto per una voce anche non ancora salvata ─────
create or replace function public.tax_preview(
  p_base_type public.tax_base_type, p_rate_pct numeric, p_coefficient_pct numeric,
  p_fixed_amount_minor bigint, p_currency char(3), p_business_only boolean,
  p_category_ids uuid[], p_account_ids uuid[], p_basis public.tax_basis,
  p_from date, p_to date)
returns table (base_minor bigint, amount_due_minor bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_base bigint;
begin
  if v_user is null then return; end if;
  v_base := public._tax_base_core(v_user, p_base_type, coalesce(p_business_only, true),
                                  p_category_ids, p_account_ids, coalesce(p_basis,'cash'), p_from, p_to);
  base_minor := v_base;
  amount_due_minor := public._tax_amount_from_base(v_base, p_base_type, p_rate_pct,
                                  p_coefficient_pct, p_fixed_amount_minor, p_currency, v_user, p_to);
  return next;
end $$;

-- ── base di una voce esistente (drill-down UI) ──────────────────────────────
create or replace function public.tax_base(p_item_id uuid, p_from date, p_to date)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); it public.tax_items;
begin
  select * into it from public.tax_items where id = p_item_id;
  if not found then return null; end if;
  if v_user is not null and it.user_id <> v_user then raise exception 'forbidden'; end if;
  return public._tax_base_core(it.user_id, it.base_type, it.business_only,
                               it.category_ids, it.account_ids, it.basis, p_from, p_to);
end $$;

-- ── generazione dei periodi ─────────────────────────────────────────────────
create or replace function public.generate_tax_periods(p_item_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user    uuid := (select auth.uid());
  it        public.tax_items;
  v_fysm    int;
  v_horizon date := (current_date + interval '24 months')::date;
  v_start date; v_end date; v_due date; v_step interval;
  v_base bigint; v_amt bigint; v_status public.tax_period_status;
  v_count int := 0; v_guard int := 0;
begin
  select * into it from public.tax_items where id = p_item_id;
  if not found then return 0; end if;
  if v_user is not null and it.user_id <> v_user then raise exception 'forbidden'; end if;

  select fiscal_year_start_month into v_fysm from public.profiles where id = it.user_id;
  v_fysm := coalesce(v_fysm, 1);

  if it.frequency = 'monthly' then
    v_start := date_trunc('month', it.created_at)::date;
    v_step := interval '1 month';
  elsif it.frequency = 'quarterly' then
    v_start := public._fy_start(it.created_at::date, v_fysm);
    while (v_start + interval '3 months')::date <= it.created_at::date loop
      v_start := (v_start + interval '3 months')::date;
    end loop;
    v_step := interval '3 months';
  elsif it.frequency = 'yearly' then
    v_start := public._fy_start(it.created_at::date, v_fysm);
    v_step := interval '12 months';
  else -- one_off
    v_start := public._fy_start(it.created_at::date, v_fysm);
    v_step := null;
  end if;

  loop
    v_guard := v_guard + 1;
    exit when v_guard > 240;

    if it.frequency = 'monthly' then
      v_end := (v_start + interval '1 month' - interval '1 day')::date;
    elsif it.frequency = 'quarterly' then
      v_end := (v_start + interval '3 months' - interval '1 day')::date;
    else
      v_end := (v_start + interval '12 months' - interval '1 day')::date;
    end if;

    v_due := public._due_date(v_end, it.due_rule);
    v_base := public._tax_base_core(it.user_id, it.base_type, it.business_only,
                                    it.category_ids, it.account_ids, it.basis, v_start, v_end);
    v_amt := public._tax_amount_from_base(v_base, it.base_type, it.rate_pct,
                                    it.coefficient_pct, it.fixed_amount_minor, it.currency, it.user_id, v_end);
    v_status := case when v_end < current_date then 'due' else 'projected' end;

    insert into public.tax_periods
      (user_id, tax_item_id, period_start, period_end, due_date, base_minor, amount_due_minor, computed_at, status)
    values
      (it.user_id, it.id, v_start, v_end, v_due, v_base, v_amt, now(), v_status)
    on conflict (tax_item_id, period_start) do update
      set period_end = excluded.period_end,
          due_date = excluded.due_date,
          base_minor = excluded.base_minor,
          amount_due_minor = excluded.amount_due_minor,
          computed_at = now()
      where public.tax_periods.status in ('projected','due');
    v_count := v_count + 1;

    exit when it.frequency = 'one_off';
    v_start := (v_start + v_step)::date;
    exit when v_start > v_horizon;
  end loop;

  return v_count;
end $$;

-- ── ricalcolo giornaliero (cron) ────────────────────────────────────────────
-- Ricalcola solo projected e due. Non tocca mai un periodo pagato: se la base
-- cambia dopo il pagamento, alza base_changed_after_payment e lascia gli
-- importi come stavano. Porta projected -> due quando il periodo si chiude.
create or replace function public.recompute_tax_periods()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_base bigint; v_amt bigint; v_n int := 0;
begin
  for r in
    select tp.id, tp.user_id, tp.status, tp.period_start, tp.period_end, tp.base_minor,
           tp.base_changed_after_payment,
           ti.base_type, ti.business_only, ti.category_ids, ti.account_ids, ti.basis,
           ti.rate_pct, ti.coefficient_pct, ti.fixed_amount_minor, ti.currency
    from public.tax_periods tp
    join public.tax_items ti on ti.id = tp.tax_item_id
  loop
    if r.status in ('projected','due') then
      v_base := public._tax_base_core(r.user_id, r.base_type, r.business_only,
                                      r.category_ids, r.account_ids, r.basis, r.period_start, r.period_end);
      v_amt := public._tax_amount_from_base(v_base, r.base_type, r.rate_pct,
                                      r.coefficient_pct, r.fixed_amount_minor, r.currency, r.user_id, r.period_end);
      update public.tax_periods
        set base_minor = v_base, amount_due_minor = v_amt, computed_at = now(),
            status = case when r.status = 'projected' and r.period_end < current_date then 'due' else r.status end
      where id = r.id;
      v_n := v_n + 1;
    elsif r.status in ('partially_paid','paid') and not r.base_changed_after_payment then
      v_base := public._tax_base_core(r.user_id, r.base_type, r.business_only,
                                      r.category_ids, r.account_ids, r.basis, r.period_start, r.period_end);
      if v_base is distinct from r.base_minor then
        update public.tax_periods set base_changed_after_payment = true where id = r.id;
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end $$;

-- ── stato di pagamento del periodo, dai pagamenti ───────────────────────────
-- Trigger su tax_payments: tiene lo stato del periodo coerente coi versamenti.
-- Non tocca un periodo 'skipped' (scelta esplicita dell'utente). Invoker:
-- aggiorna solo `status`, che E' nei GRANT dell'utente, e la RLS lo protegge.
create or replace function public.tax_payments_touch_period()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_period uuid; v_due bigint; v_paid bigint; v_end date; v_status public.tax_period_status;
begin
  v_period := coalesce(new.tax_period_id, old.tax_period_id);
  select amount_due_minor, period_end, status into v_due, v_end, v_status
  from public.tax_periods where id = v_period;
  if v_status = 'skipped' then return coalesce(new, old); end if;

  select coalesce(sum(amount_minor), 0) into v_paid
  from public.tax_payments where tax_period_id = v_period;

  update public.tax_periods set status = case
    when v_due is not null and v_paid >= v_due then 'paid'
    when v_paid > 0 then 'partially_paid'
    when v_end < current_date then 'due'
    else 'projected'
  end
  where id = v_period;

  return coalesce(new, old);
end $$;

create trigger tax_payments_status
after insert or update or delete on public.tax_payments
for each row execute function public.tax_payments_touch_period();

-- ── quanto accantonare (sola lettura, invoker) ──────────────────────────────
-- Somma di quanto resta dovuto sui periodi gia' iniziati e non ancora pagati
-- (stima del periodo in corso compresa), meno quanto gia' versato su ciascuno.
-- Se c'e' un conto di accantonamento, ne aggiunge saldo e differenza.
create or replace function public.tax_set_aside(p_as_of date default current_date)
returns table (
  to_set_aside_minor         bigint,
  set_aside_account_id       uuid,
  account_balance_base_minor bigint,
  difference_minor           bigint
)
language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_acct uuid; v_set bigint; v_bal bigint;
begin
  if v_user is null then return; end if;
  select tax_set_aside_account_id into v_acct from public.profiles where id = v_user;

  select coalesce(sum(greatest(
           coalesce(tp.amount_due_minor, 0)
           - coalesce((select sum(x.amount_minor) from public.tax_payments x where x.tax_period_id = tp.id), 0),
           0)), 0)
    into v_set
  from public.tax_periods tp
  where tp.user_id = v_user and tp.period_start <= p_as_of
    and tp.status not in ('paid','skipped');

  if v_acct is not null then
    select ab.balance_base_minor into v_bal from public.account_balances ab where ab.account_id = v_acct;
  end if;

  to_set_aside_minor := v_set;
  set_aside_account_id := v_acct;
  account_balance_base_minor := v_bal;
  difference_minor := case when v_acct is null or v_bal is null then null else v_bal - v_set end;
  return next;
end $$;

-- ── utile netto d'imposta (sola lettura, invoker) ───────────────────────────
-- Entrate meno spese del periodo, meno le imposte dei periodi che si chiudono
-- nella finestra. Trasferimenti e investimenti sono gia' fuori per kind.
create or replace function public.net_after_tax(p_from date, p_to date)
returns bigint language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_flows bigint; v_tax bigint;
begin
  if v_user is null then return null; end if;
  select coalesce(sum(amount_base_minor), 0) into v_flows
  from public.transactions_converted
  where user_id = v_user and kind in ('income','expense')
    and booked_on between p_from and p_to and amount_base_minor is not null;
  select coalesce(sum(amount_due_minor), 0) into v_tax
  from public.tax_periods
  where user_id = v_user and period_end between p_from and p_to;
  return v_flows - v_tax;
end $$;

-- ── permessi ────────────────────────────────────────────────────────────────
-- Helper interni: nessun ruolo client li chiama direttamente. Le funzioni
-- definer qui sopra li invocano girando come proprietario.
revoke all on function public._fy_start(date, int) from public, anon, authenticated;
revoke all on function public._due_date(date, jsonb) from public, anon, authenticated;
revoke all on function public._to_base_minor(bigint, char, char, int, date) from public, anon, authenticated;
revoke all on function public._tax_base_core(uuid, public.tax_base_type, boolean, uuid[], uuid[], public.tax_basis, date, date) from public, anon, authenticated;
revoke all on function public._tax_amount_from_base(bigint, public.tax_base_type, numeric, numeric, bigint, char, uuid, date) from public, anon, authenticated;

-- Il ricalcolo giornaliero lo chiama solo il cron (postgres): mai un client.
revoke all on function public.recompute_tax_periods() from public, anon, authenticated;

-- Sola lettura e generazione: concesse all'utente autenticato.
revoke all on function public.tax_preview(public.tax_base_type, numeric, numeric, bigint, char, boolean, uuid[], uuid[], public.tax_basis, date, date) from public, anon;
grant  execute on function public.tax_preview(public.tax_base_type, numeric, numeric, bigint, char, boolean, uuid[], uuid[], public.tax_basis, date, date) to authenticated;
revoke all on function public.tax_base(uuid, date, date) from public, anon;
grant  execute on function public.tax_base(uuid, date, date) to authenticated;
revoke all on function public.generate_tax_periods(uuid) from public, anon;
grant  execute on function public.generate_tax_periods(uuid) to authenticated;
revoke all on function public.tax_set_aside(date) from public, anon;
grant  execute on function public.tax_set_aside(date) to authenticated;
revoke all on function public.net_after_tax(date, date) from public, anon;
grant  execute on function public.net_after_tax(date, date) to authenticated;

-- ── cron giornaliero del ricalcolo ──────────────────────────────────────────
-- Funzione SQL pura: la chiama direttamente pg_cron (come postgres, quindi
-- auth.uid() null e ricalcolo per tutti gli utenti). Alle 02:30 UTC, dopo il
-- giro dei tassi (01:30) cosi' le conversioni usano gli ultimi cambi.
select cron.unschedule('recompute-taxes') where exists (select 1 from cron.job where jobname = 'recompute-taxes');
select cron.schedule('recompute-taxes', '30 2 * * *', $cron$ select public.recompute_tax_periods() $cron$);
