-- phase4_positions
-- Posizioni, allocazione e serie storica del valore.
--
-- Sono funzioni con un parametro di data, non view: lo stesso codice deve
-- rispondere sia a "quanto valgo oggi" sia a "quanto valevo il 3 marzo". Una
-- view saprebbe fare solo la prima, e il grafico finirebbe per avere una
-- seconda implementazione che col tempo diverge dalla prima.
--
-- Tutte `stable`, `security invoker`, `search_path` vuoto: leggono con i
-- diritti di chi chiama, quindi la RLS vale anche qui dentro.

/*
 * holding_positions(as_of)
 *
 * Una riga per investimento, alla data richiesta.
 *
 * Il P&L non realizzato e' diviso in due, e la divisione non e' un vezzo: se
 * hai un ETF in dollari e il tuo bilancio e' in euro, una parte del guadagno
 * viene dal titolo e una dal cambio, e sono due cose che si commentano in modo
 * diverso. La somma delle due e' esattamente il P&L totale:
 *
 *   effetto prezzo = (valore - costo, in valuta dell'investimento) x cambio di oggi
 *   effetto cambio = costo in valuta investimento x cambio di oggi - costo in valuta base
 *   -------------------------------------------------------------------------
 *   totale         = valore x cambio di oggi - costo in valuta base
 *
 * Il metodo (LIFO, costo medio, FIFO) decide solo QUALE costo si scarica
 * quando si vende, e quindi come il costo totale si divide fra realizzato e
 * residuo. Le commissioni d'acquisto entrano nel costo, quelle di vendita
 * riducono il ricavo.
 */
