// Live Markets data — SERVER ONLY. Free sources, mostly keyless, with per-source
// TTL caching so we never hammer the free APIs or hit rate limits.
//
// Sources (all free):
//   crypto    CoinGecko        keyless    price + 24h + 7d sparkline + OHLC history
//   quotes    Yahoo chart      keyless    price, prior-session close, OHLC, sparkline
//   levels    Yahoo chart      keyless    ^NDX prior-session OHLC -> pivots
//   movers    Yahoo screener   keyless    /v1/finance/screener/predefined/saved
//   econ      faireconomy      keyless    ff_calendar_thisweek.json (ForexFactory mirror)
//   fear/greed alternative.me  keyless    /fng (crypto fear & greed)
//   vix       Yahoo chart      keyless    ^VIX
//   sectors   Yahoo chart      keyless    sector SPDR ETFs
//   macro     FRED             FREE KEY   FRED_API_KEY — 10Y-2Y spread + financial stress
//
// Index/ETF quotes are DELAYED PROXIES, not the live CME tape — labeled as such.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// --- tiny TTL cache -------------------------------------------------------
type Entry = { exp: number; data: unknown };
const cache = new Map<string, Entry>();
async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.data as T;
  try {
    const data = await fetcher();
    cache.set(key, { exp: now + ttlMs, data });
    return data;
  } catch (e) {
    if (hit) return hit.data as T;
    throw e;
  }
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const num = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const etDate = (s: number): string =>
  new Date(s * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const nowEtDate = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

function downsample(arr: number[], target: number): number[] {
  const clean = arr.filter((n) => Number.isFinite(n));
  if (clean.length <= target) return clean;
  const step = clean.length / target;
  const out: number[] = [];
  for (let i = 0; i < target; i++) out.push(clean[Math.floor(i * step)]);
  out.push(clean[clean.length - 1]);
  return out;
}

// --- types ----------------------------------------------------------------
export type Quote = {
  sym: string;
  desc: string;
  last: number;
  chgPct: number;
  proxy: boolean;
  spark: number[];
  chartSym: string; // underlying symbol for the price chart
  kind: "yahoo" | "crypto";
};
export type Levels = {
  proxy: string;
  current: number;
  resistance: number;
  pivot: number;
  support: number;
  onHigh: number;
  onLow: number;
  above: boolean;
};
export type EconEvent = { time: string; title: string; impact: string };
export type Mover = { sym: string; price: number; chgPct: number };
export type FlowItem = { sym: string; price: number; chgPct: number; volMult: number };
export type Sector = { name: string; etf: string; chgPct: number };
export type Macro = { t10y2y: number | null; stress: number | null; fredAvailable: boolean };
export type Candle = { time: number; open: number; high: number; low: number; close: number };
export type Markets = {
  asOf: string;
  watchlist: Quote[];
  levels: Levels | null;
  econ: EconEvent[];
  movers: { gainers: Mover[]; losers: Mover[]; actives: Mover[] };
  flow: FlowItem[];
  vix: number | null;
  fng: { value: number; label: string } | null;
  macro: Macro;
  sectors: Sector[];
  briefLine: string;
  snapshot: string;
  errors: string[];
};

// --- Yahoo chart (price, prior-session close, prior OHLC, sparkline) -------
type Chart = {
  symbol: string;
  price: number;
  prevClose: number;
  chgPct: number;
  prior: { o: number; h: number; l: number; c: number } | null;
  closes: number[];
};
async function yahooChart(symbol: string): Promise<Chart> {
  return cached(`ychart:${symbol}`, 60_000, () => fetchYahooChart(symbol));
}

// Crypto shorthands → Yahoo pairs; everything else passes through upper-cased.
function normalizeYahooSymbol(raw: string): string {
  const s = (raw || "").trim().toUpperCase();
  if (!s) return "";
  const crypto: Record<string, string> = { BTC: "BTC-USD", BITCOIN: "BTC-USD", ETH: "ETH-USD", ETHEREUM: "ETH-USD", SOL: "SOL-USD", DOGE: "DOGE-USD", XRP: "XRP-USD" };
  return crypto[s] ?? s;
}

// A single live quote for an arbitrary symbol — reuses the existing Yahoo chart fetch
// (+ its 60s cache); adds NO new data source. Used by Market Intel (lib/intel) to
// enrich and validate tickers. null if the symbol doesn't resolve to a real price.
export async function getQuote(
  symbol: string,
): Promise<{ symbol: string; price: number; prevClose: number; chgPct: number } | null> {
  const sym = normalizeYahooSymbol(symbol);
  if (!sym) return null;
  try {
    const c = await yahooChart(sym);
    if (!Number.isFinite(c.price) || c.price <= 0) return null;
    return { symbol: sym, price: c.price, prevClose: c.prevClose, chgPct: c.chgPct };
  } catch {
    return null;
  }
}
async function fetchYahooChart(symbol: string): Promise<Chart> {
  const j = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`,
  );
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error("no result");
  const meta = r.meta || {};
  const ts: number[] = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const price = num(meta.regularMarketPrice);
  const today = nowEtDate();
  let pi = -1;
  for (let i = ts.length - 1; i >= 0; i--) {
    if (q.close?.[i] == null) continue;
    if (etDate(ts[i]) < today) {
      pi = i;
      break;
    }
  }
  if (pi === -1) {
    for (let i = ts.length - 1; i >= 0; i--)
      if (q.close?.[i] != null) {
        pi = i;
        break;
      }
  }
  const prior =
    pi >= 0 ? { o: num(q.open[pi]), h: num(q.high[pi]), l: num(q.low[pi]), c: num(q.close[pi]) } : null;
  const prevClose = prior ? prior.c : num(meta.chartPreviousClose);
  const chgPct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
  const closes: number[] = (q.close || []).filter((c: unknown) => c != null).map(num);
  return { symbol: meta.symbol || symbol, price, prevClose, chgPct, prior, closes };
}

// --- crypto ---------------------------------------------------------------
// CoinGecko ids for price/24h/sparkline (one keyless call); Coinbase products for
// OHLC chart candles (keyless, US-friendly).
const CRYPTO: Array<{ id: string; sym: string; cb: string }> = [
  { id: "bitcoin", sym: "BTC", cb: "BTC-USD" },
  { id: "ethereum", sym: "ETH", cb: "ETH-USD" },
  { id: "solana", sym: "SOL", cb: "SOL-USD" },
  { id: "ripple", sym: "XRP", cb: "XRP-USD" },
  { id: "cardano", sym: "ADA", cb: "ADA-USD" },
  { id: "dogecoin", sym: "DOGE", cb: "DOGE-USD" },
  { id: "avalanche-2", sym: "AVAX", cb: "AVAX-USD" },
  { id: "chainlink", sym: "LINK", cb: "LINK-USD" },
];
type CryptoRow = { id: string; sym: string; cb: string; last: number; chgPct: number; spark: number[] };
async function getCrypto(): Promise<CryptoRow[]> {
  return cached("crypto", 45_000, async () => {
    const ids = CRYPTO.map((c) => c.id).join(",");
    const j: any[] = await getJson(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&sparkline=true&price_change_percentage=24h`,
    );
    const byId = new Map((Array.isArray(j) ? j : []).map((c) => [c.id, c]));
    return CRYPTO.map((c) => {
      const m = byId.get(c.id);
      return {
        id: c.id,
        sym: c.sym,
        cb: c.cb,
        last: num(m?.current_price),
        chgPct: num(m?.price_change_percentage_24h),
        spark: downsample((m?.sparkline_in_7d?.price as number[]) || [], 48),
      };
    });
  });
}

