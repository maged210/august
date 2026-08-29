// WHAT'S COMING actuals (fix/whats-coming) — the free calendar feed carries
// NO `actual` field (verified 2026-08-29: row keys are title/country/date/
// impact/forecast/previous, nothing else). But the desk already holds a FRED
// key, and FRED republishes the major prints the same morning — so a FIXED
// title→series mapping backfills `actual` for printed majors and caches it
// (Upstash when configured, in-process otherwise). Everything outside the
// mapping keeps the card's honest disclaimer. No paid calendar APIs.
//
// Series ids verified 2026-08-29 against the week's real prints:
// A191RL1Q225SBEA latest = 1.5 == Wednesday's "Prelim GDP q/q" 2nd estimate
// same-day; PCEPILFE m/m derives Wednesday's Core PCE; PAYEMS chg = -23K.

import { Redis } from "@upstash/redis";
import { getCalendarWeek, type CalEvent } from "./calendar-feed";

export type FredUnits = "pch" | "lin" | "chg";
export type FredMapping = {
  series: string;
  /** FRED transform: pch = % change, chg = period change, lin = as published */
  units: FredUnits;
  /** display shape: pct1 = one-decimal percent, thousands = "22K" */
  fmt: "pct1" | "thousands";
  cadence: "monthly" | "quarterly";
};

// The majors only — fixed, anchored titles (the feed's exact naming). CPI y/y
// variants, claims, and everything else deliberately stay unmapped: their
// cards keep the disclaimer rather than risk a wrong "actual".
const FRED_MAP: Array<{ re: RegExp } & FredMapping> = [
  { re: /^CPI m\/m$/i, series: "CPIAUCSL", units: "pch", fmt: "pct1", cadence: "monthly" },
  { re: /^Core CPI m\/m$/i, series: "CPILFESL", units: "pch", fmt: "pct1", cadence: "monthly" },
  { re: /^PCE Price Index m\/m$/i, series: "PCEPI", units: "pch", fmt: "pct1", cadence: "monthly" },
  { re: /^Core PCE Price Index m\/m$/i, series: "PCEPILFE", units: "pch", fmt: "pct1", cadence: "monthly" },
  { re: /^(?:Advance |Prelim |Final )?GDP q\/q$/i, series: "A191RL1Q225SBEA", units: "lin", fmt: "pct1", cadence: "quarterly" },
  { re: /^(?:Advance |Prelim |Final )?GDP Price Index q\/q$/i, series: "A191RI1Q225SBEA", units: "lin", fmt: "pct1", cadence: "quarterly" },
  { re: /^Non-Farm Employment Change$/i, series: "PAYEMS", units: "chg", fmt: "thousands", cadence: "monthly" },
  { re: /^Unemployment Rate$/i, series: "UNRATE", units: "lin", fmt: "pct1", cadence: "monthly" },
  { re: /^Retail Sales m\/m$/i, series: "RSAFS", units: "pch", fmt: "pct1", cadence: "monthly" },
  { re: /^PPI m\/m$/i, series: "PPIFIS", units: "pch", fmt: "pct1", cadence: "monthly" },
];

/** PURE. The fixed mapping for a feed title; null keeps the disclaimer. */
export function matchFredSeries(title: string): FredMapping | null {
  const t = title.trim();
  for (const { re, ...m } of FRED_MAP) if (re.test(t)) return m;
  return null;
}

/** PURE. Feed-style display value ("0.2%", "-23K"); toFixed's "-0.0" is a
 *  presentation artifact, normalized to "0.0". */
export function formatActual(value: number, fmt: FredMapping["fmt"]): string {
  if (fmt === "thousands") {
    const n = Math.round(value);
    return `${n === 0 ? 0 : n}K`;
  }
  const s = value.toFixed(1);
  return `${s === "-0.0" ? "0.0" : s}%`;
}

/** PURE. Whether a FRED observation period is THE period the event printed.
 *  Monthly majors report the prior month; GDP estimates report the quarter
 *  3–5 months back (advance/2nd/final). Anything else refuses — if FRED
 *  hasn't ingested the print yet, its latest observation is the PREVIOUS
 *  period, and serving that as "actual" would be a fabrication. */
export function observationMatchesEvent(
  obsDate: string,
  eventTs: number,
  cadence: FredMapping["cadence"],
): boolean {
  const om = /^(\d{4})-(\d{2})-\d{2}$/.exec(obsDate);
  if (!om) return false;
  const em = /^(\d{4})-(\d{2})/.exec(
    new Date(eventTs).toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
  );
  if (!em) return false;
  const diff = Number(em[1]) * 12 + Number(em[2]) - (Number(om[1]) * 12 + Number(om[2]));
  return cadence === "monthly" ? diff === 1 : diff >= 3 && diff <= 5;
}

