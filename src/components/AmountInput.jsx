// src/components/AmountInput.jsx
// Campo importo. L'utente scrive come gli viene (1.234,56 o 1234.56), sotto
// compare come e' stato capito: cosi' un malinteso sul separatore si vede
// prima di salvare, non dopo.
//
// La riga sotto ha un'altezza fissa anche quando e' vuota: se comparisse solo
// a campo pieno, il modulo si allungherebbe di 18 px alla prima cifra digitata
// e tutti i campi sotto salterebbero.
import { useI18n } from "../i18n/I18nContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { parseAmount, formatMoney } from "../lib/money";
import { Input } from "../ui";

export default function AmountInput({
  value,            // testo grezzo
  onChange,
  currency,
  id,
  placeholder,
  autoFocus,
  style,
}) {
  const { lang, t } = useI18n();
  const { minorUnits } = useCurrencies();
  const units = minorUnits(currency);
  const parsed = parseAmount(value, units, lang);
  const bad = value.trim() !== "" && parsed === null;

  return (
    <>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        aria-invalid={bad || undefined}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? (units === 0 ? "0" : `0${lang === "it" ? "," : "."}${"0".repeat(units)}`)}
        style={style}
      />
      <p
        className={bad ? "fin-error" : "fin-hint"}
        style={{ marginTop: "var(--space-1)", minHeight: 18 }}
      >
        {value.trim()
          ? (bad ? t("tx.amountNotUnderstood") : formatMoney(parsed, currency, lang, units))
          : ""}
      </p>
    </>
  );
}
