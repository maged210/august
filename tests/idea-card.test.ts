// THE IDEA CARD (feat/v4-1-terminal) — the v4 terminal's derived values are
// pure and tested here: the question template's three tiers, % of the way,
// the 1:1 status map, header stats, filters, and the chart geometry. Run via
// `npm test` (tests are ENUMERATED in package.json — this file is listed).

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublicIdea } from "../lib/ideas";
import {
  BOOK_FILTERS,
  DISTANCE_FORMULA,
  PROGRESS_FORMULA,
  bookStats,
  bucketOf,
  chartGeometry,
  entryLevelOf,
  etDateKey,
  filterCounts,
  filterIdeas,
  fmtDay,
  fmtLevel,
  fmtPct,
  headlineOf,
  headlineReason,
  headlineTone,
  levelIsParsed,
  levelOnScale,
  numOf,
  progressLabel,
  progressOf,
  progressTone,
  questionOf,
  sideOf,
  statusOf,
  statusText,
  thesisExcerpt,
  triggerOf,
  windowBars,
  type HeadlineKind,
  type HeadlineWhy,
} from "../lib/idea-card";

const T0 = 1_757_800_000_000; // 2025-09-13T22:13:20Z — a fixed clock

const base: PublicIdea = {
  id: "idea_x",
  instrument: "SEDG",
  thesis: "SolarEdge is close on watch to the upside. A breakout above 37.35 with volume confirms the base.",
  entry: "break above $37.35",
  target: "",
  riskLevel: "medium",
  createdAt: T0 - 3_600_000,
  updatedAt: T0 - 3_600_000,
};

const armed = (over: Partial<PublicIdea> = {}): PublicIdea => ({
  ...base,
  evaluation: { state: "ARMED", level: 37.35, dir: "above", price: 36.4, at: T0 - 60_000, reason: "stated trigger not yet crossed" },
  ...over,
});

// --- question template --------------------------------------------------------

test("question tier 1: stated numeric target + stop → the odds question, side-aware", () => {
  const long = questionOf({ ...base, side: "long", target: "41.00", stop: "35.60" });
  assert.deepEqual(long, { text: "SEDG reaches 41.00 before 35.60?", tier: "levels", excerpt: null });
  const short = questionOf({ ...base, instrument: "crwd", side: "short", target: "185", stop: "205" });
  assert.equal(short.text, "CRWD drops under 185.00 before 205.00?");
  // no stated side: the levels decide the shape — target above stop reads long
  assert.equal(questionOf({ ...base, target: "41", stop: "35.6" }).text, "SEDG reaches 41.00 before 35.60?");
  assert.equal(questionOf({ ...base, target: "30", stop: "35.6" }).text, "SEDG drops under 30.00 before 35.60?");
});

test("question tier 1 uses the PARSED numbers, verbatim level text stays for the detail", () => {
  const q = questionOf({ ...base, side: "long", target: "$42 near-term, $46.50 next major", stop: "$33 base" });
  assert.equal(q.text, "SEDG reaches 42.00 before 33.00?");
});

test("question tier 2: no target/stop pair → the pass's parsed trigger asks the question", () => {
  assert.deepEqual(questionOf(armed()), { text: "SEDG breaks above 37.35?", tier: "trigger", excerpt: null });
  const below = armed({ instrument: "CRWD", side: "short", evaluation: { ...armed().evaluation!, level: 197.25, dir: "below" } });
  assert.equal(questionOf(below).text, "CRWD drops under 197.25?");
  // a target WITHOUT a stop is not the odds question — it falls to the trigger
  assert.equal(questionOf(armed({ target: "41" })).tier, "trigger");
});

test("question tier 3: nothing crossable → the bare ticker + a verbatim thesis excerpt", () => {
  const q = questionOf({ ...base, instrument: "enph", thesis: "Double bottom off $35 support. Watching for confirmation." });
  assert.equal(q.tier, "thesis");
  assert.equal(q.text, "ENPH");
  assert.equal(q.excerpt, "Double bottom off $35 support.");
  // NEEDS_LEVEL rows carry no level on the evaluation either
  const nl = questionOf({
    ...base,
    evaluation: { state: "NEEDS_LEVEL", level: null, dir: null, price: 36.72, at: T0, reason: "no crossable trigger stated in the entry" },
  });
  assert.equal(nl.tier, "thesis");
});

