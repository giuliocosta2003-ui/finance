// src/hooks/useIsMobile.js
import { useState, useEffect } from "react";

/**
 * Ritorna true se la viewport è più stretta di `breakpoint` px.
 * Si aggiorna al resize. Default: 768px (tablet/telefono).
 */
export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);

  return isMobile;
}
