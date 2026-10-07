// src/components/LangThemeControls.jsx
// Lingua e tema, sempre raggiungibili: servono anche PRIMA del login (dove non
// esiste ancora un profilo su cui salvarli).
// Dopo il login la lingua vive nel profilo: se c'e' una sessione, la scelta
// viene scritta anche su profiles.locale.
import { useI18n } from "../i18n/I18nContext";
import { LANGS } from "../i18n/langs";
import { useTheme } from "../contexts/ThemeContext";
import { useAuth } from "../contexts/AuthContext";
import { Icon, ICON } from "./icons";
import { Button, IconButton } from "../ui";

export default function LangThemeControls() {
  const { lang, setLang, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { session, updateProfile } = useAuth();

  const nextLang = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];

  const switchLang = () => {
    setLang(nextLang);
    // Se l'utente e' loggato la lingua e' una preferenza del profilo, non del
    // browser: cosi' la ritrova su qualsiasi dispositivo.
    if (session) updateProfile({ locale: nextLang });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
      <Button
        variant="quiet"
        size="sm"
        onClick={switchLang}
        title={t("common.language")}
        icon={<Icon.Globe size={ICON.inline} aria-hidden="true" />}
      >
        {lang.toUpperCase()}
      </Button>
      <IconButton
        bare
        onClick={toggleTheme}
        label={t("common.theme")}
        icon={theme === "dark" ? <Icon.Sun size={ICON.sm} /> : <Icon.Moon size={ICON.sm} />}
      />
    </div>
  );
}
