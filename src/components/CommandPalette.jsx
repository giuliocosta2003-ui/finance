// src/components/CommandPalette.jsx
// Ricerca globale da tastiera (⌘K / Ctrl+K), solo su desktop.
//
// Cerca fra movimenti, commercianti e investimenti. Non aggiunge nessun dato
// nuovo al database: usa le stesse query che le schermate fanno gia', con un
// `ilike` sui campi di testo. Le sezioni dell'app sono nei risultati anche
// loro, cosi' la palette serve anche a navigare senza mouse.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../contexts/AuthContext";
import { Icon } from "./icons";
import { Amount, Avatar, ListRow, RowGroup } from "../ui";
import { formatDate } from "../lib/format";
import { NAV_ALL } from "./nav";

const LIMIT = 6;
/** Sotto i due caratteri ogni ricerca restituirebbe mezzo database. */
const MIN_CHARS = 2;

export default function CommandPalette({ onClose }) {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [q, setQ] = useState("");
  const [rows, setRows] = useState({ tx: [], holdings: [] });
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Le sezioni si filtrano in locale: sono sette, non serve la rete.
  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return NAV_ALL;
    return NAV_ALL.filter(item => t(item.labelKey).toLowerCase().includes(needle));
  }, [q, t]);

  useEffect(() => {
    const needle = q.trim();
    // eslint-disable-next-line react/set-state-in-effect
    if (needle.length < MIN_CHARS) { setRows({ tx: [], holdings: [] }); return undefined; }

    // Mezzo secondo di pausa prima di interrogare: digitando "esselunga" senza
    // attesa partirebbero nove richieste, otto delle quali inutili.
    let alive = true;
    const timer = setTimeout(async () => {
      const like = `%${needle}%`;
      const [tx, holdings] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, booked_on, description, merchant, amount_minor, currency, kind")
          .or(`description.ilike.${like},merchant.ilike.${like}`)
          .order("booked_on", { ascending: false })
          .limit(LIMIT),
        supabase
          .from("holdings")
          .select("id, name, symbol, isin, asset_class, currency")
          .or(`name.ilike.${like},symbol.ilike.${like},isin.ilike.${like}`)
          .limit(LIMIT),
      ]);
      if (!alive) return;
      setRows({ tx: tx.data ?? [], holdings: holdings.data ?? [] });
      setCursor(0);
    }, 250);

    return () => { alive = false; clearTimeout(timer); };
  }, [q]);

  /** Tutti i risultati in un unico elenco: e' quello che scorrono le frecce. */
  const flat = useMemo(() => [
    ...sections.map(s => ({ kind: "section", id: s.to, item: s })),
    ...rows.tx.map(r => ({ kind: "tx", id: r.id, item: r })),
    ...rows.holdings.map(r => ({ kind: "holding", id: r.id, item: r })),
  ], [sections, rows]);

  const go = useCallback((entry) => {
    if (!entry) return;
    if (entry.kind === "section") navigate(entry.item.to);
    if (entry.kind === "tx") navigate(`/transactions?tx=${entry.item.id}`);
    if (entry.kind === "holding") navigate(`/investments/${entry.item.id}`);
    onClose();
  }, [navigate, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, flat.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
      if (e.key === "Enter") { e.preventDefault(); go(flat[cursor]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, cursor, go, onClose]);

  // La voce sotto il cursore deve restare visibile anche scorrendo con le frecce.
  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const base = profile?.base_currency;

  /** Il titolo di gruppo si stampa quando cambia il tipo di risultato. */
  const groupLabel = { section: t("search.sections"), tx: t("nav.transactions"), holding: t("nav.investments") };

  return (
    <>
      <div className="fin-overlay" onClick={onClose} aria-hidden="true" />
      <div className="fin-palette" role="dialog" aria-modal="true" aria-label={t("search.title")}>
        <div className="fin-palette__input">
          <Icon.Search size={18} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.title")}
            // La palette gestisce le frecce da sola: il browser non deve
            // spostare il cursore nel campo mentre si scorre l'elenco.
            onKeyDown={e => { if (e.key === "ArrowDown" || e.key === "ArrowUp") e.preventDefault(); }}
          />
          <kbd style={{
            fontSize: "var(--fs-micro)", color: "var(--text-tertiary)",
            border: "1px solid var(--border-strong)", borderRadius: "var(--radius-control)",
            padding: "1px 5px",
          }}>esc</kbd>
        </div>

        <div className="fin-palette__results" ref={listRef}>
          {flat.length === 0 && (
            <p className="fin-palette__empty">
              {q.trim().length < MIN_CHARS ? t("search.hint") : t("search.empty")}
            </p>
          )}

          {/* Si scorre l'elenco unico e si stampa un titolo quando cambia il
              tipo: cosi' l'indice usato dalle frecce e quello disegnato sono
              per forza lo stesso numero, senza contatori paralleli. */}
          {flat.map((entry, i) => {
            const header = i === 0 || flat[i - 1].kind !== entry.kind
              ? <RowGroup key={`g-${entry.kind}`}>{groupLabel[entry.kind]}</RowGroup>
              : null;

            const common = {
              as: "button",
              "data-cursor": cursor === i,
              selected: cursor === i,
              onMouseEnter: () => setCursor(i),
              onClick: () => go(entry),
            };

            let row;
            if (entry.kind === "section") {
              const SectionIcon = entry.item.icon;
              row = (
                <ListRow
                  {...common}
                  avatar={
                    <span className="fin-avatar fin-avatar--sm"
                          style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
                      <SectionIcon size={15} />
                    </span>
                  }
                  title={t(entry.item.labelKey)}
                />
              );
            } else if (entry.kind === "tx") {
              const r = entry.item;
              const label = r.description || r.merchant || t("tx.noDescription");
              row = (
                <ListRow
                  {...common}
                  avatar={<Avatar name={label} colorKey={r.merchant ?? label} size="sm" />}
                  title={label}
                  subtitle={formatDate(r.booked_on, lang)}
                  end={<Amount minor={r.amount_minor} currency={r.currency?.trim()} />}
                />
              );
            } else {
              const r = entry.item;
              row = (
                <ListRow
                  {...common}
                  avatar={<Avatar name={r.name} colorKey={r.asset_class} size="sm" />}
                  title={r.name}
                  subtitle={[t(`assetClass.${r.asset_class}`), r.symbol, r.isin?.trim()]
                    .filter(Boolean).join(" · ")}
                  endSub={base && r.currency?.trim() !== base ? r.currency?.trim() : undefined}
                />
              );
            }

            return <div key={`${entry.kind}-${entry.id}`}>{header}{row}</div>;
          })}
        </div>
      </div>
    </>
  );
}