// --- index / commodity proxies -------------------------------------------
// Scale factors map ETF prices to approximate futures-equivalent levels so a
// trader sees numbers in the right range (NQ ~21k, not QQQ ~530).
//   NQ ≈ QQQ × 40  (QQQ NAV = NDX/40 since launch; NQ converges to NDX at expiry)
//   ES ≈ SPY × 10  (SPY NAV = SPX/10)
//   YM ≈ DIA × 100 (DIA NAV = DJIA/100)
//   GC ≈ GLD × 10  (GLD holds 0.1 troy oz per share)
//   USO has no clean multiplier to CL futures due to roll costs — shown as ETF price
const PROXIES: Array<{ y: string; sym: string; desc: string; scale: number }> = [
  { y: "QQQ", sym: "NQ", desc: "QQQ × 40 est.", scale: 40 },
  { y: "SPY", sym: "ES", desc: "SPY × 10 est.", scale: 10 },
  { y: "DIA", sym: "YM", desc: "DIA × 100 est.", scale: 100 },
  { y: "USO", sym: "USO", desc: "Crude · USO ETF", scale: 1 },
  { y: "GLD", sym: "GC", desc: "GLD × 10 est.", scale: 10 },
];
async function getProxies(): Promise<Quote[]> {
  // No outer cache — each yahooChart is cached per-symbol, so the QQQ here and the
  // QQQ in getLevels read the exact same entry (headline level == watchlist NQ).
  return Promise.all(
    PROXIES.map(async (p) => {
      const c = await yahooChart(p.y);
      return {
        sym: p.sym,
        desc: p.desc,
        last: c.price * p.scale,
        chgPct: c.chgPct,
        proxy: true,
        spark: downsample(c.closes, 24),
        chartSym: p.y,
        kind: "yahoo" as const,
      };
    }),
  );
}

