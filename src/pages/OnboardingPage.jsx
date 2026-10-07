// src/pages/OnboardingPage.jsx
// Onboarding in 3 passi: chi sei, dove vivi e in che valuta ragioni, due righe
// libere su di te. I campi sono esattamente quelli che il vincolo
// `onboarding_requires_fields` pretende prima di poter mettere
// onboarding_completed a true (full_name, profile_type, base_currency, country).
//
// Ogni passo salva subito la sua parte: se l'utente chiude l'app a meta',
// riaprendola ritrova quello che aveva gia' scritto.
import { useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import AppMark from "../components/AppMark";
import LangThemeControls from "../components/LangThemeControls";
import { Icon } from "../components/icons";
import { Button, Card, ChoiceRow, Field, InlineAlert, Input, Select, Textarea } from "../ui";
import { COUNTRY_CODES, COUNTRY_CURRENCY } from "../lib/countries";
import { CURRENCY_CODES, SUGGESTED_CURRENCIES } from "../lib/currencies";
import { countryName, currencyName } from "../lib/format";

const TOTAL_STEPS = 3;
const PROFILE_TYPES = ["student", "employee", "entrepreneur", "other"];
const INTRO_MAX = 1000;

export default function OnboardingPage() {
  const { profile, updateProfile } = useAuth();
  const { t, lang } = useI18n();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [profileType, setProfileType] = useState(profile?.profile_type ?? "");
  const [country, setCountry] = useState(profile?.country ?? "");
  const [baseCurrency, setBaseCurrency] = useState(profile?.base_currency ?? "");
  const [intro, setIntro] = useState(profile?.intro ?? "");

  // Paesi in ordine alfabetico secondo la lingua corrente: in italiano
  // "Germania" sta alla G, in inglese "Germany" pure, ma "Spagna"/"Spain" no.
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

  const onCountryChange = (code) => {
    setCountry(code);
    // La valuta del paese e' solo un suggerimento: se l'utente ne aveva gia'
    // scelta una, non gliela cambiamo sotto le mani.
    if (!baseCurrency && COUNTRY_CURRENCY[code]) setBaseCurrency(COUNTRY_CURRENCY[code]);
  };

  /** Salva la parte di profilo del passo corrente. */
  const savePatch = async (patch) => {
    setBusy(true);
    const res = await updateProfile(patch);
    setBusy(false);
    if (!res.ok) { setError(t("onboarding.errSave")); return false; }
    setError("");
    return true;
  };

  const goNext = async () => {
    if (step === 1) {
      if (!fullName.trim()) { setError(t("onboarding.errFullName")); return; }
      if (!profileType) { setError(t("onboarding.errProfileType")); return; }
      if (!await savePatch({ full_name: fullName.trim(), profile_type: profileType })) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!country) { setError(t("onboarding.errCountry")); return; }
      if (!baseCurrency) { setError(t("onboarding.errCurrency")); return; }
      if (!await savePatch({ country, base_currency: baseCurrency })) return;
      setStep(3);
      return;
    }
    // Passo 3: le note sono facoltative, qui si chiude l'onboarding.
    await savePatch({
      intro: intro.trim() ? intro.trim() : null,
      locale: lang,
      onboarding_completed: true,
    });
    // Riuscito: ProtectedRoute lascia passare e App mostra la home.
  };

  const goBack = () => { setError(""); setStep(s => Math.max(1, s - 1)); };

  const skipIntro = async () => {
    await savePatch({ locale: lang, onboarding_completed: true });
  };

  /** Il cerchietto di scelta dentro una riga selezionabile. */
  const radioDot = (on) => (
    <span style={{
      width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
      border: `1px solid ${on ? "var(--accent-fill)" : "var(--border-control)"}`,
      background: on ? "var(--accent-fill)" : "transparent",
      color: "var(--text-on-fill)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {on && <Icon.Check size={11} strokeWidth={3} />}
    </span>
  );

  return (
    <div style={{ minHeight: "100dvh", background: "var(--surface-bg)", display: "flex", flexDirection: "column" }}>

      {/* Intestazione fissa col marchio: durante la registrazione dice sempre
          a chi si stanno dando i propri dati. */}
      <header style={{
        display: "flex", alignItems: "center", gap: "var(--space-2)",
        height: "calc(var(--header-h) + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "var(--space-4)", paddingRight: "var(--space-4)",
        background: "var(--surface-1)",
        borderBottom: "1px solid var(--border)",
      }}>
        <AppMark size={20} />
        <span style={{
          fontSize: "var(--fs-h3)", fontWeight: "var(--fw-bold)",
          letterSpacing: "var(--tracking-tight)", color: "var(--text)",
        }}>{t("app.name")}</span>
        <div style={{ marginLeft: "auto" }}><LangThemeControls /></div>
      </header>

      <div style={{
        flex: 1, width: "100%", maxWidth: 560, margin: "0 auto",
        padding: "var(--space-6) var(--space-4)",
        display: "grid", gap: "var(--space-4)", alignContent: "start",
      }}>

        {/* Avanzamento: segmenti squadrati, non una barra a estremi tondi. */}
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: "var(--space-2)" }}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <span key={i} style={{
                flex: 1, height: 3,
                background: i < step ? "var(--accent-fill)" : "var(--border-strong)",
                transition: "background var(--dur)",
              }} />
            ))}
          </div>
          <p className="fin-eyebrow">
            {t("onboarding.stepOf", { current: step, total: TOTAL_STEPS })}
          </p>
        </div>

        <Card style={{ padding: "var(--space-5)" }}>
          {step === 1 && (
            <div className="fin-fade-in" style={{ display: "grid", gap: "var(--space-5)" }}>
              <div>
                <h1 className="fin-h1">{t("onboarding.step1Title")}</h1>
                <p className="fin-muted" style={{ marginTop: "var(--space-2)" }}>{t("onboarding.step1Sub")}</p>
              </div>

              <Field label={t("onboarding.fullName")} htmlFor="fullName">
                <Input
                  id="fullName" type="text" value={fullName} autoComplete="name" autoFocus
                  onChange={e => setFullName(e.target.value)}
                  placeholder={t("onboarding.fullNamePlaceholder")}
                />
              </Field>

              <div>
                <p className="fin-label">{t("onboarding.profileType")}</p>
                <p className="fin-hint" style={{ marginBottom: "var(--space-2)" }}>{t("onboarding.profileTypeSub")}</p>
                <div
                  style={{ display: "grid", gap: "var(--space-2)" }}
                  role="radiogroup"
                  aria-label={t("onboarding.profileType")}
                >
                  {PROFILE_TYPES.map(type => (
                    <ChoiceRow
                      key={type}
                      role="radio"
                      selected={profileType === type}
                      onClick={() => { setProfileType(type); setError(""); }}
                    >
                      {radioDot(profileType === type)}
                      {t(`profileType.${type}`)}
                    </ChoiceRow>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="fin-fade-in" style={{ display: "grid", gap: "var(--space-5)" }}>
              <div>
                <h1 className="fin-h1">{t("onboarding.step2Title")}</h1>
                <p className="fin-muted" style={{ marginTop: "var(--space-2)" }}>{t("onboarding.step2Sub")}</p>
              </div>

              <Field label={t("onboarding.country")} htmlFor="country">
                <Select
                  id="country" value={country}
                  onChange={e => { onCountryChange(e.target.value); setError(""); }}
                >
                  <option value="">{t("onboarding.countryPlaceholder")}</option>
                  {countries.map(({ code, name }) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </Select>
              </Field>

              <Field label={t("onboarding.baseCurrency")} htmlFor="baseCurrency">
                <Select
                  id="baseCurrency" value={baseCurrency}
                  onChange={e => { setBaseCurrency(e.target.value); setError(""); }}
                >
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
            </div>
          )}

          {step === 3 && (
            <div className="fin-fade-in" style={{ display: "grid", gap: "var(--space-5)" }}>
              <div>
                <h1 className="fin-h1">{t("onboarding.step3Title")}</h1>
                <p className="fin-muted" style={{ marginTop: "var(--space-2)" }}>{t("onboarding.step3Sub")}</p>
              </div>

              <Field label={`${t("onboarding.intro")} (${t("common.optional")})`} htmlFor="intro">
                <Textarea
                  id="intro" value={intro} maxLength={INTRO_MAX} autoFocus
                  onChange={e => setIntro(e.target.value)}
                  placeholder={t("onboarding.introPlaceholder")}
                />
                <p className="fin-hint" style={{ textAlign: "right", marginTop: "var(--space-1)" }}>
                  {t("onboarding.introCount", { count: intro.length })}
                </p>
              </Field>
            </div>
          )}

          {error && (
            <div style={{ marginTop: "var(--space-4)" }}>
              <InlineAlert tone="error">{error}</InlineAlert>
            </div>
          )}

          <div className="fin-toolbar" style={{ marginTop: "var(--space-5)" }}>
            {step > 1 && <Button onClick={goBack} disabled={busy}>{t("common.back")}</Button>}
            {step === 3 && (
              <Button variant="quiet" onClick={skipIntro} disabled={busy}>{t("onboarding.skip")}</Button>
            )}
            <div className="fin-toolbar__end">
              <Button variant="primary" onClick={goNext} disabled={busy} style={{ minWidth: 140 }}>
                {busy
                  ? (step === TOTAL_STEPS ? t("onboarding.finishing") : t("common.saving"))
                  : (step === TOTAL_STEPS ? t("onboarding.finish") : t("common.next"))}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
