// src/components/TaxPaymentForm.jsx
// Registra un pagamento (anche parziale) di un periodo d'imposta. L'importo e'
// in valuta base, come tutto ciò che riguarda le tasse. Il collegamento a un
// movimento gia' registrato e' facoltativo: serve a ritrovare la spesa, non a
// spostare soldi (quello e' gia' avvenuto sul conto).
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { Button, Field, InlineAlert, Input, Select, Sheet } from "../ui";
import AmountInput from "./AmountInput";
import { parseAmount, toMajorString } from "../lib/money";
import { formatDate } from "../lib/format";

export default function TaxPaymentForm({ remainingMinor, onClose, onSaved, addPayment }) {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const { minorUnits } = useCurrencies();
  const base = profile?.base_currency ?? "EUR";
  const units = minorUnits(base);

  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [txId, setTxId] = useState("");
  const [txs, setTxs] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Movimenti recenti da poter collegare: spese ed entrate degli ultimi mesi.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, booked_on, description, amount_minor, currency")
        .order("booked_on", { ascending: false })
        .limit(50);
      if (alive) setTxs(data ?? []);
    })();
    return () => { alive = false; };
  }, []);

  const fillRemaining = () => {
    if (remainingMinor != null && remainingMinor > 0) setAmount(toMajorString(remainingMinor, units));
  };

  const submit = async () => {
    const minor = parseAmount(amount, units, lang);
    if (minor == null || minor <= 0n) { setError(t("taxes.form.errFixed")); return; }
    if (!paidOn) { setError(t("taxes.form.errDueDay")); return; }
    setBusy(true);
    const res = await addPayment({ amountMinor: minor, paidOn, transactionId: txId || null });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onSaved?.();
  };

  return (
    <Sheet
      variant="dialog"
      title={t("taxes.payment.title")}
      onClose={onClose}
      footer={<>
        <Button variant="quiet" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </>}
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field
          label={t("taxes.payment.amount")}
          htmlFor="tp-amount"
          hint={remainingMinor != null && remainingMinor > 0
            ? <Button variant="quiet" size="sm" onClick={fillRemaining}>{t("taxes.payment.remainingFill")}</Button>
            : undefined}
        >
          <AmountInput id="tp-amount" value={amount} onChange={setAmount} currency={base} autoFocus />
        </Field>

        <Field label={t("taxes.payment.date")} htmlFor="tp-date">
          <Input id="tp-date" type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} />
        </Field>

        <Field label={t("taxes.payment.link")} htmlFor="tp-tx" hint={t("taxes.payment.linkHint")}>
          <Select id="tp-tx" value={txId} onChange={e => setTxId(e.target.value)}>
            <option value="">{t("taxes.payment.linkNone")}</option>
            {txs.map(x => (
              <option key={x.id} value={x.id}>
                {formatDate(x.booked_on, lang)} · {(x.description ?? "").slice(0, 40)}
              </option>
            ))}
          </Select>
        </Field>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  );
}
