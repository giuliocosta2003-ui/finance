-- supabase/tests/phase4_isolation.sql
-- Isolamento fra utenti su investimenti, lotti, prezzi, obiettivi e documenti,
-- piu' i vincoli del nuovo tipo di movimento `investment`.
--
-- Il controllo piu' importante e' quello sullo Storage: un URL firmato si
-- ottiene solo per un file che si riesce a vedere, quindi se u2 non trova la
-- riga di storage.objects di u1 nemmeno conoscendone il percorso esatto, non
-- puo' nemmeno farsi firmare quell'URL.
do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  a1 uuid; h1 uuid; l1 uuid; d1 uuid; t1 uuid; c1 uuid;
  h2 uuid;
  n integer; ok text := ''; fails text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (u1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','p4-uno@example.invalid','',now(),now(),now(),'{}','{}'),
    (u2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','p4-due@example.invalid','',now(),now(),now(),'{}','{}');
  update public.profiles set full_name='Uno', profile_type='entrepreneur', base_currency='EUR', country='IT', onboarding_completed=true where id=u1;
  update public.profiles set full_name='Due', profile_type='employee', base_currency='VND', country='VN', onboarding_completed=true where id=u2;

  perform set_config('role','authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);

  perform public.seed_default_categories();
  select id into c1 from public.categories where user_id = u1 limit 1;

  insert into public.accounts (name,type,currency) values ('Conto','checking','EUR') returning id into a1;
  insert into public.holdings (name, asset_class, currency, account_id) values ('ETF','etf','EUR',a1) returning id into h1;
  insert into public.holding_lots (holding_id, side, trade_date, quantity, unit_price)
  values (h1,'buy',current_date - 5, 10, 100) returning id into l1;
  insert into public.asset_prices (holding_id, price_date, price, source) values (h1, current_date, 110, 'manual');
  insert into public.target_allocations (dimension,key,target_pct) values ('asset_class','etf',50);
  insert into public.documents (storage_path, file_name, mime_type)
  values (u1||'/d1/fattura.pdf','fattura.pdf','application/pdf') returning id into d1;
  insert into storage.objects (bucket_id, name, owner_id) values ('documents', u1||'/d1/fattura.pdf', u1::text);

  -- ── il nuovo tipo di movimento ─────────────────────────────────────────
  insert into public.transactions (account_id, booked_on, description, amount_minor, currency, kind)
  values (a1, current_date - 5, 'Acquisto ETF', -100000, 'EUR', 'investment') returning id into t1;
  ok := ok || 'movimento investment accettato; ';

  -- Senza categoria, come i trasferimenti: altrimenti comparirebbe nei
  -- riepiloghi di spesa e conterebbe due volte gli stessi soldi.
  begin
    insert into public.transactions (account_id, booked_on, amount_minor, currency, kind, category_id)
    values (a1, current_date, -100, 'EUR', 'investment', c1);
    fails := fails || 'investment con categoria accettato; ';
  exception when check_violation then ok := ok || 'investment senza categoria imposto; ';
  end;

  update public.holding_lots set transaction_id = t1 where id = l1;
  ok := ok || 'lotto collegato al movimento di pagamento; ';

  update public.documents set holding_id = h1, holding_lot_id = l1, transaction_id = t1 where id = d1;
  ok := ok || 'documento collegato a investimento, lotto e movimento; ';

  -- ── utente 2 ───────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);

  select count(*) into n from public.holdings;
  if n = 0 then ok := ok || 'u2 non vede gli investimenti; '; else fails := fails || 'u2 vede gli investimenti; '; end if;
  select count(*) into n from public.holding_lots;
  if n = 0 then ok := ok || 'u2 non vede i lotti; '; else fails := fails || 'u2 vede i lotti; '; end if;
  select count(*) into n from public.asset_prices;
  if n = 0 then ok := ok || 'u2 non vede i prezzi; '; else fails := fails || 'u2 vede i prezzi; '; end if;
  select count(*) into n from public.target_allocations;
  if n = 0 then ok := ok || 'u2 non vede gli obiettivi; '; else fails := fails || 'u2 vede gli obiettivi; '; end if;
  select count(*) into n from public.documents;
  if n = 0 then ok := ok || 'u2 non vede i documenti; '; else fails := fails || 'u2 vede i documenti; '; end if;

  select count(*) into n from storage.objects where name = u1||'/d1/fattura.pdf';
  if n = 0 then ok := ok || 'u2 non vede il file di u1 nemmeno col percorso; ';
  else fails := fails || 'u2 vede il file di u1: potrebbe farsi firmare un URL; '; end if;

  select count(*) into n from public.holding_positions(current_date);
  if n = 0 then ok := ok || 'holding_positions non mostra le posizioni di u1; ';
  else fails := fails || 'holding_positions mostra dati altrui; '; end if;

  update public.holdings set name = 'rubato' where id = h1;
  get diagnostics n = row_count;
  if n = 0 then ok := ok || 'u2 non modifica gli investimenti di u1; '; else fails := fails || 'u2 ha modificato un investimento altrui; '; end if;

  -- La RLS nasconde; la FK composta impedisce comunque di agganciarsi.
  insert into public.holdings (name, asset_class, currency) values ('Mio','crypto','VND') returning id into h2;
  begin
    insert into public.holding_lots (holding_id, side, trade_date, quantity, unit_price)
    values (h1,'buy',current_date, 1, 1);
    fails := fails || 'u2 ha aggiunto un lotto all investimento di u1; ';
  exception when others then ok := ok || 'FK composta blocca l investimento altrui; ';
  end;

  begin
    insert into public.asset_prices (holding_id, price_date, price, source)
    values (h1, current_date, 1, 'manual');
    fails := fails || 'u2 ha scritto un prezzo sull investimento di u1; ';
  exception when others then ok := ok || 'FK composta blocca il prezzo altrui; ';
  end;

  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('documents', u1||'/altrui/x.pdf', u2::text);
    fails := fails || 'u2 ha caricato nella cartella di u1; ';
  exception when others then ok := ok || 'cartella altrui vietata in scrittura; ';
  end;

  -- ── anonimo ────────────────────────────────────────────────────────────
  perform set_config('role','anon', true);
  perform set_config('request.jwt.claims','{"role":"anon"}', true);
  begin
    select count(*) into n from public.holdings;
    fails := fails || 'anon legge gli investimenti; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge gli investimenti; ';
  end;
  begin
    select count(*) into n from public.documents;
    fails := fails || 'anon legge i documenti; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge i documenti; ';
  end;
  begin
    select count(*) into n from public.price_fetch_log;
    fails := fails || 'anon legge il diario dei prezzi; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge il diario dei prezzi; ';
  end;

  perform set_config('role','postgres', true);
  if fails = '' then raise exception 'TEST OK -- %', ok;
  else raise exception 'TEST FALLITI -- % || superati: %', fails, ok; end if;
end $test$;
