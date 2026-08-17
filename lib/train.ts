// TRAIN-1 — THE TRAINING FLOOR. The lesson engine: build once, lessons are
// content. A lesson is a DATA OBJECT — prose sections, a SCRIPTED TAPE
// (deterministic seed + a pinned RoundDef on the existing tape engine v2),
// a DO-TASK with auto-validation, unlock rules, a completion badge. No React,
// no network — the surface draws, this file decides. SIMULATED ONLY;
// education, not investment advice.

import type { RoundDef, TradeMark } from "./pit-engine";

// ── lesson shape ─────────────────────────────────────────────────────────────

export type LessonId = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8";

/** Coach voice — floor commentary beats keyed to tape seconds. Dry desk-speak,
 *  never chipper-tutorial. */
export type CoachBeat = { atSec: number; text: string };

/** Per-lesson control locks (Topstep-style progressive unlocks). A locked
 *  control renders as L6 furniture: the real button, padlocked, one line. */
export type LessonControls = {
  trade: boolean;   // LONG (and CLOSE)
  short: boolean;   // SHORT
  sizing: boolean;  // fractional orders
};

export type LessonDef = {
  id: LessonId;
  n: number;
  title: string;
  topic: string;      // index chip
  minutes: string;    // honest estimate, e.g. "~3 MIN"
  /** true = playable now; false = slotted for the next round (honest lock) */
  built: boolean;
  prose: string[];
  seed: number;
  day: RoundDef;
  controls: LessonControls;
  /** L3 — training-only ghost stop/target markers */
  ghostPlan?: boolean;
  beats: CoachBeat[];
  task: string;
  /** one line of what was learned — the completion panel's summary (P4) */
  learned?: string;
  /** which button the lesson newly unlocks — the padlock moment's caption */
  unlocks?: string;
  /** optional media slot — reserved, always null in v1 (no videos) */
  media: null;
};

// ── task validation (pure — the suite plays these) ──────────────────────────

/** L1 — a tapped tick counts as the day's high/low when its price sits within
 *  `frac` of the day's range from the true extreme. */
export function nearExtreme(
  prices: number[],
  tick: number,
  which: "hi" | "lo",
  frac = 0.12,
): boolean {
  if (!prices.length || tick < 0 || tick >= prices.length) return false;
  const hi = Math.max(...prices);
  const lo = Math.min(...prices);
  const range = hi - lo;
  if (range <= 0) return false;
  const p = prices[tick];
  return which === "hi" ? hi - p <= range * frac : p - lo <= range * frac;
}

/** L2 — one deliberate profitable close, either direction. */
export function profitableClose(log: TradeMark[]): boolean {
  return log.some((m) => m.kind === "close" && (m.gain ?? 0) > 0);
}

export type TradePlan = { entry: number; stop: number; target: number };

/** L3 — the 2:1 rule: reward distance ≥ min × risk distance, stop on the
 *  losing side, target on the paying side. Direction-agnostic. */
export function planRatioOk(plan: TradePlan, min = 2): boolean {
  const risk = Math.abs(plan.entry - plan.stop);
  const reward = Math.abs(plan.target - plan.entry);
  if (risk <= 0 || reward <= 0) return false;
  const longSide = plan.target > plan.entry;
  if (longSide && plan.stop >= plan.entry) return false;
  if (!longSide && plan.stop <= plan.entry) return false;
  return reward >= risk * min;
}

/** L3 — a close executed AT the plan: exit price within `tol` of the planned
 *  distance from either the target or the stop. The plan obeyed, either side. */
export function exitAtPlan(plan: TradePlan, log: TradeMark[], tol = 0.35): boolean {
  const risk = Math.abs(plan.entry - plan.stop);
  const reward = Math.abs(plan.target - plan.entry);
  return log.some((m) => {
    if (m.kind !== "close") return false;
    const nearTarget = Math.abs(m.price - plan.target) <= reward * tol;
    const nearStop = Math.abs(m.price - plan.stop) <= risk * tol;
    return nearTarget || nearStop;
  });
}

/** Unlock chain: L1 is open; each lesson needs the one before it. */
export function lessonUnlocked(n: number, done: string[]): boolean {
  return n <= 1 || done.includes(`L${n - 1}`);
}

/** All eight = TRAINED. */
export function trainedBadge(done: string[]): boolean {
  for (let n = 1; n <= 8; n++) if (!done.includes(`L${n}`)) return false;
  return true;
}

// ── curriculum v1 ────────────────────────────────────────────────────────────
// Scripted tapes ride the engine untouched: pinned RoundDef + fixed seed =
// the same day for every student, forever. Sim universe only (trainCalm /
// trainTrend / trainChop) — real tickers never appear in lesson tapes.

