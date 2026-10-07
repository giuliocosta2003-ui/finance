-- phase4_document_links
-- Suggerimenti di collegamento fra un documento e cio' che gia' c'e'.
--
-- Sta qui e non nella Edge Function perche' non c'entra l'AI: e' una ricerca
-- su tutto lo storico dell'utente, ed e' il database il posto dove i dati
-- stanno gia'. La funzione SUGGERISCE e basta: il collegamento lo conferma
-- l'utente, sempre. Un documento agganciato al movimento sbagliato e' peggio
-- di un documento non agganciato, perche' nessuno va a ricontrollarlo.
create or replace function public.suggest_document_links(p_document_id uuid)
returns table (
  target_kind  text,
  target_id    uuid,
  label        text,
  on_date      date,
  amount_minor bigint,
  currency     char(3),
  day_gap      integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with doc as (
    -- La RLS fa da sola il controllo: un documento altrui qui non esiste.
    select d.id, d.user_id, d.total_minor, d.currency,
           coalesce(d.doc_date, d.due_date) as ref_date, d.doc_date, d.due_date
    from public.documents d
    where d.id = p_document_id
  ),
  tx as (
    select
      'transaction'::text as target_kind,
      t.id,
      coalesce(t.description, t.merchant, '') as label,
      t.booked_on as on_date,
      t.amount_minor,
      t.currency,
      least(
        abs(t.booked_on - doc.ref_date),
        abs(t.booked_on - coalesce(doc.due_date, doc.ref_date))
      ) as day_gap
    from doc
    join public.transactions t
      on t.currency = doc.currency
     -- Stesso importo in valore assoluto: una fattura da 1.220 puo' essere
     -- stata pagata (uscita) o incassata (entrata).
     and abs(t.amount_minor) = doc.total_minor
     and (
       abs(t.booked_on - doc.ref_date) <= 5
       or (doc.due_date is not null and abs(t.booked_on - doc.due_date) <= 5)
     )
    where doc.total_minor is not null and doc.currency is not null
  ),
  lots as (
    select
      'holding_lot'::text as target_kind,
      l.id,
      h.name as label,
      l.trade_date as on_date,
      (round(l.quantity * l.unit_price * power(10::numeric, c.minor_units)) + l.fees_minor)::bigint as amount_minor,
      h.currency,
      abs(l.trade_date - doc.ref_date) as day_gap
    from doc
    join public.holding_lots l on true
    join public.holdings h on h.id = l.holding_id
    join public.currencies c on c.code = h.currency
    where doc.total_minor is not null
      and doc.currency is not null
      and h.currency = doc.currency
      and abs(l.trade_date - doc.ref_date) <= 5
      -- Su una nota di eseguito il totale include le commissioni; si accetta
      -- uno scarto di una unita' minima per gli arrotondamenti del broker.
      and abs((round(l.quantity * l.unit_price * power(10::numeric, c.minor_units)) + l.fees_minor)
              - doc.total_minor) <= 1
  )
  select target_kind, id, label, on_date, amount_minor, currency, day_gap from tx
  union all
  select target_kind, id, label, on_date, amount_minor, currency, day_gap from lots
  order by day_gap, on_date desc
  limit 20;
$$;

comment on function public.suggest_document_links(uuid) is
  'Movimenti e lotti compatibili per importo e data. Solo suggerimenti: il collegamento lo conferma l utente.';

revoke execute on function public.suggest_document_links(uuid) from public, anon;
grant   execute on function public.suggest_document_links(uuid) to authenticated;
