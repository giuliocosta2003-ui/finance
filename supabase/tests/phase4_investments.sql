-- supabase/tests/phase4_investments.sql
-- P&L nei tre metodi, effetto prezzo contro effetto cambio, precisione crypto,
-- freschezza dei prezzi, allocazione e serie storica.
--
-- Stessa forma delle fasi precedenti: un DO block che alla fine solleva
-- un'eccezione, cosi' il rollback e' garantito e i dati di prova non restano.
--
-- Il caso di riferimento e' quello del brief: 10 a 100, 10 a 120, vendita 5 a
-- 130. Con i tre metodi da' tre risultati diversi, ed e' esattamente il punto:
-- il metodo non e' una preferenza estetica, cambia quanto risulta realizzato.
--
--   costo medio: costo medio 110, realizzato 100, residuo 1.650
--   FIFO:        scarica il lotto da 100, realizzato 150, residuo 1.700
--   LIFO:        scarica il lotto da 120, realizzato  50, residuo 1.600
do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  h_eur uuid; h_usd uuid; h_btc uuid; h_casa uuid;
  h_a uuid; h_b uuid;
  r record; n integer;
  v_ra numeric; v_rt numeric;
  v_exp_price numeric; v_exp_fx numeric;
  ok text := ''; fails text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (u1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','p4-math@example.invalid','',now(),now(),now(),'{}','{}'),
    (u2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','p4-alloc@example.invalid','',now(),now(),now(),'{}','{}');

  update public.profiles set full_name='M', profile_type='employee', base_currency='EUR', country='IT', onboarding_completed=true where id=u1;
  update public.profiles set full_name='A', profile_type='employee', base_currency='EUR', country='IT', onboarding_completed=true where id=u2;

  perform set_config('role','authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);

  -- ── i tre metodi sullo stesso caso ─────────────────────────────────────
  insert into public.holdings (name, asset_class, currency) values ('ETF Mondo','etf','EUR') returning id into h_eur;
  insert into public.holding_lots (holding_id, side, trade_date, quantity, unit_price)
  values (h_eur,'buy', current_date - 100, 10, 100),
         (h_eur,'buy', current_date -  80, 10, 120),
         (h_eur,'sell',current_date -  60,  5, 130);

  update public.profiles set pnl_method = 'average' where id = u1;
  select * into r from public.holding_positions(current_date) where holding_id = h_eur;
  if r.avg_unit_cost = 110 and r.realized_pl = 100 and r.cost_residual = 1650 and r.quantity = 15 then
    ok := ok || 'medio: 110 / 100 / 1650; ';
  else
    fails := fails || format('medio sbagliato (avg=%s real=%s res=%s qty=%s); ', r.avg_unit_cost, r.realized_pl, r.cost_residual, r.quantity);
  end if;

  update public.profiles set pnl_method = 'fifo' where id = u1;
  select * into r from public.holding_positions(current_date) where holding_id = h_eur;
  if r.realized_pl = 150 and r.cost_residual = 1700 then
    ok := ok || 'fifo: 150 / 1700; ';
  else
    fails := fails || format('fifo sbagliato (real=%s res=%s); ', r.realized_pl, r.cost_residual);
  end if;

  update public.profiles set pnl_method = 'lifo' where id = u1;
  select * into r from public.holding_positions(current_date) where holding_id = h_eur;
  if r.realized_pl = 50 and r.cost_residual = 1600 then
    ok := ok || 'lifo: 50 / 1600; ';
  else
    fails := fails || format('lifo sbagliato (real=%s res=%s); ', r.realized_pl, r.cost_residual);
  end if;

  -- Le commissioni di vendita riducono il ricavo (5 EUR su 100 realizzati).
  update public.profiles set pnl_method = 'average' where id = u1;
  update public.holding_lots set fees_minor = 500 where holding_id = h_eur and side = 'sell';
  select * into r from public.holding_positions(current_date) where holding_id = h_eur;
  if r.realized_pl = 95 then
    ok := ok || 'commissione di vendita toglie dal ricavo; ';
  else
    fails := fails || format('commissione vendita: realizzato %s invece di 95; ', r.realized_pl);
  end if;
  update public.holding_lots set fees_minor = 0 where holding_id = h_eur and side = 'sell';

  -- ── effetto prezzo contro effetto cambio ───────────────────────────────
  -- Base EUR, investimento in USD: il guadagno viene in parte dal titolo e in
  -- parte dal dollaro, e i due numeri si commentano in modo diverso.
  insert into public.holdings (name, asset_class, currency) values ('ETF USA','etf','USD') returning id into h_usd;
  insert into public.holding_lots (holding_id, side, trade_date, quantity, unit_price)
  values (h_usd,'buy', current_date - 90, 10, 100);
  insert into public.asset_prices (holding_id, price_date, price, source)
  values (h_usd, current_date, 120, 'manual');

  select rate into v_ra from public.fx_rate('USD','EUR', current_date - 90);
  select rate into v_rt from public.fx_rate('USD','EUR', current_date);
  v_exp_price := round(200 * v_rt * 100);
  v_exp_fx    := round((1000 * v_rt - 1000 * v_ra) * 100);

  select * into r from public.holding_positions(current_date) where holding_id = h_usd;
  if r.price_effect_base_minor = v_exp_price and r.fx_effect_base_minor = v_exp_fx then
    ok := ok || 'effetto prezzo ed effetto cambio corretti; ';
  else
    fails := fails || format('split sbagliato (prezzo %s atteso %s, cambio %s atteso %s); ', r.price_effect_base_minor, v_exp_price, r.fx_effect_base_minor, v_exp_fx);
  end if;

  if abs(r.price_effect_base_minor + r.fx_effect_base_minor - r.unrealized_pl_base_minor) <= 1 then
    ok := ok || 'la somma dei due effetti fa il P&L totale; ';
  else
    fails := fails || format('somma effetti %s <> totale %s; ', r.price_effect_base_minor + r.fx_effect_base_minor, r.unrealized_pl_base_minor);
  end if;

  if r.price_status = 'fresh' then
    ok := ok || 'prezzo di oggi = fresh; ';
  else
    fails := fails || format('price_status %s invece di fresh; ', r.price_status);
  end if;

  -- ── crypto: 18 decimali e prezzo minuscolo ─────────────────────────────
  insert into public.holdings (name, asset_class, currency) values ('Shiba','crypto','EUR') returning id into h_btc;
  insert into public.holding_lots (holding_id, side, trade_date, quantity, unit_price)
  values (h_btc,'buy', current_date - 30, 123456789.000000000000000001, 0.0000000234);
  insert into public.asset_prices (holding_id, price_date, price, source)
  values (h_btc, current_date - 1, 0.0000000300, 'manual');

  select * into r from public.holding_positions(current_date) where holding_id = h_btc;
  if r.quantity = 123456789.000000000000000001 then
    ok := ok || 'quantita a 18 decimali intatta; ';
  else
    fails := fails || format('quantita crypto persa: %s; ', r.quantity);
  end if;
  if r.value = 123456789.000000000000000001 * 0.0000000300 then
    ok := ok || 'valore crypto esatto; ';
  else
    fails := fails || format('valore crypto %s; ', r.value);
  end if;

  -- ── freschezza dei prezzi ──────────────────────────────────────────────
  -- price_date fa parte della chiave e non e' aggiornabile: un prezzo a
  -- un'altra data e' un'altra riga, non una correzione della stessa.
  delete from public.asset_prices where holding_id = h_btc;
  insert into public.asset_prices (holding_id, price_date, price, source)
  values (h_btc, current_date - 20, 0.0000000300, 'manual');
  select * into r from public.holding_positions(current_date) where holding_id = h_btc;
  if r.price_status = 'stale' then
    ok := ok || 'prezzo di 20 giorni = stale; ';
  else
    fails := fails || format('stale non riconosciuto (%s); ', r.price_status);
  end if;

  select * into r from public.holding_positions(current_date) where holding_id = h_eur;
  if r.price_status = 'no_price' and r.last_price = 120 then
    ok := ok || 'senza prezzo si usa l ultimo acquisto; ';
  else
    fails := fails || format('no_price sbagliato (%s, %s); ', r.price_status, r.last_price);
  end if;

  -- Un immobile non si rivaluta ogni settimana: la soglia e' 90 giorni.
  insert into public.holdings (name, asset_class, currency) values ('Casa','real_estate','EUR') returning id into h_casa;
  insert into public.holding_lots (holding_id, side, trade_date, quantity, unit_price)
  values (h_casa,'buy', current_date - 400, 1, 200000);
  insert into public.asset_prices (holding_id, price_date, price, source)
  values (h_casa, current_date - 60, 230000, 'manual');
  select * into r from public.holding_positions(current_date) where holding_id = h_casa;
  if r.price_status = 'fresh' then
    ok := ok || 'immobile: 60 giorni sono ancora freschi; ';
  else
    fails := fails || format('immobile stale troppo presto (%s); ', r.price_status);
  end if;

  -- ── vendita superiore alla giacenza ────────────────────────────────────
  begin
    insert into public.holding_lots (holding_id, side, trade_date, quantity, unit_price)
    values (h_casa,'sell', current_date, 2, 250000);
    fails := fails || 'vendita superiore alla giacenza accettata; ';
  exception when others then ok := ok || 'vendita eccessiva rifiutata; ';
  end;

  -- Anche una vendita inserita PRIMA: a quella data si possedevano 10 quote,
  -- quindi venderne 11 manderebbe il progressivo sotto zero anche se alla fine
  -- della storia la giacenza tornerebbe positiva.
  begin
    insert into public.holding_lots (holding_id, side, trade_date, quantity, unit_price)
    values (h_eur,'sell', current_date - 90, 11, 110);
    fails := fails || 'vendita retroattiva che manda in negativo accettata; ';
  exception when others then ok := ok || 'progressivo controllato a tutte le date; ';
  end;

  -- ── il prezzo manuale non si fa sovrascrivere ──────────────────────────
  begin
    update public.asset_prices set price = 1, source = 'provider'
    where holding_id = h_casa and price_date = current_date - 60;
    fails := fails || 'il provider ha sovrascritto un prezzo manuale; ';
  exception when others then ok := ok || 'prezzo manuale protetto; ';
  end;

  -- ── allocazione e serie, con un secondo utente ─────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);

  -- 7.500 EUR di ETF e 2.500 EUR di crypto: 75% e 25%.
  insert into public.holdings (name, asset_class, currency) values ('ETF','etf','EUR') returning id into h_a;
  insert into public.holdings (name, asset_class, currency) values ('BTC','crypto','EUR') returning id into h_b;
  insert into public.holding_lots (holding_id, side, trade_date, quantity, unit_price)
  values (h_a,'buy', current_date - 10, 100, 50), (h_b,'buy', current_date - 10, 1, 2000);
  insert into public.asset_prices (holding_id, price_date, price, source)
  values (h_a, current_date, 75, 'manual'), (h_b, current_date, 2500, 'manual');

  insert into public.target_allocations (dimension, key, target_pct, tolerance_pct)
  values ('asset_class','etf', 60, 5),
         ('asset_class','crypto', 10, 5),
         ('asset_class','bond', 30, 5);   -- obiettivo su una classe NON posseduta

  select * into r from public.portfolio_allocation('asset_class') where key = 'etf';
  if r.value_base_minor = 750000 and r.pct = 75 and r.drift_pct = 15 and r.out_of_band then
    ok := ok || 'etf 75% contro 60%, fuori banda; ';
  else
    fails := fails || format('etf: valore %s pct %s drift %s oob %s; ', r.value_base_minor, r.pct, r.drift_pct, r.out_of_band);
  end if;

  select * into r from public.portfolio_allocation('asset_class') where key = 'crypto';
  if r.pct = 25 and r.drift_pct = 15 and r.out_of_band then
    ok := ok || 'crypto 25% contro 10%, fuori banda; ';
  else
    fails := fails || format('crypto: pct %s drift %s oob %s; ', r.pct, r.drift_pct, r.out_of_band);
  end if;

  -- Il caso piu' importante: un obiettivo su qualcosa che non possiedi deve
  -- comparire, a zero. Un inner join lo farebbe sparire proprio adesso.
  select * into r from public.portfolio_allocation('asset_class') where key = 'bond';
  if found and r.value_base_minor = 0 and r.pct = 0 and r.drift_pct = -30 and r.out_of_band then
    ok := ok || 'obiettivo senza posizione visibile a 0; ';
  else
    fails := fails || 'obiettivo su classe non posseduta sparito o sbagliato; ';
  end if;

  select count(*) into n from public.portfolio_allocation('asset_class');
  if n = 3 then ok := ok || '3 righe di allocazione; ';
  else fails := fails || format('righe allocazione: %s; ', n); end if;

  select * into r from public.portfolio_allocation('currency') where key = 'EUR';
  if r.pct = 100 then ok := ok || 'per valuta: 100% EUR; ';
  else fails := fails || format('valuta EUR pct %s; ', r.pct); end if;

  select * into r from public.portfolio_allocation('holding') where key = h_a::text;
  if r.label = 'ETF' then ok := ok || 'per investimento: etichetta col nome; ';
  else fails := fails || format('label investimento: %s; ', r.label); end if;

  -- Obiettivi che non fanno 100: la funzione non deve imporlo, avvisa la UI.
  update public.target_allocations set target_pct = 90 where dimension='asset_class' and key='etf';
  select count(*) into n from public.portfolio_allocation('asset_class');
  if n = 3 then ok := ok || 'somma obiettivi <> 100 non blocca; ';
  else fails := fails || 'somma obiettivi diversa da 100 ha rotto la funzione; '; end if;

  -- ── serie storica ──────────────────────────────────────────────────────
  select count(*) into n from public.portfolio_value_series(current_date - 6, current_date, 'day');
  if n = 7 then ok := ok || 'serie giornaliera: 7 punti; ';
  else fails := fails || format('punti serie: %s; ', n); end if;

  select * into r from public.portfolio_value_series(current_date, current_date, 'day');
  if r.value_base_minor = 1000000 and not r.estimated then
    ok := ok || 'oggi vale 10.000 EUR, non stimato; ';
  else
    fails := fails || format('oggi: %s estimated %s; ', r.value_base_minor, r.estimated);
  end if;

  -- Prima che esistesse un prezzo: il punto c'e' ma dichiara di essere stimato.
  select * into r from public.portfolio_value_series(current_date - 9, current_date - 9, 'day');
  if r.estimated then ok := ok || 'punto senza prezzo marcato come stimato; ';
  else fails := fails || 'punto senza prezzo non marcato; '; end if;

  -- Oltre l'anno il passo diventa settimanale da solo.
  select count(*) into n from public.portfolio_value_series(current_date - 400, current_date);
  if n between 55 and 60 then ok := ok || format('oltre l anno passa a settimanale (%s punti); ', n);
  else fails := fails || format('passo automatico sbagliato: %s punti; ', n); end if;

  perform set_config('role','postgres', true);

  if fails = '' then raise exception 'TEST OK -- %', ok;
  else raise exception 'TEST FALLITI -- % || superati: %', fails, ok;
  end if;
end $test$;
