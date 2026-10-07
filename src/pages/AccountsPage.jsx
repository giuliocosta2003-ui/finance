// src/pages/AccountsPage.jsx
// Elenco dei conti con saldo nella loro valuta e in valuta base.
// Il totale ha senso solo in valuta base: sommare euro e dong non significa
// niente, quindi quando l'interruttore e' su "valuta originale" il totale
// sparisce invece di mostrare un numero falso.
import { useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { useCurrencies } from "../contexts/CurrenciesContext";
import { useAccounts } from "../hooks/useAccounts";
import { useLocalPreference } from "../hooks/useLocalPreference";
import { useToast } from "../components/Toast";
import {
  Amount, Badge, Button, Card, Checkbox, EmptyState, Field, IconButton,
  InlineAlert, Input, Page, PageHeader, SegmentedControl, Select, Sheet, SkeletonRows,
} from "../ui";
import AmountInput from "../components/AmountInput";
import { Icon, ICON } from "../components/icons";
import { parseAmount, toMajorString } from "../lib/money";
import { formatDate } from "../lib/format";

const ACCOUNT_TYPES = ["checking", "savings", "cash", "credit_card", "e_wallet", "broker", "other"];

export default function AccountsPage() {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const { minorUnits, codes, byCode } = useCurrencies();
  const toast = useToast();

  const [showArchived, setShowArchived] = useLocalPreference("finance_accounts_archived", false);
  const [totalsIn, setTotalsIn] = useLocalPreference("finance_totals_currency", "base");
  const { accounts, loading, error, create, update, setArchived } = useAccounts({ includeArchived: showArchived });
  const [editing, setEditing] = useState(null); // null | "new" | account

  const base = profile?.base_currency;

  const total = useMemo(() => {
    if (!accounts) return null;
    let sum = 0n;
    let missing = 0;
    for (const a of accounts) {
      if (a.archived_at) continue;
      if (a.balance_base_minor === null) { missing += 1; continue; }
      sum += BigInt(a.balance_base_minor);
    }
    return { sum, missing };
  }, [accounts]);

  return (
    <Page>
      <PageHeader
        title={t("accounts.title")}
        actions={
          <Button variant="primary" onClick={() => setEditing("new")} icon={<Icon.Plus size={ICON.sm} />}>
            {t("accounts.new")}
          </Button>
        }
      />

      {/* Totale */}
      <Card flush>
        <div className="fin-card__head">
          <p className="fin-card__title">{t("accounts.total")}</p>
          <div style={{ marginLeft: "auto" }}>
            <SegmentedControl
              label={t("totals.switchHint")}
              value={totalsIn}
              onChange={setTotalsIn}
              options={[
                { value: "base", label: base ?? "—" },
                { value: "original", label: t("totals.inOriginal") },
              ]}
            />
          </div>
        </div>
        <div className="fin-card__body">
          {totalsIn === "base" ? (
            <>
              <Amount minor={total?.sum ?? 0n} currency={base} variant="hero" tone="neutral" />
              {total?.missing > 0 && (
                <div style={{ marginTop: "var(--space-3)" }}>
                  <InlineAlert tone="warning">{t("accounts.totalMissing", { count: total.missing })}</InlineAlert>
                </div>
              )}
            </>
          ) : (
            <p className="fin-hint">{t("totals.noMixedTotal")}</p>
          )}
        </div>
      </Card>

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      <Card flush>
        {loading && <SkeletonRows rows={4} />}

        {!loading && accounts?.length === 0 && (
          <EmptyState
            icon={<Icon.Accounts size={ICON.lg} />}
            title={t("accounts.emptyTitle")}
            body={t("accounts.emptyBody")}
            action={<Button variant="primary" onClick={() => setEditing("new")}>{t("accounts.new")}</Button>}
          />
        )}

        {accounts?.map(a => (
          <AccountRow
            key={a.account_id}
            account={a}
            base={base}
            showBase={totalsIn === "base"}
            onEdit={() => setEditing(a)}
            onArchive={async () => {
              const res = await setArchived(a.account_id, !a.archived_at);
              if (res.ok) toast.success(t("common.saved"));
              else toast.error(res.error);
            }}
          />
        ))}
      </Card>

      <Checkbox
        checked={showArchived}
        onChange={setShowArchived}
        label={t("accounts.showArchived")}
      />

      {editing && (
        <AccountForm
          account={editing === "new" ? null : editing}
          currencyCodes={codes}
          currencyNames={byCode}
          defaultCurrency={base}
          minorUnits={minorUnits}
          locale={lang}
          onClose={() => setEditing(null)}
          onSave={async (values, id) => {
            const res = id ? await update(id, values) : await create(values);
            if (!res.ok) { toast.error(res.error); return false; }
            toast.success(t("common.saved"));
            setEditing(null);
            return true;
          }}
        />
      )}
    </Page>
  );
}

/**
 * Una riga di conto, non una card: in un elenco di saldi le righe divise da
 * fili si scorrono con l'occhio molto meglio di riquadri staccati, e i numeri
 * a destra restano incolonnati.
 */
function AccountRow({ account, base, showBase, onEdit, onArchive }) {
  const { t, lang } = useI18n();
  const archived = !!account.archived_at;
  const differentCurrency = account.currency?.trim() !== base;

  return (
    <div className="fin-row" style={{ opacity: archived ? 0.6 : 1 }}>
      <div className="fin-row__body">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span className="fin-row__title">{account.name}</span>
          {archived && <Badge>{t("accounts.archived")}</Badge>}
        </div>
        <span className="fin-row__subtitle">
          {t(`accountType.${account.type}`)} · {account.currency?.trim()}
        </span>
      </div>

      <div className="fin-row__end">
        <Amount minor={account.balance_minor} currency={account.currency?.trim()} tone="neutral" />
        {showBase && differentCurrency && (
          account.balance_base_minor === null
            ? <Badge tone="var(--negative)">{t("fx.missing")}</Badge>
            : <span
                className="fin-row__subtitle"
                title={account.fx_rate_date ? t("fx.rateOf", { date: formatDate(account.fx_rate_date, lang) }) : undefined}
              >
                ≈ <Amount minor={account.balance_base_minor} currency={base} tone="muted" variant="sm" />
              </span>
        )}
      </div>

      <div style={{ display: "flex", gap: "var(--space-1)", flex: "0 0 auto" }}>
        <IconButton onClick={onEdit} label={t("common.edit")} icon={<Icon.Edit size={ICON.sm} />} />
        <IconButton
          onClick={onArchive}
          label={archived ? t("accounts.unarchive") : t("accounts.archive")}
          icon={archived ? <Icon.Unarchive size={ICON.sm} /> : <Icon.Archive size={ICON.sm} />}
        />
      </div>
    </div>
  );
}

function AccountForm({ account, currencyCodes, currencyNames, defaultCurrency, minorUnits, locale, onClose, onSave }) {
  const { t } = useI18n();
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState(account?.type ?? "checking");
  const [currency, setCurrency] = useState(account?.currency?.trim() ?? defaultCurrency ?? "EUR");
  const [opening, setOpening] = useState(
    account ? toMajorString(account.opening_balance_minor ?? 0, minorUnits(account.currency?.trim())) : "",
  );
  const [openingDate, setOpeningDate] = useState(account?.opening_date ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // La valuta si blocca appena il conto ha movimenti: cambiarla
  // reinterpreterebbe importi gia' registrati. Lo impone anche il database.
  const currencyLocked = !!account && (account.tx_count ?? 0) > 0;

  const submit = async () => {
    if (!name.trim()) { setError(t("accounts.errName")); return; }
    const parsedOpening = opening.trim() ? parseAmount(opening, minorUnits(currency), locale) : 0n;
    if (parsedOpening === null) { setError(t("tx.amountNotUnderstood")); return; }
    setBusy(true);
    const values = {
      name: name.trim(),
      type,
      opening_balance_minor: parsedOpening.toString(),
      opening_date: openingDate || null,
    };
    if (!currencyLocked) values.currency = currency;
    const ok = await onSave(values, account?.account_id);
    if (!ok) setBusy(false);
  };

  return (
    <Sheet
      variant="dialog"
      title={account ? t("accounts.edit") : t("accounts.new")}
      onClose={onClose}
      footer={<>
        <Button variant="quiet" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </>}
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label={t("accounts.name")} htmlFor="acc-name">
          <Input
            id="acc-name" value={name} autoFocus
            onChange={e => setName(e.target.value)}
            placeholder={t("accounts.namePlaceholder")}
          />
        </Field>

        <Field label={t("accounts.type")} htmlFor="acc-type">
          <Select id="acc-type" value={type} onChange={e => setType(e.target.value)}>
            {ACCOUNT_TYPES.map(k => <option key={k} value={k}>{t(`accountType.${k}`)}</option>)}
          </Select>
        </Field>

        <Field
          label={t("accounts.currency")}
          htmlFor="acc-cur"
          hint={currencyLocked ? t("accounts.currencyLocked") : undefined}
        >
          <Select
            id="acc-cur" value={currency} disabled={currencyLocked}
            onChange={e => setCurrency(e.target.value)}
          >
            {currencyCodes.map(c => (
              <option key={c} value={c}>{c} — {currencyNames?.[c]?.name ?? c}</option>
            ))}
          </Select>
        </Field>

        <Field label={t("accounts.openingBalance")} htmlFor="acc-open">
          <AmountInput id="acc-open" value={opening} onChange={setOpening} currency={currency} />
        </Field>

        <Field label={t("accounts.openingDate")} htmlFor="acc-date">
          <Input id="acc-date" type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} />
        </Field>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  );
}
