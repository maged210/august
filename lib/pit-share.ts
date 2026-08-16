// THE PIT — S6 THE SHARE + S7 teaser visibility. Pure, node:test-friendly:
// text is the format (no image generation in v1). The challenge link carries
// the exact seed, so the recipient trades the SAME tape with the sender's
// score as the bar — deterministic by construction (S8).

import type { RoundSummary, TradeMark } from "./pit-engine";

/** DAILY PIT epoch — 2026-08-15 was #1. */
const DAILY_EPOCH_UTC = Date.UTC(2026, 7, 15);

/** PURE. "THE PIT #n" numbering for a YYYY-MM-DD ET date. */
export function dailyNumber(date: string): number {
  const d = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(d)) return 1;
  return Math.max(1, Math.floor((d - DAILY_EPOCH_UTC) / 86_400_000) + 1);
}

/** PURE. Wordle-style outcome strip from the deliberate-trade log: one glyph
 *  per close, win/loss order preserved, capped; the ending glyph rides last.
 *  Spoils nothing — reads at a glance. */
export function glyphStrip(
  log: TradeMark[],
  ending: "busted" | "cleared" | "fund" | "day" | "daily",
  cap = 12,
): string {
  const closes = log.filter((m) => m.kind === "close");
  const body = closes.slice(0, cap).map((m) => ((m.gain ?? 0) >= 0 ? "🟩" : "🟥")).join("");
  const tail = closes.length > cap ? "…" : "";
  const end = ending === "busted" ? "💀" : ending === "cleared" ? "🏁" : ending === "fund" ? "🏛" : "🔔";
  return `${body || "▫"}${tail}${end}`;
}

/** PURE. The one earned stamp worth bragging (or confessing) about. */
export function pickStamp(sum: {
  stamps: string[]; missionHit: boolean; margin: boolean;
  bonus: Array<[string, number]>; missionKey?: string;
}): string | null {
  if (sum.stamps.includes("diamond")) return "DIAMOND HANDS";
  if (sum.missionHit && sum.missionKey === "survivor") return "survived the crash";
  if (sum.bonus.some(([k]) => k === "PERFECT DAY")) return "PERFECT DAY";
  if (sum.bonus.some(([k]) => k === "MARKET BEATEN")) return "MARKET BEATEN";
  if (sum.missionHit) return "MISSION ✓";
  if (sum.stamps.includes("paper")) return "PAPER HANDS";
  if (sum.margin) return "margin called";
  return null;
}

/** PURE. The copy-card text: one line of facts, the glyph strip, the link. */
export function buildShareText(input: {
  tag: string; // "#12" (daily) or "W2D3" (career)
  pct: number;
  trades: number;
  stamp: string | null;
  glyphs: string;
  url: string;
}): string {
  const pct = `${input.pct >= 0 ? "+" : ""}${input.pct.toFixed(1)}%`;
  const bits = [
    `THE PIT ${input.tag}`,
    pct,
    `${input.trades} trade${input.trades === 1 ? "" : "s"}`,
    ...(input.stamp ? [input.stamp] : []),
  ];
  return `${bits.join(" · ")}\n${input.glyphs}\n${input.url}`;
}

// ── the challenge link ───────────────────────────────────────────────────────

export type Challenge = { seed: number; week: number; day: number; pct: number };

/** PURE. Serialize a challenge for the URL: seed.week.day.pct100 (pct in
 *  hundredths so the string stays integer-only and locale-proof). */
export function buildChallenge(c: Challenge): string {
  return [c.seed >>> 0, c.week, c.day, Math.round(c.pct * 100)].join(".");
}

/** PURE. Parse ?challenge= back; null on anything malformed. */
export function parseChallenge(raw: string | null | undefined): Challenge | null {
  if (!raw) return null;
  const m = /^(\d{1,10})\.(\d{1,2})\.(\d{1,2})\.(-?\d{1,7})$/.exec(raw.trim());
  if (!m) return null;
  const seed = Number(m[1]);
  const week = Number(m[2]);
  const day = Number(m[3]);
  const pct = Number(m[4]) / 100;
  if (!Number.isFinite(seed) || seed < 1) return null;
  if (week < 1 || week > 20 || day < 1 || day > 7) return null;
  if (pct < -100 || pct > 500) return null;
  return { seed, week, day, pct };
}

// ── S7: the desk teaser's lock switch ────────────────────────────────────────

/** Lock-ready visibility: open for everyone today; AUTH-1 flips this to
 *  gate on the viewer's tier and the teaser renders its locked/blurred CTA
 *  with zero rework. */
export function deskTeaserVisibility(): "open" | "locked" {
  return "open";
}
