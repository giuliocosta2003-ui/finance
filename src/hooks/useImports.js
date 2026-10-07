// src/hooks/useImports.js
// Elenco degli import, annullamento con anteprima, cancellazione del file.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useImports() {
  const [imports, setImports] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("imports")
      .select("*, accounts!imports_account_fkey(name, currency)")
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setImports([]); return; }
    setError(null);
    setImports(data ?? []);
  }, []);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  /** Senza conferma torna solo l'anteprima: cosa verrebbe cancellato e cosa si perderebbe. */
  const rollback = useCallback(async (importId, confirm = false) => {
    const { data, error: err } = await supabase.rpc("rollback_import", {
      p_import_id: importId,
      p_confirm: confirm,
    });
    if (err) return { ok: false, error: err.message };
    if (confirm) await reload();
    return { ok: true, ...data };
  }, [reload]);

  /**
   * Cancella un import e il suo file. Possibile solo se non e' confermato:
   * la FK verso transactions e' `restrict`, quindi il database rifiuterebbe
   * comunque di lasciare movimenti senza il loro import.
   */
  const remove = useCallback(async (imp) => {
    if (imp.status === "committed") {
      return { ok: false, error: "committed" };
    }
    if (imp.storage_path) {
      await supabase.storage.from("statements").remove([imp.storage_path]);
    }
    const { error: err } = await supabase.from("imports").delete().eq("id", imp.id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  return { imports, loading: imports === null, error, reload, rollback, remove };
}

/** Righe di un import in revisione, con le modifiche fatte dall'utente. */
export function useImportRows(importId) {
  const [rows, setRows] = useState(null);
  const [importRow, setImportRow] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!importId) return;
    const [{ data: imp, error: e1 }, { data: list, error: e2 }] = await Promise.all([
      supabase.from("imports").select("*, accounts!imports_account_fkey(name, currency)")
        .eq("id", importId).maybeSingle(),
      supabase.from("import_rows").select("*").eq("import_id", importId).order("row_index"),
    ]);
    if (e1 || e2) { setError((e1 ?? e2).message); return; }
    setError(null);
    setImportRow(imp ?? null);
    setRows(list ?? []);
  }, [importId]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const updateRows = useCallback(async (ids, patch) => {
    const { error: err } = await supabase.from("import_rows").update(patch).in("id", ids);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const commit = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("commit_import", { p_import_id: importId });
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true, ...data };
  }, [importId, reload]);

  return { rows, importRow, loading: rows === null, error, reload, updateRows, commit };
}

/** Regole sui commercianti: elenco, creazione, modifica, priorita'. */
export function useMerchantRules() {
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("merchant_rules").select("*").order("priority", { ascending: false }).order("pattern");
    if (err) { setError(err.message); setRules([]); return; }
    setError(null);
    setRules(data ?? []);
  }, []);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  /**
   * Crea o aggiorna la regola nata da una correzione. Se l'utente cambia idea
   * due volte sullo stesso commerciante, la seconda correzione sovrascrive la
   * prima invece di creare una regola in conflitto.
   */
  const upsertFromCorrection = useCallback(async (pattern, categoryId) => {
    if (!pattern) return { ok: false, error: "no-merchant" };
    const { data, error: err } = await supabase
      .from("merchant_rules")
      .upsert(
        { pattern, match_type: "exact", category_id: categoryId, created_from: "correction" },
        { onConflict: "user_id,pattern,match_type" },
      )
      .select()
      .maybeSingle();
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true, rule: data };
  }, [reload]);

  const create = useCallback(async (values) => {
    const { error: err } = await supabase.from("merchant_rules").insert(values);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const update = useCallback(async (id, patch) => {
    const { error: err } = await supabase.from("merchant_rules").update(patch).eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  const remove = useCallback(async (id) => {
    const { error: err } = await supabase.from("merchant_rules").delete().eq("id", id);
    if (err) return { ok: false, error: err.message };
    await reload();
    return { ok: true };
  }, [reload]);

  /** L'uso di una regola si conta: serve a capire quali valgono e quali no. */
  const countHit = useCallback(async (ruleId, times = 1) => {
    const { data } = await supabase.from("merchant_rules").select("hits").eq("id", ruleId).maybeSingle();
    if (!data) return;
    await supabase.from("merchant_rules")
      .update({ hits: (data.hits ?? 0) + times, last_used_at: new Date().toISOString() })
      .eq("id", ruleId);
  }, []);

  return { rules, loading: rules === null, error, reload, create, update, remove, upsertFromCorrection, countHit };
}
