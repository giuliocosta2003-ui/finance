// src/hooks/useTransactions.js
// Lettura da transactions_converted (porta gia' controvalore, tasso usato e
// fx_status), scrittura su transactions. Il trasferimento passa dalla RPC
// create_transfer, che scrive le due righe in un colpo solo.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const PAGE_SIZE = 100;

/**
 * @param {object} filters { accountId, from, to, categoryId, kind, search }
 */
export function useTransactions(filters = {}) {
  const { accountId, from, to, categoryId, kind, search } = filters;
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  // Quanti movimenti mostrare. La pagina si azzera quando cambiano i filtri, e
  // la cosa si deriva durante il render confrontando la "firma" dei filtri:
  // con un effetto si vedrebbe per un istante la pagina vecchia sui dati nuovi.
  const signature = JSON.stringify([accountId, from, to, categoryId, kind, search]);
  const [page, setPage] = useState({ signature, limit: PAGE_SIZE });
  const limit = page.signature === signature ? page.limit : PAGE_SIZE;

  const reload = useCallback(async () => {
    let q = supabase
      .from("transactions_converted")
      .select("*")
      .order("booked_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (accountId) q = q.eq("account_id", accountId);
    if (categoryId === "none") q = q.is("category_id", null);
    else if (categoryId) q = q.eq("category_id", categoryId);
    if (kind) q = q.eq("kind", kind);
    if (from) q = q.gte("booked_on", from);
    if (to) q = q.lte("booked_on", to);
    if (search?.trim()) {
      const s = `%${search.trim()}%`;
      q = q.or(`description.ilike.${s},merchant.ilike.${s},notes.ilike.${s}`);
    }

    const { data, error: err } = await q;
    if (err) { setError(err.message); setRows([]); return; }
    setError(null);
    const list = data ?? [];
    setHasMore(list.length > limit);
    setRows(list.slice(0, limit));
  }, [accountId, from, to, categoryId, kind, search, limit]);

  // Caricamento iniziale e ricarica quando cambiano i filtri. La regola
  // set-state-in-effect qui non si applica: l'effetto sincronizza con un
  // sistema esterno (il database), che e' esattamente il suo mestiere.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async (values) => {
    const { error: err } = await supabase.from("transactions").insert(values);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const update = useCallback(async (id, patch) => {
    const { error: err } = await supabase.from("transactions").update(patch).eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const remove = useCallback(async (row) => {
    // Un trasferimento sono due righe: cancellarne una sola lascerebbe un
    // movimento orfano e i due conti sbilanciati.
    const q = row.transfer_group_id
      ? supabase.from("transactions").delete().eq("transfer_group_id", row.transfer_group_id)
      : supabase.from("transactions").delete().eq("id", row.id);
    const { error: err } = await q;
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const createTransfer = useCallback(async (args) => {
    const { error: err } = await supabase.rpc("create_transfer", args);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  return {
    rows, loading: rows === null, error, hasMore,
    loadMore: () => setPage({ signature, limit: limit + PAGE_SIZE }),
    reload, create, update, remove, createTransfer,
  };
}
