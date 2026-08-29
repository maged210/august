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

/** Why a reaction couldn't be computed — surfaced on the card as "—" plus
 *  this reason, never a fabricated 0. */
export type ReactionWhy = "no_bars" | "no_preprint_bar" | "window_incomplete";
export type ReactionResult = { ok: true; pct: number } | { ok: false; why: ReactionWhy };

/** PURE (F2-A released). The market's move over the N minutes after a print,
 *  from real intraday bars — an explicit reason unless the bars genuinely
 *  cover BOTH ends (never estimated).
 *
 *  Window: close of the last bar BEFORE the print (the last pre-print trade)
 *  -> open of the first bar at/after t+N (the price N minutes in). The old
 *  version anchored on the CLOSE of the bar CONTAINING the print, which
 *  excluded the impulse move entirely — verified 2026-08-29 on real NQ=F 5m
 *  bars: the Wed 08:30 ET PCE/GDP batch measured -0.006% ("-0.0%") the old
 *  way vs the real -0.32%. Both ends tolerate <=600s so 5m/1m bars qualify
 *  and 30m bars honestly refuse. */
export function reactionAfter(bars: Candle[], tsMs: number, minutes: number): ReactionResult {
  if (bars.length === 0) return { ok: false, why: "no_bars" };
  const t0 = tsMs / 1000;
  const t1 = t0 + minutes * 60;
  let pre: Candle | null = null;
  let end: Candle | null = null;
  for (const b of bars) {
    if (b.time < t0) {
      if (t0 - b.time <= 600) pre = b;
    } else if (b.time >= t1) {
      if (b.time - t1 <= 600) end = b;
      break;
    }
  }
  if (!pre || pre.close <= 0) return { ok: false, why: "no_preprint_bar" };
  if (!end) return { ok: false, why: "window_incomplete" };
  return { ok: true, pct: ((end.open - pre.close) / pre.close) * 100 };
}

/** PURE. Shared ET stamp — the client's card and the server's canonical ask
 *  prompts must produce IDENTICAL strings (the chat cache validates on it). */
export function fmtEt(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }) + " ET";
}

/** PURE. The canonical ASK AUGUST prompts for an event — deterministic per
 *  event (no countdowns, no "now"), so one answer per event per day can be
 *  cached. The client sends exactly these; the server refuses to cache
 *  anything else. */
export function askPrompts(e: Pick<CalEvent, "title" | "ts" | "forecast" | "previous">): { released: string; imminent: string } {
  return {
    released: `The ${e.title} just printed (${fmtEt(e.ts)}). What could it mean for the tape?`,
    imminent: `${e.title} prints ${fmtEt(e.ts)} (expected ${e.forecast ?? "n/a"}, prior ${e.previous ?? "n/a"}). What could this move?`,
  };
}

/** PURE. Which canonical prompt a message is — null means "not a calendar
 *  ask": the chat cache must never store or serve arbitrary text under an
 *  event's key (a visitor could poison the shared answer otherwise). */
export function matchAskPrompt(
  e: Pick<CalEvent, "title" | "ts" | "forecast" | "previous">,
  text: string,
): "released" | "imminent" | null {
  const p = askPrompts(e);
  return text === p.released ? "released" : text === p.imminent ? "imminent" : null;
}

// FNV-1a 32-bit — a tiny pure digest (no node:crypto: this module ships in
// the client bundle).
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** PURE. Cache key for a calendar ask — per event, per prompt kind (the
 *  pre-print and post-print questions get different answers), per UTC day,
 *  per canonical prompt text: the imminent prompt embeds forecast/previous,
 *  and a mid-day feed revision must start a FRESH entry rather than serve an
 *  answer reasoning about the old numbers. */
export function askCacheKey(eventId: string, isoDay: string, kind: "released" | "imminent", promptText: string): string {
  return `aug:calask:v1:${kind}:${isoDay}:${fnv1a(promptText)}:${eventId}`;
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
