-- supabase/tests/phase3_isolation.sql
-- Isolamento, duplicati, trasferimenti, conferma e annullamento della fase 3.
-- Stessa forma della fase 2: un DO block che alla fine solleva un'eccezione,
-- cosi' il rollback e' garantito e i dati di prova non restano.
do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  a_eur uuid; a_eur2 uuid; a_vnd uuid; b_acc uuid;
  c_spesa uuid;
  i1 uuid; i2 uuid; b_imp uuid;
  r_dup uuid; r_new uuid; r_prob uuid; r_transf uuid;
  tx_esselunga uuid; tx_vnd uuid;
  n integer; v_rate numeric; v_eur_minor bigint;
  v_res jsonb;
  ok text := '';
  fails text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (u1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','p3-uno@example.invalid','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb),
    (u2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','p3-due@example.invalid','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb);

  update public.profiles set full_name='Uno', profile_type='entrepreneur', base_currency='EUR', country='IT', onboarding_completed=true where id=u1;
  update public.profiles set full_name='Due', profile_type='employee', base_currency='VND', country='VN', onboarding_completed=true where id=u2;

  perform set_config('role','authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);

  perform public.seed_default_categories();
  select id into c_spesa from public.categories where user_id=u1 and key='groceries';

  insert into public.accounts (name,type,currency) values ('Conto EUR','checking','EUR') returning id into a_eur;
  insert into public.accounts (name,type,currency) values ('Secondo EUR','savings','EUR') returning id into a_eur2;
  insert into public.accounts (name,type,currency) values ('Cassa VND','cash','VND') returning id into a_vnd;

  -- ── primo import: due caffe' identici nello stesso giorno ───────────────
  insert into public.imports (account_id, storage_path, file_name, file_type, status, parser)
  values (a_eur, u1||'/i1/estratto.csv', 'estratto.csv', 'csv', 'review', 'csv') returning id into i1;

  insert into public.import_rows (import_id,row_index,booked_on,description,merchant,amount_minor,currency,kind,category_id,category_source,confidence,dedupe_hash)
  values
    (i1,0,date '2026-09-01','POS ESSELUNGA MILANO','esselunga milano',-4530,'EUR','expense',c_spesa,'rule','high','h-esselunga'),
    (i1,1,date '2026-09-07','POS CAFFE DEL CORSO','caffe del corso',-250,'EUR','expense',c_spesa,'ai','medium','h-caffe-0'),
    (i1,2,date '2026-09-07','POS CAFFE DEL CORSO','caffe del corso',-250,'EUR','expense',c_spesa,'ai','medium','h-caffe-1');

  v_res := public.commit_import(i1);
  select count(*) into n from public.transactions where import_id=i1;
  if n <> 3 then fails := fails || format('commit ha creato %s movimenti invece di 3; ', n);
  else ok := ok || 'commit 3 movimenti; '; end if;

  select count(*) into n from public.transactions where import_id=i1 and merchant='caffe del corso';
  if n <> 2 then fails := fails || 'i due caffe identici non sono entrati entrambi; ';
  else ok := ok || 'due caffe uguali = due movimenti; '; end if;

  -- conferma ripetuta
  begin
    perform public.commit_import(i1);
    fails := fails || 'seconda conferma accettata; ';
  exception when others then ok := ok || 'seconda conferma rifiutata; ';
  end;

  select id into tx_esselunga from public.transactions where import_id=i1 and merchant='esselunga milano';

  -- ── secondo import: sovrapposto al primo ───────────────────────────────
  insert into public.imports (account_id, storage_path, file_name, file_type, status, parser)
  values (a_eur, u1||'/i2/estratto2.csv','estratto2.csv','csv','review','csv') returning id into i2;

  insert into public.import_rows (import_id,row_index,booked_on,description,merchant,amount_minor,currency,dedupe_hash)
  values (i2,0,date '2026-09-01','POS ESSELUNGA MILANO','esselunga milano',-4530,'EUR','h-esselunga')
  returning id into r_dup;

  insert into public.import_rows (import_id,row_index,booked_on,description,merchant,amount_minor,currency,dedupe_hash)
  values (i2,1,date '2026-09-15','POS IKEA','ikea',-8900,'EUR','h-ikea')
  returning id into r_new;

  -- stesso importo, due giorni dopo, descrizione simile: duplicato PROBABILE
  insert into public.import_rows (import_id,row_index,booked_on,description,merchant,amount_minor,currency,dedupe_hash)
  values (i2,2,date '2026-09-03','POS ESSELUNGA MILANO CENTRO','esselunga milano centro',-4530,'EUR','h-esselunga-2')
  returning id into r_prob;

  select count(*) into n from public.find_duplicate_candidates(i2) d
   where d.row_id = r_dup and d.exact_transaction_id = tx_esselunga;
  if n <> 1 then fails := fails || 'duplicato esatto non riconosciuto; ';
  else ok := ok || 'duplicato esatto riconosciuto; '; end if;

  select count(*) into n from public.find_duplicate_candidates(i2) d
   where d.row_id = r_new and (d.exact_transaction_id is not null or d.probable_transaction_id is not null);
  if n <> 0 then fails := fails || 'riga nuova segnalata come duplicato; ';
  else ok := ok || 'riga nuova non segnalata; '; end if;

  select count(*) into n from public.find_duplicate_candidates(i2) d
   where d.row_id = r_prob and d.exact_transaction_id is null and d.probable_transaction_id = tx_esselunga;
  if n <> 1 then fails := fails || 'duplicato probabile non riconosciuto; ';
  else ok := ok || 'duplicato probabile riconosciuto (trigram); '; end if;

  -- ── trasferimenti ──────────────────────────────────────────────────────
  -- Controparte gia' registrata, stessa valuta: +200 EUR sul secondo conto.
  insert into public.transactions (account_id,booked_on,description,amount_minor,currency,kind)
  values (a_eur2, date '2026-09-20','Giroconto in arrivo',20000,'EUR','income');

  insert into public.import_rows (import_id,row_index,booked_on,description,merchant,amount_minor,currency,dedupe_hash)
  values (i2,3,date '2026-09-20','GIROCONTO VERSO RISPARMIO','giroconto verso risparmio',-20000,'EUR','h-giro')
  returning id into r_transf;

  select count(*) into n from public.find_transfer_candidates(i2) t where t.row_id = r_transf;
  if n < 1 then fails := fails || 'trasferimento in stessa valuta non trovato; ';
  else ok := ok || 'trasferimento stessa valuta trovato; '; end if;

  -- Valute diverse: 1.400.000 VND gia' registrati, e l'uscita in EUR di pari
  -- controvalore. L'importo si calcola col cambio vero, non a occhio.
  insert into public.transactions (account_id,booked_on,description,amount_minor,currency,kind)
  values (a_vnd, date '2026-09-18','Arrivo da EUR',1400000,'VND','income') returning id into tx_vnd;

  select rate into v_rate from public.fx_rate('VND','EUR', date '2026-09-18');
  v_eur_minor := -round(1400000::numeric * v_rate * 100);

  insert into public.import_rows (import_id,row_index,booked_on,description,merchant,amount_minor,currency,dedupe_hash)
  values (i2,4,date '2026-09-18','CHUYEN TIEN AL MIO CONTO VND','al mio conto vnd', v_eur_minor,'EUR','h-giro-vnd');

  select count(*) into n from public.find_transfer_candidates(i2) t
   join public.import_rows r on r.id = t.row_id
   where r.row_index = 4 and t.match_transaction_id = tx_vnd;
  if n < 1 then fails := fails || format('trasferimento EUR<->VND non trovato (eur=%s, tasso=%s); ', v_eur_minor, v_rate);
  else ok := ok || 'trasferimento fra valute diverse trovato; '; end if;

  -- Fuori tolleranza: stesso giorno ma importo del 20% piu' alto.
  insert into public.import_rows (import_id,row_index,booked_on,description,merchant,amount_minor,currency,dedupe_hash)
  values (i2,5,date '2026-09-18','SPESA QUALSIASI','spesa qualsiasi', round(v_eur_minor*1.2),'EUR','h-fuori');
  select count(*) into n from public.find_transfer_candidates(i2) t
   join public.import_rows r on r.id = t.row_id where r.row_index = 5;
  if n > 0 then fails := fails || 'importo fuori tolleranza scambiato per trasferimento; ';
  else ok := ok || 'fuori tolleranza: nessun falso trasferimento; '; end if;

  -- ── conferma con trasferimento ─────────────────────────────────────────
  update public.import_rows set decision='skip' where id = r_dup;              -- doppione esatto
  update public.import_rows set kind='transfer', category_id=null,
         transfer_match_transaction_id=(select t.id from public.transactions t
                                        where t.account_id=a_eur2 and t.amount_minor=20000)
   where id = r_transf;
  update public.import_rows set decision='skip' where row_index in (4,5) and import_id=i2;

  -- Restano da importare: ikea, il duplicato PROBABILE (che resta importabile
  -- di proposito) e il giroconto. Il duplicato esatto no: quello e' scartato.
  v_res := public.commit_import(i2);
  if (v_res->>'imported')::int <> 3 then
    fails := fails || format('commit 2: importate %s invece di 3; ', v_res->>'imported');
  else ok := ok || 'commit 2: 3 importate, doppione esatto fuori; '; end if;

  -- La prova vera che due estratti sovrapposti non creano doppioni.
  select count(*) into n from public.transactions where dedupe_hash = 'h-esselunga';
  if n <> 1 then fails := fails || format('la riga sovrapposta e finita due volte (%s); ', n);
  else ok := ok || 'estratti sovrapposti: nessun doppione; '; end if;

  select count(*) into n from public.transactions t
   where t.transfer_group_id is not null and t.import_id = i2;
  if n <> 1 then fails := fails || 'il trasferimento confermato non e stato collegato; ';
  else ok := ok || 'trasferimento collegato; '; end if;

  select count(*) into n from public.transactions t
   where t.account_id = a_eur2 and t.kind = 'transfer' and t.transfer_group_id is not null;
  if n <> 1 then fails := fails || 'la controparte non e diventata trasferimento; ';
  else ok := ok || 'controparte trasformata in trasferimento; '; end if;

  -- ── anteprima e annullamento ───────────────────────────────────────────
  -- Dentro una sola transazione now() non avanza, quindi la conferma e la
  -- modifica avrebbero lo stesso istante. Si arretra la conferma di un'ora e
  -- si allineano le righe, cosi' "modificata DOPO l'import" ha un senso.
  perform set_config('role','postgres', true);
  update public.imports set committed_at = now() - interval '1 hour' where id = i2;
  alter table public.transactions disable trigger transactions_updated_at;
  update public.transactions set updated_at = now() - interval '1 hour' where import_id = i2;
  alter table public.transactions enable trigger transactions_updated_at;
  perform set_config('role','authenticated', true);

  update public.transactions set description = 'corretto a mano'
   where id = (select t.id from public.transactions t where t.import_id=i2 and t.merchant='ikea');

  v_res := public.rollback_import(i2, false);
  if (v_res->>'preview')::boolean is not true then
    fails := fails || 'rollback senza conferma non ha restituito l anteprima; ';
  else ok := ok || 'anteprima del rollback; '; end if;
  if (v_res->>'modified_after_commit')::int <> 1 then
    fails := fails || format('modificate dopo l import: %s invece di 1; ', v_res->>'modified_after_commit');
  else ok := ok || 'esattamente 1 modifica successiva segnalata; '; end if;
  if (v_res->>'transfers_with_outside_counterpart')::int < 1 then
    fails := fails || 'controparte fuori import non segnalata; ';
  else ok := ok || 'controparte fuori import segnalata; '; end if;

  select count(*) into n from public.transactions where import_id = i2;
  if n = 0 then fails := fails || 'l anteprima ha gia cancellato; '; end if;

  v_res := public.rollback_import(i2, true);
  select count(*) into n from public.transactions where import_id = i2;
  if n <> 0 then fails := fails || 'rollback non ha cancellato; ';
  else ok := ok || 'rollback eseguito; '; end if;

  select count(*) into n from public.transactions t
   where t.account_id = a_eur2 and t.kind = 'income' and t.transfer_group_id is null;
  if n <> 1 then fails := fails || 'la controparte non e tornata entrata; ';
  else ok := ok || 'controparte tornata entrata senza gruppo; '; end if;

  select count(*) into n from public.transactions where import_id = i1;
  if n <> 3 then fails := fails || 'il rollback ha toccato un altro import; ';
  else ok := ok || 'altri import intatti; '; end if;

  -- ── regole ─────────────────────────────────────────────────────────────
  insert into public.merchant_rules (pattern, match_type, category_id, created_from)
  values ('ikea','exact',c_spesa,'correction');
  begin
    insert into public.merchant_rules (pattern, match_type, category_id) values ('ikea','exact',c_spesa);
    fails := fails || 'regola duplicata accettata; ';
  exception when unique_violation then ok := ok || 'regola unica per pattern e tipo; ';
  end;

  -- ── storage ────────────────────────────────────────────────────────────
  insert into storage.objects (bucket_id, name, owner_id)
  values ('statements', u1 || '/i1/estratto.csv', u1::text);
  ok := ok || 'u1 carica nella sua cartella; ';

  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('statements', u2 || '/altrui/f.csv', u1::text);
    fails := fails || 'u1 ha caricato nella cartella di u2; ';
  exception when others then ok := ok || 'cartella altrui vietata in scrittura; ';
  end;

  -- ── utente 2 ───────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);

  select count(*) into n from public.imports;
  if n <> 0 then fails := fails || 'u2 vede gli import di u1; '; else ok := ok || 'u2 non vede gli import; '; end if;
  select count(*) into n from public.import_rows;
  if n <> 0 then fails := fails || 'u2 vede le righe di u1; '; else ok := ok || 'u2 non vede le righe; '; end if;
  select count(*) into n from public.import_events;
  if n <> 0 then fails := fails || 'u2 vede il diario di u1; '; else ok := ok || 'u2 non vede il diario; '; end if;
  select count(*) into n from public.merchant_rules;
  if n <> 0 then fails := fails || 'u2 vede le regole di u1; '; else ok := ok || 'u2 non vede le regole; '; end if;
  select count(*) into n from public.parser_profiles;
  if n <> 0 then fails := fails || 'u2 vede i profili di u1; '; end if;

  -- il file di u1, conoscendone il percorso esatto
  select count(*) into n from storage.objects where name = u1 || '/i1/estratto.csv';
  if n <> 0 then fails := fails || 'u2 vede il file di u1 conoscendo il percorso; ';
  else ok := ok || 'u2 non vede il file di u1 nemmeno col percorso; '; end if;

  update public.imports set status = 'failed' where id = i1;
  get diagnostics n = row_count;
  if n <> 0 then fails := fails || 'u2 ha modificato un import di u1; '; else ok := ok || 'u2 non modifica gli import; '; end if;

  -- riga agganciata all'import di u1: deve fallire la FK composta
  insert into public.accounts (name,type,currency) values ('Conto di due','cash','VND') returning id into b_acc;
  begin
    insert into public.import_rows (import_id,row_index,amount_minor,currency)
    values (i1, 99, -100, 'VND');
    fails := fails || 'u2 ha aggiunto una riga all import di u1; ';
  exception when others then ok := ok || 'FK composta blocca l import altrui; ';
  end;

  -- il diario e' solo in aggiunta: nessun update, nessun delete
  insert into public.imports (account_id, storage_path, file_name, file_type)
  values (b_acc, u2||'/x/f.csv','f.csv','csv') returning id into b_imp;
  insert into public.import_events (import_id, event, detail) values (b_imp, 'uploaded', '{}'::jsonb);
  begin
    update public.import_events set event = 'committed' where import_id = b_imp;
    fails := fails || 'il diario e modificabile; ';
  exception when insufficient_privilege then ok := ok || 'diario non modificabile; ';
  end;
  begin
    delete from public.import_events where import_id = b_imp;
    fails := fails || 'il diario e cancellabile; ';
  exception when insufficient_privilege then ok := ok || 'diario non cancellabile; ';
  end;

  -- La riga di `imports` e' ora pubblicata in Realtime: UPDATE e DELETE devono
  -- continuare a funzionare. Una tabella in una publication senza replica
  -- identity li rifiuta, e qui la chiave primaria e' quello che la fornisce.
  update public.imports set status = 'parsing', rows_total = 7 where id = b_imp;
  get diagnostics n = row_count;
  if n <> 1 then fails := fails || 'update su un import pubblicato in Realtime fallito; ';
  else ok := ok || 'imports aggiornabile con Realtime attivo; '; end if;
  delete from public.imports where id = b_imp;
  get diagnostics n = row_count;
  if n <> 1 then fails := fails || 'delete su un import pubblicato in Realtime fallito; ';
  else ok := ok || 'imports cancellabile con Realtime attivo; '; end if;

  -- ── anonimo ────────────────────────────────────────────────────────────
  perform set_config('role','anon', true);
  perform set_config('request.jwt.claims','{"role":"anon"}', true);
  begin
    select count(*) into n from public.imports;
    fails := fails || 'anon legge gli import; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge gli import; ';
  end;
  begin
    select count(*) into n from public.merchant_rules;
    fails := fails || 'anon legge le regole; ';
  exception when insufficient_privilege then ok := ok || 'anon non legge le regole; ';
  end;

  perform set_config('role','postgres', true);

  if fails = '' then raise exception 'TEST OK -- %', ok;
  else raise exception 'TEST FALLITI -- % || superati: %', fails, ok;
  end if;
end $test$;
