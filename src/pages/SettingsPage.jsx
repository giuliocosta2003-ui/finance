// src/pages/SettingsPage.jsx
// Gli stessi campi dell'onboarding, modificabili dopo. Lingua e tema stanno
// nella barra in alto (LangThemeControls): qui si tocca solo cio' che vive nel
// profilo, piu' le azioni sull'account.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { useToast } from "../components/Toast";
import { useAccounts } from "../hooks/useAccounts";
import { supabase } from "../lib/supabase";
import {
  Badge, Button, Card, CardHeader, CardTitle, Field, Input,
  Page, PageHeader, Select, Switch, Textarea,
} from "../ui";
import { Icon, ICON } from "../components/icons";
import { COUNTRY_CODES, COUNTRY_CURRENCY } from "../lib/countries";
import { CURRENCY_CODES, SUGGESTED_CURRENCIES } from "../lib/currencies";
import { countryName, currencyName, formatDate } from "../lib/format";

const PROFILE_TYPES = ["student", "employee", "entrepreneur", "other"];
const INTRO_MAX = 1000;

export default function SettingsPage() {
  const { profile, user, updateProfile, resetPassword, signOut } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [profileType, setProfileType] = useState(profile?.profile_type ?? "");
  const [country, setCountry] = useState(profile?.country ?? "");
  const [baseCurrency, setBaseCurrency] = useState(profile?.base_currency ?? "");
  const [intro, setIntro] = useState(profile?.intro ?? "");
  const [fiscalMonth, setFiscalMonth] = useState(String(profile?.fiscal_year_start_month ?? 1));
  const [setAsideAccount, setSetAsideAccount] = useState(profile?.tax_set_aside_account_id ?? "");
  const [busy, setBusy] = useState(false);

  const { accounts } = useAccounts({ includeArchived: false });

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
    n: i + 1,
    name: new Intl.DateTimeFormat(lang, { month: "long" }).format(new Date(2021, i, 1)),
  })), [lang]);

  const countries = useMemo(() => {
    const collator = new Intl.Collator(lang);
    return COUNTRY_CODES
      .map(code => ({ code, name: countryName(code, lang) }))
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [lang]);

  const otherCurrencies = useMemo(() => {
    const collator = new Intl.Collator(lang);
    return CURRENCY_CODES
      .filter(c => !SUGGESTED_CURRENCIES.includes(c))
      .map(code => ({ code, name: currencyName(code, lang) }))
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [lang]);

  const dirty =
    fullName !== (profile?.full_name ?? "") ||
    profileType !== (profile?.profile_type ?? "") ||
    country !== (profile?.country ?? "") ||
    baseCurrency !== (profile?.base_currency ?? "") ||
    intro !== (profile?.intro ?? "") ||
    Number(fiscalMonth) !== (profile?.fiscal_year_start_month ?? 1) ||
    (setAsideAccount || null) !== (profile?.tax_set_aside_account_id ?? null);

  const save = async () => {
    setBusy(true);
    const typeChanged = profileType !== (profile?.profile_type ?? "");
    const res = await updateProfile({
      full_name: fullName.trim() || null,
      profile_type: profileType || null,
      country: country || null,
      base_currency: baseCurrency || null,
      intro: intro.trim() ? intro.trim() : null,
      fiscal_year_start_month: Number(fiscalMonth) || 1,
      tax_set_aside_account_id: setAsideAccount || null,
    });
    if (!res.ok) { setBusy(false); toast.error(t("settings.saveError")); return; }

    // Cambiando tipo di profilo servono altre categorie (uno studente e un
    // libero professionista non spendono le stesse cose). Il seed aggiunge
    // solo quelle mancanti: non tocca e non cancella quelle gia' presenti.
    if (typeChanged && profileType) {
      const { data } = await supabase.rpc("seed_default_categories");
      if (data > 0) toast.info(t("categories.seedAdded", { count: data }));
    }
    setBusy(false);
    toast.success(t("common.saved"));
  };

  const sendPasswordLink = async () => {
    if (!user?.email) return;
    await resetPassword(user.email);
    toast.info(t("login.resetSent"));
  };

  /** Una voce che porta a una sottopagina delle impostazioni. */
  const linkRow = (to, LinkIcon, label, hint) => (
    <Link to={to} className="fin-row fin-row--interactive">
      <LinkIcon size={ICON.md} style={{ color: "var(--text-secondary)", flex: "0 0 auto" }} aria-hidden="true" />
      <span className="fin-row__body">
        <span className="fin-row__title">{label}</span>
        <span className="fin-row__subtitle">{hint}</span>
      </span>
      <Icon.Right size={ICON.sm} style={{ color: "var(--text-tertiary)", flex: "0 0 auto" }} aria-hidden="true" />
    </Link>
  );

  return (
    <Page>
      <PageHeader title={t("settings.title")} />

      {/* ── Profilo ───────────────────────────────────────────────────── */}
      <Card flush>
        <CardHeader><CardTitle>{t("settings.profileSection")}</CardTitle></CardHeader>
        <div className="fin-card__body" style={{ display: "grid", gap: "var(--space-4)" }}>
          <Field label={t("onboarding.fullName")} htmlFor="fullName">
            <Input
              id="fullName" type="text" value={fullName} autoComplete="name"
              onChange={e => setFullName(e.target.value)}
            />
          </Field>

          <Field label={t("onboarding.profileType")} htmlFor="profileType">
            <Select id="profileType" value={profileType} onChange={e => setProfileType(e.target.value)}>
              <option value="">—</option>
              {PROFILE_TYPES.map(type => (
                <option key={type} value={type}>{t(`profileType.${type}`)}</option>
              ))}
            </Select>
          </Field>

          <Field label={t("onboarding.country")} htmlFor="country">
            <Select
              id="country" value={country}
              onChange={e => {
                const code = e.target.value;
                setCountry(code);
                if (!baseCurrency && COUNTRY_CURRENCY[code]) setBaseCurrency(COUNTRY_CURRENCY[code]);
              }}
            >
              <option value="">{t("onboarding.countryPlaceholder")}</option>
              {countries.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
            </Select>
          </Field>

          <Field label={t("onboarding.baseCurrency")} htmlFor="baseCurrency" hint={t("settings.baseCurrencyHint")}>
            <Select id="baseCurrency" value={baseCurrency} onChange={e => setBaseCurrency(e.target.value)}>
              <option value="">—</option>
              <optgroup label={t("onboarding.currencySuggested")}>
                {SUGGESTED_CURRENCIES.map(code => (
                  <option key={code} value={code}>{code} — {currencyName(code, lang)}</option>
                ))}
              </optgroup>
              <optgroup label={t("onboarding.currencyAll")}>
                {otherCurrencies.map(({ code, name }) => (
                  <option key={code} value={code}>{code} — {name}</option>
                ))}
              </optgroup>
            </Select>
          </Field>

          <Field label={t("onboarding.intro")} htmlFor="intro">
            <Textarea
              id="intro" value={intro} maxLength={INTRO_MAX}
              onChange={e => setIntro(e.target.value)}
              placeholder={t("onboarding.introPlaceholder")}
            />
            <p className="fin-hint" style={{ textAlign: "right", marginTop: "var(--space-1)" }}>
              {t("onboarding.introCount", { count: intro.length })}
            </p>
          </Field>

          {/* Tasse: solo per l'imprenditore, e compare/sparisce col tipo di
              profilo scelto qui sopra. Salva con lo stesso pulsante. */}
          {profileType === "entrepreneur" && (
            <div className="fin-pair">
              <Field label={t("settings.fiscalYearStart")} htmlFor="fyStart" hint={t("settings.fiscalYearStartHint")}>
                <Select id="fyStart" value={fiscalMonth} onChange={e => setFiscalMonth(e.target.value)}>
                  {months.map(m => <option key={m.n} value={m.n}>{m.name}</option>)}
                </Select>
              </Field>
              <Field label={t("settings.setAsideAccount")} htmlFor="setAside" hint={t("settings.setAsideAccountHint")}>
                <Select id="setAside" value={setAsideAccount} onChange={e => setSetAsideAccount(e.target.value)}>
                  <option value="">{t("settings.setAsideNone")}</option>
                  {(accounts ?? []).map(a => (
                    <option key={a.account_id ?? a.id} value={a.account_id ?? a.id}>{a.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </div>
        <div className="fin-card__foot" style={{ justifyContent: "flex-end" }}>
          <Button variant="primary" onClick={save} disabled={busy || !dirty}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </Card>

      {/* ── App ───────────────────────────────────────────────────────── */}
      <Card flush>
        <CardHeader><CardTitle>{t("settings.appSection")}</CardTitle></CardHeader>
        {linkRow("/settings/categories", Icon.Categories, t("settings.categoriesLink"), t("settings.categoriesLinkHint"))}
        {linkRow("/settings/rules", Icon.Filters, t("settings.rulesLink"), t("settings.rulesLinkHint"))}
        {linkRow("/settings/allocation", Icon.Investments, t("settings.allocationLink"), t("settings.allocationLinkHint"))}
      </Card>

      {/* ── Intelligenza artificiale ──────────────────────────────────── */}
      <Card flush>
        <CardHeader><CardTitle>{t("settings.aiSection")}</CardTitle></CardHeader>
        <div className="fin-card__body" style={{ display: "grid", gap: "var(--space-2)" }}>
          {/* Interruttore e non casella: agisce subito, senza passare dal
              pulsante Salva qui sopra. La casella prometterebbe il contrario. */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={{ flex: 1, fontSize: "var(--fs-body)", fontWeight: "var(--fw-medium)" }}>
              {t("settings.aiConsent")}
            </span>
            <Switch
              checked={!!profile?.ai_consent_at}
              label={t("settings.aiConsent")}
              onChange={async (next) => {
                // Il consenso e' una data, non un booleano: cosi' resta scritto
                // da quando vale, e la Edge Function ha una cosa sola da guardare.
                const res = await updateProfile({ ai_consent_at: next ? new Date().toISOString() : null });
                if (res.ok) toast.success(t("common.saved"));
                else toast.error(t("settings.saveError"));
              }}
            />
          </div>
          <p className="fin-hint">{t("settings.aiConsentHint")}</p>
          {/* Una pastiglia di stato porta UNA parola. Qui il testo e' una frase
              intera, e in maiuscoletto dentro un bordo diventava illeggibile:
              la pastiglia dice lo stato, la frase resta testo normale. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <Badge tone={profile?.ai_consent_at ? "var(--positive)" : "var(--text-secondary)"}>
              {profile?.ai_consent_at ? t("settings.aiOn") : t("settings.aiOff")}
            </Badge>
            <span className="fin-hint">
              {profile?.ai_consent_at
                ? t("settings.aiConsentOn", { date: formatDate(profile.ai_consent_at, lang) })
                : t("settings.aiConsentOff")}
            </span>
          </div>
        </div>
      </Card>

      {/* ── Account ───────────────────────────────────────────────────── */}
      <Card flush>
        <CardHeader><CardTitle>{t("settings.accountSection")}</CardTitle></CardHeader>
        <div className="fin-card__body" style={{ display: "grid", gap: "var(--space-1)" }}>
          <p className="fin-body">{t("settings.signedInAs", { email: user?.email ?? "—" })}</p>
          {profile?.created_at && (
            <p className="fin-hint">{formatDate(profile.created_at, lang, { dateStyle: "long" })}</p>
          )}
        </div>
        <div className="fin-card__foot">
          <Button onClick={sendPasswordLink}>{t("settings.changePassword")}</Button>
          <Button onClick={signOut} icon={<Icon.Logout size={ICON.sm} />}>{t("common.logout")}</Button>
        </div>
      </Card>
    </Page>
  );
}