test("thesisExcerpt: first sentence when short, else a word-boundary cut with an ellipsis, never rewritten", () => {
  assert.equal(thesisExcerpt("The first sentence is this one. Two."), "The first sentence is this one.");
  const long = "word ".repeat(60).trim();
  const ex = thesisExcerpt(long, 50);
  assert.ok(ex.endsWith("…"));
  assert.ok(ex.length <= 51);
  assert.equal(thesisExcerpt("   "), "");
});

// --- % of the way ---------------------------------------------------------------

test("progress: (last − stop) / (target − stop), clamped 0–100, direction-agnostic", () => {
  const long = progressOf({ target: "41.00", stop: "35.60" }, 37.92);
  assert.equal(long.why, "ok");
  assert.equal(long.pct, 43); // (37.92-35.6)/(41-35.6) = 42.96
  assert.equal(fmtPct(long.toTargetPct!), "+8.1%");
  assert.equal(fmtPct(long.toStopPct!), "−6.1%");
  // a short: target below stop, the same formula reads progress toward the target
  const short = progressOf({ target: "185", stop: "205" }, 201.4);
  assert.equal(short.pct, 18); // (201.4-205)/(185-205) = 18
  assert.equal(progressOf({ target: "41", stop: "35.6" }, 50).pct, 100);
  assert.equal(progressOf({ target: "41", stop: "35.6" }, 10).pct, 0);
});

test("progress: absent inputs are absent WITH the reason — never a dash posing as zero", () => {
  assert.equal(progressOf({ target: "", stop: undefined }, 36).why, "no_levels");
  assert.equal(progressOf({ target: "", stop: "35" }, 36).why, "no_target");
  assert.equal(progressOf({ target: "41", stop: undefined }, 36).why, "no_stop");
  assert.equal(progressOf({ target: "41", stop: "41" }, 36).why, "degenerate");
  assert.equal(progressOf({ target: "41", stop: "35" }, null).why, "no_last");
  assert.equal(progressOf({ target: "41", stop: "35" }, 0).why, "no_last");
  for (const p of [progressOf({ target: "", stop: "" }, 1), progressOf({ target: "41", stop: "35" }, null)]) {
    assert.equal(p.pct, null);
    assert.equal(progressTone(p), null);
  }
  assert.equal(progressLabel(progressOf({ target: "41", stop: undefined }, 36)), "no stop");
  assert.equal(progressLabel(progressOf({ target: "", stop: "" }, 36)), "no target or stop");
  assert.equal(progressLabel(progressOf({ target: "41", stop: "35" }, 37)), "to target");
});

test("progress tone: green at/above 50, red below", () => {
  assert.equal(progressTone(progressOf({ target: "100", stop: "0" }, 50)), "up");
  assert.equal(progressTone(progressOf({ target: "100", stop: "0" }, 49.4)), "down");
});

// --- status chip ------------------------------------------------------------------

test("status: INTEGRITY-1 flags map 1:1; ARMED and unseen both read LIVE", () => {
  assert.equal(statusOf(base).key, "LIVE");
  assert.equal(statusOf(base).at, null);
  assert.equal(statusOf(armed()).label, "Live");
  const ev = armed().evaluation!;
  assert.equal(statusOf({ evaluation: { ...ev, state: "TRIGGERED" } }).label, "Triggered");
  assert.equal(statusOf({ evaluation: { ...ev, state: "NEEDS_LEVEL" } }).label, "Needs level");
  assert.equal(statusOf({ evaluation: { ...ev, state: "QUOTE_SUSPECT" } }).label, "Quote suspect");
  assert.equal(statusOf({ evaluation: { ...ev, state: "STALE" } }).tone, "mute");
  assert.equal(statusOf({ evaluation: { ...ev, state: "QUOTE_SUSPECT" } }).tone, "warn");
  assert.equal(statusOf(armed()).reason, "stated trigger not yet crossed");
});

