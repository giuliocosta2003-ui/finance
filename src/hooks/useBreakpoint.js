// src/hooks/useBreakpoint.js
// Tre fasce, non due: il tablet non e' un telefono largo ne' un desktop
// stretto, e la navigazione cambia forma in tutte e tre.
//
//   mobile   < 768    barra in basso, dettagli a tutta pagina o in foglio
//   tablet   768-1199 barra laterale compatta, sole icone
//   desktop  >= 1200  barra laterale intera, dettagli in pannello a destra
//
// Le soglie sono le stesse dei @media di ui.css: se cambiano, vanno cambiate
// in tutti e due i posti, ed e' il motivo per cui stanno in una costante.
import { useEffect, useState } from "react";
import { BREAKPOINTS } from "../theme/tokens";

const read = () => {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w <= BREAKPOINTS.mobile) return "mobile";
  if (w <= BREAKPOINTS.tablet) return "tablet";
  return "desktop";
};

export function useBreakpoint() {
  const [bp, setBp] = useState(read);

  useEffect(() => {
    const onResize = () => setBp(prev => {
      const next = read();
      // Si aggiorna solo quando si cambia fascia: a ogni pixel di resize
      // rirenderizzerebbe tutta l'app per niente.
      return next === prev ? prev : next;
    });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    breakpoint: bp,
    isMobile: bp === "mobile",
    isTablet: bp === "tablet",
    isDesktop: bp === "desktop",
    /** Vero dove c'e' una barra laterale invece della barra in basso. */
    hasSidebar: bp !== "mobile",
  };
}
