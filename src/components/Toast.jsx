// src/components/Toast.jsx
// Messaggi brevi in basso: conferme e errori che non meritano un modale.
// Uso: const toast = useToast();  toast.success(t("common.saved"));
import { createContext, useContext, useCallback, useMemo, useState, useRef, useEffect } from "react";
import { Icon, ICON } from "./icons";

const ToastContext = createContext(null);
const DURATION = 3200;

// Il messaggio breve prende la stessa forma dell'avviso in linea: banda di
// colore a sinistra, fondo tenue, icona sempre presente. Due componenti che
// dicono la stessa cosa devono dirla nello stesso modo.
const TONES = {
  success: { color: "var(--positive)", bg: "var(--positive-soft)", icon: Icon.Check },
  error:   { color: "var(--negative)", bg: "var(--negative-soft)", icon: Icon.Warning },
  info:    { color: "var(--info)",     bg: "var(--info-soft)",     icon: Icon.Info },
};

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setItems(list => list.filter(i => i.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  // `action` serve agli avvisi annullabili ("Regola creata - Annulla"): senza
  // una via d'uscita immediata, un automatismo silenzioso diventa una sorpresa.
  const push = useCallback((tone, message, action = null) => {
    const id = Math.random().toString(36).slice(2);
    setItems(list => [...list, { id, tone, message, action }]);
    timers.current.set(id, setTimeout(() => dismiss(id), action ? DURATION * 2 : DURATION));
  }, [dismiss]);

  // I timer pendenti muoiono con il provider, non dopo.
  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(clearTimeout); pending.clear(); };
  }, []);

  const value = useMemo(() => ({
    success: (m, action) => push("success", m, action),
    error:   (m, action) => push("error", m, action),
    info:    (m, action) => push("info", m, action),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed", left: 0, right: 0, zIndex: "var(--z-toast)",
          bottom: "calc(var(--space-4) + env(safe-area-inset-bottom))",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: "var(--space-2)", pointerEvents: "none", padding: "0 var(--space-4)",
        }}
      >
        {items.map(({ id, tone, message, action }) => {
          const style = TONES[tone] ?? TONES.info;
          const ToneIcon = style.icon;
          return (
            <div
              key={id}
              className="fin-fade-in"
              onClick={() => dismiss(id)}
              style={{
                pointerEvents: "auto", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "var(--space-2)",
                maxWidth: 440, width: "100%",
                padding: "var(--space-3)",
                background: style.bg,
                border: "1px solid var(--border)",
                borderLeft: `3px solid ${style.color}`,
                borderRadius: "var(--radius-control)",
                color: style.color,
                fontSize: "var(--fs-body)", fontWeight: "var(--fw-medium)",
                boxShadow: "var(--shadow-overlay)",
              }}
            >
              <ToneIcon size={ICON.sm} style={{ flexShrink: 0 }} aria-hidden="true" />
              <span style={{ color: "var(--text)" }}>{message}</span>
              {action && (
                <button
                  onClick={(e) => { e.stopPropagation(); action.onAction(); dismiss(id); }}
                  style={{
                    marginLeft: "auto", background: "none", border: "none", padding: 0,
                    color: style.color, fontWeight: "var(--fw-semibold)", fontSize: "var(--fs-body-sm)",
                    cursor: "pointer", fontFamily: "inherit", textDecoration: "underline",
                    whiteSpace: "nowrap",
                  }}
                >{action.label}</button>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast deve essere usato dentro <ToastProvider>");
  return ctx;
}
