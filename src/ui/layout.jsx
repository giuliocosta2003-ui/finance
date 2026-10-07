// src/ui/layout.jsx
// Le forme che ogni schermata ripete: l'impaginazione, l'intestazione, la
// barra dei filtri, il prospetto di cifre, l'avviso in linea.
//
// Esistono per un motivo preciso trovato nell'audit: prima ogni schermata si
// costruiva l'intestazione a mano — un <h1>, un pulsante spinto a destra con
// `marginLeft: auto`, e una spaziatura diversa in ognuna delle quattordici
// schermate. Il risultato e' che passando da Conti a Movimenti il titolo si
// spostava di qualche pixel. Qui la forma e' una sola.
import { Link } from "react-router-dom";
import { Icon, ICON } from "../components/icons";

const cx = (...parts) => parts.filter(Boolean).join(" ");

// ── Page ─────────────────────────────────────────────────────────────────────

/**
 * Il contenitore di una schermata: una colonna con spaziatura costante.
 *
 * NON limita la larghezza. Prima le schermate non migrate usavano un blocco da
 * 720 px centrato dentro un guscio da 1280: su desktop restava piu' della
 * meta' dello schermo vuota. La larghezza la decide il guscio (--content-max),
 * una volta sola, per tutte.
 */
export function Page({ className, children, ...rest }) {
  return <div className={cx("fin-page fin-fade-in", className)} {...rest}>{children}</div>;
}

/**
 * Intestazione di schermata: eventuale ritorno indietro, titolo, sottotitolo e
 * azioni, chiusa da un filo.
 */
export function PageHeader({ title, subtitle, actions, backTo, backLabel, children }) {
  return (
    <header className="fin-pagehead">
      <div className="fin-pagehead__text">
        {backTo && (
          <Link to={backTo} className="fin-crumb">
            <Icon.Left size={ICON.inline} aria-hidden="true" />
            {backLabel}
          </Link>
        )}
        <h1 className="fin-h1">{title}</h1>
        {subtitle && <p className="fin-pagehead__sub">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="fin-pagehead__actions">{actions}</div>}
    </header>
  );
}

// ── Toolbar e filtri ─────────────────────────────────────────────────────────

/** Riga di comandi: cio' che sta in `end` viene spinto a destra. */
export function Toolbar({ end, children, className, ...rest }) {
  return (
    <div className={cx("fin-toolbar", className)} {...rest}>
      {children}
      {end && <div className="fin-toolbar__end">{end}</div>}
    </div>
  );
}

/** La barra dei filtri: riquadro bordato, chip e campi dentro. */
export function FilterBar({ end, children, className, ...rest }) {
  return (
    <div className={cx("fin-filterbar", className)} {...rest}>
      {children}
      {end && <div className="fin-toolbar__end">{end}</div>}
    </div>
  );
}

// ── Stat ─────────────────────────────────────────────────────────────────────

/**
 * Una cifra con la sua etichetta.
 *
 * Prima esisteva tre volte, in tre schermate, con tre firme diverse
 * (`{label, value, color}` in una, `{label, value, hint, tone}` in un'altra):
 * la stessa cosa disegnata in tre modi. Qui e' una firma sola.
 */
export function Stat({ label, value, hint, tone, className, ...rest }) {
  return (
    <div className={cx("fin-stat", className)} {...rest}>
      <span className="fin-stat__label">{label}</span>
      <span className="fin-stat__value num" style={tone ? { color: tone } : undefined}>{value}</span>
      {hint && <span className="fin-stat__hint">{hint}</span>}
    </div>
  );
}

/**
 * Il prospetto: piu' cifre affiancate, divise da fili invece che da spazi.
 * E' la forma di un estratto conto, non di una fila di riquadri staccati.
 */
export function StatGrid({ className, children, ...rest }) {
  return <div className={cx("fin-statgrid", className)} {...rest}>{children}</div>;
}

// ── avvisi in linea ──────────────────────────────────────────────────────────

const ALERT_ICON = {
  error: Icon.Warning,
  warning: Icon.Warning,
  success: Icon.Check,
  info: Icon.Info,
};

/**
 * Il messaggio dentro la pagina: errore, avvertimento, conferma, nota.
 *
 * L'icona c'e' sempre, e non e' decorazione: il colore da solo non basta a chi
 * non lo distingue, e in questa interfaccia rosso vuol dire sia "marchio" sia
 * "errore" — la forma deve dire quale dei due.
 */
export function InlineAlert({ tone = "info", title, children, action, className, ...rest }) {
  const ToneIcon = ALERT_ICON[tone] ?? Icon.Info;
  return (
    <div
      className={cx("fin-alert", `fin-alert--${tone}`, className)}
      role={tone === "error" ? "alert" : "status"}
      {...rest}
    >
      <span className="fin-alert__icon" aria-hidden="true"><ToneIcon size={ICON.sm} /></span>
      <span className="fin-alert__body">
        {title && <span className="fin-alert__title">{title} </span>}
        {children}
      </span>
      {action}
    </div>
  );
}
