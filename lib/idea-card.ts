// THE IDEA CARD (feat/v4-1-terminal) — every derived value the v4 terminal
// paints, as PURE functions over the wire shape (PublicIdea from GET
// /api/ideas) plus a "last" price from GET /api/intel/quotes and bars from
// GET /api/intel/bars. No network, no React, node:test-friendly.
//
// THE LAW (DESIGN_LAWS L2, CLAUDE.md): nothing here invents a number. A
// value that is not on the wire renders as absent; a value that is computed
// says so (the caller pins a CALCULATED tag on it); a template is a
// template, never a rewrite. In particular:
//
//   - the CARD QUESTION is a deterministic template over the row's own
//     fields, in three tiers: stated numeric TARGET + STOP → the odds
//     question; else the pass's PARSED TRIGGER (evaluation.level/dir, the
//     exact number the status chip is judged against) → the trigger
//     question; else the ticker + a thesis excerpt. No model touches it.
//   - "% OF THE WAY" is (last − stop) / (target − stop), clamped 0–100, and
//     exists ONLY when target, stop and last are all real numbers. The
//     reason it is absent is returned, so the card can say "no stop"
//     instead of a dash-as-zero.
//   - the STATUS CHIP maps 1:1 onto INTEGRITY-1's conclusions. REVIEW never
//     reaches this wire (review rows are not served), so it has no mapping.
//
// numOf / liveSide / sideOf moved here from components/surfaces/dock/derive.ts
// (which re-exports them) so lib code never imports a component file.

import type { IdeaEvalState, PublicIdea } from "@/lib/ideas";

// ── level parsing + side (moved from dock/derive.ts, unchanged semantics) ─────

/** first PRICE-LIKE numeral in a free-form level string ("21,450" / "break of
 *  600"). Same guards the daily pass applies (lib/ideas.ts parseEntryTrigger):
 *  a numeral wearing a unit ("$100M revenue", "50-day", "30%", "3x") is not a
 *  price, and a bare year-like integer ("loses 2024 support") is not either —
 *  the next numeral is tried instead. */
export function numOf(s: string | null | undefined): number | null {
  if (!s) return null;
  const clean = s.replace(/,/g, "");
  for (const m of clean.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const after = clean.slice((m.index ?? 0) + m[0].length);
    if (/^\s*(%|[mbk]\b|x\b|-?\s?day\b|-?\s?d\b|-?\s?dma\b|-?\s?ema\b|-?\s?sma\b)/i.test(after)) continue;
    const v = parseFloat(m[0]);
    if (!Number.isFinite(v)) continue;
    if (!m[0].includes(".") && v >= 1990 && v <= 2035 && /\b(19|20)\d\d\b/.test(m[0])) continue; // a year
    return v;
  }
  return null;
}

/** the ENTRY level a chart draws: the daily pass's PARSED TRIGGER when the
 *  pass has read one (the number the LIVE / TRIGGERED chip is judged
 *  against), else the first price-like numeral of the entry text */
export function entryLevelOf(idea: Pick<PublicIdea, "entry" | "evaluation">): number | null {
  const ev = idea.evaluation;
  if (ev && ev.level != null && ev.dir && Number.isFinite(ev.level) && ev.level > 0) return ev.level;
  return numOf(idea.entry);
}

/** SIDE derived from entry vs target numerals — the fallback when the desk
 *  never stated one; callers render it in the derived style; null when not
 *  derivable (∅) */
export function liveSide(idea: Pick<PublicIdea, "entry" | "target">): "LONG" | "SHORT" | null {
  const e = numOf(idea.entry);
  const t = numOf(idea.target);
  if (e == null || t == null || e === t) return null;
  return t > e ? "LONG" : "SHORT";
}

/** UX4 — the ONE side resolution for a LIVE idea: a stated side (extraction
 *  or /admin) wins and renders solid; otherwise fall back to the derived
 *  entry-vs-target read, marked derived; null = ∅. */
