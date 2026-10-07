// src/hooks/useAccounts.js
// I conti si LEGGONO dalla view account_balances (che porta gia' saldo e
// controvalore) e si SCRIVONO sulla tabella accounts. Tenere separate lettura
// e scrittura evita di dover ricalcolare i saldi nel frontend.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useAccounts({ includeArchived = false } = {}) {
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    let q = supabase.from("account_balances").select("*").order("name");
    if (!includeArchived) q = q.is("archived_at", null);
    const { data, error: err } = await q;
    if (err) { setError(err.message); setAccounts([]); return; }
    setError(null);
    setAccounts(data ?? []);
  }, [includeArchived]);

  // Caricamento iniziale e ricarica quando cambiano i filtri. La regola
  // set-state-in-effect qui non si applica: l'effetto sincronizza con un
  // sistema esterno (il database), che e' esattamente il suo mestiere.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async (values) => {
    const { error: err } = await supabase.from("accounts").insert(values);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const update = useCallback(async (id, patch) => {
    const { error: err } = await supabase.from("accounts").update(patch).eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  // Archiviare invece di cancellare: un conto chiuso ha comunque una storia di
  // movimenti che deve restare leggibile.
  const setArchived = useCallback(
    (id, archived) => update(id, { archived_at: archived ? new Date().toISOString() : null }),
    [update],
  );

  return { accounts, loading: accounts === null, error, reload, create, update, setArchived };
}
