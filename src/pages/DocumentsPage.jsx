// src/pages/DocumentsPage.jsx
// Archivio dei documenti: fatture, ricevute, buste paga, contratti.
//
// Il file si carica sempre, anche senza consenso all'AI: in quel caso resta
// archiviato e i campi si compilano a mano. Perdere un documento perche' un
// interruttore e' spento sarebbe il modo peggiore di rispettare una scelta.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useDocuments, uploadDocument } from "../hooks/useDocuments";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { useToast } from "../components/Toast";
import {
  Amount, Badge, Card, EmptyState, FilterBar, IconButton, InlineAlert,
  Page, PageHeader, Select, SkeletonRows,
} from "../ui";
import Loading from "../components/Loading";
import { Icon, ICON } from "../components/icons";
import { errorText } from "../i18n/errorText";
import { formatDate } from "../lib/format";
import { DOC_STATUS_TONE } from "./statusTones";

const ACCEPT = "application/pdf,image/*";

const KINDS = ["invoice_issued", "invoice_received", "receipt", "payslip", "contract", "other"];
const STATUSES = ["uploaded", "extracting", "pending_review", "confirmed", "failed"];

export default function DocumentsPage() {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const { codes, minorUnits } = useCurrencies();
  const toast = useToast();
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const { documents, loading, error, reload, remove } = useDocuments({ kind, status });

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Aperto dal menu "+" del guscio: apre subito il selettore di file.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!params.get("new")) return;
    setParams(prev => { prev.delete("new"); return prev; }, { replace: true });
    inputRef.current?.click();
  }, [params, setParams]);

  const aiConsent = !!profile?.ai_consent_at;

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    // Le valute servono al lettore a regole per convertire gli importi in minor
    // units con i decimali giusti, senza chiamare l'AI.
    const res = await uploadDocument(file, {
      aiConsent,
      currencyCodes: new Set(codes),
      minorUnitsOf: minorUnits,
    });
    setUploading(false);
    if (!res.ok) {
      toast.error(errorText(t, "documents.errors", res.error));
      return;
    }
    await reload();
    navigate(`/documents/${res.documentId}`);
  };

  return (
    <Page>
      <PageHeader title={t("documents.title")} subtitle={t("documents.intro")} />

      {/* Caricamento */}
      <button
        type="button"
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
        onClick={() => inputRef.current?.click()}
        className={`fin-dropzone${dragging ? " fin-dropzone--on" : ""}`}
      >
        {uploading ? (
          <Loading label={t("documents.uploading")} />
        ) : (
          <>
            <Icon.Documents size={ICON.lg} aria-hidden="true" />
            <span className="fin-dropzone__title">{t("documents.dropHere")}</span>
            <span className="fin-caption">{t("documents.formats")}</span>
          </>
        )}
      </button>
      <input
        ref={inputRef} type="file" accept={ACCEPT} hidden
        // capture non e' impostato di proposito: su mobile il selettore offre
        // comunque la fotocamera, ma lascia anche scegliere un file esistente.
        onChange={e => handleFile(e.target.files?.[0])}
      />

      {!aiConsent && <InlineAlert tone="info">{t("documents.noConsentHint")}</InlineAlert>}

      <FilterBar>
        <Select
          value={kind} onChange={e => setKind(e.target.value)}
          aria-label={t("documents.filterKind")} style={{ width: "auto" }}
        >
          <option value="">{t("documents.allKinds")}</option>
          {KINDS.map(k => <option key={k} value={k}>{t(`documentKind.${k}`)}</option>)}
        </Select>
        <Select
          value={status} onChange={e => setStatus(e.target.value)}
          aria-label={t("documents.filterStatus")} style={{ width: "auto" }}
        >
          <option value="">{t("documents.allStatuses")}</option>
          {STATUSES.map(s => <option key={s} value={s}>{t(`documentStatus.${s}`)}</option>)}
        </Select>
      </FilterBar>

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      <Card flush>
        {loading && <SkeletonRows rows={4} />}

        {!loading && documents?.length === 0 && (
          <EmptyState
            icon={<Icon.Documents size={ICON.lg} />}
            title={t("documents.emptyTitle")}
            body={t("documents.emptyBody")}
          />
        )}

        {documents?.map(d => (
          <div key={d.id} className="fin-row">
            <Link to={`/documents/${d.id}`} className="fin-row__body" style={{ textDecoration: "none", color: "inherit" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <span className="fin-row__title" style={{ flex: "0 1 auto" }}>{d.issuer || d.file_name}</span>
                <Badge tone={DOC_STATUS_TONE[d.status]}>{t(`documentStatus.${d.status}`)}</Badge>
                {(d.flags ?? []).map(f => (
                  <Badge key={f} tone="var(--warning)">{t(`documentFlags.${f}`)}</Badge>
                ))}
              </span>
              <span className="fin-row__subtitle">
                {t(`documentKind.${d.kind}`)}
                {d.doc_date ? ` · ${formatDate(d.doc_date, lang)}` : ""}
                {d.reference ? ` · ${d.reference}` : ""}
              </span>
            </Link>

            {d.total_minor !== null && d.currency && (
              <Amount minor={d.total_minor} currency={d.currency.trim()} tone="neutral" />
            )}

            <IconButton
              tone="danger"
              onClick={async () => {
                const res = await remove(d);
                if (res.ok) toast.success(t("documents.deleted"));
                else toast.error(res.error);
              }}
              label={t("common.delete")}
              icon={<Icon.Delete size={ICON.sm} />}
            />
          </div>
        ))}
      </Card>
    </Page>
  );
}
