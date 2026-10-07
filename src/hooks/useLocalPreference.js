// src/hooks/useLocalPreference.js
// Preferenze di sola presentazione (quale valuta mostrare nei totali, quali
// filtri erano aperti): stanno nel browser, non nel profilo, perche' non
// cambiano i dati e non ha senso sincronizzarle fra dispositivi.
import { useCallback, useState } from "react";

export function useLocalPreference(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? fallback : JSON.parse(saved);
    } catch { return fallback; }
  });

  const set = useCallback((next) => {
    setValue(prev => {
      const resolved = typeof next === "function" ? next(prev) : next;
      try { localStorage.setItem(key, JSON.stringify(resolved)); } catch { /* ignora */ }
      return resolved;
    });
  }, [key]);

  return [value, set];
}
