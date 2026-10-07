// src/hooks/useTaxes.js
// Lettura e scrittura di voci d'imposta, periodi e pagamenti.
//
// I CALCOLI non stanno qui: base, importo dovuto, periodi e accantonamento
// arrivano dalle funzioni SQL (tax_base, tax_preview, generate_tax_periods,
// tax_set_aside). Rifarli in JavaScript vorrebbe dire due verita' sullo stesso
// numero, e prima o poi due importi diversi nella stessa schermata — cosa
// intollerabile su delle tasse.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

/** Voci d'imposta. Creare o modificare una voce rigenera subito i suoi periodi. */
export function useTaxItems() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("tax_items").select("*").order("active", { ascending: false }).order("name");
    if (err) { setError(err.message); return; }
    setError(null);
    setItems(data ?? []);
  }, []);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async (values) => {
    const { data, error: err } = await supabase.from("tax_items").insert(values).select().maybeSingle();
    if (err) return { ok: false, error: err.message };
    // I periodi si generano subito: senza, una voce nuova non mostrerebbe ne'
    // scadenze ne' stime finche' non passa il cron notturno.
    if (data?.id) await supabase.rpc("generate_tax_periods", { p_item_id: data.id });
    await reload();
    return { ok: true, item: data };
  }, [reload]);

  const update = useCallback(async (id, patch) => {
    const { error: err } = await supabase.from("tax_items").update(patch).eq("id", id);
    if (err) return { ok: false, error: err.message };
    // Rigenera i periodi projected/due con i nuovi parametri; i pagati non si
    // toccano (lo garantisce generate_tax_periods lato SQL).
    await supabase.rpc("generate_tax_periods", { p_item_id: id });
    await reload();
    return { ok: true };
  }, [reload]);

  const remove = useCallback(async (id) => {
    const { error: err } = await supabase.from("tax_items").delete().eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  return { items, loading: items === null, error, reload, create, update, remove };
}

/**
 * Periodi. Con `itemId` quelli di una voce; altrimenti tutti, col nome della
 * voce accanto (join). `openOnly` tiene fuori pagati e saltati, per l'elenco
 * delle prossime scadenze.
 */
export function useTaxPeriods({ itemId = null, openOnly = false } = {}) {
  const [periods, setPeriods] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    let q = supabase
      .from("tax_periods")
      .select("*, tax_items!inner(name, base_type, active)")
      .order("due_date");
    if (itemId) q = q.eq("tax_item_id", itemId);
    if (openOnly) q = q.not("status", "in", "(paid,skipped)");
    const { data, error: err } = await q;
    if (err) { setError(err.message); return; }
    setError(null);
    setPeriods(data ?? []);
  }, [itemId, openOnly]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  return { periods, loading: periods === null, error, reload };
}

/** Un periodo solo, coi suoi pagamenti e la voce a cui appartiene. */
export function useTaxPeriod(periodId) {
  const [period, setPeriod] = useState(null);
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!periodId) return;
    const { data: p, error: e1 } = await supabase
      .from("tax_periods").select("*, tax_items(*)").eq("id", periodId).maybeSingle();
    if (e1) { setError(e1.message); return; }
    const { data: pays, error: e2 } = await supabase
      .from("tax_payments").select("*").eq("tax_period_id", periodId).order("paid_on", { ascending: false });
    if (e2) { setError(e2.message); return; }
    setError(null);
    setPeriod(p ?? null);
    setPayments(pays ?? []);
  }, [periodId]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const addPayment = useCallback(async ({ amountMinor, paidOn, transactionId = null, notes = null }) => {
    const { error: err } = await supabase.from("tax_payments").insert({
      tax_period_id: periodId,
      amount_minor: amountMinor.toString(),
      paid_on: paidOn,
      transaction_id: transactionId,
      notes,
    });
    if (err) return { ok: false, error: err.message };
    await reload();   // il trigger ha gia' aggiornato lo stato del periodo
    return { ok: true };
  }, [periodId, reload]);

  const removePayment = useCallback(async (id) => {
    const { error: err } = await supabase.from("tax_payments").delete().eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  /** Saltare un periodo (o riattivarlo): una scelta esplicita dell'utente. */
  const setStatus = useCallback(async (status) => {
    const { error: err } = await supabase.from("tax_periods").update({ status }).eq("id", periodId);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [periodId, reload]);

  return { period, payments, loading: period === null, error, reload, addPayment, removePayment, setStatus };
}

/** Quanto accantonare, alla data. Una riga sola dalla funzione tax_set_aside. */
export function useTaxSetAside(asOf = null) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    const { data: rows, error: err } = await supabase.rpc("tax_set_aside", asOf ? { p_as_of: asOf } : {});
    if (err) { setError(err.message); return; }
    setError(null);
    setData(rows?.[0] ?? { to_set_aside_minor: 0, set_aside_account_id: null, account_balance_base_minor: null, difference_minor: null });
  }, [asOf]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  return { data, loading: data === null, error, reload };
}

/**
 * Anteprima live per il modulo di una voce: base e dovuto con i parametri
 * correnti, anche prima di salvare. Restituisce una funzione async da chiamare
 * quando i campi cambiano.
 */
export function useTaxPreview() {
  const preview = useCallback(async (params) => {
    const { data, error } = await supabase.rpc("tax_preview", {
      p_base_type: params.baseType,
      p_rate_pct: params.ratePct ?? null,
      p_coefficient_pct: params.coefficientPct ?? null,
      p_fixed_amount_minor: params.fixedAmountMinor ?? null,
      p_currency: params.currency ?? null,
      p_business_only: params.businessOnly ?? true,
      p_category_ids: params.categoryIds ?? null,
      p_account_ids: params.accountIds ?? null,
      p_basis: params.basis ?? "cash",
      p_from: params.from,
      p_to: params.to,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, ...(data?.[0] ?? { base_minor: 0, amount_due_minor: 0 }) };
  }, []);
  return { preview };
}
