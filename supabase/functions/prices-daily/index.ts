// supabase/functions/prices-daily/index.ts
//
// Prezzi degli investimenti con provider. Oggi c'e' solo CoinGecko, per le
// crypto; il provider per azioni ed ETF si aggiunge quando sara' scelto sui
// ticker veri, e questa funzione e' gia' fatta per ospitarne piu' d'uno: un
// provider che non risponde non deve impedire agli altri di scrivere.
//
// Due modi di chiamarla, con due autorizzazioni diverse:
//
// 1. pg_cron, con l'header `x-cron-secret`. Gira per TUTTI gli utenti, quindi
//    scrive con la service role: e' l'unico caso in cui serve.
// 2. l'utente dal browser, col suo JWT, per recuperare lo storico di un
//    investimento appena creato. Qui NON si usa la service role: il client ha
//    i diritti dell'utente e la RLS fa da sola il controllo su di chi sia
//    l'investimento, senza che questo codice debba ricordarsene.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CG_BASE = "https://api.coingecko.com/api/v3";
// Piano Demo: 100 chiamate al minuto, 10.000 al mese, e soprattutto storico
// limitato agli ULTIMI 365 GIORNI. Oltre non si va, e chiederlo lo stesso
// restituirebbe una risposta vuota senza spiegare perche'.
const CG_HISTORY_DAYS = 365;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function publishableKey(): string {
  const single = Deno.env.get("SUPABASE_ANON_KEY");
  if (single) return single;
  try {
    return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}").default ?? "";
  } catch { return ""; }
}

const userClient = (req: Request) =>
  createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });

async function cronSecret(): Promise<string | null> {
  const fromEnv = Deno.env.get("PRICES_CRON_SECRET");
  if (fromEnv) return fromEnv;
  const { data } = await admin.rpc("prices_cron_secret");
  return data ?? null;
}

// ── CoinGecko ────────────────────────────────────────────────────────────────

function cgHeaders(): HeadersInit {
  const key = Deno.env.get("COINGECKO_API_KEY");
  // La chiave non e' facoltativa nei fatti: senza, il limite e' per indirizzo
  // IP, e le Edge Functions condividono gli IP con altri progetti. Si sbatte
  // contro il 429 di qualcun altro.
  return key
    ? { accept: "application/json", "x-cg-demo-api-key": key }
    : { accept: "application/json" };
}

async function cgFetch(path: string): Promise<unknown> {
  const res = await fetch(`${CG_BASE}${path}`, { headers: cgHeaders() });
  if (!res.ok) throw new Error(`CoinGecko ${res.status} ${res.statusText}`);
  return await res.json();
}

/** Prezzo di oggi per tutti gli id, in tutte le valute richieste: una chiamata sola. */
async function cgSimplePrice(ids: string[], currencies: string[]) {
  const q = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: currencies.map(c => c.toLowerCase()).join(","),
    precision: "full",
  });
  return await cgFetch(`/simple/price?${q}`) as Record<string, Record<string, number>>;
}

/**
 * Storico giornaliero di un id in una valuta.
 * CoinGecko restituisce coppie [millisecondi, prezzo]; se in una giornata ci
 * sono piu' punti si tiene l'ultimo, che e' la chiusura di quel giorno.
 * Oltre i 90 giorni la granularita' e' gia' giornaliera alle 00:00 UTC.
 */
async function cgRange(id: string, currency: string, from: string, to: string) {
  const q = new URLSearchParams({
    vs_currency: currency.toLowerCase(),
    from,
    to,
    interval: "daily",
  });
  const j = await cgFetch(`/coins/${encodeURIComponent(id)}/market_chart/range?${q}`) as
    { prices?: Array<[number, number]> };

  const byDay = new Map<string, number>();
  for (const [ms, price] of j.prices ?? []) {
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    byDay.set(new Date(ms).toISOString().slice(0, 10), price);
  }
  return byDay;
}

// ── scritture ────────────────────────────────────────────────────────────────

type Row = { holding_id: string; user_id: string; price_date: string; price: number; source: "provider" };

/**
 * `on conflict do nothing` e' la regola: un prezzo gia' presente non si tocca,
 * e quello scritto a mano dall'utente resta suo. E' anche cio' che rende la
 * funzione ripetibile senza effetti, come vuole un job schedulato.
 */
async function savePrices(db: ReturnType<typeof userClient>, rows: Row[]): Promise<number> {
  if (!rows.length) return 0;
  let saved = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("asset_prices")
      .upsert(slice, { onConflict: "holding_id,price_date", ignoreDuplicates: true })
      .select("holding_id");
    if (error) throw new Error(error.message);
    saved += data?.length ?? 0;
  }
  return saved;
}

const log = (entry: Record<string, unknown>) =>
  admin.from("price_fetch_log").insert(entry);

// ── aggiornamento quotidiano, per tutti gli utenti ───────────────────────────

