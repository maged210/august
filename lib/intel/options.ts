// OptionsDataProvider — SERVER ONLY. REUSES the existing Yahoo source already used by
// lib/markets (no new vendor, no new key). Yahoo's options endpoint is keyless but
// DELAYED and does NOT supply Greeks → we return delayed=true, a quote timestamp, and
// greeks=null ("Greeks unavailable from this provider"). Never fabricates data; honest
// provider states. The rest of Intel works without this — only live-contract
// enrichment + AUGUST candidates depend on it.

import type {
  OptionContractQuote,
  OptionLeg,
  OptionsProviderStatus,
  OptionStrategyType,
} from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const BASE = "https://query1.finance.yahoo.com/v7/finance/options";

// Yahoo's v7/options endpoint now requires its standard cookie + crumb handshake (the
// same JSON API behind finance.yahoo.com — NOT UI scraping). We perform it server-side
// and cache the pair; on a 401 we refresh once. If the handshake fails we fall back to
// an unauthenticated call (which 401s) and surface an honest provider_error.
type YahooAuth = { cookie: string; crumb: string };
let _auth: { v: YahooAuth; exp: number } | null = null;
let _authInFlight: Promise<YahooAuth | null> | null = null;

async function doHandshake(): Promise<YahooAuth | null> {
  try {
    // 1) prime a session cookie (fc.yahoo.com 404s but sets A1/A3 cookies)
    const ck = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, cache: "no-store" });
    // getSetCookie() exists on Node/undici Headers but not in the TS DOM lib types.
    const setCookies = (ck.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const cookie = setCookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    if (!cookie) return null;
    // 2) exchange the cookie for a crumb
    const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
      cache: "no-store",
    });
    const crumb = (await cr.text()).trim();
    if (!crumb || crumb.length > 64 || /[<>]/.test(crumb)) return null; // guard against an HTML error page
    _auth = { v: { cookie, crumb }, exp: Date.now() + 25 * 60_000 };
    return _auth.v;
  } catch {
    return null;
  }
}

// Single-flight: concurrent cold/forced callers share one handshake instead of each
// running the two-request cookie+crumb exchange and stampeding Yahoo's getcrumb.
async function getYahooAuth(force = false): Promise<YahooAuth | null> {
  if (!force && _auth && _auth.exp > Date.now()) return _auth.v;
  if (_authInFlight) return _authInFlight;
  _authInFlight = doHandshake();
  try {
    return await _authInFlight;
  } finally {
    _authInFlight = null;
  }
}

// In-process chain cache. Stores the in-flight PROMISE (single-flight: concurrent cold
// callers for the same key collapse onto one fetch) and only RETAINS successful results
// — a transient failure is never cached, so the next request retries immediately. Bounded
// in size + swept of expired entries so an unvalidated symbol key can't grow it unboundedly.
type ChainEntry = { exp: number; p: Promise<ChainResult> };
const chainCache = new Map<string, ChainEntry>();
const CHAIN_TTL_MS = 60_000;
const CHAIN_CACHE_MAX = 200;
const isSuccess = (s: OptionsProviderStatus): boolean => s === "delayed" || s === "connected";

function sweepChainCache(): void {
  const now = Date.now();
  for (const [k, v] of chainCache) if (v.exp <= now) chainCache.delete(k);
  if (chainCache.size > CHAIN_CACHE_MAX) {
    const oldest = [...chainCache.entries()].sort((a, b) => a[1].exp - b[1].exp).slice(0, chainCache.size - CHAIN_CACHE_MAX);
    for (const [k] of oldest) chainCache.delete(k);
  }
}

export type NormalizedContract = {
  contractSymbol: string;
  strike: number;
  type: "call" | "put";
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
};

export type ChainResult = {
  status: OptionsProviderStatus;
  delayed: boolean;
  quoteTimestamp: number | null;
  expirations: number[]; // epoch seconds
  expiration: number | null;
  underlyingPrice: number | null;
  calls: NormalizedContract[];
  puts: NormalizedContract[];
  note?: string;
};

interface YContract {
  contractSymbol?: string;
  strike?: number;
  lastPrice?: number;
  bid?: number;
  ask?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
}