// --- header stats + filters --------------------------------------------------------

test("bookStats: live count, TRIGGERED-today by ET date, bias from stated + derived sides", () => {
  const ev = armed().evaluation!;
  const ideas: PublicIdea[] = [
    armed({ side: "long", evaluation: { ...ev, state: "TRIGGERED", at: T0 - 60_000 } }), // today (ET)
    armed({ side: "short", evaluation: { ...ev, state: "TRIGGERED", at: T0 - 3 * 86_400_000 } }), // not today
    armed({ entry: "21,450", target: "21,320" }), // derived SHORT
    armed({ entry: "holds support" }), // no side, not derivable
  ];
  const s = bookStats(ideas, T0);
  assert.deepEqual(s, { live: 4, triggeredToday: 1, long: 1, short: 2, watch: 0, derived: 1, unsided: 1 });
  assert.equal(etDateKey(T0), "2025-09-13");
});

test("filters: four buckets from the same flags; QUOTE SUSPECT sits under NEEDS LEVEL; STALE only under ALL", () => {
  const ev = armed().evaluation!;
  const ideas = [
    base,
    armed(),
    armed({ evaluation: { ...ev, state: "TRIGGERED" } }),
    armed({ evaluation: { ...ev, state: "NEEDS_LEVEL", level: null, dir: null } }),
    armed({ evaluation: { ...ev, state: "QUOTE_SUSPECT" } }),
    armed({ evaluation: { ...ev, state: "STALE" } }),
  ];
  assert.deepEqual(
    BOOK_FILTERS.map((f) => f.key),
    ["all", "triggered", "live", "needs_level"],
  );
  assert.equal(filterIdeas(ideas, "all").length, 6);
  assert.equal(filterIdeas(ideas, "live").length, 2);
  assert.equal(filterIdeas(ideas, "triggered").length, 1);
  assert.equal(filterIdeas(ideas, "needs_level").length, 2);
  assert.equal(bucketOf(ideas[5]), "stale");
  assert.deepEqual(filterCounts(ideas), { all: 6, triggered: 1, live: 2, needs_level: 2 });
});

// --- chart geometry ------------------------------------------------------------

const bar = (day: number, c: number) => ({ t: 1_757_000_000 + day * 86_400, o: c, h: c + 1, l: c - 1, c });

test("windowBars: the last 31 calendar days by bar time", () => {
  const bars = Array.from({ length: 60 }, (_, i) => bar(i, 100 + i));
  const w = windowBars(bars, 31);
  assert.equal(w[w.length - 1].t, bars[59].t);
  assert.ok(w.length >= 31 && w.length <= 32);
  assert.deepEqual(windowBars([], 31), []);
});

test("chartGeometry: fewer than 2 bars → null (UNAVAILABLE, never a placeholder line)", () => {
  assert.equal(chartGeometry([], {}), null);
  assert.equal(chartGeometry([bar(0, 10)], {}), null);
});

test("chartGeometry: stated levels extend the range so a far target still draws; absent levels draw nothing", () => {
  const bars = [bar(0, 36), bar(1, 37), bar(2, 37.9)];
  const g = chartGeometry(bars, { entry: 37.35, target: 41, stop: 35.6 }, 338, 160, 8)!;
  assert.ok(g.max >= 41 && g.min <= 35.6);
  assert.ok(g.ys.target! < g.ys.entry! && g.ys.entry! < g.ys.stop!); // higher price = smaller y
  assert.ok(g.ys.target! >= 8 && g.ys.stop! <= 152);
  assert.equal(g.points.split(" ").length, 3);
  assert.equal(g.first, bars[0]);
  assert.equal(g.last, bars[2]);
  const none = chartGeometry(bars, {})!;
  assert.deepEqual(none.ys, {});
  // a non-positive level is not a level
  assert.deepEqual(chartGeometry(bars, { stop: 0, target: -1 })!.ys, {});
});

