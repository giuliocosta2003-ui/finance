// src/i18n/I18nContext.jsx
// Internazionalizzazione IT/EN. Nessuna stringa visibile vive nei componenti:
// tutte stanno nei dizionari. t("a.b.c") risolve una chiave puntata, con
// fallback all'italiano e infine alla chiave stessa, cosi' una stringa
// mancante si vede subito.
//
// La lingua vive qui e in localStorage; dopo il login il profilo (profiles.locale)
// e' la fonte di verita' e viene sincronizzato in App.jsx.
import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import it from "./it";
import en from "./en";
import { FALLBACK_LANG as FALLBACK } from "./langs";

const DICTS = { it, en };
const KEY = "finance_lang";

const I18nContext = createContext(null);

function initialLang() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && DICTS[saved]) return saved;
  } catch { /* storage non disponibile */ }
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  return DICTS[nav] ? nav : FALLBACK;
}

function lookup(dict, path) {
  return path.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : undefined), dict);
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);

  useEffect(() => {
    try { localStorage.setItem(KEY, lang); } catch { /* ignora */ }
    document.documentElement.setAttribute("lang", lang);
  }, [lang]);

  const setLang = useCallback((l) => setLangState(DICTS[l] ? l : FALLBACK), []);

  // t(key, vars?) — sostituisce {placeholder} con vars[placeholder].
  const t = useCallback((key, vars) => {
    let str = lookup(DICTS[lang], key);
    if (str == null) str = lookup(DICTS[FALLBACK], key);
    if (str == null) return key;
    if (vars) for (const k of Object.keys(vars)) str = str.replaceAll(`{${k}}`, String(vars[k]));
    return str;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n deve essere usato dentro <I18nProvider>");
  return ctx;
}
