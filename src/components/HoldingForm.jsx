// src/components/HoldingForm.jsx
// Creazione e modifica di un investimento.
//
// La valuta e' quella in cui lo strumento e' QUOTATO, non quella del conto con
// cui l'hai comprato: un ETF comprato in euro puo' essere quotato in dollari,
// e confondere le due cose sballa ogni conversione.
import { useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { useAccounts } from "../hooks/useAccounts";
import { useHoldings } from "../hooks/useInvestments";
import { Button, Field, InlineAlert, Input, Select, Sheet, Textarea } from "../ui";
import { currencyName } from "../lib/format";

const CLASSES = ["etf", "stock", "bond", "crypto", "real_estate", "cash", "other"];

export default function HoldingForm({ holding = null, onClose, onSaved }) {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const { codes } = useCurrencies();
  const { accounts } = useAccounts({ includeArchived: false });
  const { create, update } = useHoldings();

  const [name, setName] = useState(holding?.name ?? "");
  const [assetClass, setAssetClass] = useState(holding?.asset_class ?? "etf");
  const [currency, setCurrency] = useState(holding?.currency?.trim() ?? profile?.base_currency ?? "EUR");
  const [symbol, setSymbol] = useState(holding?.symbol ?? "");
  const [isin, setIsin] = useState(holding?.isin?.trim() ?? "");
  const [provider, setProvider] = useState(holding?.price_provider ?? "manual");
  const [providerRef, setProviderRef] = useState(holding?.provider_ref ?? "");
  const [accountId, setAccountId] = useState(holding?.account_id ?? "");
  const [notes, setNotes] = useState(holding?.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) { setError(t("investments.errName")); return; }
    if (isin.trim() && !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin.trim().toUpperCase())) {
      setError(t("investments.errIsin")); return;
    }
    if (provider !== "manual" && !providerRef.trim()) { setError(t("investments.errProviderRef")); return; }

    const values = {
      name: name.trim(),
      asset_class: assetClass,
      currency,
      symbol: symbol.trim() || null,
      isin: isin.trim() ? isin.trim().toUpperCase() : null,
      price_provider: provider,
      provider_ref: provider === "manual" ? null : providerRef.trim(),
      account_id: accountId || null,
      notes: notes.trim() || null,
    };

    setBusy(true);
    const res = holding ? await update(holding.id, values) : await create(values);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onSaved?.(res.holding ?? holding);
  };

  return (
    <Sheet
      variant="dialog"
      title={holding ? t("investments.edit") : t("investments.new")}
      onClose={onClose}
      footer={<>
        <Button variant="quiet" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </>}
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label={t("investments.name")} htmlFor="h-name">
          <Input
            id="h-name" value={name} onChange={e => setName(e.target.value)}
            placeholder={t("investments.namePlaceholder")} autoFocus
          />
        </Field>

        <Field
          label={t("investments.assetClass")}
          htmlFor="h-class"
          hint={assetClass === "real_estate" ? t("investments.hintRealEstate")
            : assetClass === "cash" ? t("investments.hintCash")
            : undefined}
        >
          <Select id="h-class" value={assetClass} onChange={e => setAssetClass(e.target.value)}>
            {CLASSES.map(c => <option key={c} value={c}>{t(`assetClass.${c}`)}</option>)}
          </Select>
        </Field>

        <Field label={t("investments.currency")} htmlFor="h-currency" hint={t("investments.hintCurrency")}>
          <Select id="h-currency" value={currency} onChange={e => setCurrency(e.target.value)}>
            {codes.map(c => <option key={c} value={c}>{c} — {currencyName(c, lang)}</option>)}
          </Select>
        </Field>

        <div className="fin-pair">
          <Field label={t("investments.symbol")} htmlFor="h-symbol">
            <Input id="h-symbol" value={symbol} onChange={e => setSymbol(e.target.value)} />
          </Field>
          <Field label={t("investments.isin")} htmlFor="h-isin">
            <Input
              id="h-isin" value={isin} maxLength={12}
              onChange={e => setIsin(e.target.value.toUpperCase())}
            />
          </Field>
        </div>

        <Field
          label={t("investments.priceProvider")}
          htmlFor="h-provider"
          hint={provider === "coingecko" ? t("investments.hintCoingecko") : undefined}
        >
          <Select id="h-provider" value={provider} onChange={e => setProvider(e.target.value)}>
            <option value="manual">{t("priceProvider.manual")}</option>
            <option value="coingecko">{t("priceProvider.coingecko")}</option>
          </Select>
          {provider === "coingecko" && (
            <Input
              value={providerRef}
              onChange={e => setProviderRef(e.target.value.trim().toLowerCase())}
              placeholder={t("investments.providerRefPlaceholder")}
              aria-label={t("investments.providerRef")}
              style={{ marginTop: "var(--space-2)" }}
            />
          )}
        </Field>

        <Field label={t("investments.account")} htmlFor="h-account">
          <Select id="h-account" value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">{t("investments.noAccount")}</option>
            {(accounts ?? []).map(a => (
              <option key={a.account_id ?? a.id} value={a.account_id ?? a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>

        <Field label={t("common.notes")} htmlFor="h-notes">
          <Textarea id="h-notes" value={notes} onChange={e => setNotes(e.target.value)} style={{ minHeight: 72 }} />
        </Field>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  );
}
