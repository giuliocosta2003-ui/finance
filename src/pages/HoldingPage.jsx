// src/pages/HoldingPage.jsx
// Il dettaglio di un investimento: lotti, prezzi, andamento, documenti.
//
// I lotti sono la fonte di verita': quantita', costo e P&L non si salvano da
// nessuna parte, si ricalcolano da qui ogni volta. Correggere un lotto sbagliato
// di due anni fa rimette a posto tutti i numeri, senza migrazioni di dati.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { useHoldings, usePositions, useLots, usePrices } from "../hooks/useInvestments";
import { useDocuments } from "../hooks/useDocuments";
import { useToast } from "../components/Toast";
import {
  Amount, Badge, Button, Card, CardHeader, CardTitle, ErrorState, Field,
  IconButton, InlineAlert, Input, Page, PageHeader, Select, Sheet,
  SkeletonRows, Stat, StatGrid,
} from "../ui";
import ValueChart from "../components/ValueChart";
import HoldingForm from "../components/HoldingForm";
import { Icon, ICON } from "../components/icons";
import { errorText } from "../i18n/errorText";
import { formatDate, formatNumber } from "../lib/format";
import { parseDecimal, isPositiveDecimal, isNonNegativeDecimal, trimDecimal } from "../lib/decimal";