async function getLevels(): Promise<Levels | null> {
  // Derive pivot levels from QQQ, then scale × 40 so levels appear in NQ futures
  // range (~21k) rather than ETF range (~530). Same multiplier as the watchlist NQ
  // row so the price and levels are on the same scale.
  const SCALE = 40;
  const c = await yahooChart("QQQ");
  if (!c.prior) return null;
  const { h, l, c: close } = c.prior;
  const pivot = (h + l + close) / 3;
  return {
    proxy: "NQ · QQQ × 40 est.",
    current: c.price * SCALE,
    resistance: (2 * pivot - l) * SCALE,
    pivot: pivot * SCALE,
    support: (2 * pivot - h) * SCALE,
    onHigh: h * SCALE,
    onLow: l * SCALE,
    above: c.price >= pivot,
  };
}

async function getEcon(): Promise<EconEvent[]> {
  return cached("econ", 30 * 60_000, async () => {
    const list: any[] = await getJson("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
    const today = nowEtDate();
    return (Array.isArray(list) ? list : [])
      .filter((e) => e?.country === "USD" && e?.date && etDate(Date.parse(e.date) / 1000) === today)
      .map((e) => ({
        time: new Date(e.date).toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        title: String(e.title || ""),
        impact: String(e.impact || "").toLowerCase(),
      }))
      .slice(0, 8);
  });
}

type ScreenQuote = { sym: string; price: number; chgPct: number; volume: number; avgVol: number };
async function getScreeners(): Promise<{
  gainers: ScreenQuote[];
  losers: ScreenQuote[];
  actives: ScreenQuote[];
}> {
  return cached("screeners", 5 * 60_000, async () => {
    const pull = async (scrId: string): Promise<ScreenQuote[]> => {
      const j = await getJson(
        `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=8&scrIds=${scrId}`,
      );
      const quotes: any[] = j?.finance?.result?.[0]?.quotes || [];
      return quotes.map((q) => ({
        sym: String(q.symbol || ""),
        price: num(q.regularMarketPrice),
        chgPct: num(q.regularMarketChangePercent),
        volume: num(q.regularMarketVolume),
        avgVol: num(q.averageDailyVolume3Month),
      }));
    };
    const [gainers, losers, actives] = await Promise.all([
      pull("day_gainers"),
      pull("day_losers"),
      pull("most_actives"),
    ]);
    return { gainers, losers, actives };
  });
}

async function getVix(): Promise<number | null> {
  return cached("vix", 5 * 60_000, async () => (await yahooChart("^VIX")).price);
}

async function getFng(): Promise<{ value: number; label: string } | null> {
  return cached("fng", 30 * 60_000, async () => {
    const j = await getJson("https://api.alternative.me/fng/");
    const d = j?.data?.[0];
    if (!d) return null;
    return { value: num(d.value), label: String(d.value_classification || "") };
  });
}

// --- macro via FRED (FREE KEY required) -----------------------------------
async function getMacro(): Promise<Macro> {
  const key = (process.env.FRED_API_KEY || "").trim();
  // Real FRED keys are 32 alphanumeric chars; reject empty/placeholder keys up front
  // so the gauges show a clear "needs FRED key" instead of a broken value.
  if (key.length < 16) return { t10y2y: null, stress: null, fredAvailable: false };
  return cached("macro", 60 * 60_000, async () => {
    const series = async (id: string): Promise<number | null> => {
      try {
        const j = await getJson(
          `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&file_type=json&sort_order=desc&limit=1`,
        );
        const n = Number(j?.observations?.[0]?.value);
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    };
    const [t10y2y, stress] = await Promise.all([series("T10Y2Y"), series("STLFSI4")]);
    return { t10y2y, stress, fredAvailable: t10y2y != null || stress != null };
  });
}

const SECTORS: Array<{ etf: string; name: string }> = [
  { etf: "XLK", name: "Technology" },
  { etf: "XLF", name: "Financials" },
  { etf: "XLE", name: "Energy" },
  { etf: "XLV", name: "Health Care" },
  { etf: "XLY", name: "Cons. Disc." },
  { etf: "XLP", name: "Cons. Staples" },
  { etf: "XLI", name: "Industrials" },
  { etf: "XLB", name: "Materials" },
  { etf: "XLU", name: "Utilities" },
  { etf: "XLRE", name: "Real Estate" },
  { etf: "XLC", name: "Comm. Svcs." },
];
async function getSectors(): Promise<Sector[]> {
  return cached("sectors", 15 * 60_000, async () => {
    const out = await Promise.all(
      SECTORS.map(async (s) => {
        try {
          const c = await yahooChart(s.etf);
          return { name: s.name, etf: s.etf, chgPct: c.chgPct };
        } catch {
          return { name: s.name, etf: s.etf, chgPct: NaN };
        }
      }),
    );
    return out.filter((s) => Number.isFinite(s.chgPct));
  });
}

// --- FLOW · LITE ----------------------------------------------------------
// Real options flow (sweeps, blocks, premium) is a PAID feed. This is an honest
// free stand-in: "unusual volume" among the most-active EQUITIES — today's volume
// vs the 3-month average. It is NOT institutional options flow.
//
// UPGRADE: to swap in real options flow, replace the body of buildFlow() at your
// provider — Unusual Whales / FlowAlgo / CBOE LiveVol — and map to FlowItem[].
function buildFlow(actives: ScreenQuote[]): FlowItem[] {
  return actives
    .map((a) => ({
      sym: a.sym,
      price: a.price,
      chgPct: a.chgPct,
      volMult: a.avgVol > 0 ? a.volume / a.avgVol : 0,
    }))
    .filter((f) => f.volMult > 0)
    .sort((a, b) => b.volMult - a.volMult)
    .slice(0, 7);
}

// --- price-chart history (for the main chart widget) ----------------------
const TF_YAHOO: Record<string, { interval: string; range: string }> = {
  "1D": { interval: "5m", range: "1d" },
  "1W": { interval: "30m", range: "5d" },
  "1M": { interval: "1d", range: "1mo" },
};
const TF_CB: Record<string, { gran: number; n: number }> = {
  "1D": { gran: 300, n: 288 },
  "1W": { gran: 3600, n: 168 },
  "1M": { gran: 21600, n: 120 },
};
const TF_TTL: Record<string, number> = { "1D": 120_000, "1W": 600_000, "1M": 3_600_000 };

export async function getHistory(sym: string, kind: string, tf: string): Promise<Candle[]> {
  const t = TF_YAHOO[tf] ? tf : "1D";
  const k = kind === "crypto" ? "crypto" : "yahoo";
  return cached(`hist:${k}:${sym}:${t}`, TF_TTL[t], async () => {
    if (k === "crypto") {
      // Coinbase candles: [time(sec), low, high, open, close, volume], newest first.
      const g = TF_CB[t];
      const j: any[] = await getJson(
        `https://api.exchange.coinbase.com/products/${encodeURIComponent(sym)}/candles?granularity=${g.gran}`,
      );
      const rows: Candle[] = (Array.isArray(j) ? j : [])
        .map((r) => ({
          time: num(r[0]),
          low: num(r[1]),
          high: num(r[2]),
          open: num(r[3]),
          close: num(r[4]),
        }))
        .sort((a, b) => a.time - b.time);
      return rows.slice(-g.n);
    }
    const { interval, range } = TF_YAHOO[t];
    const j = await getJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,
    );
    const r = j?.chart?.result?.[0];
    const ts: number[] = r?.timestamp || [];
    const q = r?.indicators?.quote?.[0] || {};
    const out: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.open?.[i] == null || q.close?.[i] == null) continue;
      out.push({
        time: ts[i],
        open: num(q.open[i]),
        high: num(q.high[i]),
        low: num(q.low[i]),
        close: num(q.close[i]),
      });
    }
    return out;
  });
}

