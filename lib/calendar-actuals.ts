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

/** PURE. Whether a FRED observation IS the value the event printed.
 *  Monthly majors report the prior month — before FRED ingests the print its
 *  latest observation is a FURTHER month back (diff 2), so the period alone
 *  refuses. Quarterly GDP estimates are different: FRED revises the SAME
 *  quarterly observation in place (advance → 2nd → final all live on the
 *  quarter-start date), so between a Prelim/Final print and FRED's ingest the
 *  period check would pass while the VALUE is still the previous estimate —
 *  the quarterly branch therefore also requires the observation's
 *  realtime_start (the date the current value was published) to be on/after
 *  the event's ET date. Anything else refuses: a stale estimate served as
 *  "actual" would be a fabrication. */
export function observationMatchesEvent(
  obs: { date: string; realtimeStart?: string | null },
  eventTs: number,
  cadence: FredMapping["cadence"],
): boolean {
  const om = /^(\d{4})-(\d{2})-\d{2}$/.exec(obs.date);
  if (!om) return false;
  const eventEtDate = new Date(eventTs).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const em = /^(\d{4})-(\d{2})/.exec(eventEtDate);
  if (!em) return false;
  const diff = Number(em[1]) * 12 + Number(em[2]) - (Number(om[1]) * 12 + Number(om[2]));
  if (cadence === "monthly") return diff === 1;
  if (diff < 3 || diff > 5) return false;
  // in-place quarterly revisions: only a vintage published on/after the print
  // day proves the value IS this estimate and not the previous one
  const rt = obs.realtimeStart;
  return typeof rt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rt) && rt >= eventEtDate;
}

// --- FRED fetch (injectable for tests) -------------------------------------
export type FredObservation = { date: string; value: number; realtimeStart: string | null } | null;
/** realtimeStart (quarterly only): opens FRED's vintage window so the row's
 *  realtime_start is the TRUE publication date of the current value — with
 *  the default window FRED clamps realtime_start to today, which would make
 *  a pre-ingest fetch on the print day look freshly published. */
export type FredFetcher = (
  series: string,
  units: FredUnits,
  realtimeStart?: string | null,
) => Promise<FredObservation>;

async function fetchFredLatest(
  series: string,
  units: FredUnits,
  realtimeStart?: string | null,
): Promise<FredObservation> {
  const key = (process.env.FRED_API_KEY || "").trim();
  // Same guard as lib/markets getMacro: real keys are 32 chars; placeholders skip.
  if (key.length < 16) return null;
  try {
    let url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&sort_order=desc&limit=10&units=${units}`;
    // Vintage window from the day BEFORE the print: a value still current from
    // an earlier release clamps to realtime_start = that day (refused by the
    // guard); a value ingested on/after the print day keeps its true
    // publication date (accepted).
    if (realtimeStart) url += `&realtime_start=${realtimeStart}&realtime_end=9999-12-31`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      observations?: Array<{ date?: unknown; value?: unknown; realtime_start?: unknown }>;
    };
    const rows = (j?.observations ?? []).filter(
      (o): o is { date: string; value: string; realtime_start?: string } =>
        typeof o?.date === "string" && Number.isFinite(Number(o?.value)), // FRED marks missing "." → NaN → drop
    );
    if (rows.length === 0) return null;
    // newest observation period; among its vintages, the newest vintage
    const maxDate = rows.reduce((m, o) => (o.date > m ? o.date : m), rows[0].date);
    const vintages = rows.filter((o) => o.date === maxDate);
    const pick = vintages.reduce((m, o) =>
      String(o.realtime_start ?? "") > String(m.realtime_start ?? "") ? o : m,
    );
    return {
      date: pick.date,
      value: Number(pick.value),
      realtimeStart: typeof pick.realtime_start === "string" ? pick.realtime_start : null,
    };
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
      // quarterly: open the vintage window from the day before the print so
      // realtime_start carries the current value's true publication date
      const rtStart =
        map.cadence === "quarterly"
          ? new Date(e.ts - 24 * 3600_000).toLocaleDateString("en-CA", { timeZone: "America/New_York" })
          : null;
      const obs = await fetcher(map.series, map.units, rtStart);
      if (obs && observationMatchesEvent(obs, e.ts, map.cadence)) {
        const val = formatActual(obs.value, map.fmt);
        out[e.id] = val;
        await store.set(ACTUAL_KEY(e.id), val, ACTUAL_TTL_S);
      } else {
        // sentinel must NOT be JSON-parseable: @upstash/redis auto-deserializes
        // on get, so "1" would come back as number 1 and fail the string guard
        await store.set(MISS_KEY(e.id), "x", MISS_TTL_S);
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
