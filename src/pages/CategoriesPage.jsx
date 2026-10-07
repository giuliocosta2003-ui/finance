// src/pages/CategoriesPage.jsx
// Impostazioni > Categorie. Le predefinite arrivano da seed_default_categories
// e mostrano il nome tradotto finche' l'utente non le rinomina: da quel momento
// vince il suo nome, in qualsiasi lingua stia usando l'app.
// Si archiviano invece di cancellarle, perche' le transazioni gia' registrate
// continuano a puntarci.
import { useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useCategories, categoryLabel } from "../hooks/useCategories";
import { useLocalPreference } from "../hooks/useLocalPreference";
import { useToast } from "../components/Toast";
import {
  Badge, Button, Card, CardHeader, CardTitle, Checkbox, Field, IconButton,
  InlineAlert, Input, Page, PageHeader, Select, Sheet, SkeletonRows,
} from "../ui";
import { Icon, ICON } from "../components/icons";

const KINDS = ["expense", "income"];

export default function CategoriesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [showArchived, setShowArchived] = useLocalPreference("finance_categories_archived", false);
  const { categories, loading, error, create, update, setArchived, move, seedDefaults } =
    useCategories({ includeArchived: showArchived });
  const [editing, setEditing] = useState(null); // null | "new" | category
  const [busy, setBusy] = useState(false);

  const runSeed = async () => {
    setBusy(true);
    const res = await seedDefaults();
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.added > 0 ? t("categories.seedAdded", { count: res.added }) : t("categories.seedNothing"));
  };

  return (
    <Page>
      <PageHeader
        backTo="/settings"
        backLabel={t("settings.title")}
        title={t("categories.title")}
        subtitle={t("categories.intro")}
        actions={
          <Button variant="primary" onClick={() => setEditing("new")} icon={<Icon.Plus size={ICON.sm} />}>
            {t("categories.new")}
          </Button>
        }
      />

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {loading && <Card flush><SkeletonRows rows={5} /></Card>}

      {!loading && KINDS.map(kind => {
        const list = (categories ?? []).filter(c => c.kind === kind);
        return (
          <Card key={kind} flush>
            <CardHeader>
              <CardTitle>{t(`txKind.${kind}`)}</CardTitle>
            </CardHeader>

            {list.length === 0 ? (
              <div className="fin-card__body"><p className="fin-hint">{t("categories.emptyKind")}</p></div>
            ) : list.map((c, i) => (
              <div key={c.id} className="fin-row" style={{ opacity: c.archived_at ? 0.6 : 1 }}>
                <div className="fin-row__body" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <span className="fin-row__title" style={{ flex: "0 1 auto" }}>{categoryLabel(c, t)}</span>
                  {c.is_business && <Badge tone="var(--info)">{t("categories.business")}</Badge>}
                  {c.archived_at && <Badge>{t("categories.archived")}</Badge>}
                </div>

                <div style={{ display: "flex", gap: "var(--space-1)", flex: "0 0 auto" }}>
                  <IconButton
                    onClick={() => move(c, -1)} disabled={i === 0}
                    label={t("categories.moveUp")} icon={<Icon.Up size={ICON.sm} />}
                  />
                  <IconButton
                    onClick={() => move(c, 1)} disabled={i === list.length - 1}
                    label={t("categories.moveDown")} icon={<Icon.Down size={ICON.sm} />}
                  />
                  <IconButton onClick={() => setEditing(c)} label={t("common.edit")} icon={<Icon.Edit size={ICON.sm} />} />
                  <IconButton
                    onClick={async () => {
                      const res = await setArchived(c.id, !c.archived_at);
                      if (!res.ok) toast.error(res.error);
                    }}
                    label={c.archived_at ? t("categories.unarchive") : t("categories.archive")}
                    icon={c.archived_at ? <Icon.Unarchive size={ICON.sm} /> : <Icon.Archive size={ICON.sm} />}
                  />
                </div>
              </div>
            ))}
          </Card>
        );
      })}

      <div className="fin-toolbar">
        <Checkbox checked={showArchived} onChange={setShowArchived} label={t("categories.showArchived")} />
        <div className="fin-toolbar__end">
          <Button onClick={runSeed} disabled={busy}>
            {busy ? t("common.loading") : t("categories.seed")}
          </Button>
        </div>
      </div>
      <p className="fin-hint">{t("categories.seedHint")}</p>

      {editing && (
        <CategoryForm
          category={editing === "new" ? null : editing}
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

function CategoryForm({ category, onClose, onSave }) {
  const { t } = useI18n();
  const [name, setName] = useState(category?.name ?? (category?.key ? categoryLabel(category, t) : ""));
  const [kind, setKind] = useState(category?.kind ?? "expense");
  const [isBusiness, setIsBusiness] = useState(category?.is_business ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name.trim()) { setError(t("categories.errName")); return; }
    setBusy(true);
    const values = { name: name.trim(), is_business: isBusiness };
    // Il tipo di una categoria gia' usata non si cambia: le transazioni
    // collegate diventerebbero incoerenti (un'uscita sotto una categoria di
    // entrate). Si crea una categoria nuova.
    if (!category) values.kind = kind;
    const ok = await onSave(values, category?.id);
    if (!ok) setBusy(false);
  };

  return (
    <Sheet
      variant="dialog"
      title={category ? t("categories.edit") : t("categories.new")}
      onClose={onClose}
      footer={<>
        <Button variant="quiet" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </>}
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field
          label={t("categories.name")}
          htmlFor="cat-name"
          hint={category?.key ? t("categories.renameHint") : undefined}
        >
          <Input id="cat-name" value={name} autoFocus onChange={e => setName(e.target.value)} />
        </Field>

        {!category && (
          <Field label={t("tx.kind")} htmlFor="cat-kind">
            <Select id="cat-kind" value={kind} onChange={e => setKind(e.target.value)}>
              {KINDS.map(k => <option key={k} value={k}>{t(`txKind.${k}`)}</option>)}
            </Select>
          </Field>
        )}

        <Checkbox checked={isBusiness} onChange={setIsBusiness} label={t("categories.isBusiness")} />

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  );
}
