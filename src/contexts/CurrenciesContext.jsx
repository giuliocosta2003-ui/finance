// src/contexts/CurrenciesContext.jsx
// La tabella `currencies` letta una volta sola per sessione: serve ovunque si
// mostri o si legga un importo, perche' e' lei a dire quanti decimali ha una
// valuta. E' una tabella di riferimento, uguale per tutti e che non cambia:
// ricaricarla a ogni schermata sarebbe solo traffico sprecato.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { intlMinorUnits } from "../lib/money";

const CurrenciesContext = createContext(null);

export function CurrenciesProvider({ children }) {
  const [byCode, setByCode] = useState(null); // null = non ancora caricate
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: err } = await supabase
        .from("currencies")
        .select("code, name, minor_units")
        .eq("active", true)
        .order("code");
      if (!alive) return;
      if (err) { setError(err.message); return; }
      const map = {};
      for (const c of data ?? []) map[c.code.trim()] = { ...c, code: c.code.trim() };
      setByCode(map);
    })();
    return () => { alive = false; };
  }, []);

  const value = useMemo(() => ({
    byCode,
    loading: byCode === null && !error,
    error,
    codes: byCode ? Object.keys(byCode) : [],
    // Finche' la tabella non e' arrivata si usa Intl, cosi' la UI non mostra
    // mai importi con i decimali sbagliati in attesa della rete.
    minorUnits: (code) => byCode?.[code]?.minor_units ?? intlMinorUnits(code),
  }), [byCode, error]);

  return <CurrenciesContext.Provider value={value}>{children}</CurrenciesContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCurrencies() {
  const ctx = useContext(CurrenciesContext);
  if (!ctx) throw new Error("useCurrencies deve essere usato dentro <CurrenciesProvider>");
  return ctx;
}
