// THE COUNTDOWN ROW's data (R4 F2) — the same free weekly calendar JSON the
// pipeline already fetched (and discarded) since CORE V2, now mapped with its
// FULL shape: forecast/previous/country ride along. VETTED 2026-08-16 against
// two known releases (FOMC minutes Aug 19 14:00 ET; weekly claims Thu 08:30
// ET) before any timer rendered. LIMITATION: the feed carries NO `actual`
// field — released cards must never fabricate a beat/miss.

import type { Candle } from "./markets";

export type CalEvent = {
  /** stable identity: series title + timestamp. NEVER the timestamp alone —
   *  the feed stacks releases on shared timestamps (verified 2026-08-26:
   *  seven USD rows at 08:30 ET). */
  id: string;
  title: string;
  country: string;
  /** epoch ms (the feed carries ET-offset ISO strings) */
  ts: number;
  impact: "High" | "Medium" | "Low" | string;
  forecast: string | null;
  previous: string | null;
  /** the big-four class, when this is one of them */
  cls: EventClass | null;
};

export type EventClass = "CPI" | "FOMC" | "JOBS" | "GDP";
export type EventState = "distant" | "imminent" | "released" | "past";

const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

/** PURE. Classify a title into the big four; null otherwise. Weekly claims
 *  are deliberately NOT the jobs report, and regional-Fed member speeches are
 *  NOT the FOMC (the feed titles them "FOMC Member X Speaks", usually Low
 *  impact — promoting them made a Barkin speech render as "FOMC"). Chair
 *  remarks stay classified: they move the tape. */
export function classifyEvent(title: string): EventClass | null {
  const t = title.trim();
  if (/unemployment claims/i.test(t)) return null;
  if (/\bFOMC member/i.test(t)) return null;
  if (/\bCPI\b|consumer price/i.test(t)) return "CPI";
  if (/\bFOMC\b|federal funds rate|fed chair/i.test(t)) return "FOMC";
  if (/non-?farm|\bNFP\b|unemployment rate|average hourly earnings/i.test(t)) return "JOBS";
  if (/\bGDP\b/i.test(t)) return "GDP";
  return null;
}

/** PURE (F2-A). The card's state for a timestamp. Released = printed within
 *  the last 12h; older is past (drops off the row). */
export function eventState(tsMs: number, nowMs: number): EventState {
  const dt = tsMs - nowMs;
  if (dt <= 0) return nowMs - tsMs <= 12 * 3600_000 ? "released" : "past";
  return dt < 48 * 3600_000 ? "imminent" : "distant";
}

/** PURE. The card's ET stamp ("Wed 08:30 ET"). */
export function fmtEt(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }) + " ET";
}

/** PURE. Map a raw feed row; null when malformed. */
export function parseCalRow(raw: unknown): CalEvent | null {
  const r = raw as { title?: unknown; country?: unknown; date?: unknown; impact?: unknown; forecast?: unknown; previous?: unknown };
  if (typeof r?.title !== "string" || typeof r?.date !== "string") return null;
  const ts = Date.parse(r.date);
  if (!Number.isFinite(ts)) return null;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    id: `${r.title.trim()}@${ts}`,
    title: r.title.trim(),
    country: typeof r.country === "string" ? r.country : "",
    ts,
    impact: typeof r.impact === "string" ? r.impact : "Low",
    forecast: s(r.forecast),
    previous: s(r.previous),
    cls: classifyEvent(r.title),
  };
}

// 30-min in-process cache (the feed updates weekly)
let _cache: { at: number; rows: CalEvent[] } | null = null;

export async function getCalendarWeek(): Promise<CalEvent[]> {
  if (_cache && Date.now() - _cache.at < 30 * 60_000) return _cache.rows;
  const res = await fetch(FEED, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`calendar_feed_${res.status}`);
  const j: unknown[] = await res.json();
  const rows = (Array.isArray(j) ? j : [])
    .map(parseCalRow)
    .filter((e): e is CalEvent => e !== null && e.country === "USD");
  _cache = { at: Date.now(), rows };
  return rows;
}
