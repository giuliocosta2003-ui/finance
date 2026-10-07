// src/components/ProtectedRoute.jsx
// Cancello unico delle rotte private. Non ci sono ruoli in questa app: c'e'
// solo "sei tu" (e le policy RLS lo impongono comunque lato database, questo
// e' solo il controllo di navigazione).
//
// Ordine dei controlli:
//   1. sessione assente            -> /login
//   2. recupero password in corso  -> /login (schermata "nuova password")
//   3. profilo mancante            -> messaggio, non schermo nero
//   4. onboarding non completato   -> /onboarding
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import Loading from "./Loading";

export default function ProtectedRoute({ children, allowIncompleteOnboarding = false }) {
  const { loading, session, profile, profileError, recovery, signOut } = useAuth();
  const { t } = useI18n();
  const location = useLocation();

  if (loading) return <Loading fullScreen label={t("common.loading")} />;
  if (!session || recovery) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  if (!profile) {
    return (
      <div style={{
        maxWidth: 560, margin: "0 auto",
        padding: "var(--space-8) var(--space-4)",
      }}>
        <div className="fin-card">
          <p className="fin-h2" style={{ marginBottom: "var(--space-2)" }}>{t("errors.profileMissingTitle")}</p>
          <p className="fin-muted">{t("errors.profileMissingBody")}</p>
          {profileError && (
            <pre style={{
              marginTop: "var(--space-3)", padding: "var(--space-2)", fontSize: "var(--fs-caption)",
              fontFamily: "var(--font-mono)",
              background: "var(--surface-sunken)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-control)", color: "var(--text-secondary)",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>{profileError}</pre>
          )}
          <button
            type="button"
            onClick={signOut}
            className="fin-btn fin-btn--secondary"
            style={{ marginTop: "var(--space-4)" }}
          >
            {t("common.logout")}
          </button>
        </div>
      </div>
    );
  }

  if (!profile.onboarding_completed && !allowIncompleteOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}