// --- assembly -------------------------------------------------------------
function buildWatchlist(proxies: Quote[], crypto: CryptoRow[]): Quote[] {
  const cryptoRows: Quote[] = crypto.map((c) => ({
    sym: c.sym,
    desc: "crypto · spot",
    last: c.last,
    chgPct: c.chgPct,
    proxy: false,
    spark: c.spark,
    chartSym: c.cb,
    kind: "crypto" as const,
  }));
  return [...proxies, ...cryptoRows];
}

const fmt = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function buildBriefLine(levels: Levels | null, vix: number | null, fng: { label: string } | null): string {
  if (!levels) return "Markets — feed's warming up; numbers in a moment.";
  const nq = Math.round(levels.current).toLocaleString();
  const where =
    levels.current >= levels.resistance
      ? "pressing resistance"
      : levels.current >= levels.pivot
        ? "holding above the pivot"
        : levels.current >= levels.support
          ? "below pivot, above support"
          : "leaning on support";
  const tail = vix ? ` VIX ${vix.toFixed(1)}${fng ? `, ${fng.label.toLowerCase()}` : ""}.` : "";
  return `NQ ~${nq} (est.), ${where}.${tail}`;
}

function buildSnapshot(
  levels: Levels | null,
  watchlist: Quote[],
  vix: number | null,
  fng: { value: number; label: string } | null,
  macro: Macro,
  sectors: Sector[],
): string {
  const lines: string[] = [];
  lines.push("MARKETS — live, delayed free proxies (NOT the live CME tape):");
  lines.push(
    "When he asks where something is trading, about his levels, or \"where's NQ vs my levels\", ANSWER directly from these numbers in your own voice — do not just send him to a screen. Only use go_to_screen when he explicitly asks to open or see a surface.",
  );
  lines.push(
    "CRITICAL: these are the CURRENT live numbers. Use ONLY them for any market price or level. IGNORE any specific market figures you may remember from past conversations — those are stale and wrong (markets move). Never say \"based on our last conversation\" for prices; quote the live values below.",
  );
  lines.push(
    "NOTE ON SCALE: NQ/ES/YM/GC prices below are ETF-proxy estimates (QQQ×40, SPY×10, DIA×100, GLD×10) scaled to futures-equivalent range — NOT the live CME tape. USO is the raw ETF price. % changes are accurate; absolute levels are approximate.",
  );
  if (levels) {
    lines.push(
      `His NQ levels — the daily pivot levels on his Markets surface; when he says "my levels" he means THESE: ` +
        `resistance ${fmt(levels.resistance)}, pivot ${fmt(levels.pivot)}, support ${fmt(levels.support)}; ` +
        `overnight high ${fmt(levels.onHigh)}, low ${fmt(levels.onLow)}. ` +
        `NQ (${levels.proxy}) is ~${fmt(levels.current)} right now — ${levels.above ? "above" : "below"} the pivot.`,
    );
  }
  const w = (s: string) => watchlist.find((q) => q.sym === s);
  const idx = ["ES", "NQ", "YM", "USO", "GC"].map((s) => (w(s) ? `${s} ${pct(w(s)!.chgPct)}` : null)).filter(Boolean);
  if (idx.length) lines.push(`Index/commodity proxies: ${idx.join(", ")}.`);
  const cr = ["BTC", "ETH"].map((s) => (w(s) ? `${s} ${fmt(w(s)!.last, 0)} (${pct(w(s)!.chgPct)})` : null)).filter(Boolean);
  if (cr.length) lines.push(`Crypto: ${cr.join(", ")}.`);
  if (vix != null) lines.push(`VIX ${vix.toFixed(2)}.`);
  if (fng) lines.push(`Crypto Fear & Greed ${fng.value} (${fng.label}).`);
  if (macro.fredAvailable && macro.t10y2y != null) {
    lines.push(
      `Yield curve (10Y-2Y) ${macro.t10y2y.toFixed(2)}%${macro.t10y2y < 0 ? " — inverted" : ""}` +
        (macro.stress != null ? `; financial stress index ${macro.stress.toFixed(2)}.` : "."),
    );
  }
  if (sectors.length) {
    const sorted = [...sectors].sort((a, b) => b.chgPct - a.chgPct);
    lines.push(
      `Sectors: ${sorted[0].name} leads (${pct(sorted[0].chgPct)}), ${sorted[sorted.length - 1].name} lags (${pct(sorted[sorted.length - 1].chgPct)}).`,
    );
  }
  return "\n\n---\n" + lines.join("\n");
}

