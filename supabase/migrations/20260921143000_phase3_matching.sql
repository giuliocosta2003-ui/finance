-- phase3_matching
-- Duplicati, trasferimenti e categoria dallo storico: tre funzioni che
-- lavorano su tutto l'import in una chiamata sola.
--
-- Stanno nel database e non nel browser per due motivi: il confronto e' fra le
-- righe nuove e TUTTO lo storico dell'utente, che non ha senso scaricare; e la
-- somiglianza fra descrizioni usa pg_trgm, che qui ha un indice.
-- Tutte `security invoker`: vedono solo le righe che vede l'utente.

-- ── duplicati ────────────────────────────────────────────────────────────────
-- Esatto: stessa impronta (conto, data, importo, commerciante, progressivo).
-- Probabile: stesso conto e stesso importo, data entro tre giorni e descrizione
-- simile. La data balla perche' la banca contabilizza quando vuole, ma un
-- importo identico a pochi giorni di distanza merita un'occhiata.
create or replace function public.find_duplicate_candidates(p_import_id uuid)
returns table (
  row_id                 uuid,
  exact_transaction_id   uuid,
  probable_transaction_id uuid,
  probable_similarity    real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with import_info as (
    select i.id, i.account_id from public.imports i where i.id = p_import_id
  )
  select
    r.id,
    (select t.id from public.transactions t
      where t.dedupe_hash = r.dedupe_hash and r.dedupe_hash is not null
      limit 1),
    probable.id,
    probable.sim
  from public.import_rows r
  cross join import_info ii
  left join lateral (
    select t.id, extensions.similarity(coalesce(t.merchant,''), coalesce(r.merchant,'')) as sim
    from public.transactions t
    where t.account_id = ii.account_id
      and t.amount_minor = r.amount_minor
      and r.booked_on is not null
      and t.booked_on between r.booked_on - 3 and r.booked_on + 3
      and coalesce(t.merchant,'') operator(extensions.%) coalesce(r.merchant,'')
      and extensions.similarity(coalesce(t.merchant,''), coalesce(r.merchant,'')) >= 0.5
    order by extensions.similarity(coalesce(t.merchant,''), coalesce(r.merchant,'')) desc
    limit 1
  ) probable on true
  where r.import_id = p_import_id;
$$;

revoke execute on function public.find_duplicate_candidates(uuid) from public, anon;
grant   execute on function public.find_duplicate_candidates(uuid) to authenticated;

-- ── trasferimenti interni ────────────────────────────────────────────────────
-- Importo opposto su un ALTRO conto dell'utente, a pochi giorni di distanza.
-- Con valute diverse il confronto si fa sul controvalore, perche' 1.000.000 VND
-- e 35 EUR sono lo stesso movimento visto dai due lati.
-- Le parole tipiche del giroconto non creano il match da sole: allargano la
-- tolleranza, perche' quando ci sono la probabilita' che sia un giroconto e'
-- alta e le commissioni fanno ballare gli importi.
create or replace function public.find_transfer_candidates(p_import_id uuid)
returns table (
  row_id               uuid,
  match_transaction_id uuid,
  match_row_id         uuid,
  reason               text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with import_info as (
    select i.id, i.account_id, i.user_id from public.imports i where i.id = p_import_id
  ),
  base as (
    select p.base_currency from public.profiles p where p.id = (select auth.uid())
  ),
  rows_in as (
    select r.*,
           -- parole che indicano esplicitamente un giroconto
           (coalesce(r.description,'') || ' ' || coalesce(r.merchant,'')) ~*
             '(giroconto|bonifico a me stesso|transfer|chuyen tien|chuyen khoan|own account|to my account)'
             as has_keyword
    from public.import_rows r
    where r.import_id = p_import_id and r.amount_minor is not null and r.booked_on is not null
  )
  -- contro movimenti gia' registrati
  select
    r.id,
    t.id,
    null::uuid,
    case when r.has_keyword then 'keyword+amount' else 'amount' end
  from rows_in r
  cross join import_info ii
  cross join base b
  join public.transactions t
    on t.account_id <> ii.account_id
   and t.booked_on between r.booked_on - (case when r.has_keyword then 5 else 3 end)
                       and r.booked_on + (case when r.has_keyword then 5 else 3 end)
   and t.kind <> 'transfer'
  where
    case
      when t.currency = r.currency then t.amount_minor = -r.amount_minor
      else
        -- controvalore in valuta base, con tolleranza
        abs(
          coalesce((select fx.rate from public.fx_rate(t.currency, b.base_currency, t.booked_on) fx), 0)
            * t.amount_minor::numeric / power(10::numeric, (select c.minor_units from public.currencies c where c.code = t.currency))
          +
          coalesce((select fx.rate from public.fx_rate(r.currency, b.base_currency, r.booked_on) fx), 0)
            * r.amount_minor::numeric / power(10::numeric, (select c.minor_units from public.currencies c where c.code = r.currency))
        )
        <=
        abs(
          coalesce((select fx.rate from public.fx_rate(r.currency, b.base_currency, r.booked_on) fx), 0)
            * r.amount_minor::numeric / power(10::numeric, (select c.minor_units from public.currencies c where c.code = r.currency))
        ) * (case when r.has_keyword then 0.05 else 0.02 end)
    end

  union all

  -- contro righe di altri import ancora in revisione
  select
    r.id,
    null::uuid,
    other.id,
    case when r.has_keyword then 'keyword+amount (in revisione)' else 'amount (in revisione)' end
  from rows_in r
  cross join import_info ii
  join public.import_rows other
    on other.id <> r.id
   and other.amount_minor = -r.amount_minor
   and other.booked_on between r.booked_on - 3 and r.booked_on + 3
  join public.imports oi
    on oi.id = other.import_id
   and oi.id <> p_import_id
   and oi.status = 'review'
   and oi.account_id <> ii.account_id;
$$;

revoke execute on function public.find_transfer_candidates(uuid) from public, anon;
grant   execute on function public.find_transfer_candidates(uuid) to authenticated;

-- ── categoria dallo storico ──────────────────────────────────────────────────
-- Secondo gradino della categorizzazione, prima di scomodare l'AI: se in
-- passato quel commerciante e' sempre finito in una certa categoria, e' quasi
-- certamente la stessa anche stavolta. Vale solo per i movimenti categorizzati
-- a mano o da regola, non per quelli messi dall'AI, altrimenti un errore
-- dell'AI si tramanderebbe da solo.
create or replace function public.suggest_categories_from_history(p_import_id uuid)
returns table (row_id uuid, category_id uuid, seen integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, best.category_id, best.seen
  from public.import_rows r
  left join lateral (
    select t.category_id, count(*)::integer as seen
    from public.transactions t
    where t.merchant = r.merchant
      and r.merchant is not null
      and t.category_id is not null
      and t.kind <> 'transfer'
    group by t.category_id
    order by count(*) desc, max(t.booked_on) desc
    limit 1
  ) best on true
  where r.import_id = p_import_id and best.category_id is not null;
$$;

revoke execute on function public.suggest_categories_from_history(uuid) from public, anon;
grant   execute on function public.suggest_categories_from_history(uuid) to authenticated;
