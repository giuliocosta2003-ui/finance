-- supabase/tests/phase6_isolation.sql
-- Isolamento fra utenti su voci d'imposta, periodi e pagamenti, piu' i vincoli
-- delle FK composte: la RLS nasconde le righe altrui, la FK impedisce comunque
-- di agganciarsi a una voce, un periodo, un conto o una transazione di un altro
-- utente indovinandone l'UUID.
--
-- Tutto in un unico DO che alla fine solleva un'eccezione: la transazione
-- rotola indietro e i due utenti fittizi non restano nel database.
do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  a1 uuid; t1 uuid; it1 uuid; pe1 uuid;
  a2 uuid;
  n integer; ok text := ''; fails text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (u1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','p6-uno@example.invalid','',now(),now(),now(),'{}','{}'),
    (u2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','p6-due@example.invalid','',now(),now(),now(),'{}','{}');
  update public.profiles set full_name='Uno', profile_type='entrepreneur', base_currency='EUR', country='IT', onboarding_completed=true where id=u1;
  update public.profiles set full_name='Due', profile_type='entrepreneur', base_currency='EUR', country='IT', onboarding_completed=true where id=u2;

  -- ── utente 1 ─────────────────────────────────────────────────────────────
  perform set_config('role','authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);

  insert into public.accounts (name,type,currency) values ('Conto','checking','EUR') returning id into a1;
  insert into public.transactions (account_id, booked_on, description, amount_minor, currency, kind)
  values (a1, current_date - 3, 'Compenso', 100000, 'EUR', 'income') returning id into t1;

  insert into public.tax_items (name, base_type, rate_pct, coefficient_pct, frequency, basis, due_rule)
  values ('Imposta sui ricavi', 'gross_income', 15, 78, 'yearly', 'cash', '{"month_offset":6,"day":30}')
  returning id into it1;
  ok := ok || 'voce d''imposta creata; ';

  insert into public.tax_periods (tax_item_id, period_start, period_end, due_date, status)
  values (it1, date '2026-01-01', date '2026-12-31', date '2027-06-30', 'projected')
  returning id into pe1;
  ok := ok || 'periodo creato; ';

  insert into public.tax_payments (tax_period_id, transaction_id, amount_minor, paid_on)
  values (pe1, t1, 5000, current_date);
  ok := ok || 'pagamento (con transazione collegata) registrato; ';

  -- Il conto di accantonamento proprio si imposta.
  update public.profiles set tax_set_aside_account_id = a1 where id = u1;
  ok := ok || 'conto di accantonamento proprio impostato; ';

  -- Vincolo struttura: base non-fixed senza aliquota deve fallire.
  begin
    insert into public.tax_items (name, base_type, frequency, due_rule)
    values ('Senza aliquota', 'net_profit', 'monthly', '{"month_offset":1,"day":16}');
    fails := fails || 'voce non-fixed senza aliquota accettata; ';
  exception when check_violation then ok := ok || 'aliquota obbligatoria sulle voci non-fixed; ';
  end;

  -- Vincolo struttura: fixed senza importo deve fallire.
  begin
    insert into public.tax_items (name, base_type, frequency, due_rule)
    values ('Fisso senza importo', 'fixed', 'yearly', '{"month_offset":0,"day":30}');
    fails := fails || 'voce fixed senza importo accettata; ';
  exception when check_violation then ok := ok || 'importo obbligatorio sulle voci fixed; ';
  end;

  -- Vincolo struttura: due_rule malformata deve fallire.
  begin
    insert into public.tax_items (name, base_type, rate_pct, frequency, due_rule)
    values ('Scadenza storta', 'gross_income', 10, 'yearly', '{"day":99}');
    fails := fails || 'due_rule malformata accettata; ';
  exception when check_violation then ok := ok || 'due_rule malformata rifiutata; ';
  end;

  -- ── utente 2 ─────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  insert into public.accounts (name,type,currency) values ('Conto2','checking','EUR') returning id into a2;

  select count(*) into n from public.tax_items;
  if n = 0 then ok := ok || 'u2 non vede le voci d''imposta di u1; '; else fails := fails || 'u2 vede le voci di u1; '; end if;
  select count(*) into n from public.tax_periods;
  if n = 0 then ok := ok || 'u2 non vede i periodi di u1; '; else fails := fails || 'u2 vede i periodi di u1; '; end if;
  select count(*) into n from public.tax_payments;
  if n = 0 then ok := ok || 'u2 non vede i pagamenti di u1; '; else fails := fails || 'u2 vede i pagamenti di u1; '; end if;

  update public.tax_items set name = 'rubata' where id = it1;
  get diagnostics n = row_count;
  if n = 0 then ok := ok || 'u2 non modifica le voci di u1; '; else fails := fails || 'u2 ha modificato una voce altrui; '; end if;

  -- FK composta: u2 non puo' agganciare un periodo alla voce di u1.
  begin
    insert into public.tax_periods (tax_item_id, period_start, period_end, due_date)
    values (it1, date '2026-01-01', date '2026-12-31', date '2027-06-30');
    fails := fails || 'u2 ha aggiunto un periodo alla voce di u1; ';
  exception when others then ok := ok || 'FK composta blocca il periodo su voce altrui; ';
  end;

  -- FK composta: u2 non puo' pagare un periodo di u1.
  begin
    insert into public.tax_payments (tax_period_id, amount_minor, paid_on)
    values (pe1, 100, current_date);
    fails := fails || 'u2 ha pagato un periodo di u1; ';
  exception when others then ok := ok || 'FK composta blocca il pagamento su periodo altrui; ';
  end;

  -- FK composta: u2 non puo' puntare il conto di accantonamento al conto di u1.
  begin
    update public.profiles set tax_set_aside_account_id = a1 where id = u2;
    fails := fails || 'u2 ha usato il conto di u1 come accantonamento; ';
  exception when others then ok := ok || 'FK composta blocca il conto di accantonamento altrui; ';
  end;

  -- ── anonimo ────────────────────────────────────────────────────────────────
  perform set_config('role','anon', true);
  perform set_config('request.jwt.claims','{"role":"anon"}', true);
  begin
    select count(*) into n from public.tax_items;
    fails := fails || 'anon legge le voci d''imposta; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge le voci d''imposta; ';
  end;
  begin
    select count(*) into n from public.tax_periods;
    fails := fails || 'anon legge i periodi; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge i periodi; ';
  end;
  begin
    select count(*) into n from public.tax_payments;
    fails := fails || 'anon legge i pagamenti; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge i pagamenti; ';
  end;

  perform set_config('role','postgres', true);
  if fails = '' then raise exception 'TEST OK -- %', ok;
  else raise exception 'TEST FALLITI -- % || superati: %', fails, ok; end if;
end $test$;