// --- formatting + side + chunking --------------------------------------------

test("fmtLevel / fmtPct / numOf", () => {
  assert.equal(fmtLevel(37.35), "37.35");
  assert.equal(fmtLevel(5.7), "5.70");
  assert.equal(fmtLevel(21450), "21,450");
  assert.equal(fmtLevel(0.0842), "0.0842");
  assert.equal(fmtPct(0), "0.0%");
  assert.equal(fmtPct(-0.04), "0.0%");
  assert.equal(numOf("break of 600"), 600);
  assert.equal(numOf("$1,117.50"), 1117.5);
  assert.equal(numOf(""), null);
  assert.equal(numOf(undefined), null);
});

test("sideOf: stated wins solid; entry-vs-target derives, marked; nothing → null", () => {
  assert.deepEqual(sideOf({ side: "short", entry: "10", target: "20" }), { side: "SHORT", derived: false });
  assert.deepEqual(sideOf({ entry: "10", target: "20" }), { side: "LONG", derived: true });
  assert.equal(sideOf({ entry: "holds", target: "" }), null);
});

// --- review round: the real book's edges ---------------------------------------

test("numOf: unit-qualified and year-like numerals are not price levels (the pass's own guards)", () => {
  assert.equal(numOf("$100M revenue, then 42"), 42);
  assert.equal(numOf("30% pullback to 18.50"), 18.5);
  assert.equal(numOf("loses 2024 support at 97"), 97);
  assert.equal(numOf("50-day at 210"), 210);
  assert.equal(numOf("2024"), null);
  assert.equal(numOf("$37–$40 resistance zone"), 37);
  assert.equal(numOf("107.50 near-term resistance; 120 or higher"), 107.5);
});

test("entryLevelOf: the pass's parsed trigger wins over the entry text's first numeral", () => {
  const ev = armed().evaluation!;
  assert.equal(entryLevelOf({ entry: "confirmation candle above $150 tomorrow, stop 140", evaluation: { ...ev, level: 150, dir: "above" } }), 150);
  // feat/v4-1b-integrity — a stop clause's number is never drawn as the ENTRY
  assert.equal(entryLevelOf({ entry: "current levels; stop consideration under $34.80" }), null);
  assert.equal(entryLevelOf({ entry: "near $40; stop below 36.70" }), 40);
  // …and never derives a side as if it were the entry
  assert.equal(sideOf({ entry: "current levels; stop consideration under $34.80", target: "$37–$40 resistance zone" }), null);
  assert.deepEqual(sideOf({ entry: "near $40; stop below 36.70", target: "46" }), { side: "LONG", derived: true });
  assert.equal(entryLevelOf({ entry: "holds support", evaluation: { ...ev, level: null, dir: null, state: "NEEDS_LEVEL" } }), null);
});

test("fmtDay stamps in ET, the same calendar TRIGGERED TODAY counts in", () => {
  // 2025-09-16T02:12Z is still SEP 15 in New York
  const ms = Date.UTC(2025, 8, 16, 2, 12);
  assert.equal(fmtDay(ms), "SEP 15");
  assert.equal(etDateKey(ms), "2025-09-15");
});

test("questionOf: a stated side that contradicts the level ordering asks no odds question", () => {
  // a SHORT whose target sits above its stop is a conflicted row → no odds
  // question; with no parsed trigger it falls to the excerpt form
  const q2 = questionOf({ ...base, side: "short", target: "41", stop: "35.6" });
  assert.equal(q2.tier, "thesis");
  // …and with the pass's (agreeing) trigger, to the trigger question
  const ev = armed().evaluation!;
  const q = questionOf(armed({ side: "short", target: "41", stop: "35.6", evaluation: { ...ev, level: 30, dir: "below" } }));
  assert.equal(q.tier, "trigger");
  // agreement still asks the odds question
  assert.equal(questionOf({ ...base, side: "long", target: "41", stop: "35.6" }).tier, "levels");
});