function norm(c: YContract, type: "call" | "put"): NormalizedContract {
  const bid = typeof c.bid === "number" ? c.bid : null;
  const ask = typeof c.ask === "number" ? c.ask : null;
  return {
    contractSymbol: c.contractSymbol ?? "",
    strike: c.strike ?? 0,
    type,
    bid,
    ask,
    mid: bid !== null && ask !== null ? Number(((bid + ask) / 2).toFixed(2)) : null,
    last: typeof c.lastPrice === "number" ? c.lastPrice : null,
    volume: typeof c.volume === "number" ? c.volume : null,
    openInterest: typeof c.openInterest === "number" ? c.openInterest : null,
    impliedVolatility: typeof c.impliedVolatility === "number" ? c.impliedVolatility : null,
  };
}

const empty = (status: OptionsProviderStatus, note?: string): ChainResult => ({
  status,
  delayed: true,
  quoteTimestamp: null,
  expirations: [],
  expiration: null,
  underlyingPrice: null,
  calls: [],
  puts: [],
  note,
});

/** Map an HTTP status from the provider to an honest OptionsProviderStatus. Pure → tested. */
export function providerStatusForHttp(httpStatus: number): OptionsProviderStatus {
  if (httpStatus === 401 || httpStatus === 403) return "unauthorized";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus === 404) return "unsupported_symbol";
  if (httpStatus >= 200 && httpStatus < 300) return "delayed";
  return "provider_error";
}

const chainUrl = (sym: string, crumb: string | undefined, epoch?: number): string => {
  const p = new URLSearchParams();
  if (epoch) p.set("date", String(epoch));
  if (crumb) p.set("crumb", crumb);
  const qs = p.toString();
  return `${BASE}/${encodeURIComponent(sym)}${qs ? `?${qs}` : ""}`;
};

// One authenticated attempt; returns the raw Response so the caller can retry on 401.
async function fetchChainRaw(sym: string, auth: YahooAuth | null, epoch?: number): Promise<Response> {
  return fetch(chainUrl(sym, auth?.crumb, epoch), {
    headers: { "User-Agent": UA, ...(auth ? { Cookie: auth.cookie } : {}) },
    cache: "no-store",
  });
}

// One full fetch attempt (auth + 401-refresh-once + parse). No caching here.
async function fetchChain(sym: string, expirationEpoch?: number): Promise<ChainResult> {
  let auth = await getYahooAuth();
  let res = await fetchChainRaw(sym, auth, expirationEpoch);
  if ((res.status === 401 || res.status === 403) && auth) {
    // stale crumb/cookie → refresh once and retry
    auth = await getYahooAuth(true);
    res = await fetchChainRaw(sym, auth, expirationEpoch);
  }
  if (res.status === 429) {
    const ra = res.headers.get("retry-after");
    return empty("rate_limited", ra ? `rate limited — retry after ${ra}s` : "rate limited");
  }
  if (!res.ok) return empty(providerStatusForHttp(res.status), `status ${res.status}`);
  const j = (await res.json()) as {
    optionChain?: { result?: { expirationDates?: number[]; quote?: { regularMarketPrice?: number; regularMarketTime?: number }; options?: { calls?: YContract[]; puts?: YContract[] }[] }[] };
  };
  const r = j.optionChain?.result?.[0];
  if (!r) return empty("unsupported_symbol", "No option chain for symbol.");
  const o = r.options?.[0];
  return {
    status: "delayed",
    delayed: true,
    quoteTimestamp: r.quote?.regularMarketTime ? r.quote.regularMarketTime * 1000 : Date.now(),
    expirations: r.expirationDates ?? [],
    expiration: expirationEpoch ?? r.expirationDates?.[0] ?? null,
    underlyingPrice: r.quote?.regularMarketPrice ?? null,
    calls: (o?.calls ?? []).map((c) => norm(c, "call")),
    puts: (o?.puts ?? []).map((c) => norm(c, "put")),
  } as ChainResult;
}

/** Fetch the option chain for `symbol` (nearest expiration, or a specific epoch). */
export async function getOptionChain(symbol: string, expirationEpoch?: number): Promise<ChainResult> {
  const sym = (symbol || "").trim().toUpperCase();
  if (!sym) return empty("unsupported_symbol");
  const key = `opt:${sym}:${expirationEpoch ?? "near"}`;
  const now = Date.now();
  const hit = chainCache.get(key);
  if (hit && hit.exp > now) return hit.p; // share the in-flight / fresh successful result
  const p = fetchChain(sym, expirationEpoch).catch((e): ChainResult => empty("provider_error", e instanceof Error ? e.message : "fetch failed"));
  chainCache.set(key, { exp: now + CHAIN_TTL_MS, p });
  const r = await p;
  // Only RETAIN successes; drop a transient failure so the next call retries immediately.
  if (!isSuccess(r.status)) chainCache.delete(key);
  else sweepChainCache();
  return r;
}

