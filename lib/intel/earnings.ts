// AUGUST Market Intel — Finnhub earnings calendar (the CATALYSTS line). SERVER ONLY.
//
// SPEC-wiring §2.7: key-gated on FINNHUB_API_KEY — unset returns null and the
// line is hidden entirely (no creator-claim fallback built here; hiding is the
// honest default). ONE range call from today (ET) to +10 calendar days (covers
// the design's "<7 sessions" window across weekends/holidays), filtered to the
// live tracked watchlist. hour comes back "bmo" | "amc" | "dmh" | "" — the UI
// maps bmo/amc/dmh → BMO/AMC/—.
//
// Caching: Redis 6h TTL keyed by ET date (august:intel:earnings:v1:<etDate> —
// earnings dates don't move intraday) + an in-process memo so a Redis-less dev
// box doesn't ping Finnhub every desk poll. The cached value stores the
// watchlist it was filtered for: a cached superset serves any current subset;
// a new ticker forces one fresh call. Free-tier safe (~4 calls/day).

import { Redis } from "@upstash/redis";

export type EarningsHour = "bmo" | "amc" | "dmh";
export type EarningsEvent = { symbol: string; date: string; hour: EarningsHour | null };

/** mirrors trackerStore's MAX_QUOTED_TICKERS — the watchlist cap */
const MAX_WATCHLIST = 25;
const RANGE_DAYS = 10;
const TTL_MS = 6 * 60 * 60_000;
const TTL_SEC = TTL_MS / 1000;
const redisKey = (etDate: string) => `august:intel:earnings:v1:${etDate}`;

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

type CachedCal = { watchlist: string[]; events: EarningsEvent[]; asOf: number };

let mem: { etDate: string; exp: number; cal: CachedCal } | null = null;

const nowEtDate = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

function plusDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const HOURS: ReadonlySet<string> = new Set(["bmo", "amc", "dmh"]);

function isCachedCal(x: unknown): x is CachedCal {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    Array.isArray(r.watchlist) && r.watchlist.every((s) => typeof s === "string") &&
    Array.isArray(r.events) &&
    r.events.every(
      (e: unknown) =>
        !!e && typeof e === "object" &&
        typeof (e as EarningsEvent).symbol === "string" &&
        typeof (e as EarningsEvent).date === "string",
    )
  );
}

/** filter a cached calendar down to the current (sub)watchlist */
function filterTo(cal: CachedCal, watch: ReadonlySet<string>): EarningsEvent[] {
  return cal.events.filter((e) => watch.has(e.symbol));
}

async function fetchFinnhub(key: string, from: string, to: string): Promise<EarningsEvent[]> {
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`finnhub ${res.status}`);
  const j: unknown = await res.json();
  const rows = (j as { earningsCalendar?: unknown[] })?.earningsCalendar;
  if (!Array.isArray(rows)) throw new Error("finnhub bad payload");
  const out: EarningsEvent[] = [];
  for (const row of rows) {
    const r = row as { symbol?: unknown; date?: unknown; hour?: unknown };
    const symbol = String(r.symbol ?? "").trim().toUpperCase();
    const date = String(r.date ?? "").trim();
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) continue;
    const hraw = String(r.hour ?? "").trim().toLowerCase();
    out.push({ symbol, date, hour: HOURS.has(hraw) ? (hraw as EarningsHour) : null });
  }
  out.sort((a, b) => (a.date === b.date ? a.symbol.localeCompare(b.symbol) : a.date.localeCompare(b.date)));
  return out;
}

/**
 * Watchlist earnings for the next ~7 sessions. Returns:
 *  - null   → FINNHUB_API_KEY unset, or the calendar could not be fetched
 *             (the CATALYSTS line hides — never placeholder rows);
 *  - []     → key set, calendar fetched, no watchlist earnings in the window;
 *  - rows   → real Finnhub dates for tracked tickers.
 */
export async function getWatchlistEarnings(watchlist: string[]): Promise<EarningsEvent[] | null> {
  const key = (process.env.FINNHUB_API_KEY || "").trim();
  if (!key) return null;

  const watch = [...new Set(watchlist.map((s) => s.trim().toUpperCase()).filter(Boolean))]
    .sort()
    .slice(0, MAX_WATCHLIST);
  if (watch.length === 0) return [];
  const watchSet = new Set(watch);

  const etDate = nowEtDate();
  const now = Date.now();

  // in-process memo — valid same ET date, unexpired, and a superset watchlist
  if (mem && mem.etDate === etDate && mem.exp > now && watch.every((s) => mem!.cal.watchlist.includes(s))) {
    return filterTo(mem.cal, watchSet);
  }

  // Redis (best-effort) — same superset rule; a new ticker is a cache miss
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get<string>(redisKey(etDate));
      if (raw) {
        const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (isCachedCal(parsed) && watch.every((s) => parsed.watchlist.includes(s))) {
          mem = { etDate, exp: now + TTL_MS, cal: parsed };
          return filterTo(parsed, watchSet);
        }
      }
    } catch {
      /* best-effort — fall through to a live fetch */
    }
  }

  try {
    const events = (await fetchFinnhub(key, etDate, plusDays(etDate, RANGE_DAYS))).filter((e) =>
      watchSet.has(e.symbol),
    );
    const cal: CachedCal = { watchlist: watch, events, asOf: now };
    mem = { etDate, exp: now + TTL_MS, cal };
    if (redis) {
      try {
        await redis.set(redisKey(etDate), JSON.stringify(cal), { ex: TTL_SEC });
      } catch {
        /* best-effort */
      }
    }
    return events;
  } catch {
    return null; // fetch failed with no cache — the line hides, never fakes
  }
}
