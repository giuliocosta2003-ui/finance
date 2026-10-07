// src/pages/dev/UiGallery.jsx
// Galleria del design system. Montata SOLO in sviluppo (vedi App.jsx): serve a
// guardare tutti i componenti insieme, e a fare gli screenshot di verifica.
//
// I due temi sono affiancati sulla stessa pagina invece che alternati con un
// interruttore: un componente che in chiaro perde contrasto si vede subito se
// ce l'hai accanto, mentre alternando te ne dimentichi.
//
// Le etichette qui dentro sono nomi di componenti, non testo di prodotto: la
// regola "niente stringhe fuori dai file i18n" vale per l'app, e questa pagina
// nell'app non ci arriva mai.
import { useState } from "react";
import {
  Amount, Avatar, Badge, Button, Card, CardHeader, CardTitle, ChartFrame,
  Checkbox, Chip, ChoiceRow, CurrencySelector, DataTable, DateRangePicker,
  EmptyState, ErrorState, Field, IconButton, InlineAlert, Input, LegendItem,
  ListRow, PageHeader, QuickAction, RowGroup, SearchField, SegmentedControl,
  Select, Sheet, Skeleton, SkeletonRows, Stat, StatGrid, Switch, Tabs, Tag,
  Textarea,
} from "../../ui";
import { Icon, ICON } from "../../components/icons";
import { categoryColor } from "../../theme/tokens";

const SPESE = [
  { id: "1", name: "Esselunga", cat: "Spesa", minor: -4530n, cur: "EUR" },
  { id: "2", name: "Stipendio settembre", cat: "Reddito", minor: 250000n, cur: "EUR" },
  { id: "3", name: "Netflix", cat: "Abbonamenti", minor: -1299n, cur: "EUR" },
  { id: "4", name: "Highlands Coffee", cat: "Bar", minor: -6500000n, cur: "VND" },
];

export default function UiGallery() {
  // `?theme=dark` o `?theme=light` mostra un tema solo: serve agli screenshot
  // automatici, che devono fotografare un tema per volta.
  const only = new URLSearchParams(window.location.search).get("theme");
  const themes = only === "dark" || only === "light" ? [only] : ["light", "dark"];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: themes.length === 1 ? "1fr" : "repeat(auto-fit, minmax(420px, 1fr))",
        minHeight: "100dvh",
      }}
    >
      {themes.map(t => <ThemePane key={t} theme={t} />)}
    </div>
  );
}

/* I token stanno su [data-theme=...], che e' un selettore di attributo: vale su
   qualunque elemento, non solo su <html>. Annidarlo qui fa convivere i due temi
   nella stessa pagina. */
function ThemePane({ theme }) {
  return (
    <div
      data-theme={theme}
      style={{
        background: "var(--surface-bg)",
        color: "var(--text)",
        padding: "var(--space-6)",
        display: "grid",
        gap: "var(--space-8)",
        alignContent: "start",
        borderLeft: theme === "dark" ? "1px solid var(--border)" : undefined,
      }}
    >
      <p className="fin-eyebrow">{theme}</p>
      <Gallery />
    </div>
  );
}

function Section({ title, children, style }) {
  return (
    <section style={{ display: "grid", gap: "var(--space-3)", ...style }}>
      <p className="fin-eyebrow">{title}</p>
      {children}
    </section>
  );
}

function Row({ children, align = "center" }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: align }}>
      {children}
    </div>
  );
}

