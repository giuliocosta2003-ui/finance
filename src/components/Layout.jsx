// src/components/Layout.jsx
// Il guscio dell'app, in tre forme.
//
//   mobile   barra in basso con cinque voci e barra in alto con titolo della
//            sezione, ricerca, lingua/tema e il "+"
//   tablet   barra laterale di sole icone
//   desktop  barra laterale intera, "+" e ricerca dentro la barra, profilo in
//            fondo, area di lavoro centrata
//
// Le tre forme condividono lo stesso elenco di sezioni (nav.js): una voce che
// esiste in una e non nell'altra sarebbe un bug che nessuno nota.
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { Icon, ICON } from "./icons";
import AppMark from "./AppMark";
import LangThemeControls from "./LangThemeControls";
import CommandPalette from "./CommandPalette";
import { Avatar, Button, IconButton, ListRow, Sheet } from "../ui";
import { initials } from "../theme/tokens";
import {
  NAV_MAIN, NAV_MANAGE, NAV_MORE, NAV_SETTINGS, CREATE_ACTIONS,
  isActive, currentSection, forProfile,
} from "./nav";

export default function Layout({ children }) {
  const { t } = useI18n();
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isMobile, isTablet, hasSidebar } = useBreakpoint();

  // Il menu "Altro" mostra solo le voci ammesse dal profilo (le tasse sono
  // riservate all'imprenditore).
  const moreNav = forProfile(NAV_MORE, profile?.profile_type);

  const [more, setMore] = useState(false);
  const [create, setCreate] = useState(false);
  const [palette, setPalette] = useState(false);

  // ⌘K / Ctrl+K apre la ricerca. Solo dove c'e' una tastiera: su un telefono
  // la scorciatoia non esiste e il pannello non serve.
  useEffect(() => {
    if (isMobile) return undefined;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(p => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile]);

  // Cambiando pagina i pannelli si chiudono: restare aperti sopra una
  // schermata diversa da quella da cui sono partiti disorienta.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { setMore(false); setCreate(false); setPalette(false); }, [pathname]);

  const section = currentSection(pathname);

  const openCreate = (to) => { setCreate(false); navigate(to); };

  return (
    <div className="fin-shell">
      {hasSidebar && (
        <Sidebar
          compact={isTablet}
          pathname={pathname}
          onCreate={() => setCreate(true)}
          onSearch={() => setPalette(true)}
        />
      )}

      <div className={hasSidebar ? (isTablet ? "fin-main fin-main--compact" : "fin-main fin-main--sidebar") : "fin-main"}>
        {isMobile && (
          <header className="fin-topbar">
            <AppMark size={18} />
            <h1 className="fin-h3" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {section ? t(section.labelKey) : t("app.name")}
            </h1>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
              <IconButton
                bare
                onClick={() => setPalette(true)}
                label={t("search.short")}
                icon={<Icon.Search size={ICON.md} />}
              />
              <LangThemeControls />
              {/* Il "+" sta QUI e non in un pulsante flottante: un cerchio
                  sospeso sopra il contenuto copre sempre qualcosa (copriva
                  "Vedi tutti" in cima all'elenco dei movimenti), ed e' il
                  gesto di un'app di consumo. In una barra di intestazione
                  l'azione e' altrettanto raggiungibile col pollice e non
                  nasconde niente. */}
              <Button
                variant="primary"
                size="sm"
                onClick={() => setCreate(true)}
                aria-label={t("create.title")}
                icon={<Icon.Plus size={ICON.sm} />}
              />
            </div>
          </header>
        )}

        <main className="fin-content">{children}</main>
      </div>

      {isMobile && (
        <nav className="fin-tabbar" aria-label={t("nav.sections")}>
          {NAV_MAIN.map(({ to, icon: NavIcon, labelKey }) => {
            const on = isActive(pathname, to);
            return (
              <Link
                key={to}
                to={to}
                className={`fin-tabbar__item${on ? " fin-tabbar__item--on" : ""}`}
                aria-current={on ? "page" : undefined}
              >
                <NavIcon size={ICON.md} aria-hidden="true" />
                {t(labelKey)}
              </Link>
            );
          })}
          <button
            type="button"
            className={`fin-tabbar__item${moreNav.some(i => isActive(pathname, i.to)) ? " fin-tabbar__item--on" : ""}`}
            onClick={() => setMore(true)}
          >
            <Icon.Menu size={ICON.md} aria-hidden="true" />
            {t("nav.more")}
          </button>
        </nav>
      )}

      {more && (
        <Sheet title={t("nav.more")} onClose={() => setMore(false)}>
          <div style={{ display: "grid", gap: "var(--space-1)" }}>
            {moreNav.map(({ to, icon: NavIcon, labelKey }) => (
              <ListRow
                key={to}
                as={Link}
                to={to}
                avatar={<Avatar square size="md" icon={<NavIcon size={ICON.md} />}
                                style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }} />}
                title={t(labelKey)}
                end={<Icon.Right size={ICON.sm} style={{ color: "var(--text-tertiary)" }} aria-hidden="true" />}
              />
            ))}
          </div>
          <div style={{ marginTop: "var(--space-6)" }}>
            <SignOutButton />
          </div>
        </Sheet>
      )}

      {create && (
        <Sheet title={t("create.title")} onClose={() => setCreate(false)}>
          <div style={{ display: "grid", gap: "var(--space-1)" }}>
            {CREATE_ACTIONS.map(({ key, to, icon: ActionIcon, labelKey }) => (
              <ListRow
                key={key}
                as="button"
                onClick={() => openCreate(to)}
                avatar={<Avatar square size="md" icon={<ActionIcon size={ICON.md} />}
                                style={{ background: "var(--accent-soft)", color: "var(--accent)" }} />}
                title={t(labelKey)}
                subtitle={t(`${labelKey}Hint`)}
              />
            ))}
          </div>
        </Sheet>
      )}

      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}

