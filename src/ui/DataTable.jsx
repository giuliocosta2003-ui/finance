// src/ui/DataTable.jsx
// La tabella del desktop: colonne ordinabili, selezione multipla, e le celle
// numeriche allineate a destra con le cifre tabulari.
//
// Esiste solo su schermo largo. Su mobile la stessa lista si mostra come card
// (ListRow): una tabella a sette colonne su 390 px si legge male e costringe a
// scorrere di lato, che il brief vieta.
import { useI18n } from "../i18n/I18nContext";
import { Icon } from "../components/icons";

const cx = (...parts) => parts.filter(Boolean).join(" ");

/**
 * @param columns  [{ key, header, align, sortable, width, render(row) }]
 * @param rows     le righe, ognuna con un `id`
 * @param sort     { key, dir: "asc" | "desc" }
 * @param selected Set di id, oppure null se la selezione non serve
 * @param rowClassName (row) => string | undefined
 */
export default function DataTable({
  columns,
  rows,
  sort,
  onSort,
  selected = null,
  onToggle,
  onToggleAll,
  onRowClick,
  caption,
  emptyLabel,
  /** Classe extra per riga, es. per attenuare quelle escluse dall'import. */
  rowClassName,
}) {
  const { t } = useI18n();
  const selectable = selected instanceof Set;
  const allOn = selectable && rows.length > 0 && rows.every(r => selected.has(r.id));

  const ariaSort = (col) => {
    if (!col.sortable) return undefined;
    if (sort?.key !== col.key) return "none";
    return sort.dir === "asc" ? "ascending" : "descending";
  };

  return (
    <div className="fin-table-wrap">
      <table className="fin-table">
        {caption && <caption className="fin-caption" style={{ textAlign: "left", padding: "var(--space-2) var(--space-4)" }}>{caption}</caption>}
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 44 }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={onToggleAll}
                  aria-label={t("ui.selectAll")}
                />
              </th>
            )}
            {columns.map(col => (
              <th
                key={col.key}
                style={{ width: col.width, textAlign: col.align === "right" ? "right" : undefined }}
                aria-sort={ariaSort(col)}
                onClick={col.sortable ? () => onSort?.(col.key) : undefined}
                // Una colonna ordinabile deve essere azionabile anche da
                // tastiera: e' un comando, non una decorazione.
                tabIndex={col.sortable ? 0 : undefined}
                onKeyDown={col.sortable
                  ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort?.(col.key); } }
                  : undefined}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {col.header}
                  {col.sortable && sort?.key === col.key && (
                    sort.dir === "asc"
                      ? <Icon.Up size={12} aria-hidden="true" />
                      : <Icon.Down size={12} aria-hidden="true" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="fin-caption">
                {emptyLabel ?? t("ui.noRows")}
              </td>
            </tr>
          )}

          {rows.map(row => (
            <tr
              key={row.id}
              className={rowClassName?.(row)}
              aria-selected={selectable ? selected.has(row.id) : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ cursor: onRowClick ? "pointer" : undefined }}
            >
              {selectable && (
                <td onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => onToggle?.(row.id)}
                    aria-label={t("ui.selectRow")}
                  />
                </td>
              )}
              {columns.map(col => (
                <td key={col.key} className={cx(col.align === "right" && "fin-table__num")}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
