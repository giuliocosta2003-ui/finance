-- phase6_status_cast
-- Correzione: nel trigger dello stato dei periodi la CASE restituisce testo,
-- ma tax_periods.status e' un enum: serve il cast esplicito, altrimenti
-- l'inserimento di un pagamento fallisce.
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

  update public.tax_periods set status = (case
    when v_due is not null and v_paid >= v_due then 'paid'
    when v_paid > 0 then 'partially_paid'
    when v_end < current_date then 'due'
    else 'projected'
  end)::public.tax_period_status
  where id = v_period;

  return coalesce(new, old);
end $$;
