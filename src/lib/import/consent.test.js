// src/lib/import/consent.test.js — node --test
// Il consenso all'AI e' un interruttore, non una formalita'.
//
// Il divieto e' scritto in due punti — qui nel client e nell'handler della Edge
// Function — perche' un solo controllo, ovunque stia, e' un controllo che prima
// o poi qualcuno aggira. Questo test verifica quello del client contando le
// chiamate: zero deve voler dire zero.
import test from "node:test";
import assert from "node:assert/strict";
import { persistRows } from "./persist.js";

/**
 * Un finto client Supabase: registra cosa gli viene chiesto e non parla con
 * nessuno. Serve a contare le chiamate alla Edge Function, che e' l'unica cosa
 * che questo test vuole misurare.
 */
function fakeSupabase({ rules = [], uncategorized = 0 }) {
  const log = { invokes: [], inserts: [], updates: [] };

  const resultFor = (table, q) => {
    if (table === "merchant_rules" && q.op === "select") return { data: rules, error: null };
    if (table === "import_rows" && q.op === "select" && q.counting) {
      return { count: uncategorized, error: null };
    }
    return { data: null, error: null };
  };

  const query = (table) => {
    const q = { op: null, counting: false };
    const self = {
      select(_cols, opts) { q.op = "select"; q.counting = !!opts?.count; return self; },
      insert(values) { q.op = "insert"; log.inserts.push({ table, values }); return self; },
      update(patch) { q.op = "update"; log.updates.push({ table, patch }); return self; },
      eq: () => self, is: () => self, in: () => self, order: () => self, limit: () => self,
      maybeSingle: () => Promise.resolve(resultFor(table, q)),
      then: (ok, ko) => Promise.resolve(resultFor(table, q)).then(ok, ko),
    };
    return self;
  };

  return {
    log,
    from: query,
    rpc: async () => ({ data: [], error: null }),
    functions: {
      invoke: async (name, options) => {
        log.invokes.push({ name, options });
        return { data: { assigned: 0 }, error: null };
      },
    },
  };
}

const righe = [
  { rowIndex: 0, bookedOn: "2026-09-01", description: "POS ESSELUNGA", merchant: "esselunga",
    amountMinor: -4530n, currency: "EUR", flags: [], dedupeHash: "a".repeat(64) },
  { rowIndex: 1, bookedOn: "2026-09-05", description: "STIPENDIO", merchant: "stipendio",
    amountMinor: 250000n, currency: "EUR", flags: [], dedupeHash: "b".repeat(64) },
];

test("senza consenso non parte nessuna chiamata all'AI", async () => {
  const db = fakeSupabase({ uncategorized: righe.length });
  await persistRows(db, { importId: "imp-1", rows: righe, aiConsent: false });

  assert.equal(db.log.invokes.length, 0);
  // Le righe entrano lo stesso: senza AI restano solo senza categoria.
  assert.equal(db.log.inserts.filter(i => i.table === "import_rows").length, 1);
});

test("col consenso, e solo se resta qualcosa da categorizzare, l'AI viene chiamata", async () => {
  const db = fakeSupabase({ uncategorized: 2 });
  await persistRows(db, { importId: "imp-1", rows: righe, aiConsent: true });

  assert.equal(db.log.invokes.length, 1);
  assert.equal(db.log.invokes[0].name, "import-ai");
  assert.equal(db.log.invokes[0].options.body.action, "categorize");
});

test("se le regole coprono tutto, l'AI non serve nemmeno col consenso", async () => {
  const db = fakeSupabase({ uncategorized: 0 });
  await persistRows(db, { importId: "imp-1", rows: righe, aiConsent: true });
  assert.equal(db.log.invokes.length, 0);
});

test("una regola applicata aggiorna il suo contatore d'uso", async () => {
  const rules = [{ id: "r-1", pattern: "esselunga", match_type: "exact", category_id: "cat-1", priority: 0, hits: 4 }];
  const db = fakeSupabase({ rules, uncategorized: 1 });
  await persistRows(db, { importId: "imp-1", rows: righe, aiConsent: false });

  const hit = db.log.updates.find(u => u.table === "merchant_rules");
  assert.equal(hit.patch.hits, 5);
  assert.ok(hit.patch.last_used_at);
});

test("alla fine l'import passa in revisione, con il periodo e l'esito del saldo", async () => {
  const db = fakeSupabase({ uncategorized: 0 });
  await persistRows(db, {
    importId: "imp-1", rows: righe, aiConsent: false,
    balanceCheck: "ok", period: { from: "2026-09-01", to: "2026-09-05" },
  });

  const patch = db.log.updates.find(u => u.table === "imports").patch;
  assert.equal(patch.status, "review");
  assert.equal(patch.rows_total, 2);
  assert.equal(patch.balance_check, "ok");
  assert.equal(patch.period_from, "2026-09-01");
  assert.equal(patch.period_to, "2026-09-05");
});
