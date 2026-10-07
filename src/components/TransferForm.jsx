// src/components/TransferForm.jsx
// Spostare soldi fra due conti propri. Non e' ne' un'entrata ne' un'uscita:
// il patrimonio non cambia, cambia solo dove sta. Per questo il trasferimento
// non ha categoria e resta fuori dai totali di entrate e uscite.
//
// Fra conti in valute diverse gli importi sono due: quello che esce e quello
// che arriva. Non si calcola il secondo dal primo con un tasso teorico, perche'
// quello che conta e' quanto e' davvero arrivato.
import { useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { parseAmount } from "../lib/money";
import { Button, Field, InlineAlert, Input, Select, Sheet } from "../ui";
import AmountInput from "./AmountInput";

const today = () => new Date().toISOString().slice(0, 10);

export default function TransferForm({ accounts, onClose, onSave }) {
  const { t, lang } = useI18n();
  const { minorUnits } = useCurrencies();

  const usable = accounts.filter(a => !a.archived_at);
  const [fromId, setFromId] = useState(usable[0]?.account_id ?? "");
  const [toId, setToId] = useState(usable[1]?.account_id ?? "");
  const [bookedOn, setBookedOn] = useState(today());
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const from = usable.find(a => a.account_id === fromId);
  const to = usable.find(a => a.account_id === toId);
  const fromCur = from?.currency?.trim();
  const toCur = to?.currency?.trim();
  const sameCurrency = fromCur && toCur && fromCur === toCur;

  const submit = async () => {
    if (!fromId || !toId) { setError(t("transfer.errAccounts")); return; }
    if (fromId === toId) { setError(t("transfer.errSameAccount")); return; }
    const out = parseAmount(fromAmount, minorUnits(fromCur), lang);
    if (out === null || out <= 0n) { setError(t("transfer.errAmount")); return; }
    const inAmount = sameCurrency ? out : parseAmount(toAmount, minorUnits(toCur), lang);
    if (inAmount === null || inAmount <= 0n) { setError(t("transfer.errAmountIn")); return; }

    setBusy(true);
    const ok = await onSave({
      p_from_account: fromId,
      p_to_account: toId,
      p_booked_on: bookedOn,
      p_from_amount_minor: out.toString(),
      p_to_amount_minor: inAmount.toString(),
      p_description: description.trim() || null,
      p_notes: null,
    });
    if (!ok) setBusy(false);
  };

  return (
    <Sheet
      variant="dialog"
      title={t("transfer.title")}
      onClose={onClose}
      footer={<>
        <Button variant="quiet" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </>}
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label={t("transfer.from")} htmlFor="tr-from">
          <Select id="tr-from" value={fromId} onChange={e => setFromId(e.target.value)}>
            {usable.map(a => <option key={a.account_id} value={a.account_id}>{a.name} ({a.currency?.trim()})</option>)}
          </Select>
        </Field>

        <Field label={t("transfer.to")} htmlFor="tr-to">
          <Select id="tr-to" value={toId} onChange={e => setToId(e.target.value)}>
            {usable.map(a => <option key={a.account_id} value={a.account_id}>{a.name} ({a.currency?.trim()})</option>)}
          </Select>
        </Field>

        <Field label={t("tx.date")} htmlFor="tr-date">
          <Input id="tr-date" type="date" value={bookedOn} onChange={e => setBookedOn(e.target.value)} />
        </Field>

        <Field
          label={`${sameCurrency ? t("transfer.amount") : t("transfer.amountOut")}${fromCur ? ` (${fromCur})` : ""}`}
          htmlFor="tr-out"
        >
          <AmountInput id="tr-out" value={fromAmount} onChange={setFromAmount} currency={fromCur} autoFocus />
        </Field>

        {!sameCurrency && (
          <Field
            label={`${t("transfer.amountIn")}${toCur ? ` (${toCur})` : ""}`}
            htmlFor="tr-in"
            hint={t("transfer.differentCurrencyHint")}
          >
            <AmountInput id="tr-in" value={toAmount} onChange={setToAmount} currency={toCur} />
          </Field>
        )}

        <Field label={t("tx.description")} htmlFor="tr-desc">
          <Input id="tr-desc" value={description} onChange={e => setDescription(e.target.value)} />
        </Field>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  );
}
