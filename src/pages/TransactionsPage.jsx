// src/pages/TransactionsPage.jsx
// L'elenco dei movimenti, in due forme.
//
//   telefono  righe raggruppate per giorno, con "Oggi" e "Ieri" in testa
//   desktop   tabella densa, colonne ordinabili, selezione multipla
//
// I trasferimenti e gli acquisti di investimenti compaiono nell'elenco ma NON
// nei totali di entrate e uscite: spostare soldi fra due conti propri, o
// comprare un ETF, non e' ne' guadagnare ne' spendere.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { useAccounts } from "../hooks/useAccounts";
import { useCategories, categoryLabel } from "../hooks/useCategories";
import { useTransactions } from "../hooks/useTransactions";
import { useMerchantRules } from "../hooks/useImports";
import { useToast } from "../components/Toast";
import {
  Amount, Avatar, Badge, Button, Card, Chip, DataTable, DateRangePicker,
  EmptyState, Field, FilterBar, InlineAlert, ListRow, Page, PageHeader, RowGroup,
  SearchField, Select, Sheet, SkeletonRows, Stat, StatGrid, Toolbar,
} from "../ui";
import TransactionForm from "../components/TransactionForm";
import TransferForm from "../components/TransferForm";
import TransactionDetail from "../components/TransactionDetail";
import { Icon, ICON } from "../components/icons";
import { formatDate } from "../lib/format";
import { groupByDay } from "../lib/groupByDay";

const KINDS = ["income", "expense", "transfer", "investment"];
const EMPTY_FILTERS = { accountId: "", from: "", to: "", categoryId: "", kind: "", search: "" };

