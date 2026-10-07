// src/pages/RulesPage.jsx
// Impostazioni > Regole. Ogni volta che correggi la categoria di un
// commerciante nasce una regola: qui si vedono tutte, con quante volte hanno
// funzionato, e si possono cambiare o togliere.
//
// Niente espressioni regolari: tre modi di confronto (esatto, inizia con,
// contiene). Un'espressione scritta male puo' bloccare il database, e in
// cambio darebbe un potere che qui non serve a nessuno.
import { useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useCategories, categoryLabel } from "../hooks/useCategories";
import { useMerchantRules } from "../hooks/useImports";
import { useToast } from "../components/Toast";
import {
  Button, Card, EmptyState, Field, IconButton, InlineAlert, Input,
  Page, PageHeader, Select, Sheet, SkeletonRows,
} from "../ui";
import { Icon, ICON } from "../components/icons";
import { formatDate } from "../lib/format";
import { normalizeMerchant } from "../lib/merchant";

const MATCH_TYPES = ["exact", "starts_with", "contains"];

/** Il pattern e' un dato tecnico: monospazio su fondo incassato lo dichiara. */
const patternStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-body-sm)",
  color: "var(--text)",
  background: "var(--surface-sunken)",
  border: "1px solid var(--border)",
  padding: "1px var(--space-2)",
  borderRadius: "var(--radius-control)",
};

export default function RulesPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { rules, loading, error, create, update, remove } = useMerchantRules();
  const { categories } = useCategories({ includeArchived: true });
  const [editing, setEditing] = useState(null);

  const categoryById = Object.fromEntries((categories ?? []).map(c => [c.id, c]));

  return (
    <Page>
      <PageHeader
        backTo="/settings"
        backLabel={t("settings.title")}
        title={t("rules.title")}
        subtitle={t("rules.intro")}
        actions={
          <Button variant="primary" onClick={() => setEditing("new")} icon={<Icon.Plus size={ICON.sm} />}>
            {t("rules.new")}
          </Button>
        }
      />

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      <Card flush>
        {loading && <SkeletonRows rows={4} />}

        {!loading && rules?.length === 0 && (
          <EmptyState
            icon={<Icon.Filters size={ICON.lg} />}
            title={t("rules.emptyTitle")}
            body={t("rules.emptyBody")}
          />
        )}

        {rules?.map(rule => (
          <div key={rule.id} className="fin-row">
            <div className="fin-row__body">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <code style={patternStyle}>{rule.pattern}</code>
                <span className="fin-caption">{t(`rules.match.${rule.match_type}`)}</span>
                <Icon.Right size={ICON.inline} style={{ color: "var(--text-tertiary)" }} aria-hidden="true" />
                <span style={{ fontSize: "var(--fs-body)", fontWeight: "var(--fw-semibold)" }}>
                  {categoryLabel(categoryById[rule.category_id], t) || "—"}
                </span>
              </div>
              <span className="fin-row__subtitle">
                {t("rules.hits", { count: rule.hits ?? 0 })}
                {rule.last_used_at ? ` · ${formatDate(rule.last_used_at, lang)}` : ""}
                {" · "}{t(`rules.origin.${rule.created_from}`)}
                {" · "}{t("rules.priority")}: {rule.priority}
              </span>
            </div>

            <div style={{ display: "flex", gap: "var(--space-1)", flex: "0 0 auto" }}>
              <IconButton
                onClick={() => update(rule.id, { priority: rule.priority + 10 })}
                label={t("rules.raise")} icon={<Icon.Up size={ICON.sm} />}
              />
              <IconButton
                onClick={() => update(rule.id, { priority: Math.max(0, rule.priority - 10) })}
                label={t("rules.lower")} icon={<Icon.Down size={ICON.sm} />}
              />
              <IconButton onClick={() => setEditing(rule)} label={t("common.edit")} icon={<Icon.Edit size={ICON.sm} />} />
              <IconButton
                tone="danger"
                onClick={async () => {
                  const res = await remove(rule.id);
                  if (res.ok) toast.success(t("rules.deleted"));
                  else toast.error(res.error);
                }}
                label={t("common.delete")} icon={<Icon.Delete size={ICON.sm} />}
              />
            </div>
          </div>
        ))}
      </Card>

      {editing && (
        <RuleForm
          rule={editing === "new" ? null : editing}
          categories={(categories ?? []).filter(c => !c.archived_at)}
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

function RuleForm({ rule, categories, onClose, onSave }) {
  const { t } = useI18n();
  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const [matchType, setMatchType] = useState(rule?.match_type ?? "contains");
  const [categoryId, setCategoryId] = useState(rule?.category_id ?? categories[0]?.id ?? "");
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Il pattern si normalizza come i commercianti: altrimenti una regola
  // scritta "Esselunga MILANO" non scatterebbe mai su "esselunga milano".
  const normalized = normalizeMerchant(pattern);

  const submit = async () => {
    if (!normalized) { setError(t("rules.errPattern")); return; }
    if (!categoryId) { setError(t("rules.errCategory")); return; }
    setBusy(true);
    const ok = await onSave({
      pattern: normalized,
      match_type: matchType,
      category_id: categoryId,
      priority: Number(priority) || 100,
      created_from: "manual",
    }, rule?.id);
    if (!ok) setBusy(false);
  };

  return (
    <Sheet
      variant="dialog"
      title={rule ? t("rules.edit") : t("rules.new")}
      onClose={onClose}
      footer={<>
        <Button variant="quiet" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </>}
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label={t("rules.pattern")} htmlFor="rule-pattern">
          <Input
            id="rule-pattern" value={pattern} autoFocus
            onChange={e => setPattern(e.target.value)}
            placeholder={t("rules.patternPlaceholder")}
          />
          {pattern && normalized !== pattern.toLowerCase() && (
            <p className="fin-hint" style={{ marginTop: "var(--space-1)" }}>
              {t("rules.normalizedAs")} <code style={patternStyle}>{normalized || "—"}</code>
            </p>
          )}
        </Field>

        <Field label={t("rules.matchType")} htmlFor="rule-match">
          <Select id="rule-match" value={matchType} onChange={e => setMatchType(e.target.value)}>
            {MATCH_TYPES.map(m => <option key={m} value={m}>{t(`rules.match.${m}`)}</option>)}
          </Select>
        </Field>

        <Field label={t("tx.category")} htmlFor="rule-cat">
          <Select id="rule-cat" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            {categories.map(c => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
          </Select>
        </Field>

        <Field label={t("rules.priority")} htmlFor="rule-priority" hint={t("rules.priorityHint")}>
          <Input id="rule-priority" type="number" value={priority} onChange={e => setPriority(e.target.value)} />
        </Field>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  );
}
