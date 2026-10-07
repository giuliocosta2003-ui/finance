-- phase6_drop_business
-- Correzione: categories ha gia' `is_business` dalla fase 2 (con toggle e badge
-- nella UI e default sensati nel seed), quindi la colonna `business` aggiunta in
-- phase6_category_business era un DUPLICATO. La si elimina e _tax_base_core usa
-- la colonna vera, `is_business`. (Il corpo della funzione e' identico a quello
-- di phase6_drop_business applicato: qui basta ricordare che ricrea
-- _tax_base_core con `c.is_business` al posto di `c.business`.)
drop index if exists public.categories_business_idx;
alter table public.categories drop column if exists business;

-- La ricreazione di _tax_base_core con is_business e' applicata al progetto;
-- il corpo completo sta nel file phase6_tax_functions, qui cambia solo il nome
-- della colonna del filtro aziendale da `business` a `is_business`.
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
              select 1 from public.categories c where c.id = tc.category_id and c.is_business));
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
              select 1 from public.categories c where c.id = tc.category_id and c.is_business));
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
      select coalesce(sum(
        case d.kind
          when 'invoice_issued'   then  public._to_base_minor(d.tax_minor, d.currency, v_base, v_units, d.doc_date)
          when 'invoice_received' then -public._to_base_minor(d.tax_minor, d.currency, v_base, v_units, d.doc_date)
        end), 0) into v
      from public.documents d
      where d.user_id = p_user_id and d.kind in ('invoice_issued','invoice_received')
        and d.doc_date between p_from and p_to and d.tax_minor is not null;
    else
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

  else
    return 0;
  end if;
end $$;
revoke all on function public._tax_base_core(uuid, public.tax_base_type, boolean, uuid[], uuid[], public.tax_basis, date, date) from public, anon, authenticated;
