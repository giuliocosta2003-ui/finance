// src/components/TaxItemForm.jsx
// Creazione e modifica di una voce d'imposta, con anteprima in tempo reale:
// "con i dati di quest'anno pagheresti X". E' il modo migliore per accorgersi
// di un'impostazione sbagliata prima di salvarla.
//
// Nessuna regola fiscale e' suggerita: aliquota, coefficiente, cadenza e
// scadenza partono vuoti o neutri e li decide l'utente.
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { useAccounts } from "../hooks/useAccounts";
import { useCategories, categoryLabel } from "../hooks/useCategories";
import { useTaxItems, useTaxPreview } from "../hooks/useTaxes";
import { Button, Checkbox, Field, InlineAlert, Input, Select, Sheet, Textarea } from "../ui";
import AmountInput from "./AmountInput";
import Amount from "../ui/Amount.jsx";
import { parseAmount } from "../lib/money";
import { currencyName } from "../lib/format";

const iso = (d) => d.toISOString().slice(0, 10);

/** L'anno fiscale che contiene oggi, dato il mese d'inizio. */
function fiscalYearWindow(fysm) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const startYear = m < fysm ? y - 1 : y;
  const start = new Date(Date.UTC(startYear, fysm - 1, 1));
  const end = new Date(Date.UTC(startYear + 1, fysm - 1, 1));
  end.setUTCDate(end.getUTCDate() - 1);
  return { from: iso(start), to: iso(end) };
}

