// src/pages/InvestmentsPage.jsx
// Il portafoglio: quanto vale, com'e' diviso, com'e' andato.
//
// Il P&L e' diviso in effetto prezzo ed effetto cambio perche' sono due cose
// diverse: sul primo hai scelto tu, sul secondo no. Vederli insieme come un
// numero solo nasconde quale dei due sta muovendo il bilancio.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useHoldings, usePositions, useAllocation, useValueSeries } from "../hooks/useInvestments";
import {
  Amount, Badge, Button, Card, CardHeader, CardTitle, EmptyState, InlineAlert,
  Page, PageHeader, SegmentedControl, Select, SkeletonRows, Stat, StatGrid,
} from "../ui";
import ValueChart from "../components/ValueChart";
import AllocationBars from "../components/AllocationBars";
import HoldingForm from "../components/HoldingForm";
import { Icon, ICON } from "../components/icons";
import { formatDate } from "../lib/format";
import { trimDecimal } from "../lib/decimal";

const RANGES = { "1M": 30, "6M": 182, "1A": 365, ALL: 3650 };

const PRICE_TONE = {
  fresh:    null,
  stale:    "var(--warning)",
  no_price: "var(--negative)",
};

const iso = (daysAgo) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

export default function InvestmentsPage() {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const base = profile?.base_currency;

  const { positions, loading, error, reload: reloadPositions } = usePositions();
  const { reload: reloadHoldings } = useHoldings();

  const [dimension, setDimension] = useState("asset_class");
  const [range, setRange] = useState("6M");
  const [creating, setCreating] = useState(false);

  const { rows: allocation } = useAllocation(dimension);
  const { series } = useValueSeries({ from: iso(RANGES[range]) });

  const totals = useMemo(() => {
    let value = 0n, cost = 0n, price = 0n, fx = 0n, realized = 0n, unrealized = 0n;
    let stale = 0, missing = 0;
    for (const p of positions ?? []) {
      if (Number(p.quantity) > 0) {
        value      += BigInt(p.value_base_minor ?? 0);
        cost       += BigInt(p.cost_residual_base_minor ?? 0);
        price      += BigInt(p.price_effect_base_minor ?? 0);
        fx         += BigInt(p.fx_effect_base_minor ?? 0);
        unrealized += BigInt(p.unrealized_pl_base_minor ?? 0);
        if (p.price_status === "stale") stale += 1;
        if (p.price_status === "no_price") missing += 1;
      }
      realized += BigInt(p.realized_pl_base_minor ?? 0);
    }
    return { value, cost, price, fx, realized, unrealized, stale, missing };
  }, [positions]);

  const open = (positions ?? []).filter(p => Number(p.quantity) > 0);

  const header = (
    <PageHeader
      title={t("investments.title")}
      actions={
        <Button variant="primary" onClick={() => setCreating(true)} icon={<Icon.Plus size={ICON.sm} />}>
          {t("investments.new")}
        </Button>
      }
    />
  );

  if (loading) {
    return <Page>{header}<Card flush><SkeletonRows rows={5} /></Card></Page>;
  }

  return (
    <Page>
      {header}

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {open.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon.Investments size={ICON.lg} />}
            title={t("investments.emptyTitle")}
            body={t("investments.emptyBody")}
            action={<Button variant="primary" onClick={() => setCreating(true)}>{t("investments.new")}</Button>}
          />
        </Card>
      ) : (
        <>
          {/* Riepilogo: una riga di totali divisa da fili, come un prospetto. */}
          <Card flush>
            <div className="fin-card__body">
              <CardTitle>{t("investments.totalValue")}</CardTitle>
              <div style={{ marginTop: "var(--space-1)" }}>
                <Amount minor={totals.value} currency={base} variant="hero" tone="neutral" />
              </div>
            </div>

            <StatGrid style={{ border: "none", borderTop: "1px solid var(--border)", borderRadius: 0 }}>
              <Stat
                label={t("investments.unrealized")}
                value={<Amount minor={totals.unrealized} currency={base} variant="lg" signDisplay="exceptZero" />}
                hint={<>
                  {t("investments.ofWhichPrice")}{" "}
                  <Amount minor={totals.price} currency={base} variant="sm" signDisplay="exceptZero" />
                  {" · "}
                  {t("investments.ofWhichFx")}{" "}
                  <Amount minor={totals.fx} currency={base} variant="sm" signDisplay="exceptZero" />
                </>}
              />
              <Stat
                label={t("investments.realized")}
                value={<Amount minor={totals.realized} currency={base} variant="lg" signDisplay="exceptZero" />}
              />
              <Stat
                label={t("investments.cost")}
                value={<Amount minor={totals.cost} currency={base} variant="lg" tone="neutral" />}
              />
            </StatGrid>

            {(totals.stale > 0 || totals.missing > 0) && (
              <div className="fin-card__body">
                <InlineAlert tone="warning">
                  {totals.missing > 0 && t("investments.warnMissing", { count: totals.missing })}
                  {totals.missing > 0 && totals.stale > 0 && " · "}
                  {totals.stale > 0 && t("investments.warnStale", { count: totals.stale })}
                </InlineAlert>
              </div>
            )}
          </Card>

          {/* Andamento */}
          <Card flush>
            <CardHeader
              actions={
                <SegmentedControl
                  label={t("investments.overTime")}
                  value={range}
                  onChange={setRange}
                  options={Object.keys(RANGES).map(r => ({ value: r, label: t(`investments.range.${r}`) }))}
                />
              }
            >
              <CardTitle>{t("investments.overTime")}</CardTitle>
            </CardHeader>
            <div className="fin-card__body">
              <ValueChart series={series} currency={base} />
            </div>
          </Card>

          {/* Allocazione */}
          <Card flush>
            <CardHeader
              actions={
                <Select
                  value={dimension}
                  onChange={e => setDimension(e.target.value)}
                  aria-label={t("investments.dimension")}
                  style={{ width: "auto", height: "var(--control-h-sm)" }}
                >
                  <option value="asset_class">{t("investments.byClass")}</option>
                  <option value="currency">{t("investments.byCurrency")}</option>
                  <option value="holding">{t("investments.byHolding")}</option>
                </Select>
              }
            >
              <CardTitle>{t("investments.allocation")}</CardTitle>
            </CardHeader>
            <div className="fin-card__body">
              <AllocationBars
                rows={allocation}
                currency={base}
                labelOf={row => dimension === "asset_class" ? t(`assetClass.${row.label}`) : row.label}
              />
            </div>
            <div className="fin-card__foot">
              <Button as={Link} variant="ghost" size="sm" to="/settings/allocation">
                {t("investments.editTargets")}
              </Button>
            </div>
          </Card>

          {/* Elenco */}
          <Card flush>
            <CardHeader>
              <CardTitle>{t("investments.holdings")}</CardTitle>
            </CardHeader>

            {open.map(p => (
              <Link
                key={p.holding_id}
                to={`/investments/${p.holding_id}`}
                className="fin-row fin-row--interactive"
              >
                <span className="fin-row__body">
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                    <span className="fin-row__title" style={{ flex: "0 1 auto" }}>{p.name}</span>
                    <Badge>{t(`assetClass.${p.asset_class}`)}</Badge>
                    {PRICE_TONE[p.price_status] && (
                      <Badge tone={PRICE_TONE[p.price_status]}>{t(`priceStatus.${p.price_status}`)}</Badge>
                    )}
                  </span>
                  <span className="fin-row__subtitle">
                    {t("investments.quantityOf", { quantity: trimDecimal(p.quantity), currency: p.currency })}
                    {p.last_price_date ? ` · ${formatDate(p.last_price_date, lang)}` : ""}
                  </span>
                </span>

                <span className="fin-row__end">
                  <Amount minor={p.value_base_minor} currency={base} tone="neutral" />
                  <Amount minor={p.unrealized_pl_base_minor} currency={base} variant="sm" signDisplay="exceptZero" />
                </span>

                <Icon.Right size={ICON.sm} style={{ color: "var(--text-tertiary)", flex: "0 0 auto" }} aria-hidden="true" />
              </Link>
            ))}
          </Card>
        </>
      )}

      {creating && (
        <HoldingForm
          onClose={() => setCreating(false)}
          onSaved={async () => { setCreating(false); await reloadHoldings(); await reloadPositions(); }}
        />
      )}
    </Page>
  );
}
