// supabase/functions/fx-daily/index.ts
//
// Scarica i tassi di cambio (pivot USD) e li salva in fx_rates.
//
// Autenticazione: verify_jwt = false, perche' a chiamarla e' pg_cron, che non
// ha un utente. Al suo posto vale l'header x-cron-secret, confrontato con il
// segreto FX_CRON_SECRET: prima si guarda fra le variabili d'ambiente della
// funzione, e se non c'e' si legge dal Vault (dove sta comunque, perche' serve
// anche a pg_cron per costruire la chiamata).
//
// Corpo della richiesta (tutto facoltativo):
//   { "from": "2026-01-01", "to": "2026-03-31" }  -> backfill di un intervallo
//   { "maxDays": 60 }                              -> limite di giorni per run
// Senza corpo: completa i giorni mancanti fino a oggi e le date delle
// transazioni ancora senza tasso.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_DAYS_DEFAULT = 60;
// Oltre questa distanza conviene un'unica chiamata a intervallo invece di N
// chiamate giorno per giorno.
const RANGE_THRESHOLD = 7;
// Uno scarto oltre il 30% da un giorno all'altro non e' un cambio, e' un dato
// sbagliato: non si salva e si annota nel log.
const ANOMALY_RATIO = 0.3;

type Rates = Record<string, number>;
type DayResult = { date: string; source: string; rates: Rates };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function cronSecret(): Promise<string | null> {
  const fromEnv = Deno.env.get("FX_CRON_SECRET");
  if (fromEnv) return fromEnv;
  const { data } = await admin.rpc("fx_cron_secret");
  return data ?? null;
}

// ── Fonti ────────────────────────────────────────────────────────────────────
// In ordine: fawazahmed0, il suo mirror, Frankfurter. Ognuna restituisce la
// data che ha davvero (quella richiesta puo' non esistere), e i tassi vengono
// salvati sotto quella data, non sotto quella chiesta.

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

async function fromFawaz(url: string, source: string, date: string): Promise<DayResult> {
  const j = await fetchJson(url) as { date?: string; usd?: Record<string, number> };
  if (!j?.usd) throw new Error("risposta senza campo usd");
  const rates: Rates = {};
  for (const [code, rate] of Object.entries(j.usd)) {
    if (typeof rate === "number") rates[code.toUpperCase()] = rate;
  }
  return { date: j.date ?? date, source, rates };
}

async function fromFrankfurterDay(date: string): Promise<DayResult> {
  const rows = await fetchJson(`https://api.frankfurter.dev/v2/rates?base=USD&date=${date}`) as
    Array<{ date: string; quote: string; rate: number }>;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("nessun tasso");
  const rates: Rates = {};
  for (const r of rows) rates[r.quote.toUpperCase()] = r.rate;
  return { date: rows[0].date ?? date, source: "frankfurter", rates };
}

