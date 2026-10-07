// src/ui/Sheet.jsx
// Un solo componente per due forme: bottom sheet su mobile, pannello laterale
// destro su desktop. Il cambio e' tutto in CSS (media query in ui.css), qui il
// comportamento e' identico.
//
// Perche' a destra e non una pagina nuova, su desktop: aprendo il dettaglio di
// una transazione l'elenco resta visibile, e si passa da una riga all'altra
// senza perdere il posto. Su mobile lo spazio non c'e', e il foglio dal basso
// e' il gesto che tutti si aspettano.
//
// `variant="dialog"` lo rende invece una finestra centrata su desktop: serve
// ai moduli brevi (nuovo conto, nuova regola), dove dietro non c'e' un elenco
// da tenere sott'occhio e un pannello laterale sarebbe solo piu' lontano dal
// centro dello sguardo. Su mobile le due varianti coincidono.
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/I18nContext";
import { Icon } from "../components/icons";
import { Button } from "./primitives";

/** Gli elementi che possono ricevere il focus dentro un contenitore. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function Sheet({ title, onClose, children, footer, labelledBy, variant = "panel" }) {
  const { t } = useI18n();
  const panel = useRef(null);
  const returnTo = useRef(null);

  useEffect(() => {
    // Da dove si era arrivati: alla chiusura il focus deve tornare li',
    // altrimenti chi naviga da tastiera riparte dall'inizio della pagina.
    returnTo.current = document.activeElement;

    const first = panel.current?.querySelector(FOCUSABLE);
    (first ?? panel.current)?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;

      // Il focus resta dentro il pannello: fuori c'e' una pagina che in questo
      // momento non e' raggiungibile col mouse, e non deve esserlo col Tab.
      const items = [...(panel.current?.querySelectorAll(FOCUSABLE) ?? [])];
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      returnTo.current?.focus?.();
    };
  }, [onClose]);

  return (
    <>
      <div className="fin-overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className={variant === "dialog" ? "fin-sheet fin-sheet--dialog" : "fin-sheet"}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        <div className="fin-sheet__grabber" aria-hidden="true" />

        <div className="fin-sheet__head">
          <h2 className="fin-sheet__title">{title}</h2>
          <Button
            variant="quiet"
            size="sm"
            onClick={onClose}
            aria-label={t("common.close")}
            style={{ marginLeft: "auto" }}
            icon={<Icon.Close size={18} />}
          />
        </div>

        <div className="fin-sheet__body">{children}</div>

        {footer && <div className="fin-sheet__foot">{footer}</div>}
      </div>
    </>
  );
}
