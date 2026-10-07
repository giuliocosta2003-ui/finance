// src/ui/ListRow.jsx
// La riga di elenco e il suo avatar: il mattone piu' ripetuto dell'app.
//
// L'avatar e' fatto in casa, con le iniziali su un colore ricavato dal nome.
// Un servizio esterno di loghi darebbe risultati piu' belli ma manderebbe a
// terzi l'elenco dei posti dove uno spende: l'aspetto non vale quel prezzo.
import { categoryColor, initials } from "../theme/tokens";

const cx = (...parts) => parts.filter(Boolean).join(" ");

/**
 * Iniziali su pastiglia colorata. Il colore si ricava dalla chiave con un
 * hash, quindi lo stesso commerciante ha sempre lo stesso colore: se cambiasse
 * a ogni caricamento non sarebbe un riconoscimento, sarebbe rumore.
 */
/**
 * `square` serve quando dentro c'e' un'icona di sistema invece delle iniziali:
 * un glifo tecnico dentro un cerchio colorato sembra un adesivo, dentro un
 * quadrato sembra un pittogramma.
 */
export function Avatar({ name, colorKey, size = "md", icon, square = false, className, style }) {
  const label = initials(name);
  return (
    <span
      className={cx("fin-avatar", `fin-avatar--${size}`, square && "fin-avatar--square", className)}
      style={{ background: categoryColor(colorKey ?? name), ...style }}
      aria-hidden="true"
    >
      {icon ?? label}
    </span>
  );
}

/**
 * Riga di elenco: avatar, titolo, sottotitolo, e a destra l'importo.
 *
 * `as` permette di renderla un <button> (tocco che apre un dettaglio), un
 * <a>/<Link>, o un semplice <div> quando non e' cliccabile. Un div cliccabile
 * non sarebbe raggiungibile da tastiera, e su desktop la tastiera conta.
 */
export function ListRow({
  as: As = "div",
  avatar,
  title,
  subtitle,
  end,
  endSub,
  selected = false,
  className,
  children,
  ...rest
}) {
  const interactive = As !== "div";
  return (
    <As
      className={cx(
        "fin-row",
        interactive && "fin-row--interactive",
        selected && "fin-row--selected",
        className,
      )}
      type={As === "button" ? "button" : undefined}
      {...rest}
    >
      {avatar}
      <span className="fin-row__body">
        <span className="fin-row__title">{title}</span>
        {subtitle && <span className="fin-row__subtitle">{subtitle}</span>}
      </span>
      {children}
      {(end || endSub) && (
        <span className="fin-row__end">
          {end}
          {endSub && <span className="fin-row__subtitle">{endSub}</span>}
        </span>
      )}
    </As>
  );
}

/** Intestazione di gruppo ("Oggi", "Ieri", una data). Resta appiccicata in alto. */
export function RowGroup({ children, ...rest }) {
  return <div className="fin-row-group" {...rest}>{children}</div>;
}
