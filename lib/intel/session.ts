// Market session + ET date helpers. America/New_York throughout (matches the
// markets/brief layers). No external dependency — pure Intl.

import type { MarketSession } from "./types";

const TZ = "America/New_York";

export function etDateKey(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}

export function etNiceDate(d = new Date()): string {
  return d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
}

export function etClock(d = new Date()): string {
  return d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

function etParts(d = new Date()): { hour: number; minute: number; weekday: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const map: Record<string, string> = {};
  for (const p of f.formatToParts(d)) if (p.type !== "literal") map[p.type] = p.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { hour, minute: Number(map.minute), weekday: days.indexOf(map.weekday) };
}

/** US equity session (approximate; ignores half-days/holidays). */
export function marketSession(d = new Date()): MarketSession {
  const { hour, minute, weekday } = etParts(d);
  if (weekday === 0 || weekday === 6) return "closed";
  const mins = hour * 60 + minute;
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "premarket";
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "regular";
  if (mins >= 16 * 60 && mins < 20 * 60) return "afterhours";
  return "closed";
}

export const SESSION_LABEL: Record<MarketSession, string> = {
  premarket: "Premarket",
  regular: "Regular session",
  afterhours: "After-hours",
  closed: "Market closed",
};

/** A video is stale if it was published before today's ET market date. */
export function isStale(publishedAtMs: number, now = new Date()): boolean {
  if (!publishedAtMs) return false;
  return etDateKey(new Date(publishedAtMs)) < etDateKey(now);
}
