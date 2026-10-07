// src/hooks/useCategories.js
// Categorie dell'utente. Il nome mostrato e' `name` se l'utente l'ha
// rinominata, altrimenti la traduzione di `key`: e' per questo che le
// predefinite nascono con name nullo.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

/** Nome da mostrare: quello scelto dall'utente vince sulla traduzione. */
export function categoryLabel(category, t) {
  if (!category) return "";
  if (category.name) return category.name;
  if (category.key) {
    const translated = t(`categories.${category.key}`);
    // t() restituisce la chiave stessa quando manca la traduzione: in quel
    // caso e' meglio mostrare la key grezza che una stringa con i punti.
    return translated === `categories.${category.key}` ? category.key : translated;
  }
  return "";
}

export function useCategories({ includeArchived = false } = {}) {
  const [categories, setCategories] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    let q = supabase
      .from("categories")
      .select("id, parent_id, key, name, kind, is_business, sort_order, archived_at")
      .order("kind")
      .order("sort_order")
      .order("key");
    if (!includeArchived) q = q.is("archived_at", null);
    const { data, error: err } = await q;
    if (err) { setError(err.message); setCategories([]); return; }
    setError(null);
    setCategories(data ?? []);
  }, [includeArchived]);

  // Caricamento iniziale e ricarica quando cambiano i filtri. La regola
  // set-state-in-effect qui non si applica: l'effetto sincronizza con un
  // sistema esterno (il database), che e' esattamente il suo mestiere.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async (values) => {
    const { error: err } = await supabase.from("categories").insert(values);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const update = useCallback(async (id, patch) => {
    const { error: err } = await supabase.from("categories").update(patch).eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const setArchived = useCallback(
    (id, archived) => update(id, { archived_at: archived ? new Date().toISOString() : null }),
    [update],
  );

  /** Sposta una categoria di un posto su o giu' dentro il suo gruppo. */
  const move = useCallback(async (category, direction) => {
    const siblings = (categories ?? [])
      .filter(c => c.kind === category.kind && c.parent_id === category.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const i = siblings.findIndex(c => c.id === category.id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= siblings.length) return { ok: true };
    const other = siblings[j];
    // Scambio secco dei due sort_order: due update, nessuna rinumerazione.
    const a = await supabase.from("categories").update({ sort_order: other.sort_order }).eq("id", category.id);
    const b = await supabase.from("categories").update({ sort_order: category.sort_order }).eq("id", other.id);
    if (a.error || b.error) return { ok: false, error: (a.error ?? b.error).message };
    await reload();
    return { ok: true };
  }, [categories, reload]);

  /** Aggiunge le predefinite mancanti per il profilo corrente. Non cancella nulla. */
  const seedDefaults = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("seed_default_categories");
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true, added: data ?? 0 };
  }, [reload]);

  return {
    categories, loading: categories === null, error,
    reload, create, update, setArchived, move, seedDefaults,
  };
}
