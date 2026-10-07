// src/pages/TaxesPage.jsx
// La sezione Tasse (solo profilo imprenditore). Tre blocchi: quanto
// accantonare, le prossime scadenze, e le voci d'imposta con lo storico.
//
// Regola non negoziabile: nessun numero appare senza che si possa vedere da
// dove arriva. Ogni riga porta al dettaglio del periodo, e da lì ai movimenti.
// E in cima resta sempre l'avviso: l'app fa aritmetica, non consulenza.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import {
  Badge, Button, Card, CardBody, CardHeader, CardTitle, ChoiceRow,
  EmptyState, InlineAlert, Page, PageHeader, SkeletonRows, Stat, StatGrid,
} from "../ui";
import Amount from "../ui/Amount.jsx";
import { Icon, ICON } from "../components/icons";
import { formatDate } from "../lib/format";
import { useTaxItems, useTaxPeriods, useTaxSetAside } from "../hooks/useTaxes";
import TaxItemForm from "../components/TaxItemForm";

const DAY = 86400000;

function daysTo(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d - today) / DAY);
}

export default function TaxesPage() {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const base = profile?.base_currency ?? "EUR";

  const { items, loading: itemsLoading, reload: reloadItems } = useTaxItems();
  const { periods: upcoming, loading: upLoading } = useTaxPeriods({ openOnly: true });
  const { data: setAside } = useTaxSetAside();

  const [editing, setEditing] = useState(null); // null | "new" | item

  // Storico: i periodi pagati, sommati per anno.
  const { periods: allPeriods } = useTaxPeriods({});
  const history = useMemo(() => {
    const byYear = new Map();
    for (const p of allPeriods ?? []) {
      if (p.status !== "paid") continue;
      const y = (p.period_end ?? "").slice(0, 4);
      byYear.set(y, (byYear.get(y) ?? 0) + Number(p.amount_due_minor ?? 0));
    }
    return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [allPeriods]);

  if (profile && profile.profile_type !== "entrepreneur") {
    return (
      <Page>
        <PageHeader title={t("taxes.title")} subtitle={t("taxes.intro")} />
        <Card><EmptyState icon={<Icon.Taxes size={22} />} title={t("taxes.title")} body={t("taxes.intro")} /></Card>
      </Page>
    );
  }

  const diff = setAside?.difference_minor;

  return (
    <Page>
      <PageHeader
        title={t("taxes.title")}
        subtitle={t("taxes.intro")}
        actions={<Button variant="primary" onClick={() => setEditing("new")}>
          <Icon.Plus size={ICON.sm} aria-hidden="true" /> {t("taxes.items.new")}
        </Button>}
      />

      {/* L'avviso fisso: sempre, in cima. */}
      <InlineAlert tone="info">{t("taxes.disclaimer")}</InlineAlert>

      {/* Da accantonare */}
      <Card>
        <CardHeader><CardTitle>{t("taxes.setAside.title")}</CardTitle></CardHeader>
        <CardBody>
          <p className="fin-hint" style={{ marginTop: 0 }}>{t("taxes.setAside.hint")}</p>
          <StatGrid>
            <Stat label={t("taxes.setAside.title")}
              value={<Amount minor={setAside?.to_set_aside_minor ?? 0} currency={base} variant="lg" tone="neutral" />} />
            {setAside?.set_aside_account_id ? (
              <>
                <Stat label={t("taxes.setAside.inAccount")}
                  value={<Amount minor={setAside.account_balance_base_minor} currency={base} variant="lg" tone="neutral" />} />
                <Stat
                  label={t("taxes.setAside.difference")}
                  value={<Amount minor={diff} currency={base} variant="lg"
                    tone={diff == null ? "neutral" : diff >= 0 ? "in" : "out"} signDisplay="exceptZero" />}
                  hint={diff == null ? undefined : diff >= 0 ? t("taxes.setAside.surplus") : t("taxes.setAside.shortfall")}
                />
              </>
            ) : (
              <Stat label="" value={<span className="fin-caption">{t("taxes.setAside.noAccount")}</span>} />
            )}
          </StatGrid>
        </CardBody>
      </Card>

      {/* Prossime scadenze */}
      <Card flush>
        <CardHeader><CardTitle>{t("taxes.upcoming.title")}</CardTitle></CardHeader>
        {upLoading ? <SkeletonRows rows={3} /> : (upcoming ?? []).length === 0 ? (
          <CardBody><p className="fin-hint" style={{ margin: 0 }}>{t("taxes.upcoming.empty")}</p></CardBody>
        ) : (
          <div>
            {upcoming.map(p => {
              const d = daysTo(p.due_date);
              const soon = d <= 7;
              const label = d < 0 ? t("taxes.upcoming.overdue")
                : d === 0 ? t("taxes.upcoming.today")
                : t("taxes.upcoming.inDays", { days: d });
              return (
                <ChoiceRow key={p.id} onClick={() => navigate(`/taxes/period/${p.id}`)} style={{ flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", color: "var(--text)" }}>{p.tax_items?.name}</span>
                    <span className="fin-caption">{t("taxes.upcoming.dueOn", { date: formatDate(p.due_date, lang) })}</span>
                  </span>
                  <Badge tone={soon ? "var(--negative)" : "var(--muted)"}>{label}</Badge>
                  <Amount minor={p.amount_due_minor} currency={base} variant="sm" tone="neutral" />
                  <Icon.Right size={ICON.sm} aria-hidden="true" style={{ color: "var(--muted)" }} />
                </ChoiceRow>
              );
            })}
          </div>
        )}
      </Card>

      {/* Voci d'imposta */}
      <Card flush>
        <CardHeader><CardTitle>{t("taxes.items.title")}</CardTitle></CardHeader>
        {itemsLoading ? <SkeletonRows rows={3} /> : (items ?? []).length === 0 ? (
          <CardBody>
            <EmptyState title={t("taxes.items.empty")}
              action={<Button variant="secondary" onClick={() => setEditing("new")}>{t("taxes.items.new")}</Button>} />
          </CardBody>
        ) : (
          <div>
            {items.map(it => (
              <ChoiceRow key={it.id} onClick={() => setEditing(it)} style={{ flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", color: "var(--text)" }}>{it.name}</span>
                  <span className="fin-caption">
                    {t(`taxes.form.base${it.base_type === "gross_income" ? "Gross" : it.base_type === "net_profit" ? "Net" : it.base_type === "vat_balance" ? "Vat" : "Fixed"}`)}
                    {it.rate_pct != null ? ` · ${it.rate_pct}%` : ""}
                    {` · ${t(`taxes.form.freq${it.frequency === "monthly" ? "Monthly" : it.frequency === "quarterly" ? "Quarterly" : it.frequency === "yearly" ? "Yearly" : "OneOff"}`)}`}
                  </span>
                </span>
                {!it.active && <Badge tone="var(--muted)">{t("taxes.items.inactive")}</Badge>}
                <Icon.Edit size={ICON.sm} aria-hidden="true" style={{ color: "var(--muted)" }} />
              </ChoiceRow>
            ))}
          </div>
        )}
      </Card>

      {/* Storico */}
      {history.length > 0 && (
        <Card flush>
          <CardHeader><CardTitle>{t("taxes.history.title")}</CardTitle></CardHeader>
          <div>
            {history.map(([year, sum]) => (
              <div key={year} className="fin-listrow">
                <span style={{ flex: 1 }}>{year}</span>
                <Amount minor={sum} currency={base} variant="sm" tone="neutral" />
              </div>
            ))}
          </div>
        </Card>
      )}

      {editing && (
        <TaxItemForm
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reloadItems(); }}
        />
      )}
    </Page>
  );
}