/** "15" / "15,5" -> 15.5 ; vuoto -> null. */
function parsePct(text) {
  const s = String(text ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const BASE_TYPES = ["gross_income", "net_profit", "vat_balance", "fixed"];
const FREQUENCIES = ["monthly", "quarterly", "yearly", "one_off"];

export default function TaxItemForm({ item = null, onClose, onSaved }) {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const base = profile?.base_currency ?? "EUR";
  const { codes } = useCurrencies();
  const { accounts } = useAccounts({ includeArchived: false });
  const { categories } = useCategories();
  const { create, update } = useTaxItems();
  const { preview } = useTaxPreview();

  const [name, setName] = useState(item?.name ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const [baseType, setBaseType] = useState(item?.base_type ?? "gross_income");
  const [rate, setRate] = useState(item?.rate_pct != null ? String(item.rate_pct) : "");
  const [coefficient, setCoefficient] = useState(item?.coefficient_pct != null ? String(item.coefficient_pct) : "");
  const [fixed, setFixed] = useState("");
  const [currency, setCurrency] = useState(item?.currency?.trim() || base);
  const [frequency, setFrequency] = useState(item?.frequency ?? "yearly");
  const [basis, setBasis] = useState(item?.basis ?? "cash");
  const [businessOnly, setBusinessOnly] = useState(item?.business_only ?? true);
  const [accountIds, setAccountIds] = useState(item?.account_ids ?? []);
  const [categoryIds, setCategoryIds] = useState(item?.category_ids ?? []);
  const [monthOffset, setMonthOffset] = useState(String(item?.due_rule?.month_offset ?? 1));
  const [dueDay, setDueDay] = useState(String(item?.due_rule?.day ?? 16));
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [est, setEst] = useState(null); // {base_minor, amount_due_minor}

  const isFixed = baseType === "fixed";
  const isVat = baseType === "vat_balance";
  const needsRate = !isFixed && !isVat;

  const window = useMemo(() => fiscalYearWindow(profile?.fiscal_year_start_month ?? 1), [profile]);

  // Anteprima: si ricalcola quando cambia qualcosa che entra nel conto. Un
  // piccolo ritardo evita una chiamata a ogni tasto premuto.
  useEffect(() => {
    const units = 2;
    const fixedMinor = isFixed ? parseAmount(fixed, units, lang) : null;
    const params = {
      baseType,
      ratePct: parsePct(rate),
      coefficientPct: parsePct(coefficient),
      fixedAmountMinor: fixedMinor != null ? fixedMinor.toString() : null,
      currency: isFixed ? currency : null,
      businessOnly,
      categoryIds: categoryIds.length ? categoryIds : null,
      accountIds: accountIds.length ? accountIds : null,
      basis,
      from: window.from,
      to: window.to,
    };
    let alive = true;
    const id = setTimeout(async () => {
      const res = await preview(params);
      if (alive && res.ok) setEst({ base_minor: Number(res.base_minor), amount_due_minor: Number(res.amount_due_minor) });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseType, rate, coefficient, fixed, currency, businessOnly, categoryIds, accountIds, basis, window]);

  const toggle = (list, setList, id) =>
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  const submit = async () => {
    if (!name.trim()) { setError(t("taxes.form.errName")); return; }
    const day = Number(dueDay);
    if (!(day >= 1 && day <= 31)) { setError(t("taxes.form.errDueDay")); return; }

    const units = 2;
    const fixedMinor = isFixed ? parseAmount(fixed, units, lang) : null;
    if (isFixed && (fixedMinor == null || !currency)) { setError(t("taxes.form.errFixed")); return; }
    if (needsRate && parsePct(rate) == null) { setError(t("taxes.form.errRate")); return; }

    const values = {
      name: name.trim(),
      active,
      notes: notes.trim() || null,
      base_type: baseType,
      rate_pct: needsRate ? parsePct(rate) : null,
      coefficient_pct: needsRate ? parsePct(coefficient) : null,
      fixed_amount_minor: isFixed ? fixedMinor.toString() : null,
      currency: isFixed ? currency : null,
      frequency,
      basis,
      business_only: businessOnly,
      account_ids: accountIds.length ? accountIds : null,
      category_ids: categoryIds.length ? categoryIds : null,
      due_rule: { month_offset: Number(monthOffset) || 0, day },
    };

    setBusy(true);
    const res = item ? await update(item.id, values) : await create(values);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onSaved?.();
  };

  return (
    <Sheet
      variant="dialog"
      title={item ? t("taxes.items.edit") : t("taxes.items.new")}
      onClose={onClose}
      footer={<>
        <Button variant="quiet" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </>}
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label={t("taxes.form.name")} htmlFor="ti-name">
          <Input id="ti-name" value={name} onChange={e => setName(e.target.value)}
            placeholder={t("taxes.form.namePlaceholder")} autoFocus />
        </Field>

        <Field label={t("taxes.form.baseType")} htmlFor="ti-base" hint={t("taxes.form.baseHint")}>
          <Select id="ti-base" value={baseType} onChange={e => setBaseType(e.target.value)}>
            {BASE_TYPES.map(b => <option key={b} value={b}>{t(`taxes.form.base${b === "gross_income" ? "Gross" : b === "net_profit" ? "Net" : b === "vat_balance" ? "Vat" : "Fixed"}`)}</option>)}
          </Select>
        </Field>

        {isFixed ? (
          <div className="fin-pair">
            <Field label={t("taxes.form.fixedAmount")} htmlFor="ti-fixed">
              <AmountInput id="ti-fixed" value={fixed} onChange={setFixed} currency={currency} />
            </Field>
            <Field label={t("taxes.form.currency")} htmlFor="ti-cur">
              <Select id="ti-cur" value={currency} onChange={e => setCurrency(e.target.value)}>
                {codes.map(c => <option key={c} value={c}>{c} — {currencyName(c, lang)}</option>)}
              </Select>
            </Field>
          </div>
        ) : isVat ? null : (
          <div className="fin-pair">
            <Field label={t("taxes.form.rate")} htmlFor="ti-rate">
              <Input id="ti-rate" inputMode="decimal" value={rate}
                onChange={e => setRate(e.target.value)} placeholder="0" />
            </Field>
            <Field label={t("taxes.form.coefficient")} htmlFor="ti-coef" hint={t("taxes.form.coefficientHint")}>
              <Input id="ti-coef" inputMode="decimal" value={coefficient}
                onChange={e => setCoefficient(e.target.value)} placeholder="100" />
            </Field>
          </div>
        )}

        <div className="fin-pair">
          <Field label={t("taxes.form.frequency")} htmlFor="ti-freq">
            <Select id="ti-freq" value={frequency} onChange={e => setFrequency(e.target.value)}>
              {FREQUENCIES.map(f => <option key={f} value={f}>{t(`taxes.form.freq${f === "monthly" ? "Monthly" : f === "quarterly" ? "Quarterly" : f === "yearly" ? "Yearly" : "OneOff"}`)}</option>)}
            </Select>
          </Field>
          {!isFixed && (
            <Field label={t("taxes.form.basis")} htmlFor="ti-basis">
              <Select id="ti-basis" value={basis} onChange={e => setBasis(e.target.value)}>
                <option value="cash">{t("taxes.form.basisCash")}</option>
                <option value="accrual">{t("taxes.form.basisAccrual")}</option>
              </Select>
            </Field>
          )}
        </div>

        {/* Scadenza: struttura, non una data precompilata. */}
        <Field label={t("taxes.form.dueRule")} hint={t("taxes.form.dueRuleHint")}>
          <div className="fin-pair">
            <Input aria-label={t("taxes.form.dueMonthOffset")} inputMode="numeric" value={monthOffset}
              onChange={e => setMonthOffset(e.target.value.replace(/\D/g, ""))}
              placeholder={t("taxes.form.dueMonthOffset")} />
            <Input aria-label={t("taxes.form.dueDay")} inputMode="numeric" value={dueDay}
              onChange={e => setDueDay(e.target.value.replace(/\D/g, ""))}
              placeholder={t("taxes.form.dueDay")} />
          </div>
        </Field>

        {(baseType === "gross_income" || baseType === "net_profit") && (
          <Field label={t("taxes.form.businessOnly")} hint={t("taxes.form.businessOnlyHint")}>
            <Checkbox checked={businessOnly} onChange={setBusinessOnly}
              label={t("taxes.form.businessOnly")} />
          </Field>
        )}

        {/* Filtri: nessuna selezione = tutto. */}
        {!isFixed && (
          <Field label={t("taxes.form.filters")}>
            <details className="fin-details">
              <summary className="fin-caption">{t("taxes.form.accounts")} · {t("taxes.form.categories")}</summary>
              <div style={{ marginTop: "var(--space-2)", display: "grid", gap: "var(--space-2)" }}>
                <p className="fin-caption">{accountIds.length ? t("taxes.form.accounts") : t("taxes.form.allAccounts")}</p>
                <div style={{ display: "grid", gap: "var(--space-1)" }}>
                  {(accounts ?? []).map(a => (
                    <Checkbox key={a.account_id ?? a.id} checked={accountIds.includes(a.account_id ?? a.id)}
                      onChange={() => toggle(accountIds, setAccountIds, a.account_id ?? a.id)} label={a.name} />
                  ))}
                </div>
                <p className="fin-caption">{categoryIds.length ? t("taxes.form.categories") : t("taxes.form.allCategories")}</p>
                <div style={{ display: "grid", gap: "var(--space-1)" }}>
                  {(categories ?? []).map(c => (
                    <Checkbox key={c.id} checked={categoryIds.includes(c.id)}
                      onChange={() => toggle(categoryIds, setCategoryIds, c.id)} label={categoryLabel(c, t)} />
                  ))}
                </div>
              </div>
            </details>
          </Field>
        )}

        <Field label={t("common.notes")} htmlFor="ti-notes">
          <Textarea id="ti-notes" value={notes} onChange={e => setNotes(e.target.value)} style={{ minHeight: 60 }} />
        </Field>

        <Checkbox checked={active} onChange={setActive} label={t("taxes.form.active")} />

        {/* Anteprima */}
        <div className="fin-card" style={{ padding: "var(--space-3)", background: "var(--surface-2)" }}>
          {est && (est.amount_due_minor > 0 || est.base_minor !== 0) ? (
            <div style={{ display: "grid", gap: "var(--space-1)" }}>
              <span className="fin-caption">{t("taxes.form.preview")}</span>
              <Amount minor={est.amount_due_minor} currency={base} variant="lg" tone="neutral" />
              {!isFixed && (
                <span className="fin-caption">
                  {t("taxes.form.previewBase")} <Amount minor={est.base_minor} currency={base} variant="sm" tone="neutral" />
                </span>
              )}
            </div>
          ) : (
            <span className="fin-caption">{t("taxes.form.previewNone")}</span>
          )}
        </div>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  );
}