// ── barra laterale ───────────────────────────────────────────────────────────

function Sidebar({ compact, pathname, onCreate, onSearch }) {
  const { t } = useI18n();
  const { profile, session } = useAuth();

  const item = ({ to, icon: NavIcon, labelKey }) => {
    const on = isActive(pathname, to);
    return (
      <Link
        key={to}
        to={to}
        className={`fin-navitem${on ? " fin-navitem--on" : ""}`}
        aria-current={on ? "page" : undefined}
        title={compact ? t(labelKey) : undefined}
      >
        <NavIcon size={ICON.md} aria-hidden="true" />
        {!compact && t(labelKey)}
      </Link>
    );
  };

  return (
    <aside className={`fin-sidebar${compact ? " fin-sidebar--compact" : ""}`} aria-label={t("nav.sections")}>
      <Link to="/" className="fin-sidebar__brand">
        <AppMark size={22} />
        {!compact && <span className="fin-sidebar__brandname">{t("app.name")}</span>}
      </Link>

      {/* Il "+" in cima: e' l'azione piu' frequente, e in cima si raggiunge
          senza cercarla. Su mobile lo stesso comando e' il bottone flottante. */}
      <div className="fin-sidebar__pad" style={{ display: "grid", gap: "var(--space-2)" }}>
        {compact ? (
          <Button variant="primary" onClick={onCreate} aria-label={t("create.title")} icon={<Icon.Plus size={ICON.md} />} />
        ) : (
          <Button variant="primary" block onClick={onCreate} icon={<Icon.Plus size={ICON.sm} />}>
            {t("create.title")}
          </Button>
        )}

        {compact ? (
          <IconButton onClick={onSearch} label={t("search.short")} size="lg" icon={<Icon.Search size={ICON.md} />} />
        ) : (
          <button type="button" className="fin-search" onClick={onSearch} style={{ cursor: "pointer" }}>
            <Icon.Search size={ICON.sm} aria-hidden="true" />
            <span style={{ flex: 1, textAlign: "left", fontSize: "var(--fs-body)" }}>{t("search.short")}</span>
            <kbd>⌘K</kbd>
          </button>
        )}
      </div>

      <nav className="fin-sidebar__group fin-sidebar__pad" style={{ marginTop: "var(--space-4)" }}>
        {NAV_MAIN.map(item)}
      </nav>

      {!compact && <p className="fin-sidebar__label">{t("nav.manage")}</p>}
      <nav className="fin-sidebar__group fin-sidebar__pad" style={compact ? { marginTop: "var(--space-2)" } : undefined}>
        {forProfile(NAV_MANAGE, profile?.profile_type).map(item)}
      </nav>

      <div className="fin-sidebar__foot fin-sidebar__pad">
        {!compact && <LangThemeControls />}
        {item(NAV_SETTINGS)}

        {/* Il profilo in fondo: ricorda con che account si sta guardando, che
            in un'app di soldi non e' un dettaglio. */}
        <Link to="/settings" className="fin-profile" style={compact ? { justifyContent: "center" } : undefined}>
          <span className="fin-avatar fin-avatar--sm" style={{ background: "var(--accent-fill)", color: "var(--text-on-fill)" }}>
            {initials(profile?.full_name || session?.user?.email || "?")}
          </span>
          {!compact && (
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="fin-profile__name">{profile?.full_name || session?.user?.email}</span>
              <span className="fin-profile__sub">{profile?.base_currency}</span>
            </span>
          )}
        </Link>
      </div>
    </aside>
  );
}

function SignOutButton() {
  const { t } = useI18n();
  const { signOut } = useAuth();
  return (
    <Button variant="secondary" block onClick={signOut} icon={<Icon.Logout size={ICON.sm} />}>
      {t("common.logout")}
    </Button>
  );
}
