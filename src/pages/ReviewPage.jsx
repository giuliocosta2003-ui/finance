// src/pages/ReviewPage.jsx
// Revisione di un import: qui si guarda cosa e' stato letto e si decide cosa
// entra davvero nei conti. Finche' non si preme Conferma, `transactions` non
// viene toccata.
//
// Le due regole che governano i pulsanti: la valuta sbagliata BLOCCA la
// conferma (importare importi in un'altra valuta falserebbe ogni saldo), il
// saldo che non torna la fa solo CHIEDERE conferma (puo' capitare che manchi
// una riga e l'utente lo sappia).
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { useCategories, categoryLabel } from "../hooks/useCategories";
import { useImportRows, useMerchantRules } from "../hooks/useImports";
import { useToast } from "../components/Toast";
import {
  Amount, Avatar, Badge, Button, Card, Chip, DataTable, ErrorState, Field,
  FilterBar, IconButton, InlineAlert, Input, Page, PageHeader, SegmentedControl,
  Select, Sheet, SkeletonRows, Stat, StatGrid,
} from "../ui";
import Loading from "../components/Loading";
import AmountInput from "../components/AmountInput";
import { Icon, ICON } from "../components/icons";
import { formatDate } from "../lib/format";
import { parseAmount, toMajorString } from "../lib/money";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { supabase } from "../lib/supabase";
import { resumeExtraction } from "../lib/import/persist.js";
import { groupByMerchant } from "../lib/groupByMerchant";
import { CONFIDENCE_TONE } from "./statusTones";

const FLAG_TONE = {
  duplicate_exact:    "var(--negative)",
  duplicate_probable: "var(--warning)",
  transfer_candidate: "var(--info)",
  balance_mismatch:   "var(--warning)",
  currency_mismatch:  "var(--negative)",
  parse_warning:      "var(--warning)",
  date_ambiguous:     "var(--warning)",
};

const SOURCE_TONE = {
  rule:    CONFIDENCE_TONE.rule,
  history: CONFIDENCE_TONE.rule,
  ai:      CONFIDENCE_TONE.ai,
  user:    "var(--text-secondary)",
  none:    "var(--text-tertiary)",
};