export async function getExpirations(symbol: string): Promise<{ status: OptionsProviderStatus; expirations: number[] }> {
  const r = await getOptionChain(symbol);
  return { status: r.status, expirations: r.expirations };
}

/** Find a specific contract quote by symbol within a fetched chain. */
export function findContract(chain: ChainResult, contractSymbol: string): NormalizedContract | null {
  return [...chain.calls, ...chain.puts].find((c) => c.contractSymbol === contractSymbol) ?? null;
}

// Greeks are not available from this provider; surface that honestly.
export function quoteFromContract(c: NormalizedContract | null, delayed: boolean, ts: number | null): OptionContractQuote {
  return {
    contractSymbol: c?.contractSymbol ?? null,
    bid: c?.bid ?? null,
    ask: c?.ask ?? null,
    mid: c?.mid ?? null,
    last: c?.last ?? null,
    openInterest: c?.openInterest ?? null,
    volume: c?.volume ?? null,
    impliedVolatility: c?.impliedVolatility ?? null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    quoteTimestamp: ts,
    delayed,
  };
}

// ===========================================================================
// Options math — pure, exported, tested. Returns nulls when inputs are missing
// (anti-hallucination: never calc a breakeven/max P/L without the needed inputs).
// All P/L are per single contract (×100). A "premium" is the per-share price.
// ===========================================================================
export type OptionMetrics = {
  breakevens: number[];
  maxProfit: number | null; // null = unlimited OR not computable
  maxLoss: number | null;
  riskRewardRatio: number | null;
};

type LegPriced = OptionLeg & { premium: number | null };

export function computeOptionMetrics(strategy: OptionStrategyType, legs: LegPriced[]): OptionMetrics {
  const none: OptionMetrics = { breakevens: [], maxProfit: null, maxLoss: null, riskRewardRatio: null };
  const priced = legs.every((l) => l.premium !== null && l.strike !== null);

  if (strategy === "long_call" && legs.length === 1) {
    const l = legs[0];
    if (l.premium === null || l.strike === null) return none;
    return { breakevens: [round(l.strike + l.premium)], maxProfit: null /* unlimited */, maxLoss: round(l.premium * 100), riskRewardRatio: null };
  }
  if (strategy === "long_put" && legs.length === 1) {
    const l = legs[0];
    if (l.premium === null || l.strike === null) return none;
    const maxProfit = round((l.strike - l.premium) * 100);
    const maxLoss = round(l.premium * 100);
    return { breakevens: [round(l.strike - l.premium)], maxProfit, maxLoss, riskRewardRatio: maxLoss ? round(maxProfit / maxLoss, 2) : null };
  }

  // Two-leg verticals.
  if (priced && legs.length === 2 && (strategy.endsWith("debit_spread") || strategy.endsWith("credit_spread"))) {
    const long = legs.find((l) => l.action === "buy")!;
    const short = legs.find((l) => l.action === "sell")!;
    if (!long || !short || long.strike === null || short.strike === null || long.premium === null || short.premium === null) return none;
    const width = Math.abs(long.strike - short.strike);
    const isDebit = strategy.includes("debit");
    const net = isDebit ? long.premium - short.premium : short.premium - long.premium; // net debit / credit per share
    if (net <= 0) return none;
    if (isDebit) {
      const maxLoss = round(net * 100);
      const maxProfit = round((width - net) * 100);
      const be = strategy === "call_debit_spread" ? Math.min(long.strike, short.strike) + net : Math.max(long.strike, short.strike) - net;
      return { breakevens: [round(be)], maxProfit, maxLoss, riskRewardRatio: maxLoss ? round(maxProfit / maxLoss, 2) : null };
    } else {
      const maxProfit = round(net * 100);
      const maxLoss = round((width - net) * 100);
      const be = strategy === "call_credit_spread" ? Math.min(long.strike, short.strike) + net : Math.max(long.strike, short.strike) - net;
      return { breakevens: [round(be)], maxProfit, maxLoss, riskRewardRatio: maxLoss ? round(maxProfit / maxLoss, 2) : null };
    }
  }

  return none;
}

function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** Relative bid/ask spread (0..1) for a contract, or null. Takes only the fields it reads
 *  so any object with bid/ask/mid (e.g. an OptionContractQuote) type-checks honestly. */
export function spreadPct(c: Pick<NormalizedContract, "bid" | "ask" | "mid"> | null): number | null {
  if (!c || c.bid === null || c.ask === null || c.mid === null || c.mid <= 0) return null;
  return round((c.ask - c.bid) / c.mid, 3);
}
