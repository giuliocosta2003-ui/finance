// src/hooks/useInvestments.js
// Lettura e scrittura di investimenti, lotti, prezzi e obiettivi.
//
// I calcoli NON stanno qui: posizioni, allocazione e serie storica arrivano
// dalle funzioni SQL. Rifarli in JavaScript vorrebbe dire avere due verita'
// sul P&L, e prima o poi due numeri diversi nella stessa schermata.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { functionErrorCode } from "../lib/edgeError";

/** Elenco degli investimenti. Gli archiviati restano fuori, salvo richiesta. */
export function useHoldings({ includeArchived = false } = {}) {
  const [holdings, setHoldings] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    let q = supabase.from("holdings").select("*").order("name");
    if (!includeArchived) q = q.is("archived_at", null);
    const { data, error: err } = await q;
    if (err) { setError(err.message); return; }
    setError(null);
    setHoldings(data ?? []);
  }, [includeArchived]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async (values) => {
    const { data, error: err } = await supabase.from("holdings").insert(values).select().maybeSingle();
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true, holding: data };
  }, [reload]);

  const update = useCallback(async (id, patch) => {
    const { error: err } = await supabase.from("holdings").update(patch).eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const remove = useCallback(async (id) => {
    const { error: err } = await supabase.from("holdings").delete().eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  return { holdings, loading: holdings === null, error, reload, create, update, remove };
}

/** Posizioni alla data richiesta. Il calcolo e' tutto in `holding_positions`. */
export function usePositions(asOf = null) {
  const [positions, setPositions] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("holding_positions", asOf ? { p_as_of: asOf } : {});
    if (err) { setError(err.message); return; }
    setError(null);
    setPositions(data ?? []);
  }, [asOf]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  return { positions, loading: positions === null, error, reload };
}

export function useAllocation(dimension) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("portfolio_allocation", { p_dimension: dimension });
    if (err) { setError(err.message); return; }
    setError(null);
    setRows(data ?? []);
  }, [dimension]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  return { rows, loading: rows === null, error, reload };
}

export function useValueSeries({ from, to = null, step = null }) {
  const [series, setSeries] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!from) return;
    const args = { p_from: from };
    if (to) args.p_to = to;
    if (step) args.p_step = step;
    const { data, error: err } = await supabase.rpc("portfolio_value_series", args);
    if (err) { setError(err.message); return; }
    setError(null);
    setSeries(data ?? []);
  }, [from, to, step]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  return { series, loading: series === null, error, reload };
}

/** Lotti di un investimento, dal piu' recente. */
export function useLots(holdingId) {
  const [lots, setLots] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!holdingId) return;
    const { data, error: err } = await supabase
      .from("holding_lots").select("*").eq("holding_id", holdingId)
      .order("trade_date", { ascending: false });
    if (err) { setError(err.message); return; }
    setError(null);
    setLots(data ?? []);
  }, [holdingId]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async (values) => {
    const { error: err } = await supabase.from("holding_lots").insert({ ...values, holding_id: holdingId });
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [holdingId, reload]);

  const update = useCallback(async (id, patch) => {
    const { error: err } = await supabase.from("holding_lots").update(patch).eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const remove = useCallback(async (id) => {
    const { error: err } = await supabase.from("holding_lots").delete().eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  return { lots, loading: lots === null, error, reload, create, update, remove };
}

/** Prezzi di un investimento. L'inserimento a mano vince sempre sul provider. */
export function usePrices(holdingId, { limit = 90 } = {}) {
  const [prices, setPrices] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!holdingId) return;
    const { data, error: err } = await supabase
      .from("asset_prices").select("*").eq("holding_id", holdingId)
      .order("price_date", { ascending: false }).limit(limit);
    if (err) { setError(err.message); return; }
    setError(null);
    setPrices(data ?? []);
  }, [holdingId, limit]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  /**
   * Un prezzo per una data che c'e' gia' va SOSTITUITO, non ignorato: qui e'
   * l'utente che corregge. E' il contrario di quello che fa il job, che con
   * `on conflict do nothing` non tocca mai niente.
   */
  const setPrice = useCallback(async ({ priceDate, price }) => {
    const { error: err } = await supabase.from("asset_prices").upsert(
      { holding_id: holdingId, price_date: priceDate, price, source: "manual", fetched_at: new Date().toISOString() },
      { onConflict: "holding_id,price_date" },
    );
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [holdingId, reload]);

  const removePrice = useCallback(async (priceDate) => {
    const { error: err } = await supabase.from("asset_prices")
      .delete().eq("holding_id", holdingId).eq("price_date", priceDate);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [holdingId, reload]);

  /** Recupero dello storico dal provider, per un investimento appena creato. */
  const backfill = useCallback(async () => {
    const { data, error: err } = await supabase.functions.invoke("prices-daily", {
      body: { holdingId },
    });
    if (err) return { ok: false, error: await functionErrorCode(err) };
    await reload();
    return { ok: true, ...data };
  }, [holdingId, reload]);

  return { prices, loading: prices === null, error, reload, setPrice, removePrice, backfill };
}

/** Obiettivi di allocazione. */
export function useTargets() {
  const [targets, setTargets] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("target_allocations").select("*").order("dimension").order("key");
    if (err) { setError(err.message); return; }
    setError(null);
    setTargets(data ?? []);
  }, []);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async ({ dimension, key, targetPct, tolerancePct }) => {
    const { error: err } = await supabase.from("target_allocations").upsert(
      { dimension, key, target_pct: targetPct, tolerance_pct: tolerancePct },
      { onConflict: "user_id,dimension,key" },
    );
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const remove = useCallback(async (id) => {
    const { error: err } = await supabase.from("target_allocations").delete().eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  return { targets, loading: targets === null, error, reload, save, remove };
}
