-- phase3_commit_rollback
-- Conferma e annullamento di un import, in un'unica transazione ciascuno.
-- Entrambe `security invoker`: valgono le policy RLS dell'utente, quindi una
-- RPC non puo' diventare una scorciatoia per toccare i dati di un altro.

-- ── commit_import ────────────────────────────────────────────────────────────
-- Trasferisce in `transactions` le righe marcate `import`. Funziona solo da
-- `review`: e' quello a rendere impossibile confermare due volte, perche' alla
-- fine lo stato diventa `committed` e un secondo tentativo trova lo stato
-- sbagliato invece di duplicare i movimenti.
create or replace function public.commit_import(p_import_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user       uuid := (select auth.uid());
  v_import     public.imports%rowtype;
  v_row        record;
  v_tx_id      uuid;
  v_group      uuid;
  v_partner_tx uuid;
  v_imported   integer := 0;
  v_skipped    integer := 0;
  v_blocked    integer;
begin
  if v_user is null then
    raise exception 'Serve un utente autenticato';
  end if;

  select * into v_import from public.imports i where i.id = p_import_id;
  if not found then
    raise exception 'Import non trovato';
  end if;
  if v_import.status <> 'review' then
    raise exception 'L''import non e'' in revisione (stato: %)', v_import.status;
  end if;

  -- La valuta sbagliata non e' un avviso: importare righe in una valuta
  -- diversa da quella del conto falserebbe ogni saldo successivo.
  select count(*) into v_blocked
  from public.import_rows r
  where r.import_id = p_import_id
    and r.decision = 'import'
    and 'currency_mismatch' = any(r.flags);
  if v_blocked > 0 then
    raise exception 'Ci sono % righe con valuta diversa da quella del conto', v_blocked;
  end if;

  update public.imports set status = 'committing' where id = p_import_id;

  -- Passo 1: le righe diventano movimenti. Si tiene traccia del movimento
  -- creato in matched_transaction_id, che serve subito dopo per i trasferimenti
  -- e piu' avanti per capire da dove viene ogni transazione.
  for v_row in
    select * from public.import_rows r
    where r.import_id = p_import_id and r.decision = 'import'
    order by r.row_index
  loop
    insert into public.transactions
      (user_id, account_id, booked_on, description, merchant, amount_minor, currency,
       kind, category_id, import_id, dedupe_hash)
    values (
      v_user,
      v_import.account_id,
      v_row.booked_on,
      v_row.description,
      v_row.merchant,
      v_row.amount_minor,
      coalesce(v_row.currency, (select a.currency from public.accounts a where a.id = v_import.account_id)),
      case
        when v_row.kind = 'transfer'   then 'transfer'::public.transaction_kind
        when v_row.amount_minor > 0    then 'income'::public.transaction_kind
        else 'expense'::public.transaction_kind
      end,
      case when v_row.kind = 'transfer' then null else v_row.category_id end,
      p_import_id,
      v_row.dedupe_hash
    )
    returning id into v_tx_id;

    update public.import_rows set matched_transaction_id = v_tx_id where id = v_row.id;
    v_imported := v_imported + 1;
  end loop;

  select count(*) into v_skipped
  from public.import_rows r where r.import_id = p_import_id and r.decision = 'skip';

  -- Passo 2: i trasferimenti confermati si legano alla controparte. Va fatto
  -- dopo, perche' la controparte puo' essere una riga dello stesso import che
  -- prima del passo 1 non aveva ancora un movimento.
  for v_row in
    select * from public.import_rows r
    where r.import_id = p_import_id and r.decision = 'import' and r.kind = 'transfer'
    order by r.row_index
  loop
    v_partner_tx := null;

    if v_row.transfer_match_transaction_id is not null then
      v_partner_tx := v_row.transfer_match_transaction_id;
    elsif v_row.transfer_match_row_id is not null then
      select p.matched_transaction_id into v_partner_tx
      from public.import_rows p where p.id = v_row.transfer_match_row_id;
    end if;

    if v_partner_tx is null then
      continue;
    end if;

    select t.transfer_group_id into v_group from public.transactions t where t.id = v_partner_tx;
    if v_group is null then
      v_group := gen_random_uuid();
      -- La controparte diventa anch'essa un trasferimento e perde la categoria:
      -- spostare soldi fra conti propri non e' una spesa.
      update public.transactions
      set kind = 'transfer', category_id = null, transfer_group_id = v_group
      where id = v_partner_tx;
    end if;

    update public.transactions set transfer_group_id = v_group where id = v_row.matched_transaction_id;
  end loop;

  update public.imports
  set status        = 'committed',
      committed_at  = now(),
      rows_imported = v_imported,
      rows_skipped  = v_skipped
  where id = p_import_id;

  insert into public.import_events (import_id, user_id, event, detail)
  values (p_import_id, v_user, 'committed',
          jsonb_build_object('imported', v_imported, 'skipped', v_skipped));

  return jsonb_build_object('ok', true, 'imported', v_imported, 'skipped', v_skipped);
end $$;

revoke execute on function public.commit_import(uuid) from public, anon;
grant   execute on function public.commit_import(uuid) to authenticated;

-- ── rollback_import ──────────────────────────────────────────────────────────
-- Senza `p_confirm` non cancella niente: restituisce solo l'anteprima, perche'
-- annullare un import puo' portarsi via transazioni che l'utente ha corretto a
-- mano dopo averle importate, e quella e' roba che non torna indietro.
create or replace function public.rollback_import(p_import_id uuid, p_confirm boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user      uuid := (select auth.uid());
  v_import    public.imports%rowtype;
  v_count     integer;
  v_modified  integer;
  v_outside   integer;
  v_orphans   uuid[];
begin
  if v_user is null then
    raise exception 'Serve un utente autenticato';
  end if;

  select * into v_import from public.imports i where i.id = p_import_id;
  if not found then
    raise exception 'Import non trovato';
  end if;
  if v_import.status <> 'committed' then
    raise exception 'Si puo'' annullare solo un import confermato (stato: %)', v_import.status;
  end if;

  select count(*) into v_count
  from public.transactions t where t.import_id = p_import_id;

  -- Modificate dopo la conferma: annullando si perdono anche quelle correzioni.
  select count(*) into v_modified
  from public.transactions t
  where t.import_id = p_import_id and t.updated_at > v_import.committed_at;

  -- Trasferimenti la cui controparte non fa parte di questo import: restano
  -- nel database e vanno riportate a entrata o uscita, altrimenti diventano
  -- meta' trasferimento senza l'altra meta'.
  select coalesce(array_agg(distinct partner.id), '{}') into v_orphans
  from public.transactions t
  join public.transactions partner
    on partner.transfer_group_id = t.transfer_group_id and partner.id <> t.id
  where t.import_id = p_import_id
    and t.transfer_group_id is not null
    and (partner.import_id is distinct from p_import_id);
  v_outside := coalesce(array_length(v_orphans, 1), 0);

  if not p_confirm then
    return jsonb_build_object(
      'ok', false,
      'preview', true,
      'transactions', v_count,
      'modified_after_commit', v_modified,
      'transfers_with_outside_counterpart', v_outside
    );
  end if;

  if v_outside > 0 then
    update public.transactions t
    set kind = case when t.amount_minor > 0 then 'income'::public.transaction_kind
                    else 'expense'::public.transaction_kind end,
        transfer_group_id = null,
        category_id = null
    where t.id = any(v_orphans);
  end if;

  delete from public.transactions t where t.import_id = p_import_id;

  update public.imports
  set status = 'rolled_back', rolled_back_at = now(), rows_imported = 0
  where id = p_import_id;

  insert into public.import_events (import_id, user_id, event, detail)
  values (p_import_id, v_user, 'rolled_back',
          jsonb_build_object('deleted', v_count, 'modified_after_commit', v_modified,
                             'counterparts_detached', v_outside));

  return jsonb_build_object(
    'ok', true,
    'deleted', v_count,
    'modified_after_commit', v_modified,
    'counterparts_detached', v_outside
  );
end $$;

revoke execute on function public.rollback_import(uuid, boolean) from public, anon;
grant   execute on function public.rollback_import(uuid, boolean) to authenticated;
