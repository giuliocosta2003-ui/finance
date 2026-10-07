// src/pages/HomePage.jsx
// La prima schermata: quanto ho, cosa e' entrato e uscito, dove sta, cosa e'
// successo di recente.
//
// L'ordine e' quello di un prospetto bancario, non di un cruscotto. In cima il
// patrimonio in grande, perche' e' l'unica cosa che quasi tutti guardano
// aprendo l'app; subito sotto, sulla stessa fascia, le quattro cifre del mese
// (entrate, uscite, risparmio, investito) divise da fili invece che sparse in
// riquadri staccati: cosi' si leggono come una riga di totali, e i numeri
// restano incolonnati. Poi le azioni rapide, i movimenti, i conti e le spese.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useAccounts } from "../hooks/useAccounts";
import { useTransactions } from "../hooks/useTransactions";
import { usePositions } from "../hooks/useInvestments";
import { useCategories, categoryLabel } from "../hooks/useCategories";
import {
  Amount, Avatar, Button, Card, CardHeader, CardTitle, EmptyState, InlineAlert,
  ListRow, Page, QuickAction, RowGroup, Skeleton, SkeletonRows, Stat, StatGrid,
} from "../ui";
import { Icon, ICON } from "../components/icons";
import { categoryColor } from "../theme/tokens";
import { formatDate, formatPercent } from "../lib/format";
import { groupByDay, periodFlows, spendingByCategory } from "../lib/groupByDay";
import { CREATE_ACTIONS } from "../components/nav";

const RECENT = 8;

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