export default function ReviewPage() {
  const { importId } = useParams();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const isMobile = useIsMobile();
  const { minorUnits } = useCurrencies();

  const { rows, importRow, loading, error, reload, updateRows, commit } = useImportRows(importId);
  const { categories } = useCategories();
  const { upsertFromCorrection, remove: removeRule } = useMerchantRules();
  const { profile } = useAuth();

  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState("all");
  // "merchants" raggruppa per commerciante: con un estratto di cento righe
  // categorizzarle una per una e' un lavoro da un'ora, e la stragrande
  // maggioranza sono lo stesso negozio ripetuto. La vista per riga resta per
  // quando serve guardare il dettaglio.
  const [view, setView] = useState("merchants");
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(false);
  const resumed = useRef(false);

  const currency = importRow?.accounts?.currency?.trim();
  const units = minorUnits(currency);

  /**
   * Un PDF scansionato lo legge la Edge Function in sottofondo, e le righe
   * estratte restano nel diario finche' qualcuno non le lavora. Se l'utente
   * arriva qui prima che sia successo, si finisce adesso: controlli, impronte e
   * regole sono gli stessi di ogni altro import, e vanno applicati comunque.
   */
  const pendingExtraction =
    importRow?.status === "parsing" && (importRow?.rows_total ?? 0) > 0 && rows?.length === 0;

  useEffect(() => {
    if (!pendingExtraction || resumed.current) return;
    resumed.current = true;
    setResuming(true);
    (async () => {
      const account = {
        id: importRow.account_id,
        currency: importRow.accounts?.currency ?? "",
      };
      const res = await resumeExtraction(supabase, {
        importId,
        account,
        minorUnits: minorUnits((account.currency ?? "").trim()),
        aiConsent: !!profile?.ai_consent_at,
        onProgress: () => {},
      });
      setResuming(false);
      if (!res.ok) {
        await supabase.from("imports")
          .update({ status: "failed", error: res.error })
          .eq("id", importId);
      }
      await reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingExtraction]);

  const visible = useMemo(() => {
    if (!rows) return [];
    if (filter === "all") return rows;
    if (filter === "uncategorized") return rows.filter(r => !r.category_id);
    if (filter === "low") return rows.filter(r => r.confidence === "low");
    return rows.filter(r => (r.flags ?? []).includes(filter));
  }, [rows, filter]);

  /**
   * Le righe visibili raggruppate per commerciante: la logica sta in
   * `groupByMerchant`, provata a parte. Si raggruppa cio' che e' VISIBILE,
   * quindi il filtro "senza categoria" piu' questa vista danno esattamente il
   * lavoro da fare e nient'altro.
   */
  const merchantGroups = useMemo(() => groupByMerchant(visible), [visible]);

  const totals = useMemo(() => {
    let income = 0n, expense = 0n, toImport = 0;
    for (const r of rows ?? []) {
      if (r.decision !== "import" || r.amount_minor == null) continue;
      toImport += 1;
      // Un trasferimento confermato non e' ne' un'entrata ne' un'uscita: sono
      // gli stessi soldi che cambiano conto, come in Movimenti.
      if (r.kind === "transfer") continue;
      const v = BigInt(r.amount_minor);
      if (v > 0n) income += v; else expense += v;
    }
    return { income, expense, toImport };
  }, [rows]);

  const blocking = (rows ?? []).filter(r => r.decision === "import" && (r.flags ?? []).includes("currency_mismatch"));
  const balanceWarning = importRow?.balance_check === "mismatch";
  const alreadyCommitted = importRow && importRow.status !== "review";

  const flagCounts = useMemo(() => {
    const counts = {};
    for (const r of rows ?? []) for (const f of r.flags ?? []) counts[f] = (counts[f] ?? 0) + 1;
    return counts;
  }, [rows]);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /**
   * Cambiare categoria a una riga crea anche la regola per quel commerciante,
   * e la applica subito a tutte le righe uguali dell'import. L'avviso resta
   * annullabile: l'automatismo aiuta finche' si puo' disfare.
   */
  const changeCategory = async (ids, categoryId) => {
    await updateRows(ids, { category_id: categoryId || null, category_source: "user", confidence: "high" });

    const touched = (rows ?? []).filter(r => ids.includes(r.id));
    const merchants = [...new Set(touched.map(r => r.merchant).filter(Boolean))];
    if (!categoryId || merchants.length !== 1) return;

    const merchant = merchants[0];
    const res = await upsertFromCorrection(merchant, categoryId);
    if (!res.ok) return;

    // Stesso commerciante, stesse righe: si allineano tutte adesso.
    const sameMerchant = (rows ?? [])
      .filter(r => r.merchant === merchant && !ids.includes(r.id))
      .map(r => r.id);
    if (sameMerchant.length) {
      await updateRows(sameMerchant, { category_id: categoryId, category_source: "rule", confidence: "high" });
    }

    toast.success(
      t("rules.created", { merchant }),
      { label: t("common.undo"), onAction: async () => { await removeRule(res.rule.id); toast.info(t("rules.undone")); } },
    );
  };

  /**
   * Conferma (o smentita) di un trasferimento interno.
   *
   * Il collegamento fra le due gambe lo fa `commit_import`, ma solo per le
   * righe che l'utente ha dichiarato trasferimenti: un movimento con importo
   * opposto su un altro conto SOMIGLIA a un giroconto senza esserlo per forza,
   * e indovinare al posto dell'utente qui vuol dire sbagliare un bilancio.
   * Un trasferimento non ha categoria: non e' una spesa, sono gli stessi soldi
   * che cambiano tasca.
   */
  const changeKind = async (ids, kind) => {
    const touched = (rows ?? []).filter(r => ids.includes(r.id));
    if (kind === "transfer") {
      await updateRows(ids, {
        kind: "transfer", category_id: null, category_source: "none", confidence: "high",
      });
      return;
    }
    // Torna un movimento normale: il verso lo dice il segno, non l'utente.
    const entrate = touched.filter(r => BigInt(r.amount_minor ?? 0) > 0n).map(r => r.id);
    const uscite = touched.filter(r => BigInt(r.amount_minor ?? 0) <= 0n).map(r => r.id);
    if (entrate.length) await updateRows(entrate, { kind: "income" });
    if (uscite.length) await updateRows(uscite, { kind: "expense" });
  };

  const doCommit = async () => {
    setBusy(true);
    const res = await commit();
    setBusy(false);
    setConfirming(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(t("review.committed", { count: res.imported ?? 0 }));
    navigate("/transactions");
  };

  if (loading || resuming) {
    return (
      <Page>
        <Card>
          <Loading label={t(resuming ? "review.resuming" : "common.loading")} />
        </Card>
        <Card flush><SkeletonRows rows={5} /></Card>
      </Page>
    );
  }

  if (error) {
    return <Page><Card><ErrorState title={error} onRetry={reload} /></Card></Page>;
  }

  const commitDisabled = busy || blocking.length > 0 || alreadyCommitted || totals.toImport === 0;

  return (
    <Page>
      <PageHeader
        backTo="/imports"
        backLabel={t("imports.title")}
        title={t("review.title")}
        subtitle={
          <>
            {importRow?.file_name} · {importRow?.accounts?.name}
            {importRow?.period_from
              ? ` · ${formatDate(importRow.period_from, lang)} – ${formatDate(importRow.period_to, lang)}`
              : ""}
          </>
        }
      />

      {/* Riepilogo */}
      <StatGrid>
        <Stat label={t("review.rowsToImport")} value={`${totals.toImport} / ${rows?.length ?? 0}`} />
        <Stat
          label={t("tx.totalIncome")}
          value={<Amount minor={totals.income} currency={currency} tone="in" variant="lg" />}
        />
        <Stat
          label={t("tx.totalExpense")}
          value={<Amount minor={totals.expense} currency={currency} tone="out" variant="lg" />}
        />
        <Stat
          label={t("review.balanceCheck")}
          value={t(`review.balance.${importRow?.balance_check ?? "not_available"}`)}
          tone={importRow?.balance_check === "ok" ? "var(--positive)"
            : importRow?.balance_check === "mismatch" ? "var(--warning)" : undefined}
        />
      </StatGrid>

      {(importRow?.ai_input_tokens > 0 || importRow?.ai_output_tokens > 0) && (
        <p className="fin-hint">
          {t("review.tokens", { input: importRow.ai_input_tokens, output: importRow.ai_output_tokens })}
        </p>
      )}

      {/* Filtri */}
      <FilterBar>
        <Chip on={filter === "all"} onClick={() => setFilter("all")} count={rows?.length}>
          {t("review.filterAll")}
        </Chip>
        <Chip
          on={filter === "uncategorized"}
          onClick={() => setFilter("uncategorized")}
          count={(rows ?? []).filter(r => !r.category_id).length}
        >{t("review.filterUncategorized")}</Chip>
        <Chip
          on={filter === "low"}
          onClick={() => setFilter("low")}
          count={(rows ?? []).filter(r => r.confidence === "low").length}
        >{t("review.filterLow")}</Chip>
        {Object.entries(flagCounts).map(([flag, count]) => (
          <Chip key={flag} on={filter === flag} onClick={() => setFilter(flag)} count={count}>
            {t(`flags.${flag}`)}
          </Chip>
        ))}
      </FilterBar>

      {/* Azioni in blocco */}
      {selected.size > 0 && (
        <FilterBar>
          <span className="fin-eyebrow">{t("review.selected", { count: selected.size })}</span>
          <Select
            value=""
            onChange={e => { changeCategory([...selected], e.target.value); setSelected(new Set()); }}
            aria-label={t("review.setCategory")}
            style={{ width: "auto", height: "var(--control-h-sm)" }}
          >
            <option value="">{t("review.setCategory")}</option>
            {(categories ?? []).map(c => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
          </Select>
          <Select
            value=""
            onChange={e => { changeKind([...selected], e.target.value); setSelected(new Set()); }}
            aria-label={t("review.setKind")}
            style={{ width: "auto", height: "var(--control-h-sm)" }}
          >
            <option value="">{t("review.setKind")}</option>
            <option value="transfer">{t("review.markTransfer")}</option>
            <option value="normal">{t("review.markNotTransfer")}</option>
          </Select>
          <Button
            size="sm"
            onClick={async () => { await updateRows([...selected], { decision: "import" }); setSelected(new Set()); }}
          >{t("review.markImport")}</Button>
          <Button
            size="sm"
            onClick={async () => { await updateRows([...selected], { decision: "skip" }); setSelected(new Set()); }}
          >{t("review.markSkip")}</Button>
          <div className="fin-toolbar__end">
            <Button variant="quiet" size="sm" onClick={() => setSelected(new Set())}>
              {t("review.clearSelection")}
            </Button>
          </div>
        </FilterBar>
      )}

      {/* Il selettore di vista. Per commerciante e' il modo veloce; per
          movimento resta per quando serve guardare la singola riga. */}
      {visible.length > 0 && (
        <div className="fin-toolbar">
          <SegmentedControl
            label={t("review.view")}
            value={view}
            onChange={setView}
            options={[
              { value: "merchants", label: t("review.viewMerchants", { count: merchantGroups.length }) },
              { value: "rows", label: t("review.viewRows", { count: visible.length }) },
            ]}
          />
        </div>
      )}

      {/* Righe: tabella su desktop, card su mobile. Stessi comandi, due
          impaginazioni: su uno schermo stretto una tabella a sette colonne si
          legge male, su uno largo una colonna di card spreca tutto lo spazio. */}
      {visible.length === 0 ? (
        <Card><p className="fin-hint">{t("review.noRows")}</p></Card>
      ) : view === "merchants" ? (
        <MerchantGroups
          groups={merchantGroups}
          currency={currency}
          categories={categories ?? []}
          locale={lang}
          onCategory={(group, id) => changeCategory(group.rows.map(r => r.id), id)}
          onDecision={(group, decision) => updateRows(group.rows.map(r => r.id), { decision })}
        />
      ) : isMobile ? (
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          {visible.map(row => (
            <RowCard
              key={row.id}
              row={row}
              currency={currency}
              categories={categories ?? []}
              selected={selected.has(row.id)}
              onToggle={() => toggle(row.id)}
              onEdit={() => setEditing(row)}
              onCategory={(id) => changeCategory([row.id], id)}
              onKind={(kind) => changeKind([row.id], kind)}
              onDecision={(decision) => updateRows([row.id], { decision })}
              locale={lang}
            />
          ))}
        </div>
      ) : (
        <Card flush>
          <RowsTable
            rows={visible}
            currency={currency}
            categories={categories ?? []}
            selected={selected}
            onToggle={toggle}
            onToggleAll={() => setSelected(prev =>
              visible.every(r => prev.has(r.id))
                ? new Set()
                : new Set(visible.map(r => r.id)))}
            onEdit={setEditing}
            onCategory={(row, id) => changeCategory([row.id], id)}
            onKind={(row, kind) => changeKind([row.id], kind)}
            onDecision={(row, decision) => updateRows([row.id], { decision })}
            locale={lang}
          />
        </Card>
      )}

      {/* Conferma. Resta appiccicata in fondo: con duecento righe, dover
          risalire fino in cima per confermare sarebbe assurdo. */}
      <div className="fin-commitbar">
        {blocking.length > 0 && (
          <InlineAlert tone="error">{t("review.blockedCurrency", { count: blocking.length })}</InlineAlert>
        )}
        {alreadyCommitted && (
          <InlineAlert tone="info">{t(`review.alreadyCommitted.${importRow.status}`)}</InlineAlert>
        )}
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => (balanceWarning ? setConfirming(true) : doCommit())}
          disabled={commitDisabled}
        >
          {busy ? t("common.saving") : t("review.commit", { count: totals.toImport })}
        </Button>
      </div>

      {editing && (
        <EditRowSheet
          row={editing}
          currency={currency}
          units={units}
          locale={lang}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await updateRows([editing.id], patch);
            setEditing(null);
          }}
        />
      )}

      {confirming && (
        <Sheet
          variant="dialog"
          title={t("review.balanceWarningTitle")}
          onClose={() => setConfirming(false)}
          footer={<>
            <Button variant="quiet" onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={doCommit}>{t("review.commitAnyway")}</Button>
          </>}
        >
          <p className="fin-body">{t("review.balanceWarningBody")}</p>
        </Sheet>
      )}
    </Page>
  );
}

// ── vista per commerciante ───────────────────────────────────────────────────

/**
 * I movimenti raggruppati per commerciante, una categoria per gruppo.
 *
 * E' la risposta al problema vero di un estratto conto reale: le righe sono
 * cento, ma i negozi sono venti. Scegliere una categoria qui la applica a tutte
 * le righe del gruppo E crea la regola per il commerciante, quindi il prossimo
 * estratto arrivera' gia' categorizzato — e' lo stesso `changeCategory` che usa
 * la vista per riga, chiamato su piu' id insieme.
 *
 * E' esportato per il banco di prova in /dev/page/review, che lo monta con
 * dati finti: questa schermata vera ha bisogno di una sessione e di un import
 * sul database, e senza un modo di guardarla non si verifica.
 */
export function MerchantGroups({ groups, currency, categories, locale, onCategory, onDecision }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => new Set());

  const toggleOpen = (key) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <Card flush>
      {groups.map(group => {
        const expanded = open.has(group.key);
        const label = group.merchant || group.rows[0].description || t("tx.noDescription");
        const dates = group.rows.map(r => r.booked_on).filter(Boolean).sort();

        return (
          <div key={group.key}>
            <div className="fin-group" style={{ opacity: group.skipped ? 0.5 : 1 }}>
              <span className="fin-group__avatar">
                <Avatar name={label} colorKey={group.merchant ?? label} />
              </span>

              <span className="fin-group__head">
                <span className="fin-group__name">{label}</span>
                {(group.rows.length > 1 || group.mixed) && (
                  <span className="fin-group__tags">
                    {group.rows.length > 1 && (
                      <Badge>{t("review.groupCount", { count: group.rows.length })}</Badge>
                    )}
                    {group.mixed && <Badge tone="var(--warning)">{t("review.groupMixed")}</Badge>}
                  </span>
                )}
              </span>

              <span className="fin-group__figures">
                <span className="fin-caption">
                  {dates.length > 0 && (dates[0] === dates[dates.length - 1]
                    ? formatDate(dates[0], locale)
                    : `${formatDate(dates[0], locale)} – ${formatDate(dates[dates.length - 1], locale)}`)}
                </span>
                <Amount minor={group.total} currency={currency} />
              </span>

              <span className="fin-group__actions">
                {/* Una tendina sola per tutto il gruppo: e' il punto di tutta
                    la schermata. Su un gruppo misto parte vuota e riallinea. */}
                <Select
                  value={group.mixed ? "" : (group.categoryId ?? "")}
                  onChange={e => onCategory(group, e.target.value)}
                  aria-label={t("tx.category")}
                  style={{ height: "var(--control-h-sm)", fontSize: "var(--fs-body-sm)" }}
                >
                  <option value="">{group.mixed ? t("review.groupSetAll") : t("tx.noCategory")}</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
                </Select>

                <IconButton
                  onClick={() => onDecision(group, group.skipped ? "import" : "skip")}
                  label={group.skipped ? t("review.markImport") : t("review.markSkip")}
                  icon={group.skipped ? <Icon.Check size={ICON.sm} /> : <Icon.Close size={ICON.sm} />}
                />

                {group.rows.length > 1 && (
                  <IconButton
                    onClick={() => toggleOpen(group.key)}
                    label={expanded ? t("review.groupCollapse") : t("review.groupExpand")}
                    icon={expanded ? <Icon.Up size={ICON.sm} /> : <Icon.Down size={ICON.sm} />}
                  />
                )}
              </span>
            </div>

            {/* Le singole righe del gruppo, se le si vuole controllare. */}
            {expanded && group.rows.map(row => (
              <div key={row.id} className="fin-group__row">
                <span className="fin-caption" style={{ minWidth: 88 }}>
                  {row.booked_on ? formatDate(row.booked_on, locale) : t("review.noDate")}
                </span>
                <span className="fin-caption" style={{ flex: "1 1 160px", minWidth: 0 }}>
                  {row.description || row.merchant || t("tx.noDescription")}
                </span>
                <FlagBadges flags={row.flags} />
                <Amount minor={row.amount_minor} currency={currency} variant="sm" />
              </div>
            ))}
          </div>
        );
      })}
    </Card>
  );
}