export type ResolvedSide = { side: "LONG" | "SHORT" | "WATCH"; derived: boolean };
export function sideOf(idea: Pick<PublicIdea, "side" | "entry" | "target">): ResolvedSide | null {
  if (idea.side === "long") return { side: "LONG", derived: false };
  if (idea.side === "short") return { side: "SHORT", derived: false };
  if (idea.side === "watch") return { side: "WATCH", derived: false };
  const d = liveSide(idea);
  return d ? { side: d, derived: true } : null;
}

// ── formatting ────────────────────────────────────────────────────────────────

/** a price level for a card: 4dp under 1, 2dp under 1,000, else 0–2dp with
 *  thousands separators ("0.0842", "37.35", "21,450", "1,234.5") */
export function fmtLevel(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const opts: Intl.NumberFormatOptions =
    a < 1
      ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
      : a < 1000
        ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        : { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  return n.toLocaleString("en-US", opts);
}

/** a signed percent with a real minus sign ("+8.1%", "−6.1%", "0.0%") */
export function fmtPct(n: number, dp = 1): string {
  if (!Number.isFinite(n)) return "—";
  const r = Number(n.toFixed(dp));
  const s = Math.abs(r).toFixed(dp);
  return r > 0 ? `+${s}%` : r < 0 ? `−${s}%` : `${s}%`;
}

/** "SEP 9" — the pass/date stamp the chips carry. In ET, like every desk
 *  date: a 22:12 UTC pass is the same exchange day for a viewer in Europe,
 *  and the TRIGGERED TODAY tile counts in ET too — one calendar, one stamp. */
export function fmtDay(ms: number): string {
  return new Date(ms)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })
    .toUpperCase();
}

/** the ET calendar date (YYYY-MM-DD) — "today" for TRIGGERED TODAY is an
 *  exchange-day question, so it is asked in New York, never in UTC */
export function etDateKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

// ── status chip — INTEGRITY-1 flags, 1:1 ─────────────────────────────────────

export type StatusKey = "LIVE" | "TRIGGERED" | "NEEDS_LEVEL" | "QUOTE_SUSPECT" | "STALE";
export type StatusTone = "live" | "trig" | "warn" | "mute";
export type StatusChip = {
  key: StatusKey;
  /** the rendered word(s) */
  label: string;
  tone: StatusTone;
  /** the pass's honest cause, when the pass has seen the row */
  reason: string | null;
  /** when the pass concluded it (epoch ms) — absent until the first pass */
  at: number | null;
};

const STATUS_LABEL: Record<StatusKey, string> = {
  LIVE: "Live",
  TRIGGERED: "Triggered",
  NEEDS_LEVEL: "Needs level",
  QUOTE_SUSPECT: "Quote suspect",
  STALE: "Stale",
};
const STATUS_TONE: Record<StatusKey, StatusTone> = {
  LIVE: "live",
  TRIGGERED: "trig",
  NEEDS_LEVEL: "warn",
  QUOTE_SUSPECT: "warn",
  STALE: "mute",
};

function keyOfState(state: IdeaEvalState | undefined): StatusKey {
  // ARMED (crossable trigger stated, fresh, uncrossed) still reads LIVE — it
  // is; a row the pass hasn't seen yet keeps plain LIVE too
  if (!state || state === "ARMED") return "LIVE";
  return state;
}

export function statusOf(idea: Pick<PublicIdea, "evaluation">): StatusChip {
  const ev = idea.evaluation;
  const key = keyOfState(ev?.state);
  return {
    key,
    label: STATUS_LABEL[key],
    tone: STATUS_TONE[key],
    reason: ev?.reason ?? null,
    at: ev?.at ?? null,
  };
}

// ── the card question — a template, never a rewrite ──────────────────────────

export type QuestionTier = "levels" | "trigger" | "thesis";
export type Question = {
  text: string;
  tier: QuestionTier;
  /** tier "thesis" only: the excerpt shown under the bare ticker */
  excerpt: string | null;
};

/** the direction the odds question reads in. The level ordering decides
 *  (target above stop = long-shaped, below = short-shaped); a stated side
 *  that CONTRADICTS that ordering is a conflicted row — no confident odds
 *  question is asked (null → the caller falls to the next tier), the same
 *  way the pass demotes a side-vs-entry conflict to REVIEW. target === stop
 *  is not a question either (see progressOf). */