test("questionOf: asks the pass's trigger — never after NEEDS LEVEL (AGI after v4-1b), never for QUOTE SUSPECT", () => {
  const ev = armed().evaluation!;
  // AGI once the pass reads its stop clause as a stop: no level on the record
  const agi = armed({
    instrument: "AGI",
    entry: "current levels; stop consideration under $34.80",
    target: "$37–$40 resistance zone",
    evaluation: { ...ev, state: "NEEDS_LEVEL", level: null, dir: null, reason: "no crossable entry trigger: below 34.8 is stop language, and a stop never arms an entry trigger" },
  });
  assert.equal(questionOf(agi).tier, "thesis");
  // the pass is the only parser: an ARMED / STALE record is asked as stored,
  // for any side (feat/v4-1b-integrity retires the terminal's own side guard —
  // the pass refuses a crossing against the stated side at the source)
  assert.equal(questionOf(armed({ side: "long" })).tier, "trigger");
  assert.equal(questionOf(armed({ side: "watch" })).tier, "trigger");
  assert.equal(questionOf(armed({ evaluation: { ...ev, state: "STALE" } })).text, "SEDG breaks above 37.35?");
  // the pass refused to grade the level: no headline question
  const lite = armed({ side: "short", evaluation: { ...ev, level: 8.4, dir: "below", state: "QUOTE_SUSPECT" } });
  assert.equal(questionOf(lite).tier, "thesis");
});

test("levelIsParsed: a bare number is stated as-is; a zone, ladder or condition is parsed", () => {
  assert.equal(levelIsParsed("37.35", 37.35), false);
  assert.equal(levelIsParsed("$1,117.50", 1117.5), false);
  assert.equal(levelIsParsed("$37–$40 resistance zone", 37), true);
  assert.equal(levelIsParsed("765, then 762, then 760", 765), true);
  assert.equal(levelIsParsed("", null), false);
});

test("thesisExcerpt: an abbreviation's period does not end the sentence", () => {
  assert.equal(thesisExcerpt("Rivian Inc. is breaking out above 14. Watch volume."), "Rivian Inc. is breaking out above 14.");
});

test("bookStats: a stated WATCH side is counted as watch, not as unsided", () => {
  const s = bookStats([armed({ side: "watch" }), armed({ entry: "holds" })], T0);
  assert.equal(s.watch, 1);
  assert.equal(s.unsided, 1);
});

test("chartGeometry: a level more than 3× off the month's scale is left off the chart, not flattening it", () => {
  const bars = [bar(0, 880), bar(1, 870), bar(2, 883)];
  // LITE: stated 8.40 against an ~880 tape (QUOTE SUSPECT)
  const g = chartGeometry(bars, { entry: 8.4 }, 338, 160, 8)!;
  assert.equal(g.ys.entry, undefined);
  assert.ok(g.min > 800);
  assert.equal(levelOnScale(8.4, [880, 870, 883]), false);
  assert.equal(levelOnScale(900, [880, 870, 883]), true);
});

// --- fix round: triggered rows, side-aware tint, one quote policy -----------

test("questionOf: a TRIGGERED row never asks its trigger question", () => {
  const ev = armed().evaluation!;
  const fired = { ...ev, state: "TRIGGERED" as const, level: 106.1, dir: "above" as const, price: 106.24 };
  // no target + stop pair → the plain ticker + excerpt (INTC today)
  const intc = armed({ instrument: "INTC", side: "long", target: "107.50 near-term resistance; 120 or higher", evaluation: fired });
  const q = questionOf(intc);
  assert.equal(q.tier, "thesis");
  assert.equal(q.text, "INTC");
  assert.ok(q.excerpt && q.excerpt.length > 0);
  // both target and stop → the target/stop question still reads the state
  const both = questionOf(armed({ instrument: "INTC", side: "long", target: "120", stop: "100", evaluation: fired }));
  assert.equal(both.tier, "levels");
  assert.equal(both.text, "INTC reaches 120.00 before 100.00?");
  // a row that has NOT triggered keeps the trigger question (STALE / ARMED)
  assert.equal(questionOf(armed({ side: "long", evaluation: { ...ev, state: "STALE" } })).tier, "trigger");
  assert.equal(questionOf(armed({ side: "long" })).tier, "trigger");
});

