-- phase6_vat_amount
-- Correzione: per un saldo IVA l'importo dovuto E' la base (IVA sulle fatture
-- emesse meno IVA sulle ricevute), non base x aliquota — moltiplicare per
-- un'aliquota la applicherebbe due volte. Quindi vat_balance non richiede
-- rate_pct, e _tax_amount_from_base restituisce la base direttamente, mai
-- negativa (un credito IVA vale zero da versare, si riporta altrove).

alter table public.tax_items drop constraint tax_items_amounts;
alter table public.tax_items add constraint tax_items_amounts check (
  case base_type
    when 'fixed'       then fixed_amount_minor is not null and currency is not null and rate_pct is null
    when 'vat_balance' then true
    else rate_pct is not null
  end
);

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

  if p_base_type = 'vat_balance' then
    return greatest(coalesce(p_base_minor, 0), 0);
  end if;

  if p_base_minor is null or p_base_minor <= 0 or p_rate_pct is null then return 0; end if;
  v_amt := p_base_minor::numeric
    * (case when p_coefficient_pct is null then 1 else p_coefficient_pct / 100 end)
    * (p_rate_pct / 100);
  return round(v_amt)::bigint;
end $$;
revoke all on function public._tax_amount_from_base(bigint, public.tax_base_type, numeric, numeric, bigint, char, uuid, date) from public, anon, authenticated;