// ── pezzi condivisi fra la tabella e le card ─────────────────────────────────

function FlagBadges({ flags }) {
  const { t } = useI18n();
  return (flags ?? []).map(f => (
    <Badge key={f} tone={FLAG_TONE[f] ?? "var(--text-secondary)"}>{t(`flags.${f}`)}</Badge>
  ));
}

function SourceNote({ row }) {
  const { t } = useI18n();
  return (
    <span className="fin-caption" style={{ color: SOURCE_TONE[row.category_source] ?? "var(--text-tertiary)" }}>
      {t(`source.${row.category_source}`)} · {t(`confidence.${row.confidence}`)}
    </span>
  );
}

/**
 * Un trasferimento non ha categoria: al posto della tendina mostra cosa e'.
 * Toglierla del tutto e' voluto — se la categoria si potesse scegliere lo
 * stesso, un giroconto finirebbe classificato come spesa e il bilancio
 * conterebbe due volte gli stessi soldi.
 */
function CategoryCell({ row, categories, onCategory, width }) {
  const { t } = useI18n();
  if (row.kind === "transfer") {
    return (
      <Badge tone="var(--info)" icon={<Icon.Transfer size={ICON.inline} aria-hidden="true" />}>
        {t("review.isTransfer")}
      </Badge>
    );
  }
  return (
    <Select
      value={row.category_id ?? ""}
      onChange={e => onCategory(e.target.value)}
      aria-label={t("tx.category")}
      style={{ width: "auto", maxWidth: width, height: "var(--control-h-sm)", fontSize: "var(--fs-body-sm)" }}
    >
      <option value="">{t("tx.noCategory")}</option>
      {categories.map(c => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
    </Select>
  );
}

function RowButtons({ row, onEdit, onKind, onDecision }) {
  const { t } = useI18n();
  const skipped = row.decision === "skip";
  const isTransfer = row.kind === "transfer";
  // Il pulsante compare dove ha senso: sulle righe che il database ha segnalato
  // come possibile giroconto, e su quelle gia' confermate, per poter tornare
  // indietro.
  const showTransfer = isTransfer || (row.flags ?? []).includes("transfer_candidate");

  return (
    <div style={{ display: "flex", gap: "var(--space-1)" }}>
      {showTransfer && (
        <IconButton
          onClick={() => onKind(isTransfer ? "normal" : "transfer")}
          label={t(isTransfer ? "review.markNotTransfer" : "review.markTransfer")}
          icon={<Icon.Transfer size={ICON.sm} />}
          style={isTransfer ? { color: "var(--info)", borderColor: "var(--info)" } : undefined}
        />
      )}
      <IconButton onClick={onEdit} label={t("common.edit")} icon={<Icon.Edit size={ICON.sm} />} />
      <IconButton
        onClick={() => onDecision(skipped ? "import" : "skip")}
        label={skipped ? t("review.markImport") : t("review.markSkip")}
        icon={skipped ? <Icon.Check size={ICON.sm} /> : <Icon.Close size={ICON.sm} />}
      />
    </div>
  );
}

// ── desktop ──────────────────────────────────────────────────────────────────

/**
 * La tabella e' quella del design system (<DataTable>), non una scritta a
 * mano: prima questa schermata aveva il proprio <table> con i propri `th` e
 * `td`, e accanto a Movimenti — che usa DataTable — le due tabelle avevano
 * altezze di riga e bordi diversi.
 */
function RowsTable({
  rows, currency, categories, selected,
  onToggle, onToggleAll, onEdit, onCategory, onKind, onDecision, locale,
}) {
  const { t } = useI18n();

  const columns = [
    {
      key: "date",
      header: t("tx.date"),
      width: 110,
      render: row => (
        <span style={{ whiteSpace: "nowrap", color: "var(--text-secondary)" }}>
          {row.booked_on ? formatDate(row.booked_on, locale) : t("review.noDate")}
        </span>
      ),
    },
    {
      key: "description",
      header: t("tx.description"),
      render: row => (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <span>{row.description || row.merchant || t("tx.noDescription")}</span>
          <FlagBadges flags={row.flags} />
        </div>
      ),
    },
    { key: "source", header: t("review.sourceColumn"), width: 150, render: row => <SourceNote row={row} /> },
    {
      key: "category",
      header: t("tx.category"),
      width: 200,
      render: row => (
        <CategoryCell row={row} categories={categories} onCategory={id => onCategory(row, id)} width={190} />
      ),
    },
    {
      key: "amount",
      header: t("tx.amount"),
      align: "right",
      width: 130,
      render: row => <Amount minor={row.amount_minor} currency={currency} variant="sm" />,
    },
    {
      key: "actions",
      header: "",
      width: 120,
      render: row => (
        <RowButtons
          row={row}
          onEdit={() => onEdit(row)}
          onKind={kind => onKind(row, kind)}
          onDecision={decision => onDecision(row, decision)}
        />
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      selected={selected}
      onToggle={onToggle}
      onToggleAll={onToggleAll}
      rowClassName={row => (row.decision === "skip" ? "fin-table__row--skipped" : undefined)}
    />
  );
}

// ── mobile ───────────────────────────────────────────────────────────────────

function RowCard({ row, currency, categories, selected, onToggle, onEdit, onCategory, onKind, onDecision, locale }) {
  const { t } = useI18n();
  const skipped = row.decision === "skip";
  const flagTone = (row.flags ?? []).length ? (FLAG_TONE[row.flags[0]] ?? "transparent") : "transparent";

  return (
    <div
      className="fin-card"
      style={{
        padding: "var(--space-3)",
        display: "grid",
        gap: "var(--space-2)",
        opacity: skipped ? 0.5 : 1,
        // La banda a sinistra dice a colpo d'occhio se la riga ha un problema,
        // senza dover leggere le pastiglie.
        borderLeft: `3px solid ${flagTone}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
        <input
          type="checkbox" className="fin-check" checked={selected} onChange={onToggle}
          aria-label={t("review.select")} style={{ marginTop: 3 }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <span style={{ fontSize: "var(--fs-body)", color: "var(--text)" }}>
              {row.description || row.merchant || t("tx.noDescription")}
            </span>
            <FlagBadges flags={row.flags} />
          </div>
          <p style={{ marginTop: 2 }}>
            <span className="fin-caption">
              {row.booked_on ? formatDate(row.booked_on, locale) : t("review.noDate")}
              {" · "}
            </span>
            <SourceNote row={row} />
          </p>
        </div>
        <Amount minor={row.amount_minor} currency={currency} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <CategoryCell row={row} categories={categories} onCategory={onCategory} width={200} />
        <div style={{ marginLeft: "auto" }}>
          <RowButtons row={row} onEdit={onEdit} onKind={onKind} onDecision={onDecision} />
        </div>
      </div>
    </div>
  );
}

function EditRowSheet({ row, currency, units, locale, onClose, onSave }) {
  const { t } = useI18n();
  const [bookedOn, setBookedOn] = useState(row.booked_on ?? "");
  const [description, setDescription] = useState(row.description ?? "");
  const [amount, setAmount] = useState(
    row.amount_minor == null ? "" : toMajorString(row.amount_minor, units),
  );
  const [error, setError] = useState("");

  const submit = () => {
    const parsed = parseAmount(amount, units, locale);
    if (parsed === null || parsed === 0n) { setError(t("tx.errAmount")); return; }
    onSave({
      booked_on: bookedOn || null,
      description: description.trim() || null,
      amount_minor: parsed.toString(),
      // Correggere l'importo non disfa un trasferimento gia' confermato: il
      // verso lo decide il segno solo per i movimenti normali.
      kind: row.kind === "transfer" ? "transfer" : (parsed > 0n ? "income" : "expense"),
      // Una correzione a mano toglie i dubbi sulla lettura automatica.
      flags: (row.flags ?? []).filter(f => f !== "parse_warning" && f !== "date_ambiguous"),
    });
  };

  return (
    <Sheet
      variant="dialog"
      title={t("review.editRow")}
      onClose={onClose}
      footer={<>
        <Button variant="quiet" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit}>{t("common.save")}</Button>
      </>}
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label={t("tx.date")} htmlFor="r-date">
          <Input id="r-date" type="date" value={bookedOn} onChange={e => setBookedOn(e.target.value)} />
        </Field>
        <Field label={t("tx.description")} htmlFor="r-desc">
          <Input id="r-desc" value={description} onChange={e => setDescription(e.target.value)} />
        </Field>
        <Field label={`${t("tx.amount")} (${currency})`} htmlFor="r-amount" hint={t("review.amountSignHint")}>
          <AmountInput id="r-amount" value={amount} onChange={setAmount} currency={currency} />
        </Field>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  );
}
