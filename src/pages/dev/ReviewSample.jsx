// src/pages/dev/ReviewSample.jsx
// Banco di prova della vista per commerciante. Solo in sviluppo.
//
// La schermata di revisione vera ha bisogno di una sessione e di un import sul
// database: senza un modo di montarla con dati finti non si guarda e non si
// fotografa. Le proporzioni qui sotto sono quelle misurate su un estratto
// vero — 31 corse dello stesso servizio, 16 spese allo stesso supermercato —
// perche' e' su quelle che si capisce se la schermata regge.
import { useMemo, useState } from "react";
import { MerchantGroups } from "../ReviewPage";
import { Page, PageHeader, SegmentedControl } from "../../ui";
import { groupByMerchant } from "../../lib/groupByMerchant";

const CATEGORIE = [
  { id: "trasporti", key: "transport" },
  { id: "spesa", key: "groceries" },
  { id: "pasti", key: "eating_out" },
  { id: "shopping", key: "shopping" },
];

const GIORNI = ["2026-08-10", "2026-08-14", "2026-08-19", "2026-08-25", "2026-09-02"];

/** Le stesse proporzioni dell'estratto vero, con nomi inventati. */
function righeFinte() {
  const fai = (prefisso, merchant, descrizione, quante, importo, categoria = null) =>
    Array.from({ length: quante }, (_, i) => ({
      id: `${prefisso}${i}`,
      merchant,
      description: descrizione,
      amount_minor: String(-importo - i * 1000),
      booked_on: GIORNI[i % GIORNI.length],
      decision: "import",
      category_id: categoria,
      confidence: "low",
      category_source: "none",
      flags: i === 2 ? ["duplicate_probable"] : [],
    }));

  return [
    ...fai("g", "grab a", "Grab* A-9MEVAQOWXXI8AV", 31, 21000),
    ...fai("w", "wcm winmart 2ab1 hcm", "WCM_WINMART_2AB1 HCM", 16, 152500, "spesa"),
    ...fai("m", "cty tnhh ministop vn", "CTY TNHH MINISTOP VN", 6, 32000),
    ...fai("s", "shopee", "Shopee", 3, 311290),
    // Un gruppo misto: due righe, due categorie diverse.
    { id: "x0", merchant: "kohakuudon ramen", description: "KOHAKUUDON RAMENVINCOMTH", amount_minor: "-347760", booked_on: "2026-08-10", decision: "import", category_id: "pasti", flags: [] },
    { id: "x1", merchant: "kohakuudon ramen", description: "KOHAKUUDON RAMENVINCOMTH", amount_minor: "-129000", booked_on: "2026-08-22", decision: "import", category_id: null, flags: [] },
    // Una riga senza commerciante: deve restare sola.
    { id: "z0", merchant: null, description: "RTP TRANSFER TO 622211013642", amount_minor: "3300000", booked_on: "2026-08-11", decision: "import", category_id: null, flags: [] },
  ];
}

export default function ReviewSample() {
  const [righe, setRighe] = useState(righeFinte);
  const [vista, setVista] = useState("merchants");

  const gruppi = useMemo(() => groupByMerchant(righe), [righe]);

  const cambiaCategoria = (gruppo, categoryId) => {
    const ids = new Set(gruppo.rows.map(r => r.id));
    setRighe(prev => prev.map(r => (ids.has(r.id) ? { ...r, category_id: categoryId || null } : r)));
  };

  const cambiaDecisione = (gruppo, decision) => {
    const ids = new Set(gruppo.rows.map(r => r.id));
    setRighe(prev => prev.map(r => (ids.has(r.id) ? { ...r, decision } : r)));
  };

  const daFare = gruppi.filter(g => g.categoryId == null || g.mixed).length;

  return (
    <Page>
      <PageHeader
        title="Revisione — per commerciante"
        subtitle={`${righe.length} movimenti in ${gruppi.length} gruppi, ${daFare} ancora da categorizzare.`}
      />
      <div className="fin-toolbar">
        <SegmentedControl
          label="Vista"
          value={vista}
          onChange={setVista}
          options={[
            { value: "merchants", label: `Per commerciante (${gruppi.length})` },
            { value: "rows", label: `Per movimento (${righe.length})` },
          ]}
        />
      </div>
      <MerchantGroups
        groups={gruppi}
        currency="VND"
        categories={CATEGORIE}
        locale="it"
        onCategory={cambiaCategoria}
        onDecision={cambiaDecisione}
      />
    </Page>
  );
}
