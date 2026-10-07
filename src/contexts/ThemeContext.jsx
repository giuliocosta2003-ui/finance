// src/contexts/ThemeContext.jsx
// Tema chiaro/scuro. Il valore scelto va in localStorage e viene applicato
// come attributo data-theme su <html>, che attiva i token di theme/tokens.css.
// Default: CHIARO. Un istituto finanziario si presenta su fondo bianco; il
// tema scuro esiste ed e' curato, ma e' il secondo.
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

const ThemeContext = createContext(null);
const KEY = "finance_theme";

function initialTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* storage non disponibile */ }
  return "light";
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignora */ }
    // La barra di stato della PWA segue il tema. Qui i due colori sono scritti
    // per esteso ed e' l'unico punto di tutta l'app dove succede: un attributo
    // `content` di un <meta> non sa leggere una variabile CSS. Sono gli stessi
    // valori di --surface-1 nei due temi; se cambiano li', vanno cambiati qui.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#1A1A1A" : "#FFFFFF");
  }, [theme]);

  const setTheme = useCallback((t) => setThemeState(t === "dark" ? "dark" : "light"), []);
  const toggleTheme = useCallback(() => setThemeState(t => (t === "light" ? "dark" : "light")), []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve essere usato dentro <ThemeProvider>");
  return ctx;
}