/** Un'unica chiamata per piu' giorni: e' cosi' che si fa il backfill lungo. */
async function fromFrankfurterRange(from: string, to: string): Promise<DayResult[]> {
  const rows = await fetchJson(`https://api.frankfurter.dev/v2/rates?base=USD&from=${from}&to=${to}`) as
    Array<{ date: string; quote: string; rate: number }>;
  const byDate = new Map<string, Rates>();
  for (const r of rows ?? []) {
    if (!byDate.has(r.date)) byDate.set(r.date, {});
    byDate.get(r.date)![r.quote.toUpperCase()] = r.rate;
  }
  return [...byDate.entries()]
    .map(([date, rates]) => ({ date, source: "frankfurter-range", rates }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchDay(date: string, log: LogRow[]): Promise<DayResult | null> {
  const chain: Array<[string, () => Promise<DayResult>]> = [
    ["fawazahmed0", () => fromFawaz(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`,
      "fawazahmed0", date)],
    ["mirror", () => fromFawaz(
      `https://${date}.currency-api.pages.dev/v1/currencies/usd.json`,
      "mirror", date)],
    ["frankfurter", () => fromFrankfurterDay(date)],
  ];
  for (const [name, run] of chain) {
    try {
      const out = await run();
      if (Object.keys(out.rates).length > 0) return out;
      log.push({ rate_date: date, source: name, outcome: "empty", rates_saved: 0, error: null });
    } catch (e) {
      log.push({ rate_date: date, source: name, outcome: "error", rates_saved: 0, error: String(e) });
    }
  }
  return null;
}

type LogRow = {
  rate_date: string | null;
  source: string | null;
  outcome: "ok" | "empty" | "error" | "anomaly" | "skipped";
  rates_saved: number;
  error: string | null;
};

// ── Salvataggio ──────────────────────────────────────────────────────────────

async function saveDay(
  day: DayResult,
  known: Set<string>,
  previous: Rates,
  log: LogRow[],
): Promise<number> {
  const rows: Array<{ rate_date: string; quote: string; rate: number; source: string }> = [];
  const anomalies: string[] = [];

  for (const [code, rate] of Object.entries(day.rates)) {
    if (!known.has(code)) continue;              // solo valute che conosciamo
    if (!(rate > 0) || !Number.isFinite(rate)) continue;
    const prev = previous[code];
    if (prev && Math.abs(rate - prev) / prev > ANOMALY_RATIO) {
      anomalies.push(`${code}: ${prev} -> ${rate}`);
      continue;
    }
    rows.push({ rate_date: day.date, quote: code, rate, source: day.source });
  }

  if (anomalies.length > 0) {
    log.push({
      rate_date: day.date, source: day.source, outcome: "anomaly",
      rates_saved: 0, error: anomalies.join("; ").slice(0, 2000),
    });
  }
  if (rows.length === 0) {
    log.push({ rate_date: day.date, source: day.source, outcome: "empty", rates_saved: 0, error: null });
    return 0;
  }

  // I tassi storici non cambiano mai: chi c'e' gia' resta com'e'. E' questo a
  // rendere innocuo eseguire la funzione due volte di fila.
  const { error } = await admin
    .from("fx_rates")
    .upsert(rows, { onConflict: "rate_date,quote", ignoreDuplicates: true });

  if (error) {
    log.push({ rate_date: day.date, source: day.source, outcome: "error", rates_saved: 0, error: error.message });
    return 0;
  }

  // Aggiorna il riferimento per il controllo anomalie del giorno successivo.
  for (const r of rows) previous[r.quote] = r.rate;

  log.push({ rate_date: day.date, source: day.source, outcome: "ok", rates_saved: rows.length, error: null });
  return rows.length;
}

// ── Quali date servono ───────────────────────────────────────────────────────

async function datesToFill(from: string | null, to: string | null, maxDays: number): Promise<string[]> {
  const today = iso(new Date());
  const end = to ?? today;

  let start = from;
  if (!start) {
    const { data } = await admin
      .from("fx_rates").select("rate_date")
      .order("rate_date", { ascending: false }).limit(1);
    const last = data?.[0]?.rate_date as string | undefined;
    // Prima esecuzione senza intervallo: si prende solo oggi, il backfill vero
    // si chiede esplicitamente con from/to.
    start = last ? addDays(last, 1) : end;
  }

  const wanted: string[] = [];
  for (let d = start; d <= end && wanted.length < maxDays; d = addDays(d, 1)) wanted.push(d);

  // Date di transazioni ancora senza alcun tasso salvato: capita dopo un
  // import di movimenti vecchi.
  if (wanted.length < maxDays) {
    const { data: tx } = await admin.from("transactions").select("booked_on");
    const txDates = [...new Set((tx ?? []).map((r) => r.booked_on as string))];
    if (txDates.length > 0) {
      const { data: have } = await admin.from("fx_rates").select("rate_date").in("rate_date", txDates);
      const haveSet = new Set((have ?? []).map((r) => r.rate_date as string));
      for (const d of txDates.sort()) {
        if (!haveSet.has(d) && !wanted.includes(d) && wanted.length < maxDays) wanted.push(d);
      }
    }
  }

  return wanted.sort();
}

/** Ultimi tassi noti prima di `date`: servono da metro per le anomalie. */
async function previousRates(date: string): Promise<Rates> {
  const { data: last } = await admin
    .from("fx_rates").select("rate_date")
    .lt("rate_date", date).order("rate_date", { ascending: false }).limit(1);
  const day = last?.[0]?.rate_date as string | undefined;
  if (!day) return {};
  const { data } = await admin.from("fx_rates").select("quote,rate").eq("rate_date", day);
  const out: Rates = {};
  for (const r of data ?? []) out[(r.quote as string).trim()] = Number(r.rate);
  return out;
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const secret = await cronSecret();
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }

  let body: { from?: string; to?: string; maxDays?: number } = {};
  try { body = await req.json(); } catch { /* chiamata senza corpo: va bene */ }

  const maxDays = Math.min(Math.max(body.maxDays ?? MAX_DAYS_DEFAULT, 1), 400);
  const log: LogRow[] = [];

  const { data: currencies, error: curErr } = await admin
    .from("currencies").select("code").eq("active", true);
  if (curErr) {
    return new Response(JSON.stringify({ error: curErr.message }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
  const known = new Set((currencies ?? []).map((c) => (c.code as string).trim().toUpperCase()));
  known.delete("USD"); // il pivot vale 1 per definizione, non si salva

  const dates = await datesToFill(body.from ?? null, body.to ?? null, maxDays);
  if (dates.length === 0) {
    await admin.from("fx_fetch_log").insert([{ outcome: "skipped", rates_saved: 0, source: null, rate_date: null, error: "niente da fare" }]);
    return new Response(JSON.stringify({ ok: true, dates: 0, saved: 0 }), {
      headers: { "content-type": "application/json" },
    });
  }

  const previous = await previousRates(dates[0]);
  let saved = 0;

  // Intervallo lungo: una sola chiamata a Frankfurter invece di N.
  const span = dates.length;
  if (span > RANGE_THRESHOLD) {
    try {
      const days = await fromFrankfurterRange(dates[0], dates[dates.length - 1]);
      const wanted = new Set(dates);
      for (const day of days) {
        if (!wanted.has(day.date)) continue;
        saved += await saveDay(day, known, previous, log);
      }
    } catch (e) {
      log.push({ rate_date: null, source: "frankfurter-range", outcome: "error", rates_saved: 0, error: String(e) });
    }
  }

  // Giorno per giorno: sia il caso normale, sia i buchi rimasti dall'intervallo.
  const { data: already } = await admin
    .from("fx_rates").select("rate_date").in("rate_date", dates);
  const covered = new Set((already ?? []).map((r) => r.rate_date as string));

  for (const date of dates) {
    if (covered.has(date)) continue;
    const day = await fetchDay(date, log);
    if (!day) continue;
    saved += await saveDay(day, known, previous, log);
  }

  if (log.length > 0) await admin.from("fx_fetch_log").insert(log);

  return new Response(JSON.stringify({
    ok: true,
    dates: dates.length,
    first: dates[0],
    last: dates[dates.length - 1],
    saved,
    log: log.map((l) => ({ d: l.rate_date, s: l.source, o: l.outcome, n: l.rates_saved })),
  }), { headers: { "content-type": "application/json" } });
});
