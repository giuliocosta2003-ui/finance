// src/pages/dev/ShellSample.jsx
// Contenuto finto da mettere dentro il guscio, per guardare la navigazione
// alle tre larghezze senza dipendere da nessun dato. Lo monta DevPage.
import { Amount, Avatar, Card, CardTitle, ChartFrame, ListRow, QuickAction, RowGroup, SegmentedControl } from "../../ui";
import { Icon } from "../../components/icons";

const RIGHE = [
  { id: "1", name: "Esselunga", cat: "Spesa", minor: -4530n },
  { id: "2", name: "Stipendio settembre", cat: "Reddito", minor: 250000n },
  { id: "3", name: "Netflix", cat: "Abbonamenti", minor: -1299n },
  { id: "4", name: "Affitto", cat: "Casa", minor: -95000n },
];

export default function ShellSample() {
  return (
    <>
      <div style={{ display: "grid", gap: "var(--space-5)" }}>
        <Card>
          <CardTitle>Patrimonio</CardTitle>
          <div style={{ marginTop: "var(--space-2)" }}>
            <Amount minor={4831200n} currency="EUR" variant="hero" tone="plain" />
          </div>
          <div className="fin-quickrow" style={{ marginTop: "var(--space-5)" }}>
            <QuickAction accent icon={<Icon.Plus size={20} />} label="Aggiungi" />
            <QuickAction icon={<Icon.Transfer size={20} />} label="Trasferisci" />
            <QuickAction icon={<Icon.Refresh size={20} />} label="Importa" />
            <QuickAction icon={<Icon.Documents size={20} />} label="Documento" />
          </div>
        </Card>

        <ChartFrame
          title="Ultimi 6 mesi"
          value={<Amount minor={-128400n} currency="EUR" signDisplay="exceptZero" />}
          actions={<SegmentedControl
            label="Intervallo"
            value="s"
            onChange={() => {}}
            options={[{ value: "m", label: "1M" }, { value: "s", label: "6M" }, { value: "a", label: "1A" }]}
          />}
        >
          <div style={{ height: 120, display: "grid", placeItems: "center", color: "var(--text-tertiary)" }}>
            <span className="fin-caption">grafico</span>
          </div>
        </ChartFrame>

        <Card flush>
          <RowGroup>Oggi</RowGroup>
          {RIGHE.map(r => (
            <ListRow
              key={r.id}
              as="button"
              avatar={<Avatar name={r.name} colorKey={r.cat} />}
              title={r.name}
              subtitle={r.cat}
              end={<Amount minor={r.minor} currency="EUR" />}
            />
          ))}
        </Card>
      </div>
    </>
  );
}