test("statusOf: TRIGGERED tint follows the STATED side, with the crossing in words", () => {
  const ev = armed().evaluation!;
  const trig = (dir: "above" | "below", level: number) => ({ ...ev, state: "TRIGGERED" as const, dir, level });
  // SPY / NOW / UBER: shorts that crossed below — the move favored the side
  const spy = statusOf({ side: "short", evaluation: trig("below", 768) });
  assert.equal(spy.tone, "fav");
  assert.equal(spy.move, "below 768.00");
  assert.equal(spy.against, null);
  assert.equal(statusText(spy), "Triggered below 768.00");
  // a long that crossed above: favored
  assert.equal(statusOf({ side: "long", evaluation: trig("above", 106.1) }).tone, "fav");
  // against the side: red, and the words say so
  const longDown = statusOf({ side: "long", evaluation: trig("below", 34.8) });
  assert.equal(longDown.tone, "against");
  assert.equal(statusText(longDown), "Triggered below 34.80 · against the long");
  assert.equal(statusOf({ side: "short", evaluation: trig("above", 50) }).tone, "against");
  // no stated side (a derived one does not count), or watch: neutral tint, words kept
  const unsided = statusOf({ evaluation: trig("below", 34.8) });
  assert.equal(unsided.tone, "trig");
  assert.equal(statusText(unsided), "Triggered below 34.80");
  assert.equal(statusOf({ side: "watch", evaluation: trig("above", 5) }).tone, "trig");
  // non-triggered states carry no move
  const stale = statusOf({ side: "long", evaluation: { ...ev, state: "STALE" } });
  assert.equal(stale.move, null);
  assert.equal(statusText(stale), "Stale");
});

test("bookStats: derived sides are counted inside long/short and flagged", () => {
  const s = bookStats([armed({ side: "long" }), armed({ entry: "34.80", target: "37" }), armed({ entry: "holds" })], T0);
  assert.equal(s.long, 2);
  assert.equal(s.derived, 1);
  assert.equal(s.unsided, 1);
});

// --- feat/v4-1b-integrity · THE HEADLINE METRIC -------------------------------

const ev0 = armed().evaluation!;
const withEv = (over: Partial<NonNullable<PublicIdea["evaluation"]>>, idea: Partial<PublicIdea> = {}): PublicIdea =>
  armed({ ...idea, evaluation: { ...ev0, ...over } });

test("headline: before the pass fires — distance to the parsed trigger, either direction, one decimal, CALCULATED", () => {
  // SEDG: long, break above 37.35, last 34.68 → 7.7% of price to travel up
  const sedg = headlineOf(withEv({ state: "STALE", level: 37.35, dir: "above" }, { side: "long" }), 34.68);
  assert.equal(sedg.kind, "distance");
  assert.equal(sedg.pct, 7.7); // (37.35 − 34.68) / 34.68 = 7.699…
  assert.equal(sedg.big, "7.7%");
  // the same kind of figure as "to target" — a share of price to travel; the
  // direction lives beside it (the question, the idea page's trigger line)
  assert.equal(sedg.label, "to trigger");
  assert.equal(sedg.calc, DISTANCE_FORMULA);
  assert.deepEqual(sedg.trigger, { dir: "above", level: 37.35 });
  assert.equal(sedg.last, 34.68);
  assert.equal(headlineTone(sedg), "ink");
  // CRWD: short, drop under 197.25, last 241.36 → 18.3% of price to travel down
  const crwd = headlineOf(withEv({ level: 197.25, dir: "below" }, { instrument: "CRWD", side: "short" }), 241.36);
  assert.equal(crwd.pct, 18.3); // (241.36 − 197.25) / 241.36 = 18.27…
  assert.equal(crwd.big, "18.3%");
  assert.equal(crwd.label, "to trigger");
  assert.deepEqual(crwd.trigger, { dir: "below", level: 197.25 });
  // ARMED measures exactly like STALE
  assert.equal(headlineOf(withEv({ state: "ARMED", level: 37.35, dir: "above" }), 34.68).big, "7.7%");
  // a hair away is still a distance, printed at one decimal — never "beyond"
  const hair = headlineOf(withEv({ level: 100, dir: "above" }), 99.99);
  assert.equal(hair.kind, "distance");
  assert.equal(hair.big, "0.0%");
  assert.equal(hair.label, "to trigger");
  // a target + stop pair does NOT turn an untriggered row into % of the way
  const paired = headlineOf(withEv({ level: 37.35, dir: "above" }, { target: "41", stop: "35.6" }), 36);
  assert.equal(paired.kind, "distance");
  assert.equal(paired.progress, null);
});