create or replace function public.holding_positions(p_as_of date default current_date)
returns table (
  holding_id               uuid,
  name                     text,
  symbol                   text,
  isin                     char(12),
  asset_class              public.asset_class,
  currency                 char(3),
  price_provider           public.price_provider,
  archived_at              timestamptz,
  base_currency            char(3),
  pnl_method               public.pnl_method,
  quantity                 numeric,
  avg_unit_cost            numeric,
  cost_residual            numeric,
  cost_residual_base_minor bigint,
  realized_pl              numeric,
  realized_pl_base_minor   bigint,
  last_price               numeric,
  last_price_date          date,
  price_status             text,
  value                    numeric,
  value_base_minor         bigint,
  unrealized_pl_base_minor bigint,
  price_effect_base_minor  bigint,
  fx_effect_base_minor     bigint,
  fx_rate_used             numeric,
  fx_rate_date             date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_base       char(3);
  v_base_units integer;
  v_method     public.pnl_method;
  h            record;
  l            record;
  v_units      integer;
  v_fee        numeric;
  v_rate       numeric;
  v_unit_cost  numeric;
  v_unit_base  numeric;
  -- Coda dei lotti ancora aperti, tre array paralleli: quantita', costo
  -- unitario nella valuta dell'investimento, costo unitario in valuta base.
  -- Serve solo a LIFO e FIFO; il costo medio tiene tre totali e basta.
  q_qty        numeric[];
  q_cost       numeric[];
  q_base       numeric[];
  v_idx        integer;
  v_len        integer;
  v_take       numeric;
  v_open_qty   numeric;
  v_open_cost  numeric;
  v_open_base  numeric;
  v_realized   numeric;
  v_real_base  numeric;
  v_proceeds   numeric;
  v_cost_out   numeric;
  v_base_out   numeric;
  v_frac       numeric;
  v_price      numeric;
  v_price_date date;
  v_status     text;
  v_last_buy   numeric;
  v_stale      integer;
  v_value      numeric;
  v_cur_rate   numeric;
  v_cur_date   date;
  i            integer;
begin
  select p.base_currency, p.pnl_method into v_base, v_method
  from public.profiles p where p.id = (select auth.uid());
  if v_base is null then return; end if;

  select c.minor_units into v_base_units from public.currencies c where c.code = v_base;

  for h in select hh.* from public.holdings hh order by hh.name loop
    select c.minor_units into v_units from public.currencies c where c.code = h.currency;

    q_qty := '{}'; q_cost := '{}'; q_base := '{}';
    v_open_qty := 0; v_open_cost := 0; v_open_base := 0;
    v_realized := 0; v_real_base := 0; v_last_buy := null;

    for l in
      select ll.* from public.holding_lots ll
      where ll.holding_id = h.id and ll.trade_date <= p_as_of
      order by ll.trade_date, ll.created_at, ll.id
    loop
      -- Le commissioni sono in minor units della valuta dell'investimento.
      v_fee := l.fees_minor::numeric / power(10::numeric, v_units);

      if h.currency = v_base then
        v_rate := 1;
      else
        select fx.rate into v_rate from public.fx_rate(h.currency, v_base, l.trade_date) fx;
      end if;
      -- Il tasso forzato dall'utente vince; se non c'e' nessun tasso alla data
      -- del lotto si ripiega sul piu' recente, altrimenti il costo in valuta
      -- base sarebbe nullo e con lui tutta la colonna.
      v_rate := coalesce(l.fx_override_rate, v_rate,
                         (select fx2.rate from public.fx_rate(h.currency, v_base, p_as_of) fx2));

      if l.side = 'buy' then
        v_last_buy  := l.unit_price;
        v_unit_cost := (l.quantity * l.unit_price + v_fee) / l.quantity;
        v_unit_base := v_unit_cost * v_rate;

        if v_method = 'average' then
          v_open_cost := v_open_cost + v_unit_cost * l.quantity;
          v_open_base := v_open_base + v_unit_base * l.quantity;
        else
          q_qty  := array_append(q_qty,  l.quantity);
          q_cost := array_append(q_cost, v_unit_cost);
          q_base := array_append(q_base, v_unit_base);
        end if;
        v_open_qty := v_open_qty + l.quantity;

      else
        v_proceeds := l.quantity * l.unit_price - v_fee;
        v_cost_out := 0;
        v_base_out := 0;

        if v_method = 'average' then
          -- Il costo medio non cambia vendendo: si scarica la stessa quota di
          -- costo che si scarica di quantita'.
          if v_open_qty > 0 then
            v_frac      := l.quantity / v_open_qty;
            v_cost_out  := v_open_cost * v_frac;
            v_base_out  := v_open_base * v_frac;
            v_open_cost := v_open_cost - v_cost_out;
            v_open_base := v_open_base - v_base_out;
          end if;
        else
          -- LIFO prende dal fondo, FIFO dalla testa. Ogni pezzo si porta
          -- dietro il proprio costo e il proprio cambio d'acquisto.
          v_take := l.quantity;
          while v_take > 0 and coalesce(array_length(q_qty, 1), 0) > 0 loop
            v_len := array_length(q_qty, 1);
            v_idx := case when v_method = 'fifo' then 1 else v_len end;

            if q_qty[v_idx] <= v_take then
              v_cost_out := v_cost_out + q_qty[v_idx] * q_cost[v_idx];
              v_base_out := v_base_out + q_qty[v_idx] * q_base[v_idx];
              v_take     := v_take - q_qty[v_idx];
              q_qty  := q_qty[1:v_idx-1]  || q_qty[v_idx+1:v_len];
              q_cost := q_cost[1:v_idx-1] || q_cost[v_idx+1:v_len];
              q_base := q_base[1:v_idx-1] || q_base[v_idx+1:v_len];
            else
              v_cost_out    := v_cost_out + v_take * q_cost[v_idx];
              v_base_out    := v_base_out + v_take * q_base[v_idx];
              q_qty[v_idx]  := q_qty[v_idx] - v_take;
              v_take        := 0;
            end if;
          end loop;
        end if;

        v_open_qty  := v_open_qty - l.quantity;
        v_realized  := v_realized  + (v_proceeds - v_cost_out);
        v_real_base := v_real_base + (v_proceeds - v_cost_out) * v_rate;
      end if;
    end loop;

    -- Costo residuo: per LIFO e FIFO e' quello che e' rimasto nella coda.
    if v_method <> 'average' then
      v_open_cost := 0;
      v_open_base := 0;
      for i in 1 .. coalesce(array_length(q_qty, 1), 0) loop
        v_open_cost := v_open_cost + q_qty[i] * q_cost[i];
        v_open_base := v_open_base + q_qty[i] * q_base[i];
      end loop;
    end if;

    -- Ultimo prezzo utilizzabile alla data richiesta.
    select ap.price, ap.price_date into v_price, v_price_date
    from public.asset_prices ap
    where ap.holding_id = h.id and ap.price_date <= p_as_of
    order by ap.price_date desc
    limit 1;

    -- Un immobile non si rivaluta ogni settimana: 90 giorni, non 7.
    v_stale := case when h.asset_class = 'real_estate' then 90 else 7 end;

    if v_price is null then
      -- Nessun prezzo: si usa l'ultimo prezzo d'acquisto, e lo si dichiara.
      v_price      := v_last_buy;
      v_price_date := null;
      v_status     := 'no_price';
    elsif (p_as_of - v_price_date) > v_stale then
      v_status := 'stale';
    else
      v_status := 'fresh';
    end if;

    if h.currency = v_base then
      v_cur_rate := 1;
      v_cur_date := p_as_of;
    else
      select fx.rate, fx.effective_date into v_cur_rate, v_cur_date
      from public.fx_rate(h.currency, v_base, p_as_of) fx;
    end if;

    v_value := v_open_qty * coalesce(v_price, 0);

    holding_positions.holding_id     := h.id;
    holding_positions.name           := h.name;
    holding_positions.symbol         := h.symbol;
    holding_positions.isin           := h.isin;
    holding_positions.asset_class    := h.asset_class;
    holding_positions.currency       := h.currency;
    holding_positions.price_provider := h.price_provider;
    holding_positions.archived_at    := h.archived_at;
    holding_positions.base_currency  := v_base;
    holding_positions.pnl_method     := v_method;
    holding_positions.quantity       := v_open_qty;
    holding_positions.avg_unit_cost  := case when v_open_qty > 0 then v_open_cost / v_open_qty end;
    holding_positions.cost_residual  := v_open_cost;
    holding_positions.realized_pl    := v_realized;
    holding_positions.last_price     := v_price;
    holding_positions.last_price_date:= v_price_date;
    holding_positions.price_status   := v_status;
    holding_positions.value          := v_value;
    holding_positions.fx_rate_used   := v_cur_rate;
    holding_positions.fx_rate_date   := v_cur_date;

    holding_positions.cost_residual_base_minor :=
      round(v_open_base * power(10::numeric, v_base_units))::bigint;
    holding_positions.realized_pl_base_minor :=
      round(v_real_base * power(10::numeric, v_base_units))::bigint;
    holding_positions.value_base_minor :=
      round(v_value * v_cur_rate * power(10::numeric, v_base_units))::bigint;
    holding_positions.price_effect_base_minor :=
      round((v_value - v_open_cost) * v_cur_rate * power(10::numeric, v_base_units))::bigint;
    holding_positions.fx_effect_base_minor :=
      round((v_open_cost * v_cur_rate - v_open_base) * power(10::numeric, v_base_units))::bigint;
    holding_positions.unrealized_pl_base_minor :=
      round((v_value * v_cur_rate - v_open_base) * power(10::numeric, v_base_units))::bigint;

    return next;
  end loop;
end $$;

comment on function public.holding_positions(date) is
  'Posizioni alla data richiesta: quantita, costo, P&L realizzato e non, diviso in effetto prezzo ed effetto cambio.';

/*
 * portfolio_allocation(dimensione)
 *
 * Quanto pesa oggi ogni classe, valuta o singolo investimento, contro
 * l'obiettivo. Il FULL JOIN sugli obiettivi non e' un dettaglio: un obiettivo
 * al 10% su una classe che NON possiedi e' il caso piu' interessante di tutti,
 * e un inner join lo farebbe sparire proprio quando serve vederlo.
 */
create or replace function public.portfolio_allocation(p_dimension public.allocation_dimension)
returns table (
  dimension        public.allocation_dimension,
  key              text,
  label            text,
  value_base_minor bigint,
  pct              numeric,
  target_pct       numeric,
  tolerance_pct    numeric,
  drift_pct        numeric,
  out_of_band      boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with pos as (
    select * from public.holding_positions(current_date)
  ),
  keyed as (
    select
      case p_dimension
        when 'asset_class' then p.asset_class::text
        when 'currency'    then p.currency::text
        else p.holding_id::text
      end as k,
      case p_dimension
        when 'asset_class' then p.asset_class::text
        when 'currency'    then p.currency::text
        else p.name
      end as lbl,
      coalesce(p.value_base_minor, 0) as v
    from pos p
    where p.quantity > 0
  ),
  agg as (
    select k, min(lbl) as lbl, sum(v)::bigint as v
    from keyed group by k
  ),
  tot as (
    select nullif(sum(a.v), 0)::numeric as total from agg a
  )
  select
    p_dimension,
    coalesce(a.k, t.key),
    coalesce(a.lbl, hn.name, t.key),
    coalesce(a.v, 0)::bigint,
    case when (select total from tot) is null then 0::numeric
         else round(coalesce(a.v, 0)::numeric * 100 / (select total from tot), 2) end,
    t.target_pct,
    t.tolerance_pct,
    case when t.target_pct is null then null
         else round(
                (case when (select total from tot) is null then 0::numeric
                      else coalesce(a.v, 0)::numeric * 100 / (select total from tot) end)
                - t.target_pct, 2)
    end,
    case when t.target_pct is null then false
         else abs(
                (case when (select total from tot) is null then 0::numeric
                      else coalesce(a.v, 0)::numeric * 100 / (select total from tot) end)
                - t.target_pct) > t.tolerance_pct
    end
  from agg a
  full join public.target_allocations t
    on t.dimension = p_dimension and t.key = a.k
  -- Solo per la dimensione "singolo investimento": la chiave e' un uuid, e da
  -- sola non si puo' mostrare a nessuno.
  left join public.holdings hn
    on p_dimension = 'holding' and a.k is null and hn.id::text = t.key
  order by 4 desc, 3;
$$;

comment on function public.portfolio_allocation(public.allocation_dimension) is
  'Peso attuale contro obiettivo, per classe, valuta o investimento. out_of_band quando lo scostamento supera la tolleranza.';

/*
 * portfolio_value_series(da, a, passo)
 *
 * Valore del portafoglio in valuta base a ogni passo. Per ogni giorno usa la
 * quantita' posseduta a quella data, l'ultimo prezzo non successivo e
 * l'ultimo cambio non successivo.
 *
 * `estimated` marca i punti in cui almeno un investimento non aveva un prezzo
 * abbastanza recente: nel grafico si disegnano tratteggiati, perche' una linea
 * continua su dati inventati e' peggio di un buco.
 *
 * Passo giornaliero fino a un anno, settimanale oltre: oltre i 365 punti il
 * grafico non guadagna nulla e ogni punto costa una ricerca di prezzo e una
 * di cambio per investimento.
 */
create or replace function public.portfolio_value_series(
  p_from date,
  p_to   date default current_date,
  p_step text default null
)
returns table (
  d                date,
  value_base_minor bigint,
  estimated        boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_base       char(3);
  v_base_units integer;
  v_interval   interval;
begin
  select p.base_currency into v_base from public.profiles p where p.id = (select auth.uid());
  if v_base is null or p_from is null or p_to is null or p_to < p_from then return; end if;

  select c.minor_units into v_base_units from public.currencies c where c.code = v_base;

  v_interval := case
    when p_step = 'week' then interval '7 days'
    when p_step = 'day'  then interval '1 day'
    when (p_to - p_from) > 366 then interval '7 days'
    else interval '1 day'
  end;

  return query
  with days as (
    select gs::date as d from generate_series(p_from, p_to, v_interval) gs
  ),
  held as (
    select d.d, h.id as holding_id, h.currency, h.asset_class,
           coalesce(sum(case when l.side = 'buy' then l.quantity else -l.quantity end), 0) as qty
    from days d
    cross join public.holdings h
    left join public.holding_lots l
      on l.holding_id = h.id and l.trade_date <= d.d
    group by d.d, h.id, h.currency, h.asset_class
  ),
  priced as (
    select
      x.d, x.qty, x.currency, x.asset_class,
      pr.price, pr.price_date,
      lb.unit_price as last_buy_price
    from held x
    left join lateral (
      select ap.price, ap.price_date
      from public.asset_prices ap
      where ap.holding_id = x.holding_id and ap.price_date <= x.d
      order by ap.price_date desc limit 1
    ) pr on true
    left join lateral (
      select ll.unit_price
      from public.holding_lots ll
      where ll.holding_id = x.holding_id and ll.side = 'buy' and ll.trade_date <= x.d
      order by ll.trade_date desc limit 1
    ) lb on true
    where x.qty > 0
  ),
  converted as (
    select
      p.d,
      p.qty * coalesce(p.price, p.last_buy_price, 0)
            * coalesce(case when p.currency = v_base then 1 else fx.rate end, 0) as v,
      -- Stimato se il prezzo manca del tutto o e' piu' vecchio della soglia
      -- di quella classe di attivita'.
      (p.price is null
       or (p.d - p.price_date) > case when p.asset_class = 'real_estate' then 90 else 7 end
      ) as est
    from priced p
    left join lateral public.fx_rate(p.currency, v_base, p.d) fx on true
  )
  select
    days.d,
    round(coalesce(sum(c.v), 0) * power(10::numeric, v_base_units))::bigint,
    coalesce(bool_or(c.est), false)
  from days
  left join converted c on c.d = days.d
  group by days.d
  order by days.d;
end $$;

comment on function public.portfolio_value_series(date, date, text) is
  'Valore del portafoglio in valuta base nel tempo. estimated = true dove almeno un prezzo era mancante o vecchio.';

-- ── permessi ─────────────────────────────────────────────────────────────────
revoke execute on function public.holding_positions(date) from public, anon;
grant   execute on function public.holding_positions(date) to authenticated;

revoke execute on function public.portfolio_allocation(public.allocation_dimension) from public, anon;
grant   execute on function public.portfolio_allocation(public.allocation_dimension) to authenticated;

revoke execute on function public.portfolio_value_series(date, date, text) from public, anon;
grant   execute on function public.portfolio_value_series(date, date, text) to authenticated;
