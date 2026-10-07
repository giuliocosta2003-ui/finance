// src/pages/AllocationSettingsPage.jsx
// Metodo di calcolo del P&L e obiettivi di allocazione.
//
// Il metodo cambia quanto risulta realizzato quando vendi, quindi sta qui e
// non e' una costante nel codice: le regole fiscali cambiano da paese a paese.
// Cambiarlo ricalcola tutto lo storico, perche' i numeri non sono salvati da
// nessuna parte: si ricavano dai lotti ogni volta.
import { useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { useHoldings, useTargets } from "../hooks/useInvestments";
import { useToast } from "../components/Toast";
import {
  Button, Card, CardHeader, CardTitle, ChoiceRow, Field, IconButton,
  InlineAlert, Input, Page, PageHeader, Select, SkeletonRows,
} from "../ui";
import { Icon, ICON } from "../components/icons";
import { formatPercent } from "../lib/format";

const METHODS = ["lifo", "average", "fifo"];
const DIMENSIONS = ["asset_class", "currency", "holding"];
const CLASSES = ["etf", "stock", "bond", "crypto", "real_estate", "cash", "other"];

export default function AllocationSettingsPage() {
  const { t, lang } = useI18n();
  const { profile, updateProfile } = useAuth();
  const { codes } = useCurrencies();
  const { holdings } = useHoldings();
  const { targets, loading, save, remove } = useTargets();
  const toast = useToast();

  const [dimension, setDimension] = useState("asset_class");
  const [key, setKey] = useState("");
  const [targetPct, setTargetPct] = useState("");
  const [tolerancePct, setTolerancePct] = useState("5");
  const [error, setError] = useState("");

  const rows = (targets ?? []).filter(x => x.dimension === dimension);
  const sum = rows.reduce((acc, r) => acc + Number(r.target_pct), 0);

  const keyOptions = dimension === "asset_class"
    ? CLASSES.map(c => ({ value: c, label: t(`assetClass.${c}`) }))
    : dimension === "currency"
      ? codes.map(c => ({ value: c, label: c }))
      : (holdings ?? []).map(h => ({ value: h.id, label: h.name }));

  const labelFor = (row) => {
    if (row.dimension === "asset_class") return t(`assetClass.${row.key}`);
    if (row.dimension === "currency") return row.key;
    return (holdings ?? []).find(h => h.id === row.key)?.name ?? row.key;
  };

  const add = async () => {
    setError("");
    const pct = Number(String(targetPct).replace(",", "."));
    const tol = Number(String(tolerancePct).replace(",", "."));
    if (!key) { setError(t("allocation.errKey")); return; }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setError(t("allocation.errPct")); return; }
    if (!Number.isFinite(tol) || tol < 0 || tol > 100) { setError(t("allocation.errTolerance")); return; }

    const res = await save({ dimension, key, targetPct: pct, tolerancePct: tol });
    if (!res.ok) { setError(res.error); return; }
    setKey(""); setTargetPct("");
  };

  return (
    <Page>
      <PageHeader
        backTo="/settings"
        backLabel={t("nav.settings")}
        title={t("allocation.title")}
        subtitle={t("allocation.intro")}
      />

      {/* Metodo P&L */}
      <Card flush>
        <CardHeader><CardTitle>{t("allocation.pnlMethod")}</CardTitle></CardHeader>
        <div className="fin-card__body" style={{ display: "grid", gap: "var(--space-2)" }}>
          <div role="radiogroup" aria-label={t("allocation.pnlMethod")} style={{ display: "grid", gap: "var(--space-2)" }}>
            {METHODS.map(m => (
              <ChoiceRow
                key={m}
                role="radio"
                selected={profile?.pnl_method === m}
                onClick={async () => {
                  const res = await updateProfile({ pnl_method: m });
                  if (res?.error) toast.error(res.error);
                  else toast.success(t("allocation.methodChanged"));
                }}
                style={{ display: "block" }}
              >
                <span style={{ display: "block", fontWeight: "var(--fw-semibold)", color: "var(--text)" }}>
                  {t(`pnlMethod.${m}`)}
                </span>
                <span className="fin-hint" style={{ display: "block", marginTop: 2 }}>
                  {t(`pnlMethodHint.${m}`)}
                </span>
              </ChoiceRow>
            ))}
          </div>
          <p className="fin-hint">{t("allocation.methodRecalc")}</p>
        </div>
      </Card>

      {/* Obiettivi */}
      <Card flush>
        <CardHeader
          actions={
            <Select
              value={dimension}
              onChange={e => { setDimension(e.target.value); setKey(""); }}
              aria-label={t("investments.dimension")}
              style={{ width: "auto", height: "var(--control-h-sm)" }}
            >
              {DIMENSIONS.map(d => <option key={d} value={d}>{t(`allocation.dimension.${d}`)}</option>)}
            </Select>
          }
        >
          <CardTitle>{t("allocation.targets")}</CardTitle>
        </CardHeader>

        {loading && <SkeletonRows rows={3} />}

        {!loading && rows.length === 0 && (
          <div className="fin-card__body"><p className="fin-hint">{t("allocation.empty")}</p></div>
        )}

        {rows.map(r => (
          <div key={r.id} className="fin-row">
            <span className="fin-row__body">
              <span className="fin-row__title">{labelFor(r)}</span>
            </span>
            <span className="num" style={{ fontWeight: "var(--fw-semibold)", color: "var(--text)" }}>
              {formatPercent(Number(r.target_pct) / 100, lang, { maximumFractionDigits: 1 })}
            </span>
            <span className="fin-caption" style={{ flex: "0 0 auto" }}>
              ±{formatPercent(Number(r.tolerance_pct) / 100, lang, { maximumFractionDigits: 1 })}
            </span>
            <IconButton
              tone="danger"
              onClick={() => remove(r.id)}
              label={t("common.delete")}
              icon={<Icon.Delete size={ICON.sm} />}
            />
          </div>
        ))}

        <div className="fin-card__body" style={{ display: "grid", gap: "var(--space-3)" }}>
          {/* La somma non e' obbligatoria: un obiettivo parziale e' legittimo. */}
          {rows.length > 0 && Math.abs(sum - 100) > 0.01 && (
            <InlineAlert tone="warning">
              {t("allocation.sumWarning", {
                sum: formatPercent(sum / 100, lang, { maximumFractionDigits: 1 }),
              })}
            </InlineAlert>
          )}

          {/* Nuovo obiettivo. Su schermo stretto le quattro colonne diventano
              una sola: tre campi da 60 px affiancati non si compilano. */}
          <div className="fin-target-form">
            <Field label={t("allocation.key")} htmlFor="a-key">
              <Select id="a-key" value={key} onChange={e => setKey(e.target.value)}>
                <option value="">—</option>
                {keyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
            <Field label={t("allocation.targetPct")} htmlFor="a-pct">
              <Input
                id="a-pct" value={targetPct} onChange={e => setTargetPct(e.target.value)}
                inputMode="decimal" placeholder="60"
              />
            </Field>
            <Field label={t("allocation.tolerancePct")} htmlFor="a-tol">
              <Input
                id="a-tol" value={tolerancePct} onChange={e => setTolerancePct(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Button variant="primary" onClick={add}>{t("common.add")}</Button>
          </div>

          {error && <InlineAlert tone="error">{error}</InlineAlert>}
        </div>
      </Card>
    </Page>
  );
}