export default function HoldingPage() {
  const { holdingId } = useParams();
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const { minorUnits } = useCurrencies();
  const toast = useToast();

  const base = profile?.base_currency;
  const { holdings, reload: reloadHoldings } = useHoldings({ includeArchived: true });
  const { positions, reload: reloadPositions } = usePositions();
  const { lots, create: createLot, remove: removeLot, reload: reloadLots } = useLots(holdingId);
  const { prices, setPrice, removePrice, backfill, reload: reloadPrices } = usePrices(holdingId);
  const { documents } = useDocuments({ holdingId });

  const [editing, setEditing] = useState(false);
  const [addingLot, setAddingLot] = useState(false);
  const [addingPrice, setAddingPrice] = useState(false);
  const [busy, setBusy] = useState(false);

  const holding = (holdings ?? []).find(h => h.id === holdingId);
  const position = (positions ?? []).find(p => p.holding_id === holdingId);

  // Il grafico di un singolo investimento e' quello del suo PREZZO, non del
  // controvalore: e' la cosa che si vuole guardare quando si apre questa pagina.
  const priceSeries = useMemo(() => {
    if (!prices?.length || !holding) return [];
    const units = minorUnits(holding.currency?.trim());
    const factor = 10 ** units;
    return [...prices]
      .sort((a, b) => a.price_date.localeCompare(b.price_date))
      .map(p => ({
        d: p.price_date,
        value_base_minor: Math.round(Number(p.price) * factor),
        estimated: false,
      }));
  }, [prices, holding, minorUnits]);

  const refreshAll = async () => {
    await Promise.all([reloadLots(), reloadPrices(), reloadPositions()]);
  };

  if (!holdings || !positions) {
    return <Page><Card flush><SkeletonRows rows={5} /></Card></Page>;
  }

  if (!holding) {
    return (
      <Page>
        <Card>
          <ErrorState
            title={t("investments.notFound")}
            body={t("investments.notFoundBody")}
          />
        </Card>
      </Page>
    );
  }

  const currency = holding.currency?.trim();

  return (
    <Page>
      <PageHeader
        backTo="/investments"
        backLabel={t("investments.title")}
        title={holding.name}
        subtitle={
          <>
            {t(`assetClass.${holding.asset_class}`)} · {currency}
            {holding.symbol ? ` · ${holding.symbol}` : ""}
            {holding.isin ? ` · ${holding.isin.trim()}` : ""}
            {` · ${t(`priceProvider.${holding.price_provider}`)}`}
          </>
        }
        actions={<Button onClick={() => setEditing(true)} icon={<Icon.Edit size={ICON.sm} />}>{t("common.edit")}</Button>}
      />

      {/* Posizione */}
      <Card flush>
        <StatGrid style={{ border: "none", borderRadius: 0 }}>
          <Stat label={t("investments.quantity")} value={trimDecimal(position?.quantity ?? "0")} />
          <Stat
            label={t("investments.avgCost")}
            value={position?.avg_unit_cost
              ? `${formatNumber(Number(position.avg_unit_cost), lang, { maximumFractionDigits: 6 })} ${currency}`
              : "—"}
          />
          <Stat
            label={t("investments.lastPrice")}
            value={position?.last_price
              ? `${formatNumber(Number(position.last_price), lang, { maximumFractionDigits: 10 })} ${currency}`
              : "—"}
            hint={position?.price_status === "fresh" && position.last_price_date
              ? formatDate(position.last_price_date, lang)
              : t(`priceStatus.${position?.price_status ?? "no_price"}`)}
            tone={position?.price_status === "fresh" ? null : "var(--warning)"}
          />
          <Stat
            label={t("investments.value")}
            value={<Amount minor={position?.value_base_minor} currency={base} tone="neutral" variant="lg" />}
          />
          <Stat
            label={t("investments.unrealized")}
            value={<Amount minor={position?.unrealized_pl_base_minor} currency={base} variant="lg" signDisplay="exceptZero" />}
            hint={<>
              {t("investments.ofWhichPrice")}{" "}
              <Amount minor={position?.price_effect_base_minor} currency={base} variant="sm" signDisplay="exceptZero" />
              {" · "}
              {t("investments.ofWhichFx")}{" "}
              <Amount minor={position?.fx_effect_base_minor} currency={base} variant="sm" signDisplay="exceptZero" />
            </>}
          />
          <Stat
            label={t("investments.realized")}
            value={<Amount minor={position?.realized_pl_base_minor} currency={base} variant="lg" signDisplay="exceptZero" />}
          />
        </StatGrid>

        <div className="fin-card__foot">
          <span className="fin-caption">{t(`pnlMethod.${position?.pnl_method ?? "lifo"}`)}</span>
          <div style={{ marginLeft: "auto" }}>
            <Button as={Link} variant="ghost" size="sm" to="/settings/allocation">{t("common.change")}</Button>
          </div>
        </div>
      </Card>

      {/* Prezzi */}
      <Card flush>
        <CardHeader
          actions={
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              {holding.price_provider !== "manual" && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const res = await backfill();
                    setBusy(false);
                    if (!res.ok) { toast.error(errorText(t, "investments.errors", res.error)); return; }
                    await reloadPositions();
                    toast.success(t("investments.backfilled", { count: res.saved ?? 0 }));
                    if (res.truncated) toast.info(t("investments.backfillTruncated", { days: res.historyDays }));
                  }}
                >{t("investments.backfill")}</Button>
              )}
              <Button size="sm" onClick={() => setAddingPrice(true)}>{t("investments.addPrice")}</Button>
            </div>
          }
        >
          <CardTitle>{t("investments.prices")}</CardTitle>
        </CardHeader>

        <div className="fin-card__body">
          <ValueChart series={priceSeries} currency={currency} height={160} />
        </div>

        {prices?.slice(0, 8).map(p => (
          <div key={p.price_date} className="fin-row fin-row--sm">
            <span className="fin-caption" style={{ minWidth: 110, flex: "0 0 auto" }}>
              {formatDate(p.price_date, lang)}
            </span>
            <span className="num" style={{ fontSize: "var(--fs-body-sm)", color: "var(--text)", flex: 1 }}>
              {formatNumber(Number(p.price), lang, { maximumFractionDigits: 10 })} {currency}
            </span>
            <Badge>{t(`priceSource.${p.source}`)}</Badge>
            {p.source === "manual" && (
              <IconButton
                tone="danger"
                onClick={async () => { await removePrice(p.price_date); await reloadPositions(); }}
                label={t("common.delete")}
                icon={<Icon.Delete size={ICON.sm} />}
              />
            )}
          </div>
        ))}
      </Card>

      {/* Lotti */}
      <Card flush>
        <CardHeader
          actions={
            <Button size="sm" onClick={() => setAddingLot(true)} icon={<Icon.Plus size={ICON.sm} />}>
              {t("investments.addLot")}
            </Button>
          }
        >
          <CardTitle>{t("investments.lots")}</CardTitle>
        </CardHeader>

        {lots?.length === 0 && (
          <div className="fin-card__body"><p className="fin-hint">{t("investments.noLots")}</p></div>
        )}

        {(lots ?? []).map(l => (
          <div key={l.id} className="fin-row fin-row--sm">
            {/* Acquisto verde, vendita rossa: e' lo stesso codice di colore
                degli importi, cosi' non se ne impara un secondo. */}
            <Badge tone={l.side === "buy" ? "var(--positive)" : "var(--negative)"}>
              {t(`lotSide.${l.side}`)}
            </Badge>
            <span className="fin-caption" style={{ minWidth: 100, flex: "0 0 auto" }}>
              {formatDate(l.trade_date, lang)}
            </span>
            <span className="num" style={{ fontSize: "var(--fs-body-sm)", color: "var(--text)", flex: 1 }}>
              {trimDecimal(l.quantity)} × {formatNumber(Number(l.unit_price), lang, { maximumFractionDigits: 10 })} {currency}
            </span>
            {Number(l.fees_minor) > 0 && (
              <span className="fin-caption">
                + <Amount minor={l.fees_minor} currency={currency} tone="muted" variant="sm" />
              </span>
            )}
            <IconButton
              tone="danger"
              onClick={async () => { await removeLot(l.id); await reloadPositions(); }}
              label={t("common.delete")}
              icon={<Icon.Delete size={ICON.sm} />}
            />
          </div>
        ))}
      </Card>

      {/* Documenti collegati */}
      {documents?.length > 0 && (
        <Card flush>
          <CardHeader><CardTitle>{t("investments.documents")}</CardTitle></CardHeader>
          {documents.map(d => (
            <Link key={d.id} to={`/documents/${d.id}`} className="fin-row fin-row--interactive">
              <span className="fin-row__body">
                <span className="fin-row__title">{d.file_name}</span>
                <span className="fin-row__subtitle">{t(`documentKind.${d.kind}`)}</span>
              </span>
              <Icon.Right size={ICON.sm} style={{ color: "var(--text-tertiary)", flex: "0 0 auto" }} aria-hidden="true" />
            </Link>
          ))}
        </Card>
      )}

      {editing && (
        <HoldingForm
          holding={holding}
          onClose={() => setEditing(false)}
          onSaved={async () => { setEditing(false); await reloadHoldings(); await reloadPositions(); }}
        />
      )}

      {addingLot && (
        <LotForm
          currency={currency}
          onClose={() => setAddingLot(false)}
          onSave={async (values) => {
            const res = await createLot(values);
            if (!res.ok) return res;
            setAddingLot(false);
            await refreshAll();
            return res;
          }}
        />
      )}

      {addingPrice && (
        <PriceForm
          currency={currency}
          onClose={() => setAddingPrice(false)}
          onSave={async (values) => {
            const res = await setPrice(values);
            if (!res.ok) return res;
            setAddingPrice(false);
            await reloadPositions();
            return res;
          }}
        />
      )}
    </Page>
  );
}

