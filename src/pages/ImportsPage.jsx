// src/pages/ImportsPage.jsx
// Storico degli import e procedura per uno nuovo.
// La procedura e': conto -> file -> (mappatura, solo la prima volta per quella
// banca) -> avanzamento -> revisione.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { useAccounts } from "../hooks/useAccounts";
import { useImports } from "../hooks/useImports";
import { useImportRun } from "../hooks/useImportRun";
import { useToast } from "../components/Toast";
import {
  Badge, Button, Card, EmptyState, Field, IconButton, InlineAlert,
  Page, PageHeader, Select, Sheet, SkeletonRows,
} from "../ui";
import Loading from "../components/Loading";
import MappingForm from "../components/MappingForm";
import { Icon, ICON } from "../components/icons";
import { formatDate } from "../lib/format";
import { IMPORT_STATUS_TONE } from "./statusTones";
import { errorText } from "../i18n/errorText";

const ACCEPT = ".csv,.xlsx,.xls,.ofx,.qfx,.pdf";

export default function ImportsPage() {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const { minorUnits } = useCurrencies();
  const { accounts } = useAccounts();
  const { imports, loading, error, reload, rollback, remove } = useImports();
  const toast = useToast();
  const navigate = useNavigate();

  const [showNew, setShowNew] = useState(false);

  // Aperto dal menu "+" del guscio.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!params.get("new")) return;
    // eslint-disable-next-line react/set-state-in-effect
    setShowNew(true);
    setParams(prev => { prev.delete("new"); return prev; }, { replace: true });
  }, [params, setParams]);
  const [rollbackFor, setRollbackFor] = useState(null);
  const [preview, setPreview] = useState(null);

  const openRollback = async (imp) => {
    const res = await rollback(imp.id, false);
    if (!res.ok && res.error) { toast.error(res.error); return; }
    setPreview(res);
    setRollbackFor(imp);
  };

  return (
    <Page>
      <PageHeader
        title={t("imports.title")}
        subtitle={t("imports.intro")}
        actions={
          <Button
            variant="primary"
            onClick={() => setShowNew(true)}
            disabled={!accounts?.length}
            icon={<Icon.Plus size={ICON.sm} />}
          >
            {t("imports.new")}
          </Button>
        }
      />

      {!accounts?.length && (
        <InlineAlert
          tone="info"
          action={<Button as={Link} variant="ghost" size="sm" to="/accounts">{t("nav.accounts")}</Button>}
        >
          {t("imports.needAccount")}
        </InlineAlert>
      )}

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      <Card flush>
        {loading && <SkeletonRows rows={4} />}

        {!loading && imports?.length === 0 && (
          <EmptyState
            icon={<Icon.Refresh size={ICON.lg} />}
            title={t("imports.emptyTitle")}
            body={t("imports.emptyBody")}
            action={accounts?.length
              ? <Button variant="primary" onClick={() => setShowNew(true)}>{t("imports.new")}</Button>
              : undefined}
          />
        )}

        {imports?.map(imp => (
          <div key={imp.id} className="fin-row">
            <div className="fin-row__body">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <span className="fin-row__title" style={{ flex: "0 1 auto" }}>{imp.file_name}</span>
                <Badge tone={IMPORT_STATUS_TONE[imp.status]}>{t(`importStatus.${imp.status}`)}</Badge>
                {imp.balance_check === "mismatch" && (
                  <Badge tone="var(--warning)">{t("imports.balanceMismatch")}</Badge>
                )}
              </div>
              <span className="fin-row__subtitle">
                {imp.accounts?.name ?? "—"}
                {imp.period_from ? ` · ${formatDate(imp.period_from, lang)} – ${formatDate(imp.period_to, lang)}` : ""}
                {" · "}
                {t("imports.rowsSummary", {
                  imported: imp.rows_imported ?? 0,
                  skipped: imp.rows_skipped ?? 0,
                  total: imp.rows_total ?? 0,
                })}
              </span>
              {imp.error && (
                <span className="fin-error" style={{ marginTop: "var(--space-1)" }}>{imp.error}</span>
              )}
            </div>

            <div style={{ display: "flex", gap: "var(--space-1)", flex: "0 0 auto" }}>
              {/* Anche un import ancora "in lettura" si puo' aprire, se la
                  Edge Function ha gia' estratto le righe in sottofondo: la
                  revisione finisce il lavoro all'apertura. */}
              {(imp.status === "review"
                || (imp.status === "parsing" && (imp.rows_total ?? 0) > 0)) && (
                <Button variant="primary" size="sm" onClick={() => navigate(`/imports/${imp.id}`)}>
                  {t("imports.review")}
                </Button>
              )}
              {imp.status === "committed" && (
                <Button size="sm" onClick={() => openRollback(imp)}>{t("imports.rollback")}</Button>
              )}
              {imp.status !== "committed" && (
                <IconButton
                  tone="danger"
                  onClick={async () => {
                    const res = await remove(imp);
                    if (!res.ok) toast.error(t("imports.deleteBlocked"));
                    else toast.success(t("imports.deleted"));
                  }}
                  label={t("common.delete")}
                  icon={<Icon.Delete size={ICON.sm} />}
                />
              )}
            </div>
          </div>
        ))}
      </Card>

      {showNew && (
        <NewImportFlow
          accounts={accounts ?? []}
          aiConsent={!!profile?.ai_consent_at}
          minorUnitsOf={minorUnits}
          onClose={() => { setShowNew(false); reload(); }}
          onReview={(id) => { setShowNew(false); reload(); navigate(`/imports/${id}`); }}
        />
      )}

      {rollbackFor && preview && (
        <Sheet
          variant="dialog"
          title={t("imports.rollbackTitle")}
          onClose={() => { setRollbackFor(null); setPreview(null); }}
          footer={<>
            <Button variant="quiet" onClick={() => { setRollbackFor(null); setPreview(null); }}>
              {t("common.cancel")}
            </Button>
            {/* Azione distruttiva: il pulsante e' col bordo rosso, non pieno.
                Il rosso pieno in questa interfaccia e' l'azione PRINCIPALE, e
                annullare un import non lo e' mai. */}
            <Button
              variant="danger"
              onClick={async () => {
                const res = await rollback(rollbackFor.id, true);
                setRollbackFor(null); setPreview(null);
                if (res.ok) toast.success(t("imports.rolledBack", { count: res.deleted ?? 0 }));
                else toast.error(res.error);
              }}
            >{t("imports.rollbackConfirm")}</Button>
          </>}
        >
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <p className="fin-body">{t("imports.rollbackBody", { count: preview.transactions ?? 0 })}</p>
            {preview.modified_after_commit > 0 && (
              <InlineAlert tone="error">
                {t("imports.rollbackModified", { count: preview.modified_after_commit })}
              </InlineAlert>
            )}
            {preview.transfers_with_outside_counterpart > 0 && (
              <InlineAlert tone="warning">
                {t("imports.rollbackTransfers", { count: preview.transfers_with_outside_counterpart })}
              </InlineAlert>
            )}
          </div>
        </Sheet>
      )}
    </Page>
  );
}