function Gallery() {
  const [seg, setSeg] = useState("m");
  const [tab, setTab] = useState("all");
  const [chip, setChip] = useState("a");
  const [q, setQ] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const [cur, setCur] = useState("EUR");
  const [sheet, setSheet] = useState(false);
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [selected, setSelected] = useState(() => new Set(["2"]));
  const [choice, setChoice] = useState("lifo");
  const [aiOn, setAiOn] = useState(true);
  const [archived, setArchived] = useState(false);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <>
      {/* ── tipografia ───────────────────────────────────────────────────── */}
      <Section title="Tipografia">
        <Card>
          <p className="fin-h1">Titolo H1 24</p>
          <p className="fin-h2">Titolo H2 18</p>
          <p className="fin-h3">Titolo H3 16</p>
          <p className="fin-body">Corpo 14 — il testo normale dell'app.</p>
          <p className="fin-muted">Secondario 14 — dettagli e contorno.</p>
          <p className="fin-caption">Didascalia 12 — date, fonti, note.</p>
          <p className="fin-eyebrow" style={{ marginTop: "var(--space-2)" }}>Etichetta 11</p>
        </Card>
      </Section>

      {/* ── importi ──────────────────────────────────────────────────────── */}
      <Section title="Amount">
        <Card>
          <CardTitle>Saldo principale</CardTitle>
          <div style={{ marginTop: "var(--space-2)" }}>
            <Amount minor={1234567n} currency="EUR" variant="hero" tone="neutral" />
          </div>
          <p className="fin-caption" style={{ marginTop: "var(--space-2)" }}>
            I centesimi sono piu' piccoli e piu' chiari: si leggono gli euro, non i centesimi.
          </p>

          <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-5)" }}>
            <Row><span className="fin-caption" style={{ width: 120 }}>entrata</span>
              <Amount minor={250000n} currency="EUR" /></Row>
            <Row><span className="fin-caption" style={{ width: 120 }}>uscita</span>
              <Amount minor={-4530n} currency="EUR" /></Row>
            <Row><span className="fin-caption" style={{ width: 120 }}>zero</span>
              <Amount minor={0n} currency="EUR" /></Row>
            <Row><span className="fin-caption" style={{ width: 120 }}>P&amp;L</span>
              <Amount minor={18240n} currency="EUR" signDisplay="exceptZero" /></Row>
            <Row><span className="fin-caption" style={{ width: 120 }}>VND, 0 decimali</span>
              <Amount minor={6500000n} currency="VND" /></Row>
            <Row><span className="fin-caption" style={{ width: 120 }}>KWD, 3 decimali</span>
              <Amount minor={12345n} currency="KWD" /></Row>
            <Row><span className="fin-caption" style={{ width: 120 }}>mancante</span>
              <Amount minor={null} currency="EUR" /></Row>
          </div>
        </Card>
      </Section>

      {/* ── pulsanti ─────────────────────────────────────────────────────── */}
      <Section title="Button">
        <Row>
          <Button variant="primary">Primario</Button>
          <Button variant="secondary">Secondario</Button>
          <Button variant="tertiary">Terziario</Button>
          <Button variant="quiet">Neutro</Button>
          <Button variant="danger">Elimina</Button>
        </Row>
        <Row>
          <Button variant="primary" size="sm">Piccolo</Button>
          <Button variant="primary" size="lg">Grande</Button>
          <Button variant="primary" disabled>Disabilitato</Button>
          <Button variant="secondary" icon={<Icon.Plus size={ICON.sm} />} aria-label="Aggiungi" />
        </Row>
        <Row>
          <IconButton label="Modifica" icon={<Icon.Edit size={ICON.sm} />} />
          <IconButton label="Archivia" icon={<Icon.Archive size={ICON.sm} />} />
          <IconButton tone="danger" label="Elimina" icon={<Icon.Delete size={ICON.sm} />} />
          <IconButton bare label="Cerca" icon={<Icon.Search size={ICON.sm} />} />
          <IconButton disabled label="Disabilitato" icon={<Icon.Up size={ICON.sm} />} />
        </Row>
        <Button variant="primary" block icon={<Icon.Check size={ICON.sm} />}>A tutta larghezza</Button>
      </Section>

      <Section title="QuickAction">
        <Row align="flex-start">
          <QuickAction accent icon={<Icon.Plus size={ICON.md} />} label="Aggiungi" />
          <QuickAction icon={<Icon.Transfer size={ICON.md} />} label="Trasferisci" />
          <QuickAction icon={<Icon.Documents size={ICON.md} />} label="Importa" />
          <QuickAction icon={<Icon.Investments size={ICON.md} />} label="Investi" />
        </Row>
      </Section>

      {/* ── selezione ────────────────────────────────────────────────────── */}
      <Section title="Chip, Tag, Segmented, Tabs">
        <Row>
          {["a", "b", "c"].map(k => (
            <Chip key={k} on={chip === k} onClick={() => setChip(k)} count={k === "a" ? 12 : undefined}>
              Filtro {k.toUpperCase()}
            </Chip>
          ))}
        </Row>
        <Row>
          <Tag tone="var(--positive)">confermato</Tag>
          <Tag tone="var(--warning)">da controllare</Tag>
          <Tag tone="var(--negative)">non riuscito</Tag>
          <Tag tone="var(--info)">in lettura</Tag>
        </Row>
        <Row>
          <SegmentedControl
            label="Intervallo"
            value={seg}
            onChange={setSeg}
            options={[{ value: "m", label: "1M" }, { value: "s", label: "6M" }, { value: "a", label: "1A" }]}
          />
        </Row>
        <Tabs
          label="Sezioni"
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: "Tutte" },
            { value: "in", label: "Entrate" },
            { value: "out", label: "Uscite" },
          ]}
        />
      </Section>

      {/* ── righe ────────────────────────────────────────────────────────── */}
      <Section title="ListRow e Avatar">
        <Card flush>
          <RowGroup>Oggi</RowGroup>
          {SPESE.map(s => (
            <ListRow
              key={s.id}
              as="button"
              avatar={<Avatar name={s.name} colorKey={s.cat} />}
              title={s.name}
              subtitle={s.cat}
              end={<Amount minor={s.minor} currency={s.cur} />}
              endSub={s.cur === "VND" ? "≈ 245,00 €" : undefined}
            />
          ))}
          <RowGroup>Ieri</RowGroup>
          <ListRow
            as="button"
            selected
            avatar={<Avatar name="Ikea" colorKey="Casa" />}
            title="Ikea"
            subtitle="Casa · selezionata"
            end={<Amount minor={-8900n} currency="EUR" />}
          />
        </Card>
        <Row>
          <Avatar name="Esselunga" size="sm" />
          <Avatar name="Netflix" size="md" />
          <Avatar name="Highlands Coffee" size="lg" />
          <Avatar name="?" square icon={<Icon.Accounts size={ICON.md} />} />
        </Row>
      </Section>

      {/* ── colori ───────────────────────────────────────────────────────── */}
      <Section title="Colori delle categorie">
        <Row>
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              title={`--cat-${i + 1}`}
              style={{
                width: 40, height: 40, borderRadius: "var(--radius-control)",
                background: `var(--cat-${i + 1})`,
                display: "grid", placeItems: "center",
                color: "var(--text-on-cat)", fontSize: "var(--fs-micro)",
                fontWeight: "var(--fw-bold)",
              }}
            >{i + 1}</span>
          ))}
        </Row>
        <Row>
          {["accent", "accent-fill", "positive", "negative", "warning", "info"].map(name => (
            <span key={name} style={{ display: "grid", gap: 4, justifyItems: "center" }}>
              <span style={{
                width: 56, height: 32, borderRadius: "var(--radius-control)", background: `var(--${name})`,
              }} />
              <span className="fin-caption">{name}</span>
            </span>
          ))}
        </Row>
      </Section>

      {/* ── campi ────────────────────────────────────────────────────────── */}
      <Section title="Campi">
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="Cerca fra movimenti e investimenti"
          shortcut="⌘K"
          icon={<Icon.Search size={ICON.sm} />}
        />
        <Field label="Nome" htmlFor="g-name" hint="Come lo chiami tu.">
          <Input id="g-name" placeholder="Conto corrente" />
        </Field>
        <Field label="Tipo" htmlFor="g-type">
          <Select id="g-type" defaultValue="checking">
            <option value="checking">Conto corrente</option>
            <option value="cash">Contanti</option>
          </Select>
        </Field>
        <Field label="Importo" htmlFor="g-amount" error="Inserisci un importo valido.">
          <Input id="g-amount" inputMode="decimal" defaultValue="1.234,56" />
        </Field>
        <Field label="Valuta" htmlFor="g-cur">
          <CurrencySelector id="g-cur" value={cur} onChange={setCur} suggested={["EUR", "USD", "VND"]} />
        </Field>
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} idPrefix="g" />
      </Section>

      {/* ── grafico ──────────────────────────────────────────────────────── */}
      <Section title="ChartFrame">
        <ChartFrame
          title="Patrimonio"
          value={<Amount minor={4831200n} currency="EUR" variant="hero" tone="neutral" />}
          actions={<SegmentedControl
            label="Intervallo"
            value={seg}
            onChange={setSeg}
            options={[{ value: "m", label: "1M" }, { value: "s", label: "6M" }, { value: "a", label: "1A" }]}
          />}
          legend={<>
            <LegendItem color="var(--cat-1)" label="Immobili" value="52%" />
            <LegendItem color="var(--cat-8)" label="ETF" value="31%" />
            <LegendItem color="var(--cat-5)" label="Crypto" value="17%" />
          </>}
        >
          <FakeChart />
        </ChartFrame>
      </Section>

      {/* ── tabella ──────────────────────────────────────────────────────── */}
      <Section title="DataTable">
        <Card flush>
          <DataTable
            columns={[
              { key: "name", header: "Descrizione", sortable: true },
              { key: "cat", header: "Categoria" },
              {
                key: "minor", header: "Importo", align: "right", sortable: true,
                render: r => <Amount minor={r.minor} currency={r.cur} />,
              },
            ]}
            rows={SPESE}
            sort={sort}
            onSort={key => setSort(s => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }))}
            selected={selected}
            onToggle={toggle}
            onToggleAll={() => setSelected(s => s.size === SPESE.length ? new Set() : new Set(SPESE.map(r => r.id)))}
          />
        </Card>
      </Section>

      {/* ── stati ────────────────────────────────────────────────────────── */}
      <Section title="Stati">
        <Card><SkeletonRows rows={3} /></Card>
        <Card>
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <Skeleton width="40%" height={28} />
            <Skeleton width="70%" />
            <Skeleton width="55%" />
          </div>
        </Card>
        <Card>
          <EmptyState
            icon={<Icon.Documents size={ICON.lg} />}
            title="Nessun movimento"
            body="Importa il primo estratto conto: i movimenti compaiono qui."
            action={<Button variant="primary">Importa un estratto</Button>}
          />
        </Card>
        <Card>
          <ErrorState
            icon={<Icon.Warning size={ICON.lg} />}
            title="Non siamo riusciti a caricare"
            body="La connessione al database non ha risposto."
            onRetry={() => {}}
          />
        </Card>
      </Section>

      {/* ── intestazione di pagina ───────────────────────────────────────── */}
      <Section title="PageHeader">
        <PageHeader
          backTo="/dev/ui"
          backLabel="Investimenti"
          title="Vanguard FTSE All-World"
          subtitle="ETF · EUR · IE00BK5BQT80 · CoinGecko"
          actions={<Button icon={<Icon.Edit size={ICON.sm} />}>Modifica</Button>}
        />
      </Section>

      {/* ── prospetto ────────────────────────────────────────────────────── */}
      <Section title="StatGrid">
        <StatGrid>
          <Stat label="Entrate del mese" value={<Amount minor={250000n} currency="EUR" tone="in" variant="lg" signDisplay="exceptZero" />} />
          <Stat label="Uscite del mese" value={<Amount minor={-98730n} currency="EUR" tone="out" variant="lg" />} />
          <Stat
            label="Risparmiato"
            value={<Amount minor={151270n} currency="EUR" variant="lg" signDisplay="exceptZero" />}
            hint="61% delle entrate"
          />
          <Stat label="Investito" value={<Amount minor={4831200n} currency="EUR" tone="neutral" variant="lg" />} />
        </StatGrid>
      </Section>

      {/* ── avvisi ───────────────────────────────────────────────────────── */}
      <Section title="InlineAlert">
        <InlineAlert tone="info">Il consenso all'AI e' spento: i campi si compilano a mano.</InlineAlert>
        <InlineAlert tone="success">Import confermato: 42 movimenti aggiunti.</InlineAlert>
        <InlineAlert tone="warning" title="Il saldo non torna.">
          Lo scarto e' di 12,40 € sul periodo dichiarato.
        </InlineAlert>
        <InlineAlert
          tone="error"
          action={<Button size="sm">Riprova</Button>}
        >
          3 righe sono in un'altra valuta: l'import e' bloccato.
        </InlineAlert>
      </Section>

      {/* ── card con intestazione ────────────────────────────────────────── */}
      <Section title="Card con intestazione e piede">
        <Card flush>
          <CardHeader actions={<Button variant="ghost" size="sm">Vedi tutti</Button>}>
            <CardTitle>Ultimi movimenti</CardTitle>
          </CardHeader>
          <div className="fin-card__body">
            <p className="fin-muted">Il corpo della card.</p>
          </div>
          <div className="fin-card__foot">
            <span className="fin-caption">Aggiornato 5 minuti fa</span>
            <div style={{ marginLeft: "auto" }}>
              <Button size="sm">Aggiorna</Button>
            </div>
          </div>
        </Card>
      </Section>

      {/* ── scelte ───────────────────────────────────────────────────────── */}
      <Section title="ChoiceRow, Checkbox, Switch">
        <div role="radiogroup" aria-label="Metodo" style={{ display: "grid", gap: "var(--space-2)" }}>
          {[
            ["lifo", "LIFO", "Cedute per prime le quote comprate piu' di recente."],
            ["fifo", "FIFO", "Cedute per prime le quote comprate prima."],
            ["average", "Costo medio", "Un costo unico per tutte le quote."],
          ].map(([value, label, hint]) => (
            <ChoiceRow
              key={value}
              role="radio"
              selected={choice === value}
              onClick={() => setChoice(value)}
              style={{ display: "block" }}
            >
              <span style={{ display: "block", fontWeight: "var(--fw-semibold)" }}>{label}</span>
              <span className="fin-hint" style={{ display: "block", marginTop: 2 }}>{hint}</span>
            </ChoiceRow>
          ))}
        </div>
        <Row>
          <Checkbox checked={archived} onChange={setArchived} label="Mostra anche gli archiviati" />
        </Row>
        <Row>
          <span className="fin-body" style={{ flex: 1 }}>Consenso all'analisi AI</span>
          <Switch checked={aiOn} onChange={setAiOn} label="Consenso all'analisi AI" />
        </Row>
        <Field label="Note" htmlFor="g-notes">
          <Textarea id="g-notes" placeholder="Due righe su questo movimento…" />
        </Field>
      </Section>

      {/* ── pastiglie ────────────────────────────────────────────────────── */}
      <Section title="Badge">
        <Row>
          <Badge>archiviato</Badge>
          <Badge tone="var(--positive)">confermato</Badge>
          <Badge tone="var(--warning)" soft="var(--warning-soft)">da controllare</Badge>
          <Badge tone="var(--negative)" soft="var(--negative-soft)">non riuscito</Badge>
          <Badge tone="var(--info)" icon={<Icon.Transfer size={ICON.inline} />}>trasferimento</Badge>
        </Row>
      </Section>

      {/* ── sheet ────────────────────────────────────────────────────────── */}
      <Section title="Sheet">
        <Row>
          <Button variant="secondary" onClick={() => setSheet(true)}>
            Apri il pannello
          </Button>
          <span className="fin-caption">
            Foglio dal basso sotto 768 px, pannello a destra sopra.
          </span>
        </Row>
        {sheet && (
          <Sheet
            title="Dettaglio movimento"
            onClose={() => setSheet(false)}
            footer={<>
              <Button variant="quiet" onClick={() => setSheet(false)}>Annulla</Button>
              <Button variant="primary" onClick={() => setSheet(false)}>Salva</Button>
            </>}
          >
            <div style={{ display: "grid", gap: "var(--space-5)", justifyItems: "center" }}>
              <Avatar name="Esselunga" size="lg" />
              <Amount minor={-4530n} currency="EUR" variant="hero" tone="out" />
              <p className="fin-muted">Esselunga Milano · 1 settembre</p>
            </div>
          </Sheet>
        )}
      </Section>
    </>
  );
}

/** Una linea finta, solo per vedere la cornice: il grafico vero e' ValueChart. */
function FakeChart() {
  const pts = [8, 22, 16, 34, 28, 46, 40, 58, 52, 70, 64, 82];
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"} ${(i / (pts.length - 1)) * 300} ${90 - v}`).join(" ");
  return (
    <svg viewBox="0 0 300 100" style={{ width: "100%", height: 120, display: "block" }} aria-hidden="true">
      <path d={`${d} L 300 100 L 0 100 Z`} fill={categoryColor("x")} opacity=".12" />
      <path d={d} fill="none" stroke="var(--accent-fill)" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