test("headline: last already past the trigger while not TRIGGERED → beyond trigger · awaiting pass, no percent", () => {
  const cases: Array<["above" | "below", number, number]> = [
    ["above", 37.35, 38.1],
    ["above", 37.35, 37.35], // the pass's own test: ≥ is crossed
    ["below", 197.25, 190],
    ["below", 197.25, 197.25], // ≤ is crossed
  ];
  for (const [dir, level, last] of cases) {
    for (const state of ["ARMED", "STALE"] as const) {
      const h = headlineOf(withEv({ state, level, dir }), last);
      assert.equal(h.kind, "beyond", `${state} ${dir} ${level} last ${last}`);
      assert.equal(h.label, "beyond trigger · awaiting pass");
      assert.equal(h.pct, null);
      assert.equal(h.big, "—");
      assert.equal(h.calc, null); // no number, no CALCULATED chip
      assert.deepEqual(h.trigger, { dir, level });
      assert.equal(headlineTone(h), "mute");
    }
  }
});

test("headline: TRIGGERED with a stated target and stop → % of the way, as built", () => {
  const fired = (last: number) => headlineOf(withEv({ state: "TRIGGERED", level: 37.35, dir: "above" }, { side: "long", target: "41", stop: "35.6" }), last);
  const h = fired(37.92);
  assert.equal(h.kind, "progress");
  assert.equal(h.pct, 43); // (37.92 − 35.6) / (41 − 35.6) = 42.96
  assert.equal(h.big, "43%");
  assert.equal(h.label, "to target");
  assert.equal(h.calc, PROGRESS_FORMULA);
  assert.equal(h.trigger, null); // a fired trigger is never measured to
  assert.equal(h.progress?.pct, 43);
  assert.equal(headlineTone(h), "down");
  assert.equal(headlineTone(fired(39)), "up");
  // a short's range reads the same formula
  const short = headlineOf(withEv({ state: "TRIGGERED", level: 197.25, dir: "below" }, { side: "short", target: "185", stop: "205" }), 201.4);
  assert.equal(short.pct, 18);
});