async function dailyRun() {
  const { data: holdings, error } = await admin
    .from("holdings")
    .select("id, user_id, currency, provider_ref, price_provider")
    .eq("price_provider", "coingecko")
    .is("archived_at", null);

  if (error) throw new Error(error.message);
  if (!holdings?.length) {
    await log({ provider: "coingecko", outcome: "skipped", holdings: 0, prices_saved: 0 });
    return { holdings: 0, saved: 0, outcome: "skipped" };
  }

  const ids = [...new Set(holdings.map(h => h.provider_ref).filter(Boolean) as string[])];
  const currencies = [...new Set(holdings.map(h => h.currency.trim()))];
  const today = iso(new Date());

  let quotes: Record<string, Record<string, number>>;
  try {
    quotes = await cgSimplePrice(ids, currencies);
  } catch (e) {
    // Un provider che non risponde non e' un errore del sistema: si annota e
    // si riprova domani. I prezzi di ieri restano quelli di ieri.
    await log({
      provider: "coingecko", outcome: "error", holdings: holdings.length, prices_saved: 0,
      error: String(e instanceof Error ? e.message : e).slice(0, 500),
    });
    return { holdings: holdings.length, saved: 0, outcome: "error" };
  }

  const rows: Row[] = [];
  const missing: string[] = [];
  for (const h of holdings) {
    const price = quotes?.[h.provider_ref as string]?.[h.currency.trim().toLowerCase()];
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      missing.push(`${h.provider_ref}/${h.currency}`);
      continue;
    }
    rows.push({ holding_id: h.id, user_id: h.user_id, price_date: today, price, source: "provider" });
  }

  const saved = await savePrices(admin, rows);
  const outcome = rows.length === 0 ? "empty" : missing.length > 0 ? "partial" : "ok";
  await log({
    provider: "coingecko", outcome, holdings: holdings.length, prices_saved: saved,
    error: missing.length ? `senza quotazione: ${missing.slice(0, 20).join(", ")}` : null,
  });
  return { holdings: holdings.length, saved, outcome, missing };
}

// ── recupero dello storico di un singolo investimento ────────────────────────

async function backfill(db: ReturnType<typeof userClient>, holdingId: string) {
  const { data: h, error } = await db
    .from("holdings")
    .select("id, user_id, currency, provider_ref, price_provider")
    .eq("id", holdingId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  // Se la RLS non lo fa vedere, per questo codice semplicemente non esiste.
  if (!h) return { error: "holding_not_found", status: 404 };
  if (h.price_provider !== "coingecko" || !h.provider_ref) {
    return { error: "holding_has_no_provider", status: 400 };
  }

  const { data: firstLot } = await db
    .from("holding_lots")
    .select("trade_date")
    .eq("holding_id", holdingId)
    .order("trade_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  const limit = daysAgo(CG_HISTORY_DAYS);
  const wanted = firstLot?.trade_date ?? daysAgo(30);
  // Il piano Demo non va oltre un anno: si parte dal piu' recente fra la data
  // del primo lotto e il limite, e lo si dichiara a chi ha chiamato.
  const from = wanted < limit ? limit : wanted;
  const to = iso(new Date());
  const truncated = wanted < limit;

  let byDay: Map<string, number>;
  try {
    byDay = await cgRange(h.provider_ref, h.currency.trim(), from, to);
  } catch (e) {
    await log({
      provider: "coingecko", outcome: "error", holdings: 1, prices_saved: 0,
      error: String(e instanceof Error ? e.message : e).slice(0, 500),
    });
    return { error: "provider_failed", status: 502 };
  }

  const rows: Row[] = [...byDay.entries()].map(([price_date, price]) => ({
    holding_id: h.id, user_id: h.user_id, price_date, price, source: "provider" as const,
  }));

  const saved = await savePrices(db, rows);
  await log({
    provider: "coingecko", outcome: rows.length ? "ok" : "empty",
    holdings: 1, prices_saved: saved,
  });

  return { ok: true, from, to, points: rows.length, saved, truncated, historyDays: CG_HISTORY_DAYS };
}

// ── handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corpo vuoto: va bene */ }

  const secret = await cronSecret();
  const headerSecret = req.headers.get("x-cron-secret");
  const isCron = !!secret && headerSecret === secret;

  try {
    if (isCron) {
      // Il cron puo' anche chiedere un backfill, ma il suo lavoro e' il giro
      // quotidiano su tutti gli utenti.
      const out = await dailyRun();
      return json({ ok: true, ...out });
    }

    // Niente segreto valido: allora serve un utente, e si puo' fare solo il
    // recupero dello storico di un proprio investimento.
    const db = userClient(req);
    const { data: { user } } = await db.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const holdingId = String(body.holdingId ?? "");
    if (!holdingId) return json({ error: "holding_id_required" }, 400);

    const out = await backfill(db, holdingId);
    if ("error" in out) return json({ error: out.error }, out.status);
    return json(out);

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await log({ provider: "coingecko", outcome: "error", error: message.slice(0, 500) });
    return json({ error: "prices_failed", message: message.slice(0, 500) }, 502);
  }
});
