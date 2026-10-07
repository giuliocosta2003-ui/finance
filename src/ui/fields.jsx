// src/ui/fields.jsx
// I due campi composti che ricorrono in piu' schermate: l'intervallo di date e
// la scelta della valuta.
import { useI18n } from "../i18n/I18nContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { currencyName } from "../lib/format";
import { Chip, Field, Input, Select } from "./primitives";

const iso = (d) => d.toISOString().slice(0, 10);
const shift = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return iso(d);
};
const startOfMonth = () => {
  const d = new Date();
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
};
const startOfYear = () => {
  const d = new Date();
  return iso(new Date(Date.UTC(d.getUTCFullYear(), 0, 1)));
};

/**
 * Intervallo di date con scorciatoie.
 *
 * Le scorciatoie vengono prima dei due campi perche' nove volte su dieci si
 * vuole "questo mese" o "ultimi 30 giorni", e digitare due date per ottenerlo
 * e' lavoro inutile.
 */
export function DateRangePicker({ from, to, onChange, idPrefix = "range" }) {
  const { t } = useI18n();

  const presets = [
    { key: "month", from: startOfMonth(), to: "" },
    { key: "d30", from: shift(30), to: "" },
    { key: "d90", from: shift(90), to: "" },
    { key: "year", from: startOfYear(), to: "" },
    { key: "all", from: "", to: "" },
  ];

  const active = presets.find(p => p.from === (from ?? "") && p.to === (to ?? ""));

  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {presets.map(p => (
          <Chip
            key={p.key}
            on={active?.key === p.key}
            onClick={() => onChange({ from: p.from, to: p.to })}
          >
            {t(`ui.range.${p.key}`)}
          </Chip>
        ))}
      </div>

      <div style={{ display: "grid", gap: "var(--space-3)", gridTemplateColumns: "1fr 1fr" }}>
        <Field label={t("ui.from")} htmlFor={`${idPrefix}-from`}>
          <Input
            id={`${idPrefix}-from`}
            type="date"
            value={from ?? ""}
            max={to || undefined}
            onChange={e => onChange({ from: e.target.value, to })}
          />
        </Field>
        <Field label={t("ui.to")} htmlFor={`${idPrefix}-to`}>
          <Input
            id={`${idPrefix}-to`}
            type="date"
            value={to ?? ""}
            min={from || undefined}
            onChange={e => onChange({ from, to: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

/**
 * Scelta della valuta. Le piu' usate in cima, tutte le altre sotto: 155 voci
 * in ordine alfabetico sono una lista, non una scelta.
 */
export function CurrencySelector({ value, onChange, id, suggested = [], includeEmpty = false, ...rest }) {
  const { t, lang } = useI18n();
  const { codes } = useCurrencies();

  const top = suggested.filter(c => codes.includes(c));
  const others = codes.filter(c => !top.includes(c));

  return (
    <Select id={id} value={value ?? ""} onChange={e => onChange(e.target.value)} {...rest}>
      {includeEmpty && <option value="">—</option>}
      {top.length > 0 && (
        <optgroup label={t("onboarding.currencySuggested")}>
          {top.map(c => <option key={c} value={c}>{c} — {currencyName(c, lang)}</option>)}
        </optgroup>
      )}
      <optgroup label={t("onboarding.currencyAll")}>
        {others.map(c => <option key={c} value={c}>{c} — {currencyName(c, lang)}</option>)}
      </optgroup>
    </Select>
  );
}
