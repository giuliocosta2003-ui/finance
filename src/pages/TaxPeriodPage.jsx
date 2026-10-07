// src/pages/TaxPeriodPage.jsx
// Dettaglio di un periodo d'imposta: da dove arriva l'imponibile (con il link
// ai movimenti o alle fatture che lo compongono), il calcolo passo passo, e i
// pagamenti — anche parziali. Un periodo pagato mostra un avviso se l'imponibile
// e' cambiato dopo.
import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import {
  Badge, Button, Card, CardBody, CardHeader, CardTitle, ErrorState,
  InlineAlert, Page, PageHeader, SkeletonRows, Stat, StatGrid,
} from "../ui";
import Amount from "../ui/Amount.jsx";
import { Icon, ICON } from "../components/icons";
import { formatDate } from "../lib/format";
import { useTaxPeriod } from "../hooks/useTaxes";
import TaxPaymentForm from "../components/TaxPaymentForm";

const STATUS_TONE = {
  projected: "var(--muted)",
  due: "var(--negative)",
  partially_paid: "var(--info)",
  paid: "var(--positive)",
  skipped: "var(--muted)",
};

export default function TaxPeriodPage() {
  const { periodId } = useParams();
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const base = profile?.base_currency ?? "EUR";

  const { period, payments, loading, error, reload, addPayment, removePayment, setStatus } = useTaxPeriod(periodId);
  const [paying, setPaying] = useState(false);

  const paidMinor = useMemo(
    () => (payments ?? []).reduce((s, p) => s + Number(p.amount_minor ?? 0), 0),
    [payments],
  );

  if (loading) return <Page><Card flush><SkeletonRows rows={5} /></Card></Page>;
  if (error || !period) return <Page><Card><ErrorState title={error ?? t("taxes.period.title")} /></Card></Page>;

  const item = period.tax_items ?? {};
  const due = Number(period.amount_due_minor ?? 0);
  const remaining = Math.max(due - paidMinor, 0);
  const coef = item.coefficient_pct == null ? 100 : Number(item.coefficient_pct);

  // Drill-down: i movimenti (o le fatture) del periodo. Se la voce filtra un
  // solo conto o una sola categoria, lo si passa; altrimenti solo le date.
  const txHref = () => {
    const q = new URLSearchParams({ from: period.period_start, to: period.period_end });
    if (item.base_type === "gross_income") q.set("kind", "income");
    if (Array.isArray(item.account_ids) && item.account_ids.length === 1) q.set("accountId", item.account_ids[0]);
    if (Array.isArray(item.category_ids) && item.category_ids.length === 1) q.set("categoryId", item.category_ids[0]);
    return `/transactions?${q.toString()}`;
  };

  return (
    <Page>
      <PageHeader
        backTo="/taxes"
        backLabel={t("taxes.title")}
        title={item.name ?? t("taxes.period.title")}
        subtitle={`${formatDate(period.period_start, lang)} — ${formatDate(period.period_end, lang)}`}
      />

      <InlineAlert tone="info">{t("taxes.disclaimer")}</InlineAlert>

      {period.base_changed_after_payment && (
        <InlineAlert tone="warning" title={t("taxes.status.paid")}>{t("taxes.period.baseChanged")}</InlineAlert>
      )}

      <Card>
        <CardBody>
          <StatGrid>
            <Stat label={t("taxes.period.base")} value={<Amount minor={period.base_minor} currency={base} variant="lg" tone="neutral" />} />
            <Stat label={t("taxes.period.amountDue")} value={<Amount minor={due} currency={base} variant="lg" tone="neutral" />} />
            <Stat label={t("taxes.period.paid")} value={<Amount minor={paidMinor} currency={base} variant="lg" tone="neutral" />} />
            <Stat label={t("taxes.period.remaining")} value={<Amount minor={remaining} currency={base} variant="lg" tone={remaining > 0 ? "out" : "in"} />} />
            <Stat label={t("taxes.period.dueDate")} value={formatDate(period.due_date, lang)} />
            <Stat label={t("taxes.period.statusLabel")}
              value={<Badge tone={STATUS_TONE[period.status]}>{t(`taxes.status.${period.status}`)}</Badge>} />
          </StatGrid>
        </CardBody>
      </Card>

      {/* Come è calcolato */}
      <Card>
        <CardHeader><CardTitle>{t("taxes.period.howCalculated")}</CardTitle></CardHeader>
        <CardBody>
          {item.base_type === "fixed" ? (
            <p style={{ margin: 0 }}>{t("taxes.period.calcFixed")}</p>
          ) : item.base_type === "vat_balance" ? (
            <p style={{ margin: 0 }}>{t("taxes.period.calcVat")}</p>
          ) : (
            <p style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "baseline" }}>
              <Amount minor={period.base_minor} currency={base} variant="sm" tone="neutral" />
              <span className="fin-caption">× {coef}% × {item.rate_pct}% =</span>
              <Amount minor={due} currency={base} variant="sm" tone="neutral" />
            </p>
          )}
          <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {item.base_type === "vat_balance"
              ? <Button variant="secondary" size="sm" onClick={() => navigate("/documents")}>{t("taxes.period.viewDocuments")}</Button>
              : <Button variant="secondary" size="sm" onClick={() => navigate(txHref())}>{t("taxes.period.viewTransactions")}</Button>}
          </div>
          {period.computed_at && (
            <p className="fin-caption" style={{ marginTop: "var(--space-2)" }}>
              {t("taxes.period.computedAt", { date: formatDate(period.computed_at, lang) })}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Pagamenti */}
      <Card flush>
        <CardHeader>
          <CardTitle>{t("taxes.period.payments")}</CardTitle>
          {period.status !== "skipped" && (
            <Button variant="primary" size="sm" onClick={() => setPaying(true)}>
              <Icon.Plus size={ICON.sm} aria-hidden="true" /> {t("taxes.period.addPayment")}
            </Button>
          )}
        </CardHeader>
        {(payments ?? []).length === 0 ? (
          <CardBody><p className="fin-hint" style={{ margin: 0 }}>{t("taxes.period.noPayments")}</p></CardBody>
        ) : (
          <div>
            {payments.map(p => (
              <div key={p.id} className="fin-listrow">
                <span style={{ flex: 1 }}>{formatDate(p.paid_on, lang)}</span>
                <Amount minor={p.amount_minor} currency={base} variant="sm" tone="neutral" />
                <Button variant="quiet" size="sm" onClick={async () => { await removePayment(p.id); }}
                  aria-label={t("taxes.period.deletePayment")}>
                  <Icon.Trash size={ICON.sm} aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Salta / riattiva */}
      <div>
        {period.status === "skipped" ? (
          <Button variant="secondary" onClick={() => setStatus("projected")}>{t("taxes.period.unskip")}</Button>
        ) : (
          <Button variant="quiet" onClick={() => setStatus("skipped")}>{t("taxes.period.skip")}</Button>
        )}
      </div>

      {paying && (
        <TaxPaymentForm
          period={period}
          remainingMinor={remaining}
          addPayment={addPayment}
          onClose={() => setPaying(false)}
          onSaved={() => { setPaying(false); reload(); }}
        />
      )}
    </Page>
  );
}