// --- FRED fetch (injectable for tests) -------------------------------------
export type FredObservation = { date: string; value: number } | null;
export type FredFetcher = (series: string, units: FredUnits) => Promise<FredObservation>;

async function fetchFredLatest(series: string, units: FredUnits): Promise<FredObservation> {
  const key = (process.env.FRED_API_KEY || "").trim();
  // Same guard as lib/markets getMacro: real keys are 32 chars; placeholders skip.
  if (key.length < 16) return null;
  try {
    const res = await fetch(
      `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&sort_order=desc&limit=1&units=${units}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { observations?: Array<{ date?: unknown; value?: unknown }> };
    const o = j?.observations?.[0];
    const v = Number(o?.value); // FRED marks missing values "." → NaN → refuse
    if (!o || typeof o.date !== "string" || !Number.isFinite(v)) return null;
    return { date: o.date, value: v };
  } catch {
    return null;
  }
}

// --- cache store (Upstash when configured, in-process otherwise) ------------
export type ActualsStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
};

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  // Placeholder/non-https values degrade to unconfigured, never a throw.
  try {
    _redis = url && token && url.startsWith("https://") ? new Redis({ url, token }) : null;
  } catch {
    _redis = null;
  }
  return _redis;
}

const mem = new Map<string, { exp: number; v: string }>();
const memStore: ActualsStore = {
  async get(k) {
    const e = mem.get(k);
    if (!e || e.exp < Date.now()) {
      mem.delete(k);
      return null;
    }
    return e.v;
  },
  async set(k, v, ttlSec) {
    mem.set(k, { exp: Date.now() + ttlSec * 1000, v });
  },
};

function defaultStore(): ActualsStore {
  const r = getRedis();
  if (!r) return memStore;
  return {
    async get(k) {
      try {
        const v = await r.get<string>(k);
        return typeof v === "string" ? v : null;
      } catch {
        return null; // fail open — a Redis blip means a refetch, not a 500
      }
    },
    async set(k, v, ttlSec) {
      try {
        await r.set(k, v, { ex: ttlSec });
      } catch {
        /* fail open */
      }
    },
  };
}

const ACTUAL_KEY = (id: string) => `aug:calact:v1:${id}`;
const MISS_KEY = (id: string) => `aug:calactx:v1:${id}`;
const ACTUAL_TTL_S = 14 * 24 * 3600; // outlives the 12h released window + the week
const MISS_TTL_S = 30 * 60; // FRED ingests within the hour — retry half-hourly

/** Backfill `actual` for printed, mapped events. Cached per event; a value
 *  only lands when FRED's latest observation IS the printed period. Returns
 *  id → formatted actual for the events that resolved. */
export async function backfillActuals(
  events: Array<Pick<CalEvent, "id" | "title" | "ts">>,
  opts?: { store?: ActualsStore; fetcher?: FredFetcher; now?: number },
): Promise<Record<string, string>> {
  const store = opts?.store ?? defaultStore();
  const fetcher = opts?.fetcher ?? fetchFredLatest;
  const now = opts?.now ?? Date.now();
  const out: Record<string, string> = {};
  await Promise.all(
    events.map(async (e) => {
      if (e.ts > now) return; // never pre-fill an unprinted event
      const map = matchFredSeries(e.title);
      if (!map) return;
      const hit = await store.get(ACTUAL_KEY(e.id));
      if (hit) {
        out[e.id] = hit;
        return;
      }
      if (await store.get(MISS_KEY(e.id))) return; // recent miss — don't hammer FRED
      const obs = await fetcher(map.series, map.units);
      if (obs && observationMatchesEvent(obs.date, e.ts, map.cadence)) {
        const val = formatActual(obs.value, map.fmt);
        out[e.id] = val;
        await store.set(ACTUAL_KEY(e.id), val, ACTUAL_TTL_S);
      } else {
        await store.set(MISS_KEY(e.id), "1", MISS_TTL_S);
      }
    }),
  );
  return out;
}

/** The daily 21:05 pass — warm the cache for everything printed this week so
 *  released cards (and any later read) carry the actual without waiting on
 *  FRED at request time. Returns how many actuals are resolved. */
export async function backfillPrintedWeek(): Promise<number> {
  const rows = await getCalendarWeek();
  const now = Date.now();
  const res = await backfillActuals(
    rows.filter((e) => e.ts <= now),
    { now },
  );
  return Object.keys(res).length;
}