const baseDay = {
  opps: 0,
  spyNet: [0.2, 0.8] as [number, number],
};

export const LESSONS: LessonDef[] = [
  {
    id: "L1", n: 1, title: "READING THE TAPE", topic: "TAPE", minutes: "~3 MIN", built: true,
    prose: [
      "Price is a queue of trades. Green print — someone paid up. Red print — someone hit the bid. That's all a chart is: the argument, drawn.",
      "Today you don't trade. You watch one full session and learn what an impulse looks like, what a retrace looks like, and where the day's edges were.",
    ],
    seed: 7121,
    day: {
      n: 1, name: "READING THE TAPE", missionKey: "beat",
      weather: "TRAINING TAPE — calm drift, one stock, nothing to do but see.",
      bias: "BULLISH", secs: 60, tps: 6, stocks: 1, cats: ["trainCalm"], shorts: false, positions: 1,
      news: 0, ...baseDay, vol: 0.0028, netMin: -1.5, netMax: 3, minDD: 2, minRally: 2,
    },
    controls: { trade: false, short: false, sizing: false },
    beats: [
      { atSec: 3, text: "watch the prints. green when the buyer paid up, red when the seller hit out." },
      { atSec: 10, text: "that early flush — sellers overreaching. mark where it stopped." },
      { atSec: 26, text: "the recovery leg. higher lows — buyers back in the room." },
      { atSec: 44, text: "we do nothing today. watching IS the job — most hours, the desk just sits." },
      { atSec: 55, text: "bell soon. after it rings you show me the day's high and its low." },
    ],
    task: "AFTER THE BELL — tap the day's HIGH, then its LOW, on the tape.",
    learned: "you can read a session now — impulse, retrace, and where the edges were.",
    media: null,
  },
  {
    id: "L2", n: 2, title: "LONG & SHORT", topic: "ORDERS", minutes: "~4 MIN", built: true,
    prose: [
      "Two buttons, two beliefs. LONG pays when price rises. SHORT pays when it falls. Neither is braver than the other — the tape doesn't know which side you're on.",
      "One stock, a gentle trend, fixed size. Your task is one clean round trip: in, out, green. Direction is your call.",
    ],
    seed: 7132,
    day: {
      n: 1, name: "LONG & SHORT", missionKey: "beat",
      weather: "TRAINING TAPE — a workable trend with pauses. Both directions legal.",
      bias: "MIXED", secs: 75, tps: 6, stocks: 1, cats: ["trainTrend"], shorts: true, positions: 1,
      news: 0, ...baseDay, vol: 0.0032, netMin: -2.5, netMax: 4, minDD: 2.5, minRally: 3,
    },
    controls: { trade: true, short: true, sizing: false },
    unlocks: "ORDERS UNLOCKED — LONG · SHORT · CLOSE",
    beats: [
      { atSec: 3, text: "the padlocks are off. LONG profits up, SHORT profits down. CLOSE books it." },
      { atSec: 12, text: "don't buy the vertical bar. wait for the pause after it." },
      { atSec: 34, text: "in a trade? decide your exit before the tape decides it for you." },
      { atSec: 58, text: "book one winner, either direction. that's the whole task." },
    ],
    task: "Close ONE profitable trade — long or short.",
    learned: "you put on risk and took it off green. that's the whole loop.",
    media: null,
  },
  {
    id: "L3", n: 3, title: "STOPS & TARGETS", topic: "RISK", minutes: "~4 MIN", built: true,
    prose: [
      "Before the entry, two prices. The STOP is where you're wrong — under the last swing, not under your feelings. The TARGET is where you're paid.",
      "The 2:1 rule: the target sits at least twice the stop's distance from entry. Half your trades can lose and the book still grows. That arithmetic is the whole edge.",
      "Today the floor draws your plan on the tape — training wheels, training only. Plan it, enter it, exit AT the plan. Either side. Obeyed beats abandoned.",
    ],
    seed: 7133,
    day: {
      n: 1, name: "STOPS & TARGETS", missionKey: "beat",
      weather: "TRAINING TAPE — impulses and honest retraces. A planner's tape.",
      bias: "MIXED", secs: 80, tps: 6, stocks: 1, cats: ["trainTrend"], shorts: true, positions: 1,
      news: 0, ...baseDay, vol: 0.0038, netMin: -3, netMax: 4.5, minDD: 3.5, minRally: 3.5,
    },
    controls: { trade: true, short: true, sizing: false },
    ghostPlan: true,
    beats: [
      { atSec: 3, text: "two prices before the entry: where you're wrong, where you're paid." },
      { atSec: 12, text: "stop under the last swing. target at twice the distance. that's 2:1." },
      { atSec: 36, text: "plan set? then the only job left is obeying it." },
      { atSec: 62, text: "exit at the plan — target or stop, either one is a win of discipline." },
    ],
    task: "Set a 2:1 plan (stop + target), take the trade, exit AT the plan.",
    learned: "you let the plan exit the trade. that's the skill most never learn.",
    media: null,
  },
  // ── T3 content — slotted, honest locks until the next round ────────────────
  {
    id: "L4", n: 4, title: "POSITION SIZING", topic: "RISK", minutes: "~4 MIN", built: false,
    prose: [], seed: 7104,
    day: {
      n: 4, name: "POSITION SIZING", missionKey: "survivor",
      weather: "TRAINING TAPE — a drawdown day. Size is the survival tool.",
      bias: "BEARISH", secs: 70, tps: 7, stocks: 2, cats: ["trainTrend", "trainChop"], shorts: true, positions: 1,
      news: 0, ...baseDay, vol: 0.006, netMin: -14, netMax: -6, minDD: 16, minRally: 10, spyNet: [-6, -3],
    },
    controls: { trade: true, short: true, sizing: true },
    beats: [], task: "Survive the day at ≤50% size — no margin call.", media: null,
  },
  {
    id: "L5", n: 5, title: "STRUCTURE & LEVELS", topic: "LEVELS", minutes: "~4 MIN", built: false,
    prose: [], seed: 7105,
    day: {
      n: 1, name: "STRUCTURE & LEVELS", missionKey: "beat",
      weather: "TRAINING TAPE — the tape respects its own history. Mark it.",
      bias: "MIXED", secs: 80, tps: 6, stocks: 1, cats: ["trainTrend"], shorts: true, positions: 1,
      news: 0, ...baseDay, vol: 0.0045, netMin: -4, netMax: 5, minDD: 5, minRally: 5,
    },
    controls: { trade: true, short: true, sizing: true },
    beats: [], task: "Mark two levels; trade one bounce off a marked level.", media: null,
  },
  {
    id: "L6", n: 6, title: "HEADLINES LIE SOMETIMES", topic: "EVENTS", minutes: "~4 MIN", built: false,
    prose: [], seed: 7106,
    day: {
      n: 3, name: "HEADLINES LIE SOMETIMES", missionKey: "beat",
      weather: "TRAINING TAPE — one headline mid-session. It isn't honest.",
      bias: "MIXED", secs: 75, tps: 7, stocks: 1, cats: ["trainTrend"], shorts: true, positions: 1,
      news: 1, ...baseDay, vol: 0.005, netMin: -4, netMax: 5, minDD: 5, minRally: 5,
    },
    controls: { trade: true, short: true, sizing: true },
    beats: [], task: "Hold through the fake-out headline to a profitable exit.", media: null,
  },
  {
    id: "L7", n: 7, title: "WHEN NOT TO TRADE", topic: "DISCIPLINE", minutes: "~3 MIN", built: false,
    prose: [], seed: 7107,
    day: {
      n: 1, name: "WHEN NOT TO TRADE", missionKey: "lowrisk",
      weather: "TRAINING TAPE — chop. The tape pays nobody today.",
      bias: "MIXED", secs: 60, tps: 7, stocks: 1, cats: ["trainChop"], shorts: true, positions: 1,
      news: 0, ...baseDay, vol: 0.0065, netMin: -1.5, netMax: 1.5, minDD: 4, minRally: 4,
    },
    controls: { trade: true, short: true, sizing: true },
    beats: [], task: "Finish the day with ≤1 trade taken. Restraint scores.", media: null,
  },
  {
    id: "L8", n: 8, title: "RISK FIRST — GRADUATION", topic: "COMBINE", minutes: "~5 MIN", built: false,
    prose: [], seed: 7108,
    day: {
      n: 5, name: "GRADUATION", missionKey: "volatility",
      weather: "TRAINING TAPE — the mini-combine. Modest target, hard floor.",
      bias: "MIXED", secs: 90, tps: 7, stocks: 2, cats: ["trainTrend", "trainCalm"], shorts: true, positions: 2,
      news: 0, ...baseDay, vol: 0.005, netMin: -5, netMax: 6, minDD: 6, minRally: 6,
    },
    controls: { trade: true, short: true, sizing: true },
    beats: [], task: "Hit +3% without equity ever touching −5%.", media: null,
  },
];

export function lessonById(id: string): LessonDef | null {
  return LESSONS.find((l) => l.id === id) ?? null;
}
