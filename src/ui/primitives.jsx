// src/ui/primitives.jsx
// I pezzi piccoli: pulsanti, azioni rapide, card, chip, tab, campi e stati.
//
// Nessuno di questi conosce il dominio dell'app: non sanno cosa sia una
// transazione o un investimento. Prendono testo e callback, e basta. E' cio'
// che permette di cambiare l'aspetto di tutta l'app modificando un file solo.
import { forwardRef } from "react";
import { useI18n } from "../i18n/I18nContext";
import { Icon, ICON } from "../components/icons";

const cx = (...parts) => parts.filter(Boolean).join(" ");

// ── Button ───────────────────────────────────────────────────────────────────

/**
 * Gerarchia a tre livelli, come chiede il brief:
 *
 *   primary    rosso pieno, testo bianco — una sola per schermata
 *   secondary  fondo chiaro, testo scuro, bordo sottile
 *   tertiary   solo testo (alias storico: `ghost`)
 *   quiet      solo testo, ma NEUTRO: annulla, chiudi, cambia vista
 *   danger     bordo rosso, per le azioni distruttive
 */
export const Button = forwardRef(function Button(
  { as: As = "button", variant = "secondary", size = "md", block = false, icon, children, className, ...rest },
  ref,
) {
  return (
    <As
      ref={ref}
      // `as={Link}` serve ai comandi che sono NAVIGAZIONI travestite da
      // pulsante: devono restare apribili in una scheda nuova col tasto
      // centrale, cosa che un <button> con onClick non permette.
      type={As === "button" ? "button" : undefined}
      className={cx(
        "fin-btn",
        `fin-btn--${variant}`,
        size !== "md" && `fin-btn--${size}`,
        block && "fin-btn--block",
        !children && "fin-btn--icon",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </As>
  );
});

/**
 * Pulsante di sola icona. Prima era un oggetto `iconBtn` ricopiato a mano in
 * sei schermate, ogni volta con un padding diverso: il risultato e' che due
 * icone affiancate in due schermate diverse non erano mai uguali.
 *
 * `label` non e' facoltativo: un pulsante che mostra solo un disegno deve
 * dire a voce cosa fa.
 */
export const IconButton = forwardRef(function IconButton(
  { label, icon, tone, size = "md", bare = false, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "fin-iconbtn",
        size === "lg" && "fin-iconbtn--lg",
        bare && "fin-iconbtn--bare",
        tone === "danger" && "fin-iconbtn--danger",
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});

// ── QuickAction ──────────────────────────────────────────────────────────────

/** Riquadro con icona ed etichetta: la fila di scorciatoie in cima alla Home. */
export function QuickAction({ icon, label, accent = false, as: As = "button", ...rest }) {
  return (
    <As
      className={cx("fin-quick", accent && "fin-quick--accent")}
      type={As === "button" ? "button" : undefined}
      {...rest}
    >
      <span className="fin-quick__circle" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </As>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({ raised = false, flush = false, interactive = false, className, children, ...rest }) {
  return (
    <div
      className={cx(
        "fin-card",
        raised && "fin-card--raised",
        flush && "fin-card--flush",
        interactive && "fin-card--interactive",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, ...rest }) {
  return <p className="fin-card__title" {...rest}>{children}</p>;
}

/**
 * Intestazione di card: titolo a sinistra, azioni a destra, filo sotto.
 * Va usata dentro una <Card flush>, altrimenti il filo cade dentro il padding
 * invece che da bordo a bordo.
 */
export function CardHeader({ title, actions, children, ...rest }) {
  return (
    <div className="fin-card__head" {...rest}>
      {title ? <CardTitle>{title}</CardTitle> : children}
      {actions}
    </div>
  );
}

export function CardBody({ className, children, ...rest }) {
  return <div className={cx("fin-card__body", className)} {...rest}>{children}</div>;
}

// ── Chip e Badge ─────────────────────────────────────────────────────────────

export function Chip({ on = false, count, children, ...rest }) {
  const clickable = typeof rest.onClick === "function";
  return (
    <button
      type="button"
      className={cx("fin-chip", on && "fin-chip--on", !clickable && "fin-chip--static")}
      aria-pressed={clickable ? on : undefined}
      {...rest}
    >
      {children}
      {count !== undefined && <span className="fin-chip__count">{count}</span>}
    </button>
  );
}

/**
 * Pastiglia di stato. `tone` e' un token colore, es. "var(--warning)".
 *
 * Prima questa forma era ricopiata inline in otto file con quattro varianti di
 * padding: bastava aprire due schermate di seguito per vederlo.
 */
export function Badge({ tone = "var(--text-secondary)", soft = false, icon, children, style, ...rest }) {
  return (
    <span
      className="fin-badge"
      style={{ color: tone, background: soft || undefined, ...style }}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

/** Nome storico di Badge: resta finche' le schermate non sono tutte migrate. */
export const Tag = Badge;

/**
 * Riga selezionabile: la scelta esclusiva grande abbastanza da leggersi (tipo
 * di profilo, metodo di P&L, suggerimento di collegamento).
 *
 * Selezionata, prende la stessa barra rossa a sinistra delle voci di
 * navigazione: un solo segnale di "sei qui / hai scelto questo" in tutta
 * l'app, invece di uno per schermata.
 *
 * `role` va messo a "radio" dentro un radiogroup — di default e' un bottone
 * che commuta, che per una scelta esclusiva direbbe la cosa sbagliata al
 * lettore di schermo.
 */
export function ChoiceRow({ selected = false, role = "button", className, children, ...rest }) {
  return (
    <button
      type="button"
      role={role === "button" ? undefined : role}
      aria-checked={role === "button" ? undefined : selected}
      aria-pressed={role === "button" ? selected : undefined}
      className={cx("fin-choice", selected && "fin-choice--on", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── SegmentedControl ─────────────────────────────────────────────────────────

/** `options`: [{ value, label }]. Due o tre voci; oltre, servono le Tabs. */
export function SegmentedControl({ options, value, onChange, label }) {
  return (
    <div className="fin-segmented" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={cx("fin-segmented__item", o.value === value && "fin-segmented__item--on")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

export function Tabs({ options, value, onChange, label }) {
  return (
    <div className="fin-tabs" role="tablist" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={cx("fin-tab", o.value === value && "fin-tab--on")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── campi ────────────────────────────────────────────────────────────────────

export function Field({ label, hint, error, htmlFor, children }) {
  return (
    <div className="fin-field">
      {label && <label className="fin-label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && !error && <p className="fin-hint">{hint}</p>}
      {error && (
        <p className="fin-error">
          <Icon.Warning size={ICON.inline} aria-hidden="true" style={{ flex: "0 0 auto", marginTop: 1 }} />
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx("fin-input", className)} {...rest} />;
});

export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={cx("fin-select", className)} {...rest}>{children}</select>;
});

export const Textarea = forwardRef(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx("fin-textarea", className)} {...rest} />;
});

/** Casella con la sua etichetta sulla stessa riga. */
export function Checkbox({ checked, onChange, label, disabled, ...rest }) {
  return (
    <label className="fin-checkline">
      <input
        type="checkbox"
        className="fin-check"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        {...rest}
      />
      {label}
    </label>
  );
}

/**
 * Interruttore. E' un <button> con `aria-checked`, non una casella travestita:
 * un interruttore agisce subito, una casella aspetta il salvataggio, e
 * confonderli in un'app di soldi fa perdere modifiche.
 */
export function Switch({ checked, onChange, label, disabled, ...rest }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="fin-switch"
      onClick={() => onChange(!checked)}
      {...rest}
    />
  );
}

/** Campo di ricerca. `shortcut` mostra la scorciatoia da tastiera su desktop. */
export function SearchField({ value, onChange, placeholder, shortcut, icon, ...rest }) {
  return (
    <div className="fin-search">
      {icon ?? <Icon.Search size={ICON.sm} aria-hidden="true" />}
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        {...rest}
      />
      {shortcut && <kbd>{shortcut}</kbd>}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

/**
 * Scheletro invece di rotella: mostra dove comparira' il contenuto, quindi la
 * pagina non salta quando arriva e l'attesa sembra piu' corta.
 */
export function Skeleton({ width = "100%", height = 14, radius, style, ...rest }) {
  return (
    <div
      className="fin-skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
      {...rest}
    />
  );
}

/** Lo scheletro di un elenco: n righe con avatar, testo e importo. */
export function SkeletonRows({ rows = 5 }) {
  return (
    <div role="status" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="fin-row">
          <Skeleton width={36} height={36} radius="var(--radius-pill)" />
          <div className="fin-row__body" style={{ display: "grid", gap: 6 }}>
            <Skeleton width={`${45 + ((i * 13) % 30)}%`} height={13} />
            <Skeleton width={`${25 + ((i * 7) % 20)}%`} height={11} />
          </div>
          <Skeleton width={72} height={14} />
        </div>
      ))}
    </div>
  );
}

// ── stati ────────────────────────────────────────────────────────────────────

/**
 * Stato vuoto. `action` non e' decorativa: uno stato vuoto senza la cosa da
 * fare dopo lascia l'utente fermo davanti a una schermata che non spiega
 * niente.
 */
export function EmptyState({ icon, title, body, action }) {
  return (
    <div className="fin-state">
      {icon && <div className="fin-state__icon" aria-hidden="true">{icon}</div>}
      <p className="fin-state__title">{title}</p>
      {body && <p className="fin-state__body">{body}</p>}
      {action}
    </div>
  );
}

/** Stato di errore: dice cosa e' andato storto e offre di riprovare. */
export function ErrorState({ icon, title, body, onRetry }) {
  const { t } = useI18n();
  return (
    <div className="fin-state">
      <div className="fin-state__icon" style={{ color: "var(--negative)", borderColor: "var(--negative)" }} aria-hidden="true">
        {icon ?? <Icon.Warning size={ICON.lg} />}
      </div>
      <p className="fin-state__title">{title}</p>
      {body && <p className="fin-state__body">{body}</p>}
      {onRetry && <Button variant="secondary" onClick={onRetry}>{t("common.retry")}</Button>}
    </div>
  );
}