export default function HomePage() {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const base = profile?.base_currency;

  const { accounts, loading: loadingAccounts } = useAccounts();
  const { rows: recent, loading: loadingTx } = useTransactions({});
  const { rows: monthRows } = useTransactions({ from: firstOfMonth() });
  const { positions } = usePositions();
  const { categories } = useCategories({ includeArchived: true });

  const categoryById = useMemo(
    () => Object.fromEntries((categories ?? []).map(c => [c.id, c])), [categories],
  );

  /**
   * Patrimonio = saldi dei conti + valore degli investimenti, in valuta base.
   * I conti senza tasso di cambio restano fuori e si dichiarano: sommarli a
   * zero direbbe che quel conto e' vuoto, che e' falso.
   */
  const wealth = useMemo(() => {
    let cash = 0n, invested = 0n, missing = 0;
    for (const a of accounts ?? []) {
      if (a.balance_base_minor === null) { missing += 1; continue; }
      cash += BigInt(a.balance_base_minor);
    }
    for (const p of positions ?? []) {
      if (Number(p.quantity) > 0 && p.value_base_minor !== null) invested += BigInt(p.value_base_minor);
    }
    return { cash, invested, total: cash + invested, missing };
  }, [accounts, positions]);

  const flows = useMemo(() => periodFlows(monthRows), [monthRows]);
  const spending = useMemo(() => spendingByCategory(monthRows), [monthRows]);
  const groups = useMemo(() => groupByDay((recent ?? []).slice(0, RECENT)), [recent]);

  // Quota risparmiata: ha senso solo se in questo mese e' entrato qualcosa.
  // Su entrate a zero sarebbe una divisione per zero travestita da "0%".
  const savedRate = flows.income > 0n
    ? Number((flows.saved * 1000n) / flows.income) / 1000
    : null;

  const firstName = (profile?.full_name ?? "").trim().split(/\s+/)[0];

  return (
    <Page className="fin-home">
      {/* ── patrimonio e cifre del mese ─────────────────────────────────── */}
      <Card flush className="fin-home__wide">
        <div className="fin-card__body">
          <p className="fin-caption">{formatDate(new Date(), lang, { dateStyle: "full" })}</p>
          <p className="fin-muted" style={{ marginTop: "var(--space-0-5)" }}>
            {firstName ? t("home.greeting", { name: firstName }) : t("home.greetingNoName")}
          </p>

          <div style={{ marginTop: "var(--space-4)" }}>
            <CardTitle>{t("home.wealth")}</CardTitle>
            <div style={{ marginTop: "var(--space-1)" }}>
              {loadingAccounts
                ? <Skeleton width={260} height={38} />
                : <Amount minor={wealth.total} currency={base} variant="hero" tone="neutral" />}
            </div>
            {/* Liquidita' e investito sono la COMPOSIZIONE del patrimonio, non
                un flusso del mese: stanno attaccati al totale che compongono,
                non nella riga sotto insieme a entrate e uscite. */}
            <p className="fin-caption" style={{ marginTop: "var(--space-2)" }}>
              {t("home.wealthSplit")}{" "}
              <Amount minor={wealth.cash} currency={base} tone="muted" variant="sm" />
            </p>
          </div>
        </div>

        {/* Le cifre del mese, divise da fili: e' una riga di totali, non
            riquadri che galleggiano. Sono QUATTRO e non cinque di proposito —
            quattro si dividono in due colonne sul telefono e in quattro su
            desktop senza lasciare mai una cella spaiata in fondo. */}
        <StatGrid style={{ border: "none", borderTop: "1px solid var(--border)", borderRadius: 0 }}>
          <Stat
            label={t("home.monthIncome")}
            value={<Amount minor={flows.income} currency={base} tone="in" variant="lg" signDisplay="exceptZero" />}
          />
          <Stat
            label={t("home.monthExpenses")}
            value={<Amount minor={-flows.expenses} currency={base} tone="out" variant="lg" />}
          />
          <Stat
            label={t("home.monthSaved")}
            value={<Amount minor={flows.saved} currency={base} variant="lg" signDisplay="exceptZero" />}
            hint={savedRate === null
              ? undefined
              : t("home.savedRate", { pct: formatPercent(savedRate, lang, { maximumFractionDigits: 0 }) })}
          />
          {/* Investito, non "spese del mese": quello sarebbe lo STESSO numero
              delle uscite qui accanto — periodFlows e spendingByCategory
              sommano entrambi le righe negative escludendo trasferimenti e
              investimenti. Due celle con la stessa cifra sotto due etichette
              diverse fanno dubitare di tutte e due. */}
          <Stat
            label={t("home.wealthInvested")}
            value={<Amount minor={wealth.invested} currency={base} tone="neutral" variant="lg" />}
          />
        </StatGrid>

        {wealth.missing > 0 && (
          <div className="fin-card__body" style={{ paddingTop: 0 }}>
            <InlineAlert tone="warning">{t("home.wealthMissing", { count: wealth.missing })}</InlineAlert>
          </div>
        )}

        <div className="fin-card__body" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="fin-quickrow">
            {/* Etichette corte: dentro un riquadro da 132 px "Nuovo movimento"
                andrebbe a capo. Nel foglio del "+" restano per esteso, perche'
                li' c'e' spazio e servono a spiegare. */}
            {CREATE_ACTIONS.map(({ key, to, icon: ActionIcon, shortKey, labelKey }, i) => (
              <QuickAction
                key={key}
                as={Link}
                to={to}
                accent={i === 0}
                icon={<ActionIcon size={ICON.md} />}
                label={t(shortKey ?? labelKey)}
              />
            ))}
          </div>
        </div>
      </Card>

      {/* ── movimenti recenti ──────────────────────────────────────────── */}
      <Card flush>
        <CardHeader actions={<Button as={Link} variant="ghost" size="sm" to="/transactions">{t("home.seeAll")}</Button>}>
          <CardTitle>{t("home.recent")}</CardTitle>
        </CardHeader>

        {loadingTx && <SkeletonRows rows={5} />}

        {!loadingTx && groups.length === 0 && (
          <EmptyState
            icon={<Icon.Transactions size={ICON.lg} />}
            title={t("home.noTxTitle")}
            body={t("home.noTxBody")}
            action={<Link to="/imports?new=1" className="fin-btn fin-btn--primary">{t("create.import")}</Link>}
          />
        )}

        {groups.map(group => (
          <div key={group.key}>
            <RowGroup>
              {group.label ? t(`home.${group.label}`) : formatDate(group.key, lang)}
            </RowGroup>
            {group.rows.map(r => {
              const label = r.description || r.merchant || t("tx.noDescription");
              const cat = categoryById[r.category_id];
              return (
                <ListRow
                  key={r.id}
                  as={Link}
                  to={`/transactions?tx=${r.id}`}
                  avatar={<Avatar name={label} colorKey={r.category_id ?? r.merchant ?? label} />}
                  title={label}
                  subtitle={r.kind === "transfer"
                    ? t("transfer.title")
                    : cat ? categoryLabel(cat, t) : t("tx.noCategory")}
                  end={<Amount minor={r.amount_minor} currency={r.currency?.trim()} />}
                  endSub={base && r.currency?.trim() !== base && r.amount_base_minor !== null
                    ? <Amount minor={r.amount_base_minor} currency={base} tone="muted" variant="sm" />
                    : undefined}
                />
              );
            })}
          </div>
        ))}
      </Card>

      {/* ── colonna stretta: conti, spese, investimenti ────────────────── */}
      <div style={{ display: "grid", gap: "var(--space-5)", alignContent: "start" }}>
        <AccountsCard accounts={accounts} loading={loadingAccounts} base={base} />
        <SpendingCard spending={spending} categoryById={categoryById} base={base} />
        <InvestmentsCard positions={positions} invested={wealth.invested} base={base} />
      </div>
    </Page>
  );
}