export default function TransactionsPage() {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const { isDesktop } = useBreakpoint();
  const toast = useToast();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const { accounts } = useAccounts({ includeArchived: true });
  const { categories } = useCategories({ includeArchived: true });
  const { rows, loading, error, hasMore, loadMore, create, update, remove, createTransfer } =
    useTransactions(filters);
  const { upsertFromCorrection, remove: removeRule } = useMerchantRules();

  const [editing, setEditing] = useState(null);      // null | "new" | row
  const [transfer, setTransfer] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [detail, setDetail] = useState(null);        // la riga aperta nel pannello
  const [selected, setSelected] = useState(() => new Set());
  const [sort, setSort] = useState({ key: "booked_on", dir: "desc" });

  const base = profile?.base_currency;
  const accountById = useMemo(
    () => Object.fromEntries((accounts ?? []).map(a => [a.account_id, a])), [accounts],
  );
  const categoryById = useMemo(
    () => Object.fromEntries((categories ?? []).map(c => [c.id, c])), [categories],
  );

  // Il guscio e la ricerca globale arrivano qui con dei parametri: ?new apre un
  // modulo, ?tx apre il dettaglio di un movimento.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const what = params.get("new");
    const txId = params.get("tx");
    if (!what && !txId) return;

    // eslint-disable-next-line react/set-state-in-effect
    if (what === "transfer") setTransfer(true);
    else if (what) setEditing("new");

    if (txId) {
      // Le righe possono non essere ancora arrivate: in quel caso si aspetta
      // il giro dopo invece di perdere il parametro.
      if (!rows) return;
      const row = rows.find(r => r.id === txId);
      if (row) setDetail(row);
    }
    setParams(prev => { prev.delete("new"); prev.delete("tx"); return prev; }, { replace: true });
  }, [params, setParams, rows]);

  // Drill-down dalle altre schermate (per esempio dalle Tasse): i filtri
  // possono arrivare nell'URL. Si applicano una volta e si puliscono, cosi'
  // l'indirizzo non resta pieno di parametri e i filtri restano modificabili.
  useEffect(() => {
    const keys = ["accountId", "from", "to", "categoryId", "kind"];
    const seed = {};
    for (const k of keys) { const v = params.get(k); if (v) seed[k] = v; }
    if (Object.keys(seed).length === 0) return;
    // eslint-disable-next-line react/set-state-in-effect
    setFilters(f => ({ ...f, ...seed }));
    setShowFilters(true);
    setParams(prev => { keys.forEach(k => prev.delete(k)); return prev; }, { replace: true });
  }, [params, setParams]);

  /**
   * Da una correzione nasce una regola, con l'avviso annullabile. Solo se la
   * categoria e' davvero cambiata e solo su un movimento con un commerciante
   * riconosciuto: su uno scritto a mano non c'e' niente da imparare.
   */
  const learnFromCorrection = async (before, values) => {
    const merchant = before?.merchant;
    const categoryId = values.category_id;
    if (!before || !merchant || !categoryId) return;
    if (before.category_id === categoryId) return;
    if (values.kind === "transfer" || values.kind === "investment") return;

    const res = await upsertFromCorrection(merchant, categoryId);
    if (!res.ok) return;
    toast.success(
      t("rules.created", { merchant }),
      { label: t("common.undo"), onAction: async () => { await removeRule(res.rule.id); toast.info(t("rules.undone")); } },
    );
  };

  const changeCategory = async (row, categoryId) => {
    const res = await update(row.id, { category_id: categoryId });
    if (!res.ok) { toast.error(res.error); return; }
    setDetail(d => (d?.id === row.id ? { ...d, category_id: categoryId } : d));
    await learnFromCorrection(row, { category_id: categoryId, kind: row.kind });
  };

  /**
   * Cambio di categoria su piu' righe insieme. Qui NON si creano regole: da
   * venti righe uscirebbero venti avvisi annullabili in fila, e nessuno
   * leggerebbe il ventesimo.
   */
  const bulkCategory = async (categoryId) => {
    const ids = [...selected];
    for (const id of ids) await update(id, { category_id: categoryId || null });
    setSelected(new Set());
    toast.success(t("tx.bulkDone", { count: ids.length }));
  };

  const totals = useMemo(() => {
    if (!rows) return null;
    let income = 0n, expense = 0n, missing = 0;
    for (const r of rows) {
      if (r.kind === "transfer" || r.kind === "investment") continue;
      if (r.amount_base_minor === null) { missing += 1; continue; }
      const v = BigInt(r.amount_base_minor);
      if (v > 0n) income += v; else expense += v;
    }
    return { income, expense, net: income + expense, missing };
  }, [rows]);

  // L'ordinamento agisce sulle righe GIA' caricate: il database le manda per
  // data decrescente, e "carica altri" ne aggiunge in fondo.
  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    const dir = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sort.key === "amount") {
        const av = BigInt(a.amount_base_minor ?? a.amount_minor ?? 0);
        const bv = BigInt(b.amount_base_minor ?? b.amount_minor ?? 0);
        return av === bv ? 0 : (av > bv ? dir : -dir);
      }
      return String(a[sort.key] ?? "").localeCompare(String(b[sort.key] ?? "")) * dir;
    });
    return list;
  }, [rows, sort]);

  const groups = useMemo(() => groupByDay(sorted), [sorted]);
  const activeFilters = Object.entries(filters).filter(([k, v]) => v && k !== "search").length;
  const filtered = activeFilters > 0 || !!filters.search;

  const labelOf = (r) =>
    r.description || r.merchant ||
    (r.kind === "transfer" || r.kind === "investment" ? t(`txKind.${r.kind}`) : t("tx.noDescription"));

  const subtitleOf = (r) => {
    if (r.kind === "transfer" || r.kind === "investment") return t(`txKind.${r.kind}`);
    const cat = categoryById[r.category_id];
    return cat ? categoryLabel(cat, t) : t("tx.noCategory");
  };

  return (
    <Page>
      <PageHeader
        title={t("tx.title")}
        actions={<>
          <Button onClick={() => setTransfer(true)} icon={<Icon.Transfer size={ICON.sm} />}>
            {t("transfer.title")}
          </Button>
          <Button variant="primary" onClick={() => setEditing("new")} icon={<Icon.Plus size={ICON.sm} />}>
            {t("tx.new")}
          </Button>
        </>}
      />

      {/* Totali del periodo: le tre cifre divise da fili, come un prospetto.
          L'avviso sui movimenti senza cambio sta sotto la cifra che falsa,
          non in fondo alla card dove non si capiva a quale si riferisse. */}
      <StatGrid>
        <Stat
          label={t("tx.totalIncome")}
          value={<Amount minor={totals?.income ?? 0n} currency={base} tone="in" variant="lg" />}
        />
        <Stat
          label={t("tx.totalExpense")}
          value={<Amount minor={totals?.expense ?? 0n} currency={base} tone="out" variant="lg" />}
        />
        <Stat
          label={t("tx.totalNet")}
          value={<Amount minor={totals?.net ?? 0n} currency={base} variant="lg" signDisplay="exceptZero" />}
          hint={totals?.missing > 0 ? t("tx.totalsMissing", { count: totals.missing }) : undefined}
          tone={totals?.missing > 0 ? "var(--warning)" : undefined}
        />
      </StatGrid>

      {/* ── filtri ── */}
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        <Toolbar end={
          <Button onClick={() => setShowFilters(true)} icon={<Icon.Filters size={ICON.sm} />}>
            {activeFilters > 0 ? `${t("tx.filters")} ${activeFilters}` : t("tx.filters")}
          </Button>
        }>
          <div style={{ flex: 1, minWidth: 200 }}>
            <SearchField
              value={filters.search}
              onChange={v => setFilters(f => ({ ...f, search: v }))}
              placeholder={t("tx.searchPlaceholder")}
            />
          </div>
        </Toolbar>

        <FilterBar>
          <Chip on={!filters.kind} onClick={() => setFilters(f => ({ ...f, kind: "" }))}>
            {t("tx.allKinds")}
          </Chip>
          {KINDS.map(k => (
            <Chip key={k} on={filters.kind === k} onClick={() => setFilters(f => ({ ...f, kind: k }))}>
              {t(`txKind.${k}`)}
            </Chip>
          ))}
          {activeFilters > 0 && (
            <Chip onClick={() => setFilters({ ...EMPTY_FILTERS, search: filters.search })}>
              <Icon.Close size={ICON.inline} aria-hidden="true" /> {t("tx.clearFilters")}
            </Chip>
          )}
        </FilterBar>
      </div>

      {/* ── azioni in blocco ───────────────────────────────────────────── */}
      {selected.size > 0 && (
        <FilterBar end={
          <Button variant="quiet" size="sm" onClick={() => setSelected(new Set())}>
            {t("tx.clearSelection")}
          </Button>
        }>
          <span className="fin-eyebrow">{t("tx.selected", { count: selected.size })}</span>
          <Select
            value=""
            onChange={e => bulkCategory(e.target.value)}
            aria-label={t("tx.bulkCategory")}
            style={{ width: "auto", height: "var(--control-h-sm)" }}
          >
            <option value="">{t("tx.bulkCategory")}</option>
            {(categories ?? []).map(c => (
              <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>
            ))}
          </Select>
        </FilterBar>
      )}

      {/* ── elenco ─────────────────────────────────────────────────────── */}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {loading && <Card flush><SkeletonRows rows={6} /></Card>}

      {!loading && sorted.length === 0 && (
        <Card>
          <EmptyState
            icon={<Icon.Transactions size={ICON.lg} />}
            title={filtered ? t("tx.noneFiltered") : t("home.noTxTitle")}
            body={filtered ? t("tx.noneFilteredBody") : t("home.noTxBody")}
            action={filtered
              ? <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>{t("tx.clearFilters")}</Button>
              : <Button variant="primary" onClick={() => setEditing("new")}>{t("tx.new")}</Button>}
          />
        </Card>
      )}

      {!loading && sorted.length > 0 && (isDesktop ? (
        <Card flush>
          <DataTable
            columns={[
              {
                key: "booked_on", header: t("tx.date"), sortable: true, width: 130,
                render: r => formatDate(r.booked_on, lang),
              },
              {
                key: "description", header: t("tx.description"), sortable: true,
                render: r => (
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <Avatar name={labelOf(r)} colorKey={r.category_id ?? r.merchant ?? labelOf(r)} size="sm" />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{labelOf(r)}</span>
                    {r.fx_override_rate && <Badge tone="var(--warning)">{t("fx.manual")}</Badge>}
                    {r.amount_base_minor === null && r.currency?.trim() !== base && (
                      <Badge tone="var(--negative)">{t("fx.missing")}</Badge>
                    )}
                  </span>
                ),
              },
              { key: "category", header: t("tx.category"), render: r => subtitleOf(r) },
              { key: "account", header: t("tx.account"), render: r => accountById[r.account_id]?.name ?? "—" },
              {
                key: "amount", header: t("tx.amount"), align: "right", sortable: true,
                render: r => (
                  <>
                    <Amount minor={r.amount_minor} currency={r.currency?.trim()} />
                    {base && r.currency?.trim() !== base && (
                      <div>
                        <Amount minor={r.amount_base_minor} currency={base} tone="muted" variant="sm" />
                      </div>
                    )}
                  </>
                ),
              },
            ]}
            rows={sorted}
            sort={sort}
            onSort={key => setSort(s => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}
            selected={selected}
            onToggle={id => setSelected(prev => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
            onToggleAll={() => setSelected(s =>
              s.size === sorted.length ? new Set() : new Set(sorted.map(r => r.id)))}
            onRowClick={setDetail}
          />
        </Card>
      ) : (
        <Card flush>
          {groups.map(group => (
            <div key={group.key}>
              <RowGroup>
                {group.label ? t(`home.${group.label}`) : formatDate(group.key, lang)}
              </RowGroup>
              {group.rows.map(r => (
                <ListRow
                  key={r.id}
                  as="button"
                  onClick={() => setDetail(r)}
                  avatar={<Avatar name={labelOf(r)} colorKey={r.category_id ?? r.merchant ?? labelOf(r)} />}
                  title={labelOf(r)}
                  subtitle={subtitleOf(r)}
                  end={<Amount minor={r.amount_minor} currency={r.currency?.trim()} />}
                  endSub={base && r.currency?.trim() !== base
                    ? <Amount minor={r.amount_base_minor} currency={base} tone="muted" variant="sm" />
                    : undefined}
                />
              ))}
            </div>
          ))}
        </Card>
      ))}

      {hasMore && (
        <Button variant="secondary" block onClick={loadMore}>{t("tx.loadMore")}</Button>
      )}

      {/* ── pannelli ───────────────────────────────────────────────────── */}
      {showFilters && (
        <Sheet
          title={t("tx.filters")}
          onClose={() => setShowFilters(false)}
          footer={<>
            <Button variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>{t("tx.clearFilters")}</Button>
            <Button variant="primary" onClick={() => setShowFilters(false)}>{t("common.close")}</Button>
          </>}
        >
          <div style={{ display: "grid", gap: "var(--space-5)" }}>
            <Field label={t("tx.account")} htmlFor="f-acc">
              <Select id="f-acc" value={filters.accountId}
                      onChange={e => setFilters(f => ({ ...f, accountId: e.target.value }))}>
                <option value="">{t("tx.allAccounts")}</option>
                {(accounts ?? []).map(a => (
                  <option key={a.account_id} value={a.account_id}>{a.name}</option>
                ))}
              </Select>
            </Field>

            <Field label={t("tx.category")} htmlFor="f-cat">
              <Select id="f-cat" value={filters.categoryId}
                      onChange={e => setFilters(f => ({ ...f, categoryId: e.target.value }))}>
                <option value="">{t("tx.allCategories")}</option>
                {(categories ?? []).map(c => (
                  <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>
                ))}
              </Select>
            </Field>

            <DateRangePicker
              from={filters.from}
              to={filters.to}
              onChange={({ from, to }) => setFilters(f => ({ ...f, from, to }))}
              idPrefix="f"
            />
          </div>
        </Sheet>
      )}

      {detail && (
        <TransactionDetail
          tx={detail}
          account={accountById[detail.account_id]}
          onClose={() => setDetail(null)}
          onEdit={row => { setDetail(null); setEditing(row); }}
          onDelete={row => { setDetail(null); setDeleting(row); }}
          onCategoryChange={changeCategory}
        />
      )}

      {editing && (
        <TransactionForm
          tx={editing === "new" ? null : editing}
          accounts={accounts ?? []}
          categories={categories ?? []}
          onClose={() => setEditing(null)}
          onSave={async (values, id) => {
            const before = editing === "new" ? null : editing;
            const res = id ? await update(id, values) : await create(values);
            if (!res.ok) { toast.error(res.error); return false; }
            toast.success(t("common.saved"));
            setEditing(null);
            await learnFromCorrection(before, values);
            return true;
          }}
        />
      )}

      {transfer && (
        <TransferForm
          accounts={accounts ?? []}
          onClose={() => setTransfer(false)}
          onSave={async (args) => {
            const res = await createTransfer(args);
            if (!res.ok) { toast.error(res.error); return false; }
            toast.success(t("common.saved"));
            setTransfer(false);
            return true;
          }}
        />
      )}

      {deleting && (
        <Sheet
          variant="dialog"
          title={t("tx.deleteTitle")}
          onClose={() => setDeleting(null)}
          footer={<>
            <Button variant="quiet" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const res = await remove(deleting);
                if (!res.ok) toast.error(res.error);
                else toast.success(t("tx.deleted"));
                setDeleting(null);
              }}
            >{t("common.delete")}</Button>
          </>}
        >
          <p className="fin-muted">
            {deleting.transfer_group_id ? t("tx.deleteTransferBody") : t("tx.deleteBody")}
          </p>
        </Sheet>
      )}
    </Page>
  );
}