// ── form dei lotti ───────────────────────────────────────────────────────────

function LotForm({ currency, onClose, onSave }) {
  const { t } = useI18n();
  const { minorUnits } = useCurrencies();

  const [side, setSide] = useState("buy");
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [fees, setFees] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!tradeDate) { setError(t("investments.errDate")); return; }
    if (!isPositiveDecimal(quantity)) { setError(t("investments.errQuantity")); return; }
    if (!isNonNegativeDecimal(unitPrice)) { setError(t("investments.errPrice")); return; }

    const units = minorUnits(currency);
    const feeDecimal = fees.trim() === "" ? "0" : parseDecimal(fees);
    if (feeDecimal === null) { setError(t("investments.errFees")); return; }
    // Le commissioni sono un IMPORTO: intere, in minor units.
    const [whole, frac = ""] = feeDecimal.split(".");
    const feesMinor = BigInt(whole + (frac + "0".repeat(units)).slice(0, units));

    setBusy(true);
    const res = await onSave({
      side,
      trade_date: tradeDate,
      // Quantita' e prezzo restano stringhe: Postgres li converte in NUMERIC
      // senza perdere una cifra, mentre un Number a 18 decimali la perderebbe.
      quantity: parseDecimal(quantity),
      unit_price: parseDecimal(unitPrice),
      fees_minor: feesMinor.toString(),
    });
    setBusy(false);
    if (!res?.ok) setError(res?.error ?? t("common.errorGeneric"));
  };

  return (
    <Sheet
      variant="dialog"
      title={t("investments.addLot")}
      onClose={onClose}
      footer={<>
        <Button variant="quiet" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </>}
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label={t("investments.side")} htmlFor="l-side">
          <Select id="l-side" value={side} onChange={e => setSide(e.target.value)}>
            <option value="buy">{t("lotSide.buy")}</option>
            <option value="sell">{t("lotSide.sell")}</option>
          </Select>
        </Field>
        <Field label={t("investments.tradeDate")} htmlFor="l-date">
          <Input id="l-date" type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)} />
        </Field>
        <Field label={t("investments.quantity")} htmlFor="l-qty">
          <Input id="l-qty" value={quantity} onChange={e => setQuantity(e.target.value)} inputMode="decimal" autoFocus />
        </Field>
        <Field label={`${t("investments.unitPrice")} (${currency})`} htmlFor="l-price">
          <Input id="l-price" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label={`${t("investments.fees")} (${currency})`} htmlFor="l-fees" hint={t("investments.hintFees")}>
          <Input id="l-fees" value={fees} onChange={e => setFees(e.target.value)} inputMode="decimal" placeholder="0" />
        </Field>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  );
}

function PriceForm({ currency, onClose, onSave }) {
  const { t } = useI18n();
  const [priceDate, setPriceDate] = useState(new Date().toISOString().slice(0, 10));
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = parseDecimal(price);
    if (value === null || !/[1-9]/.test(value)) { setError(t("investments.errPrice")); return; }
    setBusy(true);
    const res = await onSave({ priceDate, price: value });
    setBusy(false);
    if (!res?.ok) setError(res?.error ?? t("common.errorGeneric"));
  };

  return (
    <Sheet
      variant="dialog"
      title={t("investments.addPrice")}
      onClose={onClose}
      footer={<>
        <Button variant="quiet" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </>}
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label={t("investments.priceDate")} htmlFor="p-date">
          <Input id="p-date" type="date" value={priceDate} onChange={e => setPriceDate(e.target.value)} />
        </Field>
        <Field label={`${t("investments.price")} (${currency})`} htmlFor="p-value" hint={t("investments.hintManualPrice")}>
          <Input id="p-value" value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" autoFocus />
        </Field>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  );
}
