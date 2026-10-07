// src/components/TransactionForm.jsx
// Entrata o uscita. L'importo si scrive sempre positivo: il segno lo mette il
// tipo scelto, cosi' non si sbaglia a digitare un meno.
// La valuta e' quella del conto, non si sceglie: e' il conto che si muove.
import { useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { categoryLabel } from "../hooks/useCategories";
import { parseAmount, toMajorString } from "../lib/money";
import { Button, Checkbox, ChoiceRow, Field, InlineAlert, Input, Select, Sheet, Textarea } from "../ui";
import AmountInput from "./AmountInput";

const today = () => new Date().toISOString().slice(0, 10);

export default function TransactionForm({ tx, accounts, categories, onClose, onSave }) {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const { minorUnits, codes } = useCurrencies();

  const usable = accounts.filter(a => !a.archived_at || a.account_id === tx?.account_id);
  const [accountId, setAccountId] = useState(tx?.account_id ?? usable[0]?.account_id ?? "");
  const [kind, setKind] = useState(tx?.kind === "income" ? "income" : "expense");
  const [bookedOn, setBookedOn] = useState(tx?.booked_on ?? today());
  const [categoryId, setCategoryId] = useState(tx?.category_id ?? "");
  const [description, setDescription] = useState(tx?.description ?? "");
  const [merchant, setMerchant] = useState(tx?.merchant ?? "");
  const [notes, setNotes] = useState(tx?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const account = usable.find(a => a.account_id === accountId);
  const currency = account?.currency?.trim();
  const units = minorUnits(currency);

  const [amount, setAmount] = useState(
    tx ? toMajorString(tx.amount_minor < 0 ? -tx.amount_minor : tx.amount_minor, minorUnits(tx.currency?.trim())) : "",
  );

  // Pagamento in valuta estera: quello che c'era scritto sullo scontrino.
  const [showOriginal, setShowOriginal] = useState(!!tx?.original_amount_minor);
  const [originalAmount, setOriginalAmount] = useState(
    tx?.original_amount_minor != null
      ? toMajorString(tx.original_amount_minor, minorUnits(tx.original_currency?.trim()))
      : "",
  );
  const [originalCurrency, setOriginalCurrency] = useState(tx?.original_currency?.trim() ?? "VND");

  // Tasso forzato a mano: serve quando la banca ha applicato un cambio suo.
  const [showOverride, setShowOverride] = useState(!!tx?.fx_override_rate);
  const [overrideRate, setOverrideRate] = useState(tx?.fx_override_rate ?? "");
  const [overrideNote, setOverrideNote] = useState(tx?.fx_override_note ?? "");

  const choices = useMemo(
    () => (categories ?? []).filter(c => c.kind === kind),
    [categories, kind],
  );

  const submit = async () => {
    if (!accountId) { setError(t("tx.errAccount")); return; }
    if (!bookedOn) { setError(t("tx.errDate")); return; }
    const parsed = parseAmount(amount, units, lang);
    if (parsed === null || parsed === 0n) { setError(t("tx.errAmount")); return; }
    const magnitude = parsed < 0n ? -parsed : parsed;

    let origMinor = null;
    if (showOriginal && originalAmount.trim()) {
      const p = parseAmount(originalAmount, minorUnits(originalCurrency), lang);
      if (p === null || p <= 0n) { setError(t("tx.errOriginalAmount")); return; }
      origMinor = p;
    }

    let rate = null;
    if (showOverride && String(overrideRate).trim()) {
      rate = Number(String(overrideRate).replace(",", "."));
      if (!Number.isFinite(rate) || rate <= 0) { setError(t("tx.errRate")); return; }
    }

    setBusy(true);
    const values = {
      account_id: accountId,
      booked_on: bookedOn,
      kind,
      amount_minor: (kind === "expense" ? -magnitude : magnitude).toString(),
      currency,
      category_id: categoryId || null,
      description: description.trim() || null,
      merchant: merchant.trim() || null,
      notes: notes.trim() || null,
      original_amount_minor: origMinor === null ? null : origMinor.toString(),
      original_currency: origMinor === null ? null : originalCurrency,
      fx_override_rate: rate,
      fx_override_note: rate === null ? null : (overrideNote.trim() || null),
    };
    const ok = await onSave(values, tx?.id);
    if (!ok) setBusy(false);
  };

  return (
    <Sheet
      variant="dialog"
      title={tx ? t("tx.edit") : t("tx.new")}
      onClose={onClose}
      footer={<>
        <Button variant="quiet" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </>}
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        {/* entrata / uscita */}
        <div style={{ display: "flex", gap: "var(--space-2)" }} role="radiogroup" aria-label={t("tx.kind")}>
          {["expense", "income"].map(k => (
            <ChoiceRow
              key={k}
              role="radio"
              selected={kind === k}
              onClick={() => { setKind(k); setCategoryId(""); }}
              style={{
                justifyContent: "center",
                flex: 1,
                // Entrata verde, uscita rossa: gli stessi colori degli importi.
                color: kind === k ? (k === "income" ? "var(--positive)" : "var(--negative)") : "var(--text-secondary)",
              }}
            >
              {t(`txKind.${k}`)}
            </ChoiceRow>
          ))}
        </div>

        <Field label={t("tx.account")} htmlFor="tx-account">
          <Select id="tx-account" value={accountId} onChange={e => setAccountId(e.target.value)}>
            {usable.map(a => (
              <option key={a.account_id} value={a.account_id}>{a.name} ({a.currency?.trim()})</option>
            ))}
          </Select>
        </Field>

        <Field label={`${t("tx.amount")}${currency ? ` (${currency})` : ""}`} htmlFor="tx-amount">
          <AmountInput id="tx-amount" value={amount} onChange={setAmount} currency={currency} autoFocus={!tx} />
        </Field>

        <Field label={t("tx.date")} htmlFor="tx-date">
          <Input id="tx-date" type="date" value={bookedOn} onChange={e => setBookedOn(e.target.value)} />
        </Field>

        <Field label={t("tx.category")} htmlFor="tx-cat">
          <Select id="tx-cat" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">{t("tx.noCategory")}</option>
            {choices.map(c => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
          </Select>
        </Field>

        <Field label={t("tx.description")} htmlFor="tx-desc">
          <Input
            id="tx-desc" value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t("tx.descriptionPlaceholder")}
          />
        </Field>

        <Field label={t("tx.merchant")} htmlFor="tx-merchant">
          <Input id="tx-merchant" value={merchant} onChange={e => setMerchant(e.target.value)} />
        </Field>

        {/* Importo originale in valuta estera */}
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <Checkbox checked={showOriginal} onChange={setShowOriginal} label={t("tx.originalToggle")} />
          {showOriginal && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "var(--space-2)" }}>
                <AmountInput value={originalAmount} onChange={setOriginalAmount} currency={originalCurrency} />
                <Select
                  value={originalCurrency}
                  onChange={e => setOriginalCurrency(e.target.value)}
                  aria-label={t("tx.originalToggle")}
                >
                  {codes.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
              <p className="fin-hint">{t("tx.originalHint", { currency: currency ?? "" })}</p>
            </>
          )}
        </div>

        {/* Tasso manuale */}
        {currency && currency !== profile?.base_currency && (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <Checkbox
              checked={showOverride}
              onChange={setShowOverride}
              label={t("tx.overrideToggle", { from: currency, to: profile?.base_currency ?? "" })}
            />
            {showOverride && (
              <>
                <Input
                  value={overrideRate} inputMode="decimal"
                  onChange={e => setOverrideRate(e.target.value)}
                  placeholder="0.000034"
                  aria-label={t("tx.overrideToggle", { from: currency, to: profile?.base_currency ?? "" })}
                />
                <Input
                  value={overrideNote}
                  onChange={e => setOverrideNote(e.target.value)}
                  placeholder={t("tx.overrideNotePlaceholder")}
                />
                <p className="fin-hint">{t("tx.overrideHint", { from: currency, to: profile?.base_currency ?? "" })}</p>
              </>
            )}
          </div>
        )}

        <Field label={t("tx.notes")} htmlFor="tx-notes">
          <Textarea
            id="tx-notes" value={notes}
            onChange={e => setNotes(e.target.value)}
            style={{ minHeight: 72 }}
          />
        </Field>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  );
}
