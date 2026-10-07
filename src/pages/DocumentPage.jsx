// src/pages/DocumentPage.jsx
// Conferma di un documento: i campi estratti, modificabili, con i flag in vista.
//
// Niente si collega da solo. I suggerimenti di collegamento sono suggerimenti:
// un documento agganciato al movimento sbagliato e' peggio di uno non
// agganciato, perche' nessuno va piu' a ricontrollarlo.
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { useDocument, signedUrl } from "../hooks/useDocuments";
import { useToast } from "../components/Toast";
import {
  Amount, Button, Card, CardHeader, CardTitle, ChoiceRow, ErrorState, Field,
  InlineAlert, Input, Page, PageHeader, Select, SkeletonRows,
} from "../ui";
import Loading from "../components/Loading";
import AmountInput from "../components/AmountInput";
import { Icon, ICON } from "../components/icons";
import { formatDate } from "../lib/format";
import { parseAmount, toMajorString } from "../lib/money";

const KINDS = ["invoice_issued", "invoice_received", "receipt", "payslip", "contract", "other"];

export default function DocumentPage() {
  const { documentId } = useParams();
  const { t, lang } = useI18n();
  const { codes, minorUnits } = useCurrencies();
  const toast = useToast();
  const navigate = useNavigate();

  const { doc, loading, error, confirm, extract, suggestions } = useDocument(documentId);

  const [form, setForm] = useState(null);
  const [links, setLinks] = useState([]);
  const [busy, setBusy] = useState(false);

  // I campi si riempiono quando l'estrazione finisce: finche' lo stato e'
  // `extracting` la riga cambia sotto, e sovrascrivere il form a ogni cambio
  // cancellerebbe quello che l'utente sta scrivendo.
  useEffect(() => {
    if (!doc || form || doc.status === "extracting") return;
    const units = minorUnits(doc.currency?.trim() ?? "EUR");
    // eslint-disable-next-line react/set-state-in-effect
    setForm({
      kind: doc.kind ?? "other",
      issuer: doc.issuer ?? "",
      counterparty: doc.counterparty ?? "",
      doc_date: doc.doc_date ?? "",
      due_date: doc.due_date ?? "",
      reference: doc.reference ?? "",
      currency: doc.currency?.trim() ?? "",
      total: doc.total_minor === null ? "" : toMajorString(doc.total_minor, units),
      net: doc.net_minor === null ? "" : toMajorString(doc.net_minor, units),
      tax: doc.tax_minor === null ? "" : toMajorString(doc.tax_minor, units),
      transaction_id: doc.transaction_id ?? null,
      holding_lot_id: doc.holding_lot_id ?? null,
    });
  }, [doc, form, minorUnits]);

  useEffect(() => {
    if (doc?.status === "pending_review") suggestions().then(setLinks);
  }, [doc?.status, suggestions]);

  const openOriginal = async () => {
    const url = await signedUrl(doc.storage_path);
    if (!url) { toast.error(t("documents.errors.cannot_open")); return; }
    // URL firmato, scadenza 60 secondi: non resta valido se finisce in giro.
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (loading) return <Page><Card flush><SkeletonRows rows={5} /></Card></Page>;

  if (error || !doc) {
    return (
      <Page>
        <Card><ErrorState title={error ?? t("documents.notFound")} /></Card>
      </Page>
    );
  }

  const units = minorUnits(form?.currency || "EUR");

  const save = async () => {
    setBusy(true);
    const toMinor = (text) => {
      const v = parseAmount(text, units, lang);
      return v === null ? null : v.toString();
    };
    const res = await confirm({
      kind: form.kind,
      issuer: form.issuer.trim() || null,
      counterparty: form.counterparty.trim() || null,
      doc_date: form.doc_date || null,
      due_date: form.due_date || null,
      reference: form.reference.trim() || null,
      currency: form.currency || null,
      total_minor: toMinor(form.total),
      net_minor: toMinor(form.net),
      tax_minor: toMinor(form.tax),
      transaction_id: form.transaction_id,
      holding_lot_id: form.holding_lot_id,
    });
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(t("documents.confirmed"));
    navigate("/documents");
  };

  return (
    <Page>
      <PageHeader
        backTo="/documents"
        backLabel={t("documents.title")}
        title={doc.file_name}
        actions={<Button onClick={openOriginal}>{t("documents.openOriginal")}</Button>}
      />

      {doc.status === "extracting" && (
        <Card>
          <Loading label={t("documents.extracting")} />
          <p className="fin-hint" style={{ textAlign: "center" }}>{t("documents.extractingHint")}</p>
        </Card>
      )}

      {doc.status === "failed" && (
        <InlineAlert
          tone="error"
          action={
            <Button
              size="sm"
              onClick={async () => {
                const res = await extract();
                if (!res.ok) toast.error(res.error);
              }}
            >{t("common.retry")}</Button>
          }
        >
          {doc.error ?? t("documents.errors.extraction_failed")}
        </InlineAlert>
      )}

      {(doc.flags ?? []).length > 0 && (
        <InlineAlert tone="warning" title={t("documents.checkThese")}>
          <ul style={{ margin: "var(--space-1) 0 0", paddingLeft: "var(--space-4)" }}>
            {doc.flags.map(f => <li key={f}>{t(`documentFlagsLong.${f}`)}</li>)}
          </ul>
        </InlineAlert>
      )}

      {form && (
        <Card flush>
          <CardHeader><CardTitle>{t("documents.fieldsSection")}</CardTitle></CardHeader>
          <div className="fin-card__body" style={{ display: "grid", gap: "var(--space-4)" }}>
            <Field label={t("documents.kind")} htmlFor="d-kind">
              <Select id="d-kind" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map(k => <option key={k} value={k}>{t(`documentKind.${k}`)}</option>)}
              </Select>
            </Field>

            {/* Le coppie di campi stanno affiancate solo dove c'e' spazio: la
                classe fa due colonne sopra i 560 px e una sola sotto. Due
                campi data da 130 px su un telefono non si compilano. */}
            <div className="fin-pair">
              <Field label={t("documents.issuer")} htmlFor="d-issuer">
                <Input id="d-issuer" value={form.issuer} onChange={e => setForm({ ...form, issuer: e.target.value })} />
              </Field>
              <Field label={t("documents.counterparty")} htmlFor="d-counter">
                <Input id="d-counter" value={form.counterparty} onChange={e => setForm({ ...form, counterparty: e.target.value })} />
              </Field>
            </div>

            <div className="fin-pair">
              <Field label={t("documents.docDate")} htmlFor="d-date">
                <Input id="d-date" type="date" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} />
              </Field>
              <Field label={t("documents.dueDate")} htmlFor="d-due">
                <Input id="d-due" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
              </Field>
            </div>

            <div className="fin-pair">
              <Field label={t("documents.reference")} htmlFor="d-ref">
                <Input id="d-ref" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} />
              </Field>
              <Field label={t("documents.currency")} htmlFor="d-cur">
                <Select id="d-cur" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                  <option value="">—</option>
                  {codes.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
            </div>

            <div className="fin-triple">
              <Field label={t("documents.total")} htmlFor="d-total">
                <AmountInput id="d-total" value={form.total} onChange={v => setForm({ ...form, total: v })} currency={form.currency} />
              </Field>
              <Field label={t("documents.net")} htmlFor="d-net">
                <AmountInput id="d-net" value={form.net} onChange={v => setForm({ ...form, net: v })} currency={form.currency} />
              </Field>
              <Field label={t("documents.tax")} htmlFor="d-tax">
                <AmountInput id="d-tax" value={form.tax} onChange={v => setForm({ ...form, tax: v })} currency={form.currency} />
              </Field>
            </div>
            {form.kind === "payslip" && <p className="fin-hint">{t("documents.hintPayslip")}</p>}
          </div>
        </Card>
      )}

      {/* Suggerimenti di collegamento */}
      {links.length > 0 && form && (
        <Card flush>
          <CardHeader><CardTitle>{t("documents.suggestedLinks")}</CardTitle></CardHeader>
          <div className="fin-card__body" style={{ display: "grid", gap: "var(--space-2)" }}>
            <p className="fin-hint">{t("documents.suggestedLinksHint")}</p>
            {links.map(l => {
              const selected = l.target_kind === "transaction"
                ? form.transaction_id === l.target_id
                : form.holding_lot_id === l.target_id;
              return (
                <ChoiceRow
                  key={`${l.target_kind}-${l.target_id}`}
                  selected={selected}
                  onClick={() => setForm(f => l.target_kind === "transaction"
                    ? { ...f, transaction_id: selected ? null : l.target_id }
                    : { ...f, holding_lot_id: selected ? null : l.target_id })}
                  style={{ flexWrap: "wrap" }}
                >
                  <span className="fin-caption" style={{ minWidth: 86 }}>
                    {t(`documents.linkKind.${l.target_kind}`)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, color: "var(--text)" }}>{l.label || "—"}</span>
                  <span className="fin-caption">{formatDate(l.on_date, lang)}</span>
                  <Amount minor={l.amount_minor} currency={l.currency?.trim()} tone="neutral" variant="sm" />
                  {selected && <Icon.Check size={ICON.sm} style={{ color: "var(--accent)" }} aria-hidden="true" />}
                </ChoiceRow>
              );
            })}
          </div>
        </Card>
      )}

      {form && (
        <Button
          variant="primary"
          size="lg"
          block
          onClick={save}
          disabled={busy || doc.status === "extracting"}
        >
          {busy ? t("common.saving") : t("documents.confirm")}
        </Button>
      )}

      {(doc.ai_input_tokens > 0 || doc.ai_output_tokens > 0) && (
        <p className="fin-hint">
          {t("documents.tokens", { input: doc.ai_input_tokens, output: doc.ai_output_tokens })}
        </p>
      )}
    </Page>
  );
}