export async function getMarkets(): Promise<Markets> {
  const errors: string[] = [];
  const settle = async <T>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : "error"}`);
      return fallback;
    }
  };

  const [crypto, proxies, levels, econ, screeners, vix, fng, macro, sectors] = await Promise.all([
    settle("crypto", getCrypto(), [] as CryptoRow[]),
    settle("quotes", getProxies(), [] as Quote[]),
    settle("levels", getLevels(), null as Levels | null),
    settle("econ", getEcon(), [] as EconEvent[]),
    settle("movers", getScreeners(), { gainers: [], losers: [], actives: [] }),
    settle("vix", getVix(), null as number | null),
    settle("fng", getFng(), null as { value: number; label: string } | null),
    settle("macro", getMacro(), { t10y2y: null, stress: null, fredAvailable: false } as Macro),
    settle("sectors", getSectors(), [] as Sector[]),
  ]);

  const watchlist = buildWatchlist(proxies, crypto);
  const flow = buildFlow(screeners.actives);
  const toMover = (q: ScreenQuote): Mover => ({ sym: q.sym, price: q.price, chgPct: q.chgPct });

  return {
    asOf: new Date().toISOString(),
    watchlist,
    levels,
    econ,
    movers: {
      gainers: screeners.gainers.map(toMover).slice(0, 6),
      losers: screeners.losers.map(toMover).slice(0, 6),
      actives: screeners.actives.map(toMover).slice(0, 6),
    },
    flow,
    vix,
    fng,
    macro,
    sectors,
    briefLine: buildBriefLine(levels, vix, fng),
    snapshot: buildSnapshot(levels, watchlist, vix, fng, macro, sectors),
    errors,
  };
}

export async function getMarketsSnapshot(): Promise<string> {
  try {
    return (await getMarkets()).snapshot || "";
  } catch {
    return "";
  }
}

// Warm the cache on server start so the first markets question isn't cold. Skipped
// during the production build so we never make network calls at build time.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  void getMarkets().catch(() => {});
}
