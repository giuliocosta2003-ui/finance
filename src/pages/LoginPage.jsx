// src/pages/LoginPage.jsx
// Accesso, registrazione, password dimenticata e scelta della nuova password:
// una sola schermata con piu' stati, cosi' non esistono rotte pubbliche
// diverse da /login.
import { useState, useRef, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import AppMark from "../components/AppMark";
import LangThemeControls from "../components/LangThemeControls";
import { Icon, ICON } from "../components/icons";
import { Button, Card, Field, IconButton, InlineAlert, Input } from "../ui";

const MIN_PASSWORD = 8;

export default function LoginPage() {
  const { signIn, signUp, resetPassword, updatePassword, recovery } = useAuth();
  const { t } = useI18n();

  // "signin" | "signup" | "sent" | "reset" | "resetSent"
  const [phase, setPhase] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const emailRef = useRef(null);

  // Il link ricevuto per email apre l'app con una sessione di recupero: finche'
  // dura, l'unica cosa sensata da mostrare e' "scegli la nuova password".
  // E' una derivazione, non uno stato: appena updatePassword riesce, `recovery`
  // torna falso e la schermata riprende da dove era.
  const view = recovery ? "newPassword" : phase;

  useEffect(() => { emailRef.current?.focus(); }, []);

  const friendlyError = (msg = "") => {
    const m = msg.toLowerCase();
    if (m.includes("invalid login credentials")) return t("login.errInvalidCredentials");
    if (m.includes("email not confirmed")) return t("login.errEmailNotConfirmed");
    if (m.includes("already registered") || m.includes("already been registered")) return t("login.errEmailTaken");
    if (m.includes("rate limit") || m.includes("too many") || m.includes("for security purposes")) return t("login.errTooManyRequests");
    return msg || t("login.errUnknown");
  };

  const cleanEmail = () => email.trim().toLowerCase();

  const handleSignIn = async (e) => {
    e?.preventDefault();
    if (!cleanEmail() || !password) { setError(t("login.errEmailPassword")); return; }
    setError(""); setBusy(true);
    const res = await signIn(cleanEmail(), password);
    if (res.ok) return; // al resto pensa App quando arriva la sessione
    setError(friendlyError(res.error)); setBusy(false);
  };

  const handleSignUp = async (e) => {
    e?.preventDefault();
    if (!cleanEmail()) { setError(t("login.errEmailPassword")); return; }
    if (password.length < MIN_PASSWORD) { setError(t("login.errPasswordShort")); return; }
    setError(""); setBusy(true);
    const res = await signUp(cleanEmail(), password);
    if (!res.ok) { setError(friendlyError(res.error)); setBusy(false); return; }
    if (res.needsConfirmation) { setPhase("sent"); setBusy(false); return; }
    // Istanza senza conferma email: la sessione c'e' gia', App porta all'onboarding.
  };

  const handleReset = async (e) => {
    e?.preventDefault();
    if (!cleanEmail()) { setError(t("login.errEmailPassword")); return; }
    setError(""); setBusy(true);
    // L'esito non distingue "email esistente" da "email inesistente": dirlo
    // sarebbe un modo gentile di elencare gli iscritti.
    await resetPassword(cleanEmail());
    setPhase("resetSent"); setBusy(false);
  };

  const handleNewPassword = async (e) => {
    e?.preventDefault();
    if (password.length < MIN_PASSWORD) { setError(t("login.errPasswordShort")); return; }
    setError(""); setBusy(true);
    const res = await updatePassword(password);
    if (!res.ok) { setError(friendlyError(res.error)); setBusy(false); return; }
    setPassword("");
    // Con recovery a false App smette di trattenere l'utente qui.
  };

  const goTo = (next) => { setPhase(next); setError(""); };

  const emailField = (
    <Field label={t("common.email")} htmlFor="email">
      <Input
        id="email" ref={emailRef} type="email" value={email} autoComplete="email"
        onChange={e => setEmail(e.target.value)}
        placeholder={t("login.emailPlaceholder")}
      />
    </Field>
  );

  const passwordField = (autoComplete, labelText, hint) => (
    <Field label={labelText} htmlFor="password" hint={hint}>
      <div style={{ position: "relative" }}>
        <Input
          id="password" type={showPassword ? "text" : "password"} value={password}
          autoComplete={autoComplete}
          onChange={e => setPassword(e.target.value)}
          placeholder="********"
          style={{ paddingRight: 40 }}
        />
        <IconButton
          bare
          onClick={() => setShowPassword(v => !v)}
          label={showPassword ? t("common.hide") : t("common.show")}
          icon={showPassword ? <Icon.Hide size={ICON.sm} /> : <Icon.Show size={ICON.sm} />}
          style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)" }}
        />
      </div>
    </Field>
  );

  /** Ogni schermata di questo modulo ha la stessa colonna: campi, poi azioni. */
  const stack = (children) => (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>{children}</div>
  );

  return (
    <div style={{
      minHeight: "100dvh", background: "var(--surface-bg)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "var(--space-4)",
    }}>
      <div style={{
        position: "fixed",
        top: "calc(var(--space-3) + env(safe-area-inset-top))",
        right: "var(--space-3)",
      }}>
        <LangThemeControls />
      </div>

      {/* Il marchio sta FUORI dalla card, sopra: e' l'intestazione
          dell'istituto, non il titolo del modulo. Dentro la card resta solo
          cio' che si compila. */}
      <div className="fin-fade-in" style={{ width: "min(400px, 100%)" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: "var(--space-2)",
          marginBottom: "var(--space-2)",
        }}>
          <AppMark size={24} />
          <span style={{
            fontSize: "var(--fs-h2)", fontWeight: "var(--fw-bold)",
            letterSpacing: "var(--tracking-tight)", color: "var(--text)",
          }}>{t("app.name")}</span>
        </div>
        <p className="fin-caption" style={{ marginBottom: "var(--space-4)" }}>{t("app.tagline")}</p>

      <Card style={{ padding: "var(--space-5)" }}>

        {view === "signin" && (
          <form onSubmit={handleSignIn} noValidate>
            <h1 className="fin-h2" style={{ marginBottom: "var(--space-4)" }}>{t("login.signIn")}</h1>
            {stack(<>
              {emailField}
              {passwordField("current-password", t("common.password"))}
              {error && <InlineAlert tone="error">{error}</InlineAlert>}
              <Button type="submit" variant="primary" size="lg" block disabled={busy}>
                {busy ? t("login.signingIn") : t("login.signIn")}
              </Button>
            </>)}
            <div className="fin-toolbar" style={{ marginTop: "var(--space-4)" }}>
              <Button variant="ghost" size="sm" onClick={() => goTo("reset")}>{t("login.forgotPassword")}</Button>
              <div className="fin-toolbar__end">
                <Button variant="ghost" size="sm" onClick={() => goTo("signup")}>{t("login.signUp")}</Button>
              </div>
            </div>
          </form>
        )}

        {view === "signup" && (
          <form onSubmit={handleSignUp} noValidate>
            <h1 className="fin-h2" style={{ marginBottom: "var(--space-4)" }}>{t("login.signUp")}</h1>
            {stack(<>
              {emailField}
              {passwordField("new-password", t("common.password"), t("login.passwordHint"))}
              {error && <InlineAlert tone="error">{error}</InlineAlert>}
              <Button type="submit" variant="primary" size="lg" block disabled={busy}>
                {busy ? t("login.signingUp") : t("login.signUp")}
              </Button>
            </>)}
            <p className="fin-caption" style={{ textAlign: "center", marginTop: "var(--space-4)" }}>
              {t("login.hasAccount")}{" "}
              <Button variant="ghost" size="sm" onClick={() => goTo("signin")}>{t("login.signIn")}</Button>
            </p>
          </form>
        )}

        {view === "sent" && (
          <div style={{ textAlign: "center", display: "grid", gap: "var(--space-3)", justifyItems: "center" }}>
            <span className="fin-state__icon" aria-hidden="true"><Icon.Mail size={ICON.lg} /></span>
            <h1 className="fin-h2">{t("login.confirmEmailTitle")}</h1>
            <p className="fin-muted">{t("login.confirmEmailBody", { email: cleanEmail() })}</p>
            <Button block onClick={() => goTo("signin")}>{t("login.backToLogin")}</Button>
          </div>
        )}

        {view === "reset" && (
          <form onSubmit={handleReset} noValidate>
            <h1 className="fin-h2">{t("login.resetTitle")}</h1>
            <p className="fin-muted" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>{t("login.resetBody")}</p>
            {stack(<>
              {emailField}
              {error && <InlineAlert tone="error">{error}</InlineAlert>}
              <Button type="submit" variant="primary" size="lg" block disabled={busy}>
                {busy ? t("common.saving") : t("login.resetSend")}
              </Button>
              <Button variant="quiet" block onClick={() => goTo("signin")}>{t("login.backToLogin")}</Button>
            </>)}
          </form>
        )}

        {view === "resetSent" && (
          <div style={{ textAlign: "center", display: "grid", gap: "var(--space-3)", justifyItems: "center" }}>
            <span className="fin-state__icon" aria-hidden="true"><Icon.Mail size={ICON.lg} /></span>
            <p className="fin-muted">{t("login.resetSent")}</p>
            <Button block onClick={() => goTo("signin")}>{t("login.backToLogin")}</Button>
          </div>
        )}

        {view === "newPassword" && (
          <form onSubmit={handleNewPassword} noValidate>
            <h1 className="fin-h2" style={{ marginBottom: "var(--space-4)" }}>{t("login.newPasswordTitle")}</h1>
            {stack(<>
              {passwordField("new-password", t("login.newPassword"), t("login.passwordHint"))}
              {error && <InlineAlert tone="error">{error}</InlineAlert>}
              <Button type="submit" variant="primary" size="lg" block disabled={busy}>
                {busy ? t("common.saving") : t("common.save")}
              </Button>
            </>)}
          </form>
        )}
      </Card>
      </div>
    </div>
  );
}
