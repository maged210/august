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
//     question; else, for a row that has NOT triggered, the pass's PARSED
//     TRIGGER (evaluation.level/dir) → the trigger question; else the
//     ticker + a thesis excerpt. No model touches it.
//   - a LAST PRICE is fresh only when its own symbol was answered by the
//     latest quotes round that asked for it (readQuote); a symbol whose
//     batch failed is UNAVAILABLE, never an older round's price.
//   - "% OF THE WAY" is (last − stop) / (target − stop), clamped 0–100, and
//     exists ONLY when target, stop and last are all real numbers. The
//     reason it is absent is returned, so the card can say "no stop"
//     instead of a dash-as-zero.
//   - THE HEADLINE (feat/v4-1b-integrity, headlineOf) is the one big number
//     every surface shows: distance to the parsed trigger before a row
//     triggers, % of the way after, "—" with its reason otherwise.
//   - the STATUS CHIP maps 1:1 onto INTEGRITY-1's conclusions. REVIEW never
//     reaches this wire (review rows are not served), so it has no mapping.
//
// numOf / liveSide / sideOf moved here from components/surfaces/dock/derive.ts
// (which re-exports them) so lib code never imports a component file.

import { entryLanguage, type IdeaEvalState, type PublicIdea } from "@/lib/ideas";

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
 *  against), else the first price-like numeral of the entry LANGUAGE — the
 *  entry with its stop clauses cut out (feat/v4-1b-integrity: AGI's "stop
 *  consideration under $34.80" drew 34.80 as its ENTRY line) */
export function entryLevelOf(idea: Pick<PublicIdea, "entry" | "evaluation">): number | null {
  const ev = idea.evaluation;
  if (ev && ev.level != null && ev.dir && Number.isFinite(ev.level) && ev.level > 0) return ev.level;
  return numOf(entryLanguage(idea.entry));
}

/** SIDE derived from entry vs target numerals — the fallback when the desk
 *  never stated one; callers render it in the derived style; null when not
 *  derivable (∅). The entry numeral is read from the entry language: a stop's
 *  number is not the entry (feat/v4-1b-integrity). */
export function liveSide(idea: Pick<PublicIdea, "entry" | "target">): "LONG" | "SHORT" | null {
  const e = numOf(entryLanguage(idea.entry));
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
/** "fav" / "against" exist only for TRIGGERED: green when the crossing moved
 *  the way the STATED side wanted (long crossing above, short crossing
 *  below), red when it moved against it. "trig" is a TRIGGERED row with no
 *  stated long/short side — a neutral tint, since there is no side for the
 *  move to favor. */
export type StatusTone = "live" | "fav" | "against" | "trig" | "warn" | "mute";
export type StatusChip = {
  key: StatusKey;
  /** the rendered word(s) */
  label: string;
  tone: StatusTone;
  /** TRIGGERED only: the crossing in words ("above 106.10"), so the tint is
   *  never the only carrier of which way the move went */
  move: string | null;
  /** TRIGGERED against a stated side only: "against the long" / "against the
   *  short" — the words that stand beside the red tint */
  against: string | null;
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
const STATUS_TONE: Record<Exclude<StatusKey, "TRIGGERED">, StatusTone> = {
  LIVE: "live",
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

export function statusOf(idea: Pick<PublicIdea, "evaluation"> & Partial<Pick<PublicIdea, "side">>): StatusChip {
  const ev = idea.evaluation;
  const key = keyOfState(ev?.state);
  const base = { key, label: STATUS_LABEL[key], reason: ev?.reason ?? null, at: ev?.at ?? null };
  if (key !== "TRIGGERED" || !ev) return { ...base, tone: STATUS_TONE[key as Exclude<StatusKey, "TRIGGERED">] ?? "live", move: null, against: null };
  const move = ev.dir && ev.level != null ? `${ev.dir} ${fmtLevel(ev.level)}` : null;
  // the tint follows the STATED side only — a derived side is an inference,
  // and the pass's own crossing direction is the move being judged
  if ((idea.side === "long" || idea.side === "short") && ev.dir) {
    const favors = (idea.side === "long" && ev.dir === "above") || (idea.side === "short" && ev.dir === "below");
    return { ...base, tone: favors ? "fav" : "against", move, against: favors ? null : `against the ${idea.side}` };
  }
  return { ...base, tone: "trig", move, against: null };
}

/** the status in words, as it renders next to its tint: "Triggered above
 *  106.10", "Triggered below 34.80 · against the long", "Stale" */
export function statusText(chip: StatusChip): string {
  return [chip.move ? `${chip.label} ${chip.move}` : chip.label, chip.against].filter(Boolean).join(" · ");
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
  // the pass's own parse of the entry language — the number the LIVE chip is
  // judged against, already on the wire. Asked ONLY of rows that have not
  // triggered (a fired trigger is an answered question, and the row reads
  // its state instead: the target/stop question above when both exist, else
  // the ticker + excerpt below), and not when the pass refused to grade the
  // level (QUOTE SUSPECT). feat/v4-1b-integrity: this reads the SAME trigger
  // the headline metric measures (triggerOf). The old guard here — refusing a
  // trigger that pointed against a stated or derived side — was the terminal
  // covering for the parser reading AGI's stop clause as its entry. The pass
  // now refuses stop language and side-contradicting crossings at the source,
  // so a trigger on the wire IS the pass's trigger, and every surface reads
  // it the one way.
  const trig = triggerOf(idea);
  if (trig) {
    const text =
      trig.dir === "above" ? `${T} breaks above ${fmtLevel(trig.level)}?` : `${T} drops under ${fmtLevel(trig.level)}?`;
    return { text, tier: "trigger", excerpt: null };
  }
  return { text: T, tier: "thesis", excerpt: thesisExcerpt(idea.thesis) };
}

/** feat/v4-1b-integrity — THE TRIGGER, as every surface reads it: the pass's
 *  parsed level for a row the pass graded and that has NOT triggered (ARMED,
 *  or STALE — parsed but uncrossed past the horizon). A TRIGGERED row's level
 *  is history, a QUOTE SUSPECT level was refused, a NEEDS LEVEL row has none,
 *  and a row the pass has not seen yet has not been parsed. */
export type TriggerLevel = { dir: "above" | "below"; level: number };
export function triggerOf(idea: Pick<PublicIdea, "evaluation">): TriggerLevel | null {
  const ev = idea.evaluation;
  if (!ev || (ev.state !== "ARMED" && ev.state !== "STALE")) return null;
  if (ev.level == null || !Number.isFinite(ev.level) || ev.level <= 0 || !ev.dir) return null;
  return { dir: ev.dir, level: ev.level };
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

// ── THE HEADLINE METRIC (feat/v4-1b-integrity) — one resolver, every surface ──
//
// The big number on a card, on the idea page and in the desktop detail. Two
// states, both CALCULATED, and everything else honestly absent:
//
//   - NOT TRIGGERED, with the pass's parsed trigger (triggerOf) and a fresh
//     last: DISTANCE TO TRIGGER — |trigger − last| ÷ last, one decimal, the
//     move from here to the level. "7.7% to trigger" — the same kind of
//     figure as the idea page's "to target": a share of price to travel.
//     The direction stays where it was built, beside it (the question's
//     "breaks above 37.35?", the idea page's "trigger above 37.35").
//   - last ALREADY PAST the trigger while the row is not TRIGGERED: "beyond
//     trigger · awaiting pass", no percent. The crossing test is the pass's
//     own (≥ for above, ≤ for below); only the pass fires a trigger, so the
//     row stays LIVE / STALE in every filter and tile until it does.
//   - TRIGGERED with a stated target and stop: % OF THE WAY (progressOf), as
//     built.
//   - anything else: "—" with the reason named.

export type HeadlineKind = "distance" | "beyond" | "progress" | "absent";
export type HeadlineWhy =
  | "ok"
  | "beyond_trigger"
  | Exclude<ProgressWhy, "ok">
  | "no_trigger"
  | "quote_suspect"
  | "unevaluated";
export type Headline = {
  kind: HeadlineKind;
  /** distance: the percent at one decimal (≥ 0) · progress: integer 0–100 ·
   *  otherwise null */
  pct: number | null;
  /** the big number as it renders ("7.7%", "64%", "—") */
  big: string;
  /** the words beside it ("to trigger", "to target", "no stop") */
  label: string;
  why: HeadlineWhy;
  /** the formula a CALCULATED chip states — present exactly when `pct` is */
  calc: string | null;
  /** the trigger measured against (distance / beyond) */
  trigger: TriggerLevel | null;
  /** the % of the way read, for TRIGGERED rows */
  progress: Progress | null;
  /** the fresh last the number used, when one did */
  last: number | null;
};

export const DISTANCE_FORMULA = "|trigger − last| ÷ last — the move from last to the parsed trigger";
export const PROGRESS_FORMULA = "(last − stop) / (target − stop), clamped 0–100";

const HEADLINE_LABEL: Record<Exclude<HeadlineWhy, "ok">, string> = {
  beyond_trigger: "beyond trigger · awaiting pass",
  no_levels: PROGRESS_LABEL.no_levels,
  no_target: PROGRESS_LABEL.no_target,
  no_stop: PROGRESS_LABEL.no_stop,
  degenerate: PROGRESS_LABEL.degenerate,
  no_last: PROGRESS_LABEL.no_last,
  no_trigger: "no trigger",
  quote_suspect: "level not graded",
  unevaluated: "not yet evaluated",
};

/** the words under "—" for a headline that has no number */
export function headlineReason(why: Exclude<HeadlineWhy, "ok">): string {
  return HEADLINE_LABEL[why];
}

export function headlineOf(
  idea: Pick<PublicIdea, "target" | "stop" | "evaluation">,
  last: number | null | undefined,
): Headline {
  const l = last != null && Number.isFinite(last) && last > 0 ? last : null;
  const absent = (why: Exclude<HeadlineWhy, "ok">, extra: Partial<Headline> = {}): Headline => ({
    kind: why === "beyond_trigger" ? "beyond" : "absent",
    pct: null,
    big: "—",
    label: HEADLINE_LABEL[why],
    why,
    calc: null,
    trigger: null,
    progress: null,
    last: l,
    ...extra,
  });
  const ev = idea.evaluation;
  const state = ev?.state;

  if (state === "TRIGGERED") {
    const p = progressOf(idea, l);
    if (p.why !== "ok" || p.pct == null) {
      // progressOf names what is missing whenever it has no number
      return absent(p.why === "ok" ? "no_last" : p.why, { progress: p });
    }
    return {
      kind: "progress",
      pct: p.pct,
      big: `${p.pct}%`,
      label: PROGRESS_LABEL.ok,
      why: "ok",
      calc: PROGRESS_FORMULA,
      trigger: null,
      progress: p,
      last: l,
    };
  }

  const trig = triggerOf(idea);
  if (trig) {
    if (l == null) return absent("no_last", { trigger: trig });
    const crossed = trig.dir === "above" ? l >= trig.level : l <= trig.level;
    if (crossed) return absent("beyond_trigger", { trigger: trig });
    const pct = Number(((Math.abs(trig.level - l) / l) * 100).toFixed(1));
    return {
      kind: "distance",
      pct,
      big: `${pct.toFixed(1)}%`,
      label: "to trigger",
      why: "ok",
      calc: DISTANCE_FORMULA,
      trigger: trig,
      progress: null,
      last: l,
    };
  }

  if (state === "QUOTE_SUSPECT") return absent("quote_suspect");
  if (!ev) return absent("unevaluated");
  // NEEDS_LEVEL — or an ARMED / STALE record with no usable level
  return absent("no_trigger");
}

/** the headline's big-number tone: % of the way keeps its green / red halves;
 *  a distance is not good or bad, so it reads in ink; absent is muted */
export function headlineTone(h: Headline): "up" | "down" | "ink" | "mute" {
  if (h.kind === "progress" && h.progress) return progressTone(h.progress) ?? "mute";
  if (h.kind === "distance") return "ink";
  return "mute";
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
  /** long/short sides DERIVED from entry vs target — already inside `long`
   *  and `short`; counted so the tile can mark them (~) */
  derived: number;
  /** rows with no stated side and no derivable one */
  unsided: number;
};

export function bookStats(ideas: readonly PublicIdea[], now: number = Date.now()): BookStats {
  const today = etDateKey(now);
  let triggeredToday = 0;
  let long = 0;
  let short = 0;
  let watch = 0;
  let derived = 0;
  let unsided = 0;
  for (const i of ideas) {
    const ev = i.evaluation;
    if (ev?.state === "TRIGGERED" && etDateKey(ev.at) === today) triggeredToday++;
    const s = sideOf(i);
    if (s?.side === "LONG") long++;
    else if (s?.side === "SHORT") short++;
    else if (s?.side === "WATCH") watch++;
    else unsided++;
    if (s?.derived) derived++;
  }
  return { live: ideas.length, triggeredToday, long, short, watch, derived, unsided };
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
 *  is the same human action. STALE belongs to no bucket but ALL.
 *
 *  feat/v4-1b-integrity — the filters, the stat tiles and the headline read
 *  the SAME pass record: a row the pass refused a trigger for is NEEDS LEVEL
 *  here and "no trigger" on its card; a row whose last is past its trigger
 *  ("beyond trigger · awaiting pass") stays in LIVE (or STALE) and never counts
 *  as Triggered or Triggered today — only the pass fires a trigger. */
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

// ── last quotes — ONE freshness policy for every surface that shows a price ──
//
// The card list and the dock heatmap read the same book through readQuote,
// so a failure can never be honest in one place and silent in the other.
// Per SYMBOL, not per round: each slot carries its own last-seen time and the
// time its batch was last asked. A symbol is fresh only when the latest
// attempt that included it answered with a price, and that answer is recent.
// A failed batch nulls its symbols' prices — an older round's price is never
// kept around to be mistaken for a fresh one.

export type QuoteSlot = {
  price: number | null;
  /** today's % move, when the route carried one */
  chgPct: number | null;
  /** when this symbol last came back with a price (epoch ms) */
  seenAt: number | null;
  /** when this symbol's batch was last asked, answered or not (epoch ms) */
  checkedAt: number;
};
export type QuoteBook = Record<string, QuoteSlot>;
/** one chunk's outcome: ok=false when the request itself failed */
export type QuoteBatch = {
  symbols: readonly string[];
  ok: boolean;
  quotes?: Record<string, { price?: number; chgPct?: number } | undefined>;
};

/** `now` is when the batch was ASKED (feat/v4-1b-integrity), not when it
 *  landed: batches merge one at a time as they settle, so a slow batch never
 *  holds the rest of the book back, and a batch from an OLDER round that lands
 *  after a newer round has already asked for a symbol is dropped for that
 *  symbol — an older round's price can never overwrite a newer answer (or a
 *  newer failure) and be stamped fresh. */
export function mergeQuoteRound(prev: QuoteBook, batches: readonly QuoteBatch[], now: number): QuoteBook {
  const next: QuoteBook = { ...prev };
  for (const b of batches) {
    for (const raw of b.symbols) {
      const sym = raw.trim().toUpperCase();
      if (prev[sym] && prev[sym].checkedAt > now) continue; // a newer round already asked — this one is history
      const q = b.ok ? b.quotes?.[sym] : undefined;
      const price = q && Number.isFinite(q.price) && (q.price as number) > 0 ? (q.price as number) : null;
      if (price != null) {
        next[sym] = { price, chgPct: Number.isFinite(q!.chgPct) ? (q!.chgPct as number) : null, seenAt: now, checkedAt: now };
      } else {
        // the batch failed, or answered without this symbol: no price at all
        next[sym] = { price: null, chgPct: null, seenAt: prev[sym]?.seenAt ?? null, checkedAt: now };
      }
    }
  }
  return next;
}

export type QuoteRead =
  | { state: "pending" }
  | { state: "ok"; price: number; chgPct: number | null; seenAt: number }
  | { state: "unavailable"; seenAt: number | null };

/** pending: never asked yet · ok: answered by its latest attempt, within
 *  maxAgeMs (a poll that stalls — a hidden tab — ages a price out) ·
 *  unavailable: everything else */
export function readQuote(book: QuoteBook, symbol: string, now: number, maxAgeMs: number): QuoteRead {
  const slot = book[symbol.trim().toUpperCase()];
  if (!slot) return { state: "pending" };
  if (slot.price != null && slot.seenAt != null && slot.seenAt === slot.checkedAt && now - slot.seenAt <= maxAgeMs) {
    return { state: "ok", price: slot.price, chgPct: slot.chgPct, seenAt: slot.seenAt };
  }
  return { state: "unavailable", seenAt: slot.seenAt };
}