function questionDirection(
  idea: Pick<PublicIdea, "side" | "entry" | "target" | "stop">,
  target: number,
  stop: number,
): "long" | "short" | null {
  const byLevels: "long" | "short" | null = target > stop ? "long" : target < stop ? "short" : null;
  if (!byLevels) return null;
  if (idea.side === "long" || idea.side === "short") return idea.side === byLevels ? byLevels : null;
  return byLevels;
}

/** first sentence of the thesis, or its first ~110 characters at a word
 *  boundary — verbatim text, never rewritten. A "sentence" shorter than 24
 *  characters is treated as an abbreviation ("Inc.", "vs.") and the cut
 *  continues to the next stop. */
export function thesisExcerpt(thesis: string, max = 110): string {
  const t = thesis.trim().replace(/\s+/g, " ");
  if (!t) return "";
  let firstSentence = t;
  for (const m of t.matchAll(/[.!?](?=\s|$)/g)) {
    const end = (m.index ?? 0) + 1;
    if (end >= 24) {
      firstSentence = t.slice(0, end);
      break;
    }
  }
  const pick = firstSentence.length <= max ? firstSentence : t;
  if (pick.length <= max) return pick;
  const cut = pick.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, "")}…`;
}

export function questionOf(
  idea: Pick<PublicIdea, "instrument" | "side" | "entry" | "target" | "stop" | "thesis" | "evaluation">,
): Question {
  const T = idea.instrument.trim().toUpperCase();
  const target = numOf(idea.target);
  const stop = numOf(idea.stop);
  if (target != null && stop != null) {
    const dir = questionDirection(idea, target, stop);
    if (dir === "long")
      return { text: `${T} reaches ${fmtLevel(target)} before ${fmtLevel(stop)}?`, tier: "levels", excerpt: null };
    if (dir === "short")
      return { text: `${T} drops under ${fmtLevel(target)} before ${fmtLevel(stop)}?`, tier: "levels", excerpt: null };
  }
  const ev = idea.evaluation;
  if (ev && ev.level != null && ev.dir && ev.state !== "QUOTE_SUSPECT") {
    // the pass's own parse of the entry language — the number the LIVE /
    // TRIGGERED chip is judged against, already on the wire. Not asked when
    // the pass itself refused to grade the level (QUOTE SUSPECT), and not
    // asked when it points the opposite way from the row's side (a "drops
    // under" question on a long idea is the parser reading a stop clause as
    // the entry — the chip and the LEVELS card still state what the pass
    // read; the headline does not publish it as the call).
    const side = sideOf(idea);
    const wants: "long" | "short" = ev.dir === "above" ? "long" : "short";
    const agrees = !side || side.side === "WATCH" || side.side.toLowerCase() === wants;
    if (agrees) {
      const text =
        ev.dir === "above" ? `${T} breaks above ${fmtLevel(ev.level)}?` : `${T} drops under ${fmtLevel(ev.level)}?`;
      return { text, tier: "trigger", excerpt: null };
    }
  }
  return { text: T, tier: "thesis", excerpt: thesisExcerpt(idea.thesis) };
}

/** true when a stated level string is more than its first numeral — a zone
 *  ("$37–$40"), a ladder ("765, then 762"), a condition — so a card printing
 *  the numeral marks it as parsed (~) and the idea page prints the text */
export function levelIsParsed(text: string | null | undefined, n: number | null): boolean {
  if (!text || n == null) return false;
  const bare = text.replace(/[$,\s]/g, "");
  return !/^-?\d+(?:\.\d+)?$/.test(bare) || parseFloat(bare) !== n;
}

// ── % of the way — CALCULATED, or honestly absent ────────────────────────────

export type ProgressWhy = "ok" | "no_levels" | "no_target" | "no_stop" | "degenerate" | "no_last";
export type Progress = {
  /** integer 0–100, or null with `why` saying what is missing */
  pct: number | null;
  why: ProgressWhy;
  /** distance from last to target / stop as a % of last (null when absent) */
  toTargetPct: number | null;
  toStopPct: number | null;
  target: number | null;
  stop: number | null;
  last: number | null;
};

const PROGRESS_LABEL: Record<ProgressWhy, string> = {
  ok: "to target",
  // "no target or stop", never "no level": the same card may be asking about
  // a parsed trigger level, and that IS a level
  no_levels: "no target or stop",
  no_target: "no target",
  no_stop: "no stop",
  degenerate: "target = stop",
  no_last: "no last price",
};

export function progressOf(
  idea: Pick<PublicIdea, "target" | "stop">,
  last: number | null | undefined,
): Progress {
  const target = numOf(idea.target);
  const stop = numOf(idea.stop);
  const l = last != null && Number.isFinite(last) && last > 0 ? last : null;
  const base = { target, stop, last: l };
  if (target == null && stop == null) return { pct: null, why: "no_levels", toTargetPct: null, toStopPct: null, ...base };
  if (target == null) return { pct: null, why: "no_target", toTargetPct: null, toStopPct: null, ...base };
  if (stop == null) return { pct: null, why: "no_stop", toTargetPct: null, toStopPct: null, ...base };
  if (target === stop) return { pct: null, why: "degenerate", toTargetPct: null, toStopPct: null, ...base };
  if (l == null) return { pct: null, why: "no_last", toTargetPct: null, toStopPct: null, ...base };
  const raw = ((l - stop) / (target - stop)) * 100;
  const pct = Math.round(Math.min(100, Math.max(0, raw)));
  return {
    pct,
    why: "ok",
    toTargetPct: ((target - l) / l) * 100,
    toStopPct: ((stop - l) / l) * 100,
    ...base,
  };
}

/** the small word under the big number: "to target" when computed, else the
 *  name of what is missing — never a dash posing as a zero */
export function progressLabel(p: Progress): string {
  return PROGRESS_LABEL[p.why];
}

/** bar color: green at or above the halfway mark, red below — absent = none */
export function progressTone(p: Progress): "up" | "down" | null {
  if (p.pct == null) return null;
  return p.pct >= 50 ? "up" : "down";
}

// ── header stats + filters — computed from the feed, nothing else ────────────

export type BookStats = {
  live: number;
  /** sticky TRIGGERED whose crossing was concluded on today's ET date */
  triggeredToday: number;
  long: number;
  short: number;
  /** the desk STATED "watch" — a side, not an absence */
  watch: number;
  /** rows with no stated side and no derivable one */
  unsided: number;
};

export function bookStats(ideas: readonly PublicIdea[], now: number = Date.now()): BookStats {
  const today = etDateKey(now);
  let triggeredToday = 0;
  let long = 0;
  let short = 0;
  let watch = 0;
  let unsided = 0;
  for (const i of ideas) {
    const ev = i.evaluation;
    if (ev?.state === "TRIGGERED" && etDateKey(ev.at) === today) triggeredToday++;
    const s = sideOf(i);
    if (s?.side === "LONG") long++;
    else if (s?.side === "SHORT") short++;
    else if (s?.side === "WATCH") watch++;
    else unsided++;
  }
  return { live: ideas.length, triggeredToday, long, short, watch, unsided };
}

export type BookFilter = "all" | "triggered" | "live" | "needs_level";
export const BOOK_FILTERS: ReadonlyArray<{ key: BookFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "triggered", label: "Triggered" },
  { key: "live", label: "Live" },
  { key: "needs_level", label: "Needs level" },
];

/** the filter bucket a row belongs to. QUOTE SUSPECT sits under NEEDS LEVEL:
 *  the pass refused to grade it and asks for the level to be restated, which
 *  is the same human action. STALE belongs to no bucket but ALL. */
export function bucketOf(idea: Pick<PublicIdea, "evaluation">): "triggered" | "live" | "needs_level" | "stale" {
  const k = statusOf(idea).key;
  if (k === "TRIGGERED") return "triggered";
  if (k === "LIVE") return "live";
  if (k === "STALE") return "stale";
  return "needs_level";
}

export function filterIdeas<T extends Pick<PublicIdea, "evaluation">>(ideas: readonly T[], f: BookFilter): T[] {
  if (f === "all") return [...ideas];
  return ideas.filter((i) => bucketOf(i) === f);
}

export function filterCounts(ideas: readonly Pick<PublicIdea, "evaluation">[]): Record<BookFilter, number> {
  const c: Record<BookFilter, number> = { all: ideas.length, triggered: 0, live: 0, needs_level: 0 };
  for (const i of ideas) {
    const b = bucketOf(i);
    if (b !== "stale") c[b]++;
  }
  return c;
}

// ── the 1M daily chart — geometry only; the SVG is a dumb renderer ───────────

export type Bar = { t: number; o: number; h: number; l: number; c: number };

/** the last `days` calendar days of bars (by bar timestamp, seconds) */
export function windowBars(bars: readonly Bar[], days = 31, nowSec?: number): Bar[] {
  if (bars.length === 0) return [];
  const end = nowSec ?? bars[bars.length - 1].t;
  const from = end - days * 86_400;
  return bars.filter((b) => b.t >= from && b.t <= end);
}

export type ChartLevels = { entry?: number; target?: number; stop?: number };
export type ChartGeom = {
  width: number;
  height: number;
  /** "x,y x,y …" for the close line */
  points: string;
  /** y for each stated level, when it is inside/near the plotted range */
  ys: { entry?: number; target?: number; stop?: number };
  /** the price range actually plotted (closes ∪ stated levels), padded */
  min: number;
  max: number;
  first: Bar;
  last: Bar;
};

/** a level more than 3× away from the month's closes is not on this chart's
 *  scale (the QUOTE SUSPECT rule: a pre-split level against a post-split
 *  tape) — it is left OFF the chart rather than flattening a month of real
 *  price action into a line; the LEVELS card still states it verbatim */
export function levelOnScale(level: number | undefined, closes: readonly number[]): level is number {
  if (level == null || !Number.isFinite(level) || level <= 0) return false;
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  return level <= hi * 3 && level * 3 >= lo;
}

/** Map closes + stated levels onto a w×h box. On-scale levels EXTEND the
 *  range so a target above every close still draws (a chart that hid the
 *  target would be lying about how far away it is); off-scale levels are
 *  dropped (see levelOnScale). Fewer than 2 bars → null: the caller renders
 *  UNAVAILABLE, never a placeholder line. */
export function chartGeometry(
  bars: readonly Bar[],
  levels: ChartLevels,
  width = 338,
  height = 160,
  pad = 8,
): ChartGeom | null {
  if (bars.length < 2 || width <= 0 || height <= 0) return null;
  const closes = bars.map((b) => b.c);
  const on = {
    entry: levelOnScale(levels.entry, closes) ? levels.entry : undefined,
    target: levelOnScale(levels.target, closes) ? levels.target : undefined,
    stop: levelOnScale(levels.stop, closes) ? levels.stop : undefined,
  };
  const lv = [on.entry, on.target, on.stop].filter((v): v is number => v != null);
  let min = Math.min(...closes, ...lv);
  let max = Math.max(...closes, ...lv);
  if (max === min) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  min -= span * 0.04;
  max += span * 0.04;
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (height - pad * 2);
  const x = (i: number) => (bars.length === 1 ? width / 2 : (i / (bars.length - 1)) * width);
  const points = bars.map((b, i) => `${x(i).toFixed(1)},${y(b.c).toFixed(1)}`).join(" ");
  const ys: ChartGeom["ys"] = {};
  if (on.entry != null) ys.entry = y(on.entry);
  if (on.target != null) ys.target = y(on.target);
  if (on.stop != null) ys.stop = y(on.stop);
  return { width, height, points, ys, min, max, first: bars[0], last: bars[bars.length - 1] };
}

/** quotes are fetched in chunks the route accepts (20 symbols per call);
 *  a longer book must never silently lose its tail */
export function chunkSymbols(symbols: readonly string[], size = 20): string[][] {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  const out: string[][] = [];
  for (let i = 0; i < uniq.length; i += size) out.push(uniq.slice(i, i + size));
  return out;
}
