// src/components/TransactionDetail.jsx
// Il dettaglio di un movimento, dentro un pannello.
//
// Su desktop si apre a destra e l'elenco resta visibile, cosi' si passa da una
// riga all'altra senza perdere il posto; su telefono e' un foglio dal basso.
// E' lo stesso componente: la forma la decide il CSS di Sheet.
//
// La categoria si cambia da qui con un tocco, senza aprire il modulo di
// modifica: e' la correzione che si fa piu' spesso, e ogni passo in mezzo e'
// un passo che scoraggia dal farla.
import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useCategories, categoryLabel } from "../hooks/useCategories";
import { useDocuments } from "../hooks/useDocuments";
import { Amount, Avatar, Button, Select, Sheet, Tag } from "../ui";
import { Icon } from "./icons";
import { formatDate, formatRate } from "../lib/format";

export default function TransactionDetail({
  tx, account, onClose, onEdit, onDelete, onCategoryChange,
}) {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const { categories } = useCategories({ includeArchived: true });
  const { documents } = useDocuments({ transactionId: tx.id });

  const base = profile?.base_currency;
  const currency = tx.currency?.trim();
  const isNeutral = tx.kind === "transfer" || tx.kind === "investment";
  const label = tx.description || tx.merchant || (isNeutral ? t(`txKind.${tx.kind}`) : t("tx.noDescription"));
  const converted = base && currency !== base;

  return (
    <Sheet
      title={t("tx.detailTitle")}
      onClose={onClose}
      footer={<>
        <Button variant="danger" onClick={() => onDelete(tx)}>{t("common.delete")}</Button>
        <Button variant="primary" onClick={() => onEdit(tx)}>{t("common.edit")}</Button>
      </>}
    >
      {/* Importo e intestazione */}
      <div style={{ display: "grid", justifyItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}>
        <Avatar name={label} colorKey={tx.category_id ?? tx.merchant ?? label} size="lg" />
        <Amount minor={tx.amount_minor} currency={currency} variant="hero" />
        <p className="fin-h3" style={{ textAlign: "center" }}>{label}</p>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
          <Tag tone={isNeutral ? "var(--info)" : tx.kind === "income" ? "var(--positive)" : "var(--text-tertiary)"}>
            {t(`txKind.${tx.kind}`)}
          </Tag>
          {tx.fx_override_rate && <Tag tone="var(--warning)">{t("fx.manual")}</Tag>}
          {converted && tx.amount_base_minor === null && <Tag tone="var(--negative)">{t("fx.missing")}</Tag>}
        </div>
      </div>

      <dl style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label={t("tx.date")}>{formatDate(tx.booked_on, lang)}</Field>
        <Field label={t("tx.account")}>{account?.name ?? "—"}</Field>

        {/* La categoria si cambia qui, in un tocco. I movimenti neutri non ne
            hanno una di proposito: un giroconto non e' una spesa. */}
        <div>
          <dt className="fin-label">{t("tx.category")}</dt>
          <dd style={{ marginTop: "var(--space-2)" }}>
            {isNeutral ? (
              <p className="fin-muted">{t("tx.neutralNoCategory")}</p>
            ) : (
              <Select
                value={tx.category_id ?? ""}
                onChange={e => onCategoryChange(tx, e.target.value || null)}
                aria-label={t("tx.category")}
              >
                <option value="">{t("tx.noCategory")}</option>
                {(categories ?? []).map(c => (
                  <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>
                ))}
              </Select>
            )}
          </dd>
        </div>

        {converted && (
          <Field label={t("tx.converted", { currency: base })}>
            <Amount minor={tx.amount_base_minor} currency={base} tone="plain" />
            <p className="fin-caption" style={{ marginTop: 2 }}>
              {tx.fx_override_rate
                ? t("fx.manualTitle", { rate: formatRate(tx.fx_override_rate, lang), note: tx.fx_override_note ?? "" })
                : tx.fx_rate_date
                  ? t("fx.rateOf", { date: formatDate(tx.fx_rate_date, lang) })
                  : t("fx.missingTitle")}
            </p>
          </Field>
        )}

        {tx.original_amount_minor !== null && tx.original_currency && (
          <Field label={t("tx.originalAmount")}>
            <Amount minor={tx.original_amount_minor} currency={tx.original_currency.trim()} tone="plain" />
          </Field>
        )}

        {tx.merchant && <Field label={t("tx.merchant")}>{tx.merchant}</Field>}
        {tx.notes && <Field label={t("common.notes")}>{tx.notes}</Field>}

        {/* Documento collegato e import di provenienza: da qui si risale a
            "da dove viene questo numero", che e' la domanda che ci si fa
            davanti a un movimento che non si riconosce. */}
        {documents?.length > 0 && (
          <div>
            <dt className="fin-label">{t("tx.linkedDocument")}</dt>
            <dd style={{ marginTop: "var(--space-2)", display: "grid", gap: "var(--space-1)" }}>
              {documents.map(d => (
                <Link key={d.id} to={`/documents/${d.id}`} className="fin-btn fin-btn--secondary fin-btn--sm">
                  <Icon.Documents size={14} /> {d.file_name}
                </Link>
              ))}
            </dd>
          </div>
        )}

        {tx.import_id && (
          <div>
            <dt className="fin-label">{t("tx.fromImport")}</dt>
            <dd style={{ marginTop: "var(--space-2)" }}>
              <Link to={`/imports/${tx.import_id}`} className="fin-btn fin-btn--secondary fin-btn--sm">
                <Icon.Refresh size={14} /> {t("tx.openImport")}
              </Link>
            </dd>
          </div>
        )}
      </dl>
    </Sheet>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <dt className="fin-label">{label}</dt>
      <dd className="fin-body" style={{ marginTop: 2 }}>{children}</dd>
    </div>
  );
}