// ── procedura di nuovo import ────────────────────────────────────────────────

function NewImportFlow({ accounts, aiConsent, minorUnitsOf, onClose, onReview }) {
  const { t } = useI18n();
  const run = useImportRun({ minorUnitsOf });
  const [accountId, setAccountId] = useState(accounts[0]?.account_id ?? "");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const account = accounts.find(a => a.account_id === accountId);

  const handleFile = async (file) => {
    if (!file || !account) return;
    await run.start({ file, account, aiConsent });
  };

  const title = run.step === "mapping" ? t("imports.mappingTitle") : t("imports.new");

  return (
    <Sheet
      variant="dialog"
      title={title}
      onClose={onClose}
      footer={run.step === "done" ? (
        <>
          <Button variant="quiet" onClick={onClose}>{t("common.close")}</Button>
          <Button variant="primary" onClick={() => onReview(run.importId)}>{t("imports.goToReview")}</Button>
        </>
      ) : null}
    >
      {run.step === "idle" && (
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <Field label={t("tx.account")} htmlFor="imp-account">
            <Select id="imp-account" value={accountId} onChange={e => setAccountId(e.target.value)}>
              {accounts.map(a => (
                <option key={a.account_id} value={a.account_id}>{a.name} ({a.currency?.trim()})</option>
              ))}
            </Select>
          </Field>

          <button
            type="button"
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            className={`fin-dropzone${dragging ? " fin-dropzone--on" : ""}`}
          >
            <Icon.Documents size={ICON.lg} aria-hidden="true" />
            <span className="fin-dropzone__title">{t("imports.dropHere")}</span>
            <span className="fin-caption">{t("imports.formats")}</span>
          </button>
          <input
            ref={inputRef} type="file" accept={ACCEPT} hidden
            onChange={e => handleFile(e.target.files?.[0])}
          />

          {!aiConsent && <InlineAlert tone="info">{t("imports.noConsentHint")}</InlineAlert>}
        </div>
      )}

      {(run.step === "uploading" || run.step === "parsing") && (
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <Loading label={run.progressPart
            ? t("imports.progress.ai_text_part", run.progressPart)
            : t(`imports.progress.${run.progress}`)} />
          {run.duplicateOf && (
            <InlineAlert tone="warning">
              {t("imports.alreadyImported", { name: run.duplicateOf.file_name })}
            </InlineAlert>
          )}
        </div>
      )}

      {run.step === "mapping" && (
        <MappingForm
          proposal={run.mappingProposal}
          onConfirm={(mapping, name) => run.confirmMapping(mapping, { saveProfile: name })}
        />
      )}

      {run.step === "background" && (
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <Loading label={t("imports.progress.ai_pdf")} />
          <InlineAlert tone="info">{t("imports.backgroundHint")}</InlineAlert>
        </div>
      )}

      {run.step === "done" && (
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <p className="fin-h3">{t("imports.doneTitle")}</p>
          <p className="fin-muted">{t("imports.doneRows", { count: run.summary?.rows ?? 0 })}</p>
          {run.summary?.exact > 0 && <p className="fin-hint">{t("imports.doneDuplicates", { count: run.summary.exact })}</p>}
          {run.summary?.probable > 0 && <p className="fin-hint">{t("imports.doneProbable", { count: run.summary.probable })}</p>}
          {run.summary?.transfers > 0 && <p className="fin-hint">{t("imports.doneTransfers", { count: run.summary.transfers })}</p>}
          {run.summary?.fromHistory > 0 && <p className="fin-hint">{t("imports.doneHistory", { count: run.summary.fromHistory })}</p>}
          {run.summary?.ai?.assigned > 0 && <p className="fin-hint">{t("imports.doneAi", { count: run.summary.ai.assigned })}</p>}
        </div>
      )}

      {run.step === "failed" && (
        <div style={{ display: "grid", gap: "var(--space-3)", justifyItems: "start" }}>
          <InlineAlert tone="error">
            {errorText(t, "imports.errors", run.error)}
          </InlineAlert>
          <Button onClick={run.reset}>{t("common.retry")}</Button>
        </div>
      )}
    </Sheet>
  );
}