test("headline: everything else is — with the reason named", () => {
  const trig = { state: "TRIGGERED" as const, level: 37.35, dir: "above" as const };
  const cases: Array<[string, PublicIdea, number | null, HeadlineWhy, string]> = [
    ["triggered, no target or stop", withEv(trig), 38, "no_levels", "no target or stop"],
    ["triggered, no stop", withEv(trig, { target: "41" }), 38, "no_stop", "no stop"],
    ["triggered, no target", withEv(trig, { stop: "35" }), 38, "no_target", "no target"],
    ["triggered, target = stop", withEv(trig, { target: "41", stop: "41" }), 38, "degenerate", "target = stop"],
    ["triggered, no fresh last", withEv(trig, { target: "41", stop: "35.6" }), null, "no_last", "no last price"],
    ["pre-trigger, no fresh last", withEv({ level: 37.35, dir: "above" }), null, "no_last", "no last price"],
    ["needs level", withEv({ state: "NEEDS_LEVEL", level: null, dir: null }), 36, "no_trigger", "no trigger"],
    // a stated target + stop never computes before the pass fires
    ["needs level with target + stop", withEv({ state: "NEEDS_LEVEL", level: null, dir: null }, { target: "41", stop: "35.6" }), 36, "no_trigger", "no trigger"],
    ["quote suspect", withEv({ state: "QUOTE_SUSPECT", level: 8.4, dir: "below" }), 919.4, "quote_suspect", "level not graded"],
    ["not yet evaluated", base, 36, "unevaluated", "not yet evaluated"],
    ["armed with no usable level", withEv({ state: "ARMED", level: null, dir: null }), 36, "no_trigger", "no trigger"],
  ];
  for (const [name, idea, last, why, label] of cases) {
    const h = headlineOf(idea, last);
    assert.equal(h.kind, "absent", name);
    assert.equal(h.why, why, name);
    assert.equal(h.label, label, name);
    assert.equal(h.big, "—", name);
    assert.equal(h.pct, null, name);
    assert.equal(h.calc, null, name);
    assert.equal(headlineTone(h), "mute", name);
    if (why !== "ok" && why !== "beyond_trigger") assert.equal(headlineReason(why), label, name);
  }
  // a non-positive or non-finite last is no last
  assert.equal(headlineOf(withEv({ level: 37.35, dir: "above" }), 0).why, "no_last");
  assert.equal(headlineOf(withEv({ level: 37.35, dir: "above" }), Number.NaN).why, "no_last");
});

test("headline, question, filters and tiles read ONE record — beyond never counts as Triggered", () => {
  const today = T0 - 60_000;
  const rows: Array<[string, PublicIdea, number | null, HeadlineKind, "triggered" | "live" | "needs_level" | "stale"]> = [
    ["pre-trigger", withEv({ state: "ARMED", level: 37.35, dir: "above", at: today }), 36, "distance", "live"],
    ["beyond, awaiting pass", withEv({ state: "ARMED", level: 37.35, dir: "above", at: today }), 38, "beyond", "live"],
    ["stale pre-trigger", withEv({ state: "STALE", level: 37.35, dir: "above", at: today }), 36, "distance", "stale"],
    ["stale beyond", withEv({ state: "STALE", level: 37.35, dir: "above", at: today }), 38, "beyond", "stale"],
    ["triggered today", withEv({ state: "TRIGGERED", level: 37.35, dir: "above", at: today }, { target: "41", stop: "35.6" }), 38, "progress", "triggered"],
    ["refused trigger (AGI)", withEv({ state: "NEEDS_LEVEL", level: null, dir: null, at: today }), 35, "absent", "needs_level"],
    ["quote suspect", withEv({ state: "QUOTE_SUSPECT", level: 8.4, dir: "below", at: today }), 919, "absent", "needs_level"],
    ["unevaluated", base, 36, "absent", "live"],
  ];
  for (const [name, idea, last, kind, bucket] of rows) {
    const h = headlineOf(idea, last);
    assert.equal(h.kind, kind, name);
    assert.equal(bucketOf(idea), bucket, name);
    // the question asks exactly the trigger the headline measures
    const q = questionOf(idea);
    if (h.trigger) assert.equal(q.tier, "trigger", name);
    if (q.tier === "trigger") assert.deepEqual(triggerOf(idea), h.trigger, name);
    // a percent exists exactly when a CALCULATED formula is named
    assert.equal(h.pct != null, h.calc != null, name);
  }
  const ideas = rows.map((r) => r[1]);
  // only the pass's TRIGGERED counts — the two "beyond" rows are not triggered today
  assert.equal(bookStats(ideas, T0).triggeredToday, 1);
  assert.deepEqual(filterCounts(ideas), { all: 8, triggered: 1, live: 3, needs_level: 2 });
  assert.deepEqual(
    filterIdeas(ideas, "needs_level").map((i) => headlineOf(i, 36).why),
    ["no_trigger", "quote_suspect"],
  );
});

