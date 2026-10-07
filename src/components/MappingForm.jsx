// src/components/MappingForm.jsx
// Mappatura delle colonne di una banca. Compare solo la prima volta per quel
// tracciato: una volta confermata si salva in parser_profiles e agli import
// successivi la schermata non si vede piu'.
//
// Il modulo arriva gia' compilato dall'euristica locale (e, se serve e c'e' il
// consenso, dalla proposta di Claude): all'utente resta da controllare, non da
// compilare.
import { useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { Button, Field, InlineAlert, Input, Select } from "../ui";

export default function MappingForm({ proposal, onConfirm }) {
  const { t } = useI18n();
  const headers = proposal?.headers ?? [];
  const sample = proposal?.sample ?? [];

  const [mapping, setMapping] = useState(() => ({ ...proposal }));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (patch) => setMapping(m => ({ ...m, ...patch }));

  const columnSelect = (id, value, onChange, { allowNone = true } = {}) => (
    <Select id={id} value={value ?? ""} onChange={e => onChange(e.target.value || null)}>
      {allowNone && <option value="">—</option>}
      {headers.map(h => <option key={h} value={h}>{h}</option>)}
    </Select>
  );

  const submit = async () => {
    if (!mapping.dateColumn) { setError(t("imports.mappingErrDate")); return; }
    const hasAmount = mapping.amountMode === "debit_credit"
      ? (mapping.debitColumn || mapping.creditColumn)
      : mapping.amountColumn;
    if (!hasAmount) { setError(t("imports.mappingErrAmount")); return; }
    setBusy(true);
    const { headers: _h, sample: _s, ...clean } = mapping;
    await onConfirm(clean, name.trim() || null);
  };

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <p className="fin-muted">{t("imports.mappingIntro")}</p>

      {/* Anteprima delle prime righe, per controllare a occhio. Usa la tabella
          del design system: prima aveva `th` e `td` propri, e accanto alla
          tabella della revisione le due non si somigliavano. */}
      {sample.length > 0 && (
        <div className="fin-table-wrap" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-card)" }}>
          <table className="fin-table">
            <thead>
              <tr>{headers.map(h => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {sample.slice(0, 3).map((row, i) => (
                <tr key={i}>{headers.map(h => (
                  <td key={h} style={{ whiteSpace: "nowrap", color: "var(--text-secondary)" }}>
                    {String(row[h] ?? "")}
                  </td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Field label={t("imports.colDate")} htmlFor="map-date">
        {columnSelect("map-date", mapping.dateColumn, v => set({ dateColumn: v }), { allowNone: false })}
      </Field>

      <Field label={t("imports.dateFormat")} htmlFor="map-format">
        <Select
          id="map-format" value={mapping.dateFormat ?? "DMY"}
          onChange={e => set({ dateFormat: e.target.value, dateAmbiguous: false })}
        >
          <option value="DMY">{t("imports.dmy")}</option>
          <option value="MDY">{t("imports.mdy")}</option>
          <option value="ISO">{t("imports.iso")}</option>
        </Select>
        {mapping.dateAmbiguous && (
          <div style={{ marginTop: "var(--space-2)" }}>
            <InlineAlert tone="warning">{t("imports.dateAmbiguous")}</InlineAlert>
          </div>
        )}
      </Field>

      <Field label={t("imports.amountMode")} htmlFor="map-mode">
        <Select
          id="map-mode" value={mapping.amountMode ?? "single"}
          onChange={e => set({ amountMode: e.target.value })}
        >
          <option value="single">{t("imports.amountSingle")}</option>
          <option value="debit_credit">{t("imports.amountDebitCredit")}</option>
        </Select>
      </Field>

      {mapping.amountMode === "debit_credit" ? (
        <div className="fin-pair">
          <Field label={t("imports.colDebit")} htmlFor="map-debit">
            {columnSelect("map-debit", mapping.debitColumn, v => set({ debitColumn: v }))}
          </Field>
          <Field label={t("imports.colCredit")} htmlFor="map-credit">
            {columnSelect("map-credit", mapping.creditColumn, v => set({ creditColumn: v }))}
          </Field>
        </div>
      ) : (
        <Field label={t("imports.colAmount")} htmlFor="map-amount">
          {columnSelect("map-amount", mapping.amountColumn, v => set({ amountColumn: v }), { allowNone: false })}
        </Field>
      )}

      <Field label={t("imports.colDescription")} htmlFor="map-desc">
        {columnSelect("map-desc", mapping.descriptionColumns?.[0],
          v => set({ descriptionColumns: v ? [v] : [] }))}
      </Field>

      <Field label={t("imports.colBalance")} htmlFor="map-balance" hint={t("imports.balanceHint")}>
        {columnSelect("map-balance", mapping.balanceColumn, v => set({ balanceColumn: v }))}
      </Field>

      <Field label={t("imports.decimalSeparator")} htmlFor="map-sep">
        <Select
          id="map-sep" value={mapping.decimalSeparator ?? ","}
          onChange={e => set({ decimalSeparator: e.target.value })}
        >
          <option value=",">{t("imports.comma")}</option>
          <option value=".">{t("imports.dot")}</option>
        </Select>
      </Field>

      <Field label={t("imports.profileName")} htmlFor="map-name" hint={t("imports.profileHint")}>
        <Input
          id="map-name" value={name} onChange={e => setName(e.target.value)}
          placeholder={t("imports.profileNamePlaceholder")}
        />
      </Field>

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      <Button variant="primary" block onClick={submit} disabled={busy}>
        {busy ? t("common.loading") : t("imports.mappingConfirm")}
      </Button>
    </div>
  );
}
