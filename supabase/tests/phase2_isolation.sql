-- supabase/tests/phase2_isolation.sql
-- Test di isolamento e di conversione della fase 2.
--
-- Tutto dentro un solo DO block che alla fine solleva un'eccezione: cosi' il
-- ROLLBACK e' garantito e i due utenti fittizi non restano nel database
-- nemmeno se un'asserzione fallisce. Il riepilogo arriva nel messaggio
-- dell'eccezione finale ("TEST OK: ...").
--
-- Si esegue con la service role (SQL editor o MCP), non dal client.
do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  a_eur uuid; a_vnd uuid; a2 uuid;
  c1 uuid; c2 uuid;
  t1 uuid;
  n integer;
  seeded integer;
  v_group uuid;
  v_rate numeric; v_eff date;
  v_base bigint; v_expected bigint; v_status text;
  ok text := '';
  fails text := '';

  procedure_note text;
begin
  -- ── utenti fittizi ─────────────────────────────────────────────────────
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values
    (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-uno@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{"full_name":"Uno"}'::jsonb),
    (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-due@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{"full_name":"Due"}'::jsonb);

  update public.profiles set profile_type='entrepreneur', base_currency='EUR', country='IT',
    onboarding_completed=true where id = u1;
  update public.profiles set profile_type='employee', base_currency='VND', country='VN',
    onboarding_completed=true where id = u2;

  -- ── utente 1 ───────────────────────────────────────────────────────────
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);

  if (select auth.uid()) <> u1 then raise exception 'auth.uid() non rispecchia il claim'; end if;

  seeded := public.seed_default_categories();
  if seeded < 10 then fails := fails || format('seed ha creato solo %s categorie; ', seeded);
  else ok := ok || format('seed categorie=%s; ', seeded); end if;

  -- idempotenza del seed
  if public.seed_default_categories() <> 0 then
    fails := fails || 'seed non idempotente; ';
  else ok := ok || 'seed idempotente; '; end if;

  insert into public.accounts (name, type, currency, opening_balance_minor)
  values ('Conto EUR', 'checking', 'EUR', 100000) returning id into a_eur;
  insert into public.accounts (name, type, currency, opening_balance_minor)
  values ('Cassa VND', 'cash', 'VND', 5000000) returning id into a_vnd;

  select id into c1 from public.categories where user_id = u1 and key = 'groceries';

  insert into public.transactions (account_id, booked_on, description, amount_minor, currency, kind, category_id)
  values (a_eur, date '2026-09-18', 'Spesa', -2550, 'EUR', 'expense', c1) returning id into t1;

  -- valuta diversa da quella del conto -> rifiutata dal trigger
  begin
    insert into public.transactions (account_id, booked_on, amount_minor, currency, kind)
    values (a_eur, date '2026-09-18', -100, 'VND', 'expense');
    fails := fails || 'valuta diversa dal conto accettata; ';
  exception when others then ok := ok || 'valuta legata al conto; ';
  end;

  -- segno incoerente con il tipo -> rifiutato dal CHECK
  begin
    insert into public.transactions (account_id, booked_on, amount_minor, currency, kind)
    values (a_eur, date '2026-09-18', 100, 'EUR', 'expense');
    fails := fails || 'uscita con importo positivo accettata; ';
  exception when check_violation then ok := ok || 'segno coerente col tipo; ';
  end;

  -- trasferimento: due righe, stesso gruppo, nessuna categoria
  v_group := public.create_transfer(a_eur, a_vnd, date '2026-09-18', 50000, 1400000, 'Giro conti');
  select count(*) into n from public.transactions where transfer_group_id = v_group;
  if n <> 2 then fails := fails || format('trasferimento con %s righe; ', n);
  else ok := ok || 'trasferimento 2 righe; '; end if;

  select count(*) into n from public.transactions
   where transfer_group_id = v_group and (kind <> 'transfer' or category_id is not null);
  if n > 0 then fails := fails || 'trasferimento con categoria o kind sbagliato; '; end if;

  -- stesso conto in partenza e arrivo -> rifiutato
  begin
    perform public.create_transfer(a_eur, a_eur, date '2026-09-18', 100, 100);
    fails := fails || 'trasferimento sullo stesso conto accettato; ';
  exception when others then ok := ok || 'trasferimento su stesso conto bloccato; ';
  end;

  -- valuta del conto bloccata se ci sono movimenti
  begin
    update public.accounts set currency = 'USD' where id = a_eur;
    fails := fails || 'valuta del conto cambiata con movimenti presenti; ';
  exception when others then ok := ok || 'valuta del conto bloccata; ';
  end;

  -- ── conversione ────────────────────────────────────────────────────────
  -- Uscita in VND su un conto VND, utente con base EUR.
  insert into public.transactions (account_id, booked_on, description, amount_minor, currency, kind)
  values (a_vnd, date '2026-09-18', 'Pranzo', -100000, 'VND', 'expense');

  select rate, effective_date into v_rate, v_eff from public.fx_rate('VND','EUR', date '2026-09-18');
  v_expected := round((-100000)::numeric / power(10::numeric, 0) * v_rate * power(10::numeric, 2));
  select amount_base_minor, fx_status into v_base, v_status
  from public.transactions_converted where account_id = a_vnd and description = 'Pranzo';

  if v_base is distinct from v_expected or v_status <> 'auto' then
    fails := fails || format('conversione VND->EUR: view=%s atteso=%s stato=%s; ', v_base, v_expected, v_status);
  else
    ok := ok || format('conversione VND->EUR ok (%s minor, tasso del %s); ', v_base, v_eff);
  end if;

  -- Tasso manuale: vince sull'automatico e si dichiara nello stato.
  update public.transactions set fx_override_rate = 0.00004, fx_override_note = 'tasso carta'
   where account_id = a_vnd and description = 'Pranzo';
  select amount_base_minor, fx_status into v_base, v_status
  from public.transactions_converted where account_id = a_vnd and description = 'Pranzo';
  if v_status <> 'manual' or v_base <> round((-100000)::numeric * 0.00004 * 100) then
    fails := fails || format('tasso manuale: stato=%s valore=%s; ', v_status, v_base);
  else ok := ok || 'tasso manuale ok; '; end if;
  update public.transactions set fx_override_rate = null, fx_override_note = null
   where account_id = a_vnd and description = 'Pranzo';

  -- Saldo del conto: iniziale + movimenti.
  select balance_minor into v_base from public.account_balances where account_id = a_vnd;
  if v_base <> 5000000 + 1400000 - 100000 then
    fails := fails || format('saldo VND = %s; ', v_base);
  else ok := ok || 'saldo conto ok; '; end if;

  -- ── weekend e tassi scaduti ────────────────────────────────────────────
  perform set_config('role', 'postgres', true);
  delete from public.fx_rates where quote = 'VND' and rate_date in (date '2026-09-19', date '2026-09-20');
  perform set_config('role', 'authenticated', true);

  select rate, effective_date into v_rate, v_eff from public.fx_rate('VND','EUR', date '2026-09-20');
  if v_eff <> date '2026-09-18' then
    fails := fails || format('weekend: usata la data %s invece del venerdi 2026-09-18; ', v_eff);
  else ok := ok || 'weekend usa il venerdi; '; end if;

  perform set_config('role', 'postgres', true);
  delete from public.fx_rates where quote = 'VND' and rate_date > date '2026-09-04';
  perform set_config('role', 'authenticated', true);

  select rate into v_rate from public.fx_rate('VND','EUR', date '2026-09-20');
  if v_rate is not null then
    fails := fails || 'tasso piu vecchio di 7 giorni comunque restituito; ';
  else ok := ok || 'tasso oltre 7 giorni = NULL; '; end if;

  select fx_status, amount_base_minor into v_status, v_base
  from public.transactions_converted where account_id = a_vnd and description = 'Pranzo';
  if v_status <> 'missing' or v_base is not null then
    fails := fails || format('senza tasso la view dice %s con valore %s; ', v_status, v_base);
  else ok := ok || 'senza tasso: missing e nessun controvalore; '; end if;

  -- ── utente 2: non deve vedere ne' toccare niente di utente 1 ───────────
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);

  select count(*) into n from public.accounts;
  if n <> 0 then fails := fails || format('u2 vede %s conti di u1; ', n); else ok := ok || 'u2 non vede i conti; '; end if;

  select count(*) into n from public.transactions;
  if n <> 0 then fails := fails || format('u2 vede %s movimenti di u1; ', n); else ok := ok || 'u2 non vede i movimenti; '; end if;

  select count(*) into n from public.categories;
  if n <> 0 then fails := fails || format('u2 vede %s categorie di u1; ', n); else ok := ok || 'u2 non vede le categorie; '; end if;

  select count(*) into n from public.transactions_converted;
  if n <> 0 then fails := fails || 'u2 vede movimenti nella view; '; else ok := ok || 'view isolata; '; end if;

  select count(*) into n from public.account_balances;
  if n <> 0 then fails := fails || 'u2 vede saldi nella view; '; end if;

  update public.accounts set name = 'rubato' where id = a_eur;
  get diagnostics n = row_count;
  if n <> 0 then fails := fails || 'u2 ha modificato un conto di u1; '; else ok := ok || 'u2 non modifica; '; end if;

  delete from public.transactions where id = t1;
  get diagnostics n = row_count;
  if n <> 0 then fails := fails || 'u2 ha cancellato un movimento di u1; '; else ok := ok || 'u2 non cancella; '; end if;

  -- inserire con user_id altrui
  begin
    insert into public.accounts (user_id, name, type, currency) values (u1, 'Falso', 'cash', 'EUR');
    fails := fails || 'u2 ha inserito un conto intestato a u1; ';
  exception when others then ok := ok || 'u2 non intesta righe a u1; ';
  end;

  -- proprio conto, ma transazione agganciata al conto di u1: deve fallire la FK composta
  insert into public.accounts (name, type, currency) values ('Conto di due', 'cash', 'VND') returning id into a2;
  begin
    insert into public.transactions (account_id, booked_on, amount_minor, currency, kind)
    values (a_eur, date '2026-09-18', -100, 'EUR', 'expense');
    fails := fails || 'u2 ha agganciato un movimento al conto di u1; ';
  exception when others then ok := ok || 'FK composta blocca il conto altrui; ';
  end;

  -- proprio conto, ma categoria di u1
  begin
    insert into public.transactions (account_id, booked_on, amount_minor, currency, kind, category_id)
    values (a2, date '2026-09-18', -100, 'VND', 'expense', c1);
    fails := fails || 'u2 ha usato una categoria di u1; ';
  exception when others then ok := ok || 'FK composta blocca la categoria altrui; ';
  end;

  -- ── anonimo: non legge niente, nemmeno i cambi ─────────────────────────
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  begin
    select count(*) into n from public.fx_rates;
    fails := fails || format('anon legge %s tassi; ', n);
  exception when insufficient_privilege then ok := ok || 'anon non legge fx_rates; ';
  end;
  begin
    select count(*) into n from public.currencies;
    fails := fails || 'anon legge currencies; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge currencies; ';
  end;
  begin
    select count(*) into n from public.accounts;
    fails := fails || 'anon legge accounts; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge accounts; ';
  end;
  begin
    select count(*) into n from public.transactions;
    fails := fails || 'anon legge transactions; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge transactions; ';
  end;
  begin
    select count(*) into n from public.fx_fetch_log;
    fails := fails || 'anon legge fx_fetch_log; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge il log; ';
  end;

  perform set_config('role', 'postgres', true);

  -- L'eccezione finale garantisce il rollback di tutto quanto sopra.
  if fails = '' then
    raise exception 'TEST OK -- %', ok;
  else
    raise exception 'TEST FALLITI -- % || superati: %', fails, ok;
  end if;
end $test$;