/** I conti, come striscia di riquadri col saldo. */
function AccountsCard({ accounts, loading, base }) {
  const { t } = useI18n();

  return (
    <div>
      <div className="fin-toolbar" style={{ marginBottom: "var(--space-2)" }}>
        <CardTitle>{t("nav.accounts")}</CardTitle>
        <div className="fin-toolbar__end">
          <Button as={Link} variant="ghost" size="sm" to="/accounts">{t("home.seeAll")}</Button>
        </div>
      </div>

      {loading ? (
        <div className="fin-accounts">
          {[0, 1].map(i => <Card key={i}><Skeleton height={48} /></Card>)}
        </div>
      ) : accounts?.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon.Accounts size={ICON.lg} />}
            title={t("accounts.emptyTitle")}
            body={t("accounts.emptyBody")}
            action={<Link to="/accounts" className="fin-btn fin-btn--primary">{t("accounts.new")}</Link>}
          />
        </Card>
      ) : (
        <div className="fin-accounts">
          {accounts.map(a => (
            <Link
              key={a.account_id}
              to="/accounts"
              className="fin-card fin-card--interactive"
              style={{ textDecoration: "none", display: "block" }}
            >
              <p className="fin-caption" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.name}
              </p>
              <div style={{ marginTop: "var(--space-1)" }}>
                <Amount minor={a.balance_minor} currency={a.currency?.trim()} tone="neutral" variant="lg" />
              </div>
              {base && a.currency?.trim() !== base && (
                <p style={{ marginTop: 2 }}>
                  <Amount minor={a.balance_base_minor} currency={base} tone="muted" variant="sm" />
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Spese del mese per categoria, a barre: le prime cinque piu' il resto. */
function SpendingCard({ spending, categoryById, base }) {
  const { t } = useI18n();
  const top = spending.rows.slice(0, 5);
  const rest = spending.rows.slice(5).reduce((acc, r) => acc + r.minor, 0n);

  return (
    <Card flush>
      <CardHeader actions={<Amount minor={-spending.total} currency={base} tone="out" variant="lg" />}>
        <CardTitle>{t("home.monthSpending")}</CardTitle>
      </CardHeader>

      <div className="fin-card__body">
        {spending.rows.length === 0 ? (
          <p className="fin-caption">{t("home.noSpending")}</p>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {top.map(r => {
              const cat = categoryById[r.categoryId];
              const pct = spending.total > 0n
                ? Number((r.minor * 1000n) / spending.total) / 10
                : 0;
              return (
                <div key={r.categoryId}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", marginBottom: 4 }}>
                    <span className="fin-caption" style={{ color: "var(--text)" }}>
                      {cat ? categoryLabel(cat, t) : t("tx.noCategory")}
                    </span>
                    <span style={{ marginLeft: "auto" }}>
                      <Amount minor={r.minor} currency={base} tone="neutral" variant="sm" />
                    </span>
                  </div>
                  <div className="fin-bar">
                    <div
                      className="fin-bar__fill"
                      style={{ width: `${Math.max(pct, 2)}%`, background: categoryColor(r.categoryId) }}
                    />
                  </div>
                </div>
              );
            })}
            {rest > 0n && (
              <p className="fin-caption">
                {t("home.otherCategories", { count: spending.rows.length - top.length })}{" "}
                <Amount minor={rest} currency={base} tone="muted" variant="sm" />
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Investito e plusvalenza non realizzata. Compare solo se c'e' qualcosa. */
function InvestmentsCard({ positions, invested, base }) {
  const { t } = useI18n();
  if (!(positions ?? []).some(p => Number(p.quantity) > 0)) return null;

  const unrealized = (positions ?? [])
    .reduce((acc, p) => acc + BigInt(p.unrealized_pl_base_minor ?? 0), 0n);

  return (
    <Card flush>
      <CardHeader actions={<Button as={Link} variant="ghost" size="sm" to="/investments">{t("home.seeAll")}</Button>}>
        <CardTitle>{t("nav.investments")}</CardTitle>
      </CardHeader>
      <StatGrid style={{ border: "none", borderRadius: 0 }}>
        <Stat
          label={t("home.wealthInvested")}
          value={<Amount minor={invested} currency={base} tone="neutral" variant="lg" />}
        />
        <Stat
          label={t("home.unrealized")}
          value={<Amount minor={unrealized} currency={base} variant="lg" signDisplay="exceptZero" />}
        />
      </StatGrid>
    </Card>
  );
}
