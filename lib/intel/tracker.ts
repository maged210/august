// AUGUST Market Intel — Idea Tracker ENGINE. Pure domain logic: no I/O, no Redis,
// no fetch. Everything here is deterministic and unit-testable with simulated
// price sequences (see tests/tracker.test.ts). Persistence lives in trackerStore.ts.
//
// ANTI-HALLUCINATION LAW (the whole design bends around this):
// - Lifecycle states are computable ONLY from levels the source actually stated
//   plus recorded price observations. No stated trigger → the idea stays ACTIVE
//   (thesis-only) forever; it never fakes ARMED/TRIGGERED.
// - P&L is computed ONLY from a stated level (the trigger the creator called).
//   Thesis-only ideas get "price since first mention" — a different basis,
//   carried explicitly in `basis`, and the UI must label it exactly that.
// - We record what we OBSERVED, not what happened between observations. A gap
//   through a trigger is recorded as such in the transition reason — we never
//   claim "triggered at $X" when we only saw the price already beyond it.
// - Conflicting statements from the same source (two triggers for one ticker,
//   e.g. FCEL $30.80 vs $38.00) are BOTH kept as linked variants with a visible
//   conflict marker. Never silently merged, never discarded.

import type { BriefIdea, Direction, Explicitness, TimeHorizon } from "./types";

// ── tunables (documented caps — bounded memory is a hard requirement) ────────

/** Max snapshots kept per idea (ring buffer). At the ~15-min cron cadence during
 * regular hours (~26 snaps/day) this is ~5 trading days of shape. Extremes
 * (MFE/MAE) are tracked in dedicated fields, so trimming the ring NEVER loses
 * excursion truth — only old sparkline detail. */
export const PRICE_HISTORY_CAP = 128;

/** Max tracked ideas kept. Eviction order: oldest CLOSED → oldest terminal
 * (TARGET_HIT/INVALIDATED) → oldest stale ACTIVE. Live ARMED/TRIGGERED ideas
 * are never silently evicted. */
export const TRACKED_CAP = 300;

/** Days without a re-mention before an idea is marked stale (visibly marked,
 * never deleted). Override with env TRACKER_STALE_DAYS in trackerStore. */
export const DEFAULT_STALE_DAYS = 5;

/** Days a terminal idea (TARGET_HIT/INVALIDATED) lingers before auto-CLOSED. */
export const AUTO_CLOSE_TERMINAL_DAYS = 7;

/** Two stated triggers within this relative tolerance are "the same level"
 * (creator said 30.80 one day and 30.85 the next). Beyond it → conflict. */
export const TRIGGER_COMPAT_TOLERANCE = 0.005;

/** Min gap between snapshots for one idea; overlapping pinger runs are no-ops. */
export const SNAPSHOT_MIN_GAP_MS = 4 * 60_000;

const DAY_MS = 86_400_000;

// ── types ─────────────────────────────────────────────────────────────────────

export type TrackedStatus =
  | "ACTIVE"      // thesis-only (no stated numeric trigger, or no clear direction) — never transitions
  | "ARMED"       // stated trigger, not yet crossed
  | "TRIGGERED"   // stated trigger crossed (crossing snapshot recorded)
  | "TARGET_HIT"  // stated target crossed after trigger
  | "INVALIDATED" // stated invalidation crossed
  | "CLOSED";     // user action or staleness — terminal

/** A stated level. `value` may be null (creator spoke a condition, not a number);
 * null-valued levels are preserved for display but are NEVER actionable. */
export type TrackedLevel = { value: number | null; text: string };

export type StatusEntry = {
  state: TrackedStatus;
  at: number;
  /** price at the observation that caused the transition (null for non-price
   * transitions such as CLOSED-by-staleness) */
  price: number | null;
  /** honest, human-readable cause — including gap/first-observation caveats.
   * This history is the future notification hook; keep entries clean. */
  reason: string;
};

export type PriceSnap = { at: number; price: number };

export type SourceRef = {
  videoId: string;
  channelTitle: string;
  segmentIds: string[];
  startSeconds: number;
  /** when this mention was ingested (ms epoch) */
  mentionedAt: number;
  /** the brief/analysis idea id this mention came from */
  ideaId: string;
};

export type PnlBasis = "stated_trigger" | "first_snapshot";

export type TrackedIdea = {
  /** tracker id — the id of the first contributing idea */
  id: string;
  /** every merged contributing idea id (UI joins blotter rows through this) */
  ideaIds: string[];
  ticker: string;
  direction: Direction;
  timeframe: TimeHorizon;
  /** latest explicit statement wins; prior statements remain reachable via sourceRefs */
  thesis: string;
  statedLevels: {
    /** the actionable "call" level — mapped from the idea's stated entry */
    trigger: TrackedLevel | null;
    invalidation: TrackedLevel | null;
    targets: TrackedLevel[];
  };
  sourceRefs: SourceRef[];
  explicitness: Explicitness;
  /** first mention (tracking start) */
  createdAt: number;
  status: TrackedStatus;
  statusHistory: StatusEntry[];
  /** bounded ring buffer (PRICE_HISTORY_CAP) */
  priceHistory: PriceSnap[];
  /** raw extreme PRICES observed since `extremesBasis` was set — favorable/adverse
   * are direction-relative. UI derives MFE/MAE % against the basis level. */
  extremes: { maxFavorable: number | null; maxAdverse: number | null };
  /** what the extremes + P&L are measured from:
   *  - "stated_trigger": the creator's stated trigger level (real P&L-since-called)
   *  - "first_snapshot": first observed price (thesis-only — "price since first mention")
   *  null until the first qualifying observation. */
  basis: PnlBasis | null;
  basisPrice: number | null;
  lastQuote: { price: number; at: number } | null;
  /** set on every variant that shares ticker+direction+source with an
   * incompatible trigger — the visible CONFLICT marker */
  conflictKey: string | null;
  /** newest mention timestamp — staleness derives from this */
  lastMentionAt: number;
  stale: boolean;
  closedAt: number | null;
  closedReason: string | null;
};

// ── construction / identity / dedupe ─────────────────────────────────────────

const dirSign = (d: Direction): 1 | -1 | 0 => (d === "bullish" ? 1 : d === "bearish" ? -1 : 0);

/** Only bullish/bearish ideas with a stated NUMERIC trigger get the armed
 * lifecycle; anything else is honest thesis-only ACTIVE. */
function initialStatus(direction: Direction, trigger: TrackedLevel | null): TrackedStatus {
  return dirSign(direction) !== 0 && trigger?.value != null ? "ARMED" : "ACTIVE";
}

function toLevel(v: { value: number | null; text: string } | undefined | null): TrackedLevel | null {
  if (!v) return null;
  if (v.value == null && (!v.text || /not specified/i.test(v.text))) return null;
  return { value: v.value, text: v.text };
}

export function triggersCompatible(a: TrackedLevel | null, b: TrackedLevel | null): boolean {
  const av = a?.value ?? null;
  const bv = b?.value ?? null;
  if (av == null || bv == null) return true; // one (or both) unstated — refinement, not conflict
  return Math.abs(av - bv) / Math.max(Math.abs(av), Math.abs(bv)) <= TRIGGER_COMPAT_TOLERANCE;
}

function identityMatches(t: TrackedIdea, channel: string, ticker: string, direction: Direction): boolean {
  return (
    t.status !== "CLOSED" &&
    t.ticker === ticker &&
    t.direction === direction &&
    t.sourceRefs.some((r) => r.channelTitle === channel)
  );
}

export function newTrackedIdea(idea: BriefIdea, now: number): TrackedIdea {
  const trigger = toLevel(idea.entry);
  return {
    id: idea.id,
    ideaIds: [idea.id],
    ticker: idea.ticker.toUpperCase(),
    direction: idea.direction,
    timeframe: idea.timeHorizon,
    thesis: idea.thesis,
    statedLevels: {
      trigger,
      invalidation: toLevel(idea.invalidation),
      targets: (idea.targets ?? []).map(toLevel).filter((t): t is TrackedLevel => t !== null),
    },
    sourceRefs: [
      {
        videoId: idea.videoId,
        channelTitle: idea.channelTitle,
        segmentIds: idea.sourceSegmentIds ?? [],
        startSeconds: idea.sourceStartSeconds,
        mentionedAt: now,
        ideaId: idea.id,
      },
    ],
    explicitness: idea.explicitness,
    createdAt: now,
    status: initialStatus(idea.direction, trigger),
    statusHistory: [
      {
        state: initialStatus(idea.direction, trigger),
        at: now,
        price: null,
        reason:
          initialStatus(idea.direction, trigger) === "ARMED"
            ? `tracking started — stated trigger ${trigger!.text || trigger!.value}`
            : "tracking started — thesis-only (no actionable stated trigger)",
      },
    ],
    priceHistory: [],
    extremes: { maxFavorable: null, maxAdverse: null },
    basis: null,
    basisPrice: null,
    lastQuote: null,
    conflictKey: null,
    lastMentionAt: now,
    stale: false,
    closedAt: null,
    closedReason: null,
  };
}

export type UpsertResult = {
  tracked: TrackedIdea[];
  added: number;
  merged: number;
  conflicts: number;
};

/** Fold a batch of brief ideas into the tracked set.
 *  - same source + ticker + direction + compatible trigger → SAME idea:
 *    append the sourceRef; the latest EXPLICIT statement wins the summary
 *    (thesis + refreshed invalidation/targets); prior statements stay
 *    reachable through sourceRefs (each keeps its contributing ideaId).
 *  - incompatible triggers → linked variants, all marked with conflictKey.
 *  - mentions arriving for a CLOSED idea start a NEW lifecycle (a re-call
 *    after closure is a new call; the closed record remains as history). */
export function upsertIdeas(tracked: TrackedIdea[], incoming: BriefIdea[], now: number): UpsertResult {
  const out = [...tracked];
  let added = 0;
  let merged = 0;
  let conflicts = 0;

  for (const idea of incoming) {
    const ticker = idea.ticker.toUpperCase();
    const channel = idea.channelTitle;
    // already ingested (briefs regenerate — same idea ids reappear)
    if (out.some((t) => t.ideaIds.includes(idea.id))) continue;

    const candidates = out.filter((t) => identityMatches(t, channel, ticker, idea.direction));
    const trig = toLevel(idea.entry);
    const compatible = candidates.find((t) => triggersCompatible(t.statedLevels.trigger, trig));

    if (compatible) {
      compatible.ideaIds.push(idea.id);
      compatible.sourceRefs.push({
        videoId: idea.videoId,
        channelTitle: channel,
        segmentIds: idea.sourceSegmentIds ?? [],
        startSeconds: idea.sourceStartSeconds,
        mentionedAt: now,
        ideaId: idea.id,
      });
      compatible.lastMentionAt = now;
      compatible.stale = false;
      // latest explicit statement wins the summary
      if (idea.explicitness === "explicit") {
        compatible.thesis = idea.thesis;
        const inv = toLevel(idea.invalidation);
        if (inv) compatible.statedLevels.invalidation = inv;
        const tgts = (idea.targets ?? []).map(toLevel).filter((t): t is TrackedLevel => t !== null);
        if (tgts.length) compatible.statedLevels.targets = tgts;
        // a numeric restatement of the (compatible) trigger refreshes its text/value
        if (trig?.value != null) compatible.statedLevels.trigger = trig;
        compatible.explicitness = "explicit";
      }
      merged++;
      continue;
    }

    const fresh = newTrackedIdea(idea, now);
    if (candidates.length > 0) {
      // same source, same ticker+direction, INCOMPATIBLE trigger → conflict variants
      const key = `${channel}|${ticker}|${idea.direction}`;
      fresh.conflictKey = key;
      for (const c of candidates) c.conflictKey = key;
      conflicts++;
    }
    out.push(fresh);
    added++;
  }

  return { tracked: out, added, merged, conflicts };
}

// ── lifecycle evaluation ──────────────────────────────────────────────────────

const crossedUp = (price: number, level: number) => price >= level;
const crossedDown = (price: number, level: number) => price <= level;

/** direction-aware: has `price` crossed `level` in the direction that matters? */
function crossedTrigger(dir: 1 | -1, price: number, level: number): boolean {
  return dir === 1 ? crossedUp(price, level) : crossedDown(price, level);
}
function crossedTarget(dir: 1 | -1, price: number, level: number): boolean {
  return dir === 1 ? crossedUp(price, level) : crossedDown(price, level);
}
function crossedInvalidation(dir: 1 | -1, price: number, level: number): boolean {
  return dir === 1 ? crossedDown(price, level) : crossedUp(price, level);
}

export type EvalOpts = {
  staleDays?: number;
  /** bypass the SNAPSHOT_MIN_GAP_MS dedupe (tests use this) */
  force?: boolean;
};

/** Feed ONE observed price into ONE idea. Mutates a copy; returns it with any
 * transitions appended to statusHistory. Deterministic; idempotent for
 * duplicate observations inside SNAPSHOT_MIN_GAP_MS (unless force). */
export function applySnapshot(idea: TrackedIdea, snap: PriceSnap, opts: EvalOpts = {}): TrackedIdea {
  if (idea.status === "CLOSED") return idea;
  if (!opts.force && idea.lastQuote && snap.at - idea.lastQuote.at < SNAPSHOT_MIN_GAP_MS) return idea;

  const t: TrackedIdea = {
    ...idea,
    statedLevels: { ...idea.statedLevels, targets: [...idea.statedLevels.targets] },
    statusHistory: [...idea.statusHistory],
    priceHistory: [...idea.priceHistory],
    extremes: { ...idea.extremes },
    sourceRefs: idea.sourceRefs, // not touched here
    ideaIds: idea.ideaIds,
  };
  const { price, at } = snap;
  const dir = dirSign(t.direction);

  // record the observation (bounded ring)
  t.priceHistory.push({ at, price });
  if (t.priceHistory.length > PRICE_HISTORY_CAP) {
    t.priceHistory = t.priceHistory.slice(t.priceHistory.length - PRICE_HISTORY_CAP);
  }
  const firstObservation = t.lastQuote === null;
  t.lastQuote = { price, at };

  // thesis-only basis: first observed price ("price since first mention")
  if (t.basis === null && t.status === "ACTIVE") {
    t.basis = "first_snapshot";
    t.basisPrice = price;
  }

  // ── transitions (only for directional ideas with a stated numeric trigger) ──
  const trig = t.statedLevels.trigger?.value ?? null;
  const inv = t.statedLevels.invalidation?.value ?? null;
  const tgt = t.statedLevels.targets.find((x) => x.value != null)?.value ?? null;

  if (dir !== 0 && trig != null && t.status === "ARMED") {
    if (inv != null && crossedInvalidation(dir, price, inv)) {
      t.status = "INVALIDATED";
      t.statusHistory.push({
        state: "INVALIDATED",
        at,
        price,
        reason: "stated invalidation crossed before the trigger ever fired",
      });
    } else if (crossedTrigger(dir, price, trig)) {
      t.status = "TRIGGERED";
      // honest basis: the STATED level — that is what "since called" means
      t.basis = "stated_trigger";
      t.basisPrice = trig;
      // extremes restart at the crossing observation
      t.extremes = { maxFavorable: price, maxAdverse: price };
      t.statusHistory.push({
        state: "TRIGGERED",
        at,
        price,
        reason: firstObservation
          ? "price already beyond stated trigger at first observation (cross not directly observed)"
          : price === trig
            ? "stated trigger touched"
            : "observed beyond stated trigger (may include gap between observations)",
      });
    }
  } else if (t.status === "TRIGGERED" && dir !== 0) {
    const hitT = tgt != null && crossedTarget(dir, price, tgt);
    const hitI = inv != null && crossedInvalidation(dir, price, inv);
    if (hitT && hitI) {
      // both crossed within ONE observation window: intra-window order is
      // unknowable from our data → resolve conservatively, and say so.
      t.status = "INVALIDATED";
      t.statusHistory.push({
        state: "INVALIDATED",
        at,
        price,
        reason:
          "stated target AND invalidation both crossed within one observation window; order unknowable — conservative resolution",
      });
    } else if (hitT) {
      t.status = "TARGET_HIT";
      t.statusHistory.push({ state: "TARGET_HIT", at, price, reason: "stated target crossed" });
    } else if (hitI) {
      t.status = "INVALIDATED";
      t.statusHistory.push({ state: "INVALIDATED", at, price, reason: "stated invalidation crossed" });
    }
  }

  // ── extremes (favorable/adverse are direction-relative; ACTIVE uses raw range) ──
  if (t.basis !== null) {
    const better = dir === -1 ? Math.min : Math.max;
    const worse = dir === -1 ? Math.max : Math.min;
    t.extremes.maxFavorable = t.extremes.maxFavorable == null ? price : better(t.extremes.maxFavorable, price);
    t.extremes.maxAdverse = t.extremes.maxAdverse == null ? price : worse(t.extremes.maxAdverse, price);
  }

  return t;
}

/** Time-based bookkeeping: staleness marking and auto-close of long-terminal
 * ideas. Price-independent — runs even when no quote is available. */
export function applyHousekeeping(idea: TrackedIdea, now: number, opts: EvalOpts = {}): TrackedIdea {
  if (idea.status === "CLOSED") return idea;
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const t = { ...idea, statusHistory: [...idea.statusHistory] };

  t.stale = now - t.lastMentionAt > staleDays * DAY_MS;

  if (t.status === "TARGET_HIT" || t.status === "INVALIDATED") {
    const terminalAt = [...t.statusHistory].reverse().find((h) => h.state === t.status)?.at ?? t.createdAt;
    if (now - terminalAt > AUTO_CLOSE_TERMINAL_DAYS * DAY_MS) {
      t.status = "CLOSED";
      t.closedAt = now;
      t.closedReason = `auto-closed ${AUTO_CLOSE_TERMINAL_DAYS}d after terminal state`;
      t.statusHistory.push({ state: "CLOSED", at: now, price: null, reason: t.closedReason });
    }
  }
  return t;
}

// ── derived, display-facing numbers (never stored — computed from real fields) ──

export type PnlView =
  | { kind: "since_called"; pct: number; basis: number }      // from the STATED trigger
  | { kind: "since_first_mention"; pct: number; basis: number } // thesis-only price move
  | { kind: "none"; reason: string };

/** P&L rules (the law): a signed %, ONLY when the source stated the trigger and
 * it fired. Thesis-only ideas get an UNSIGNED price change since first mention —
 * a different kind, which the UI must label verbatim. ARMED ideas have no P&L
 * (nothing has been "called into action" yet — Δ-TRIG shows distance instead). */
export function pnlView(t: TrackedIdea): PnlView {
  const last = t.lastQuote?.price ?? null;
  if (last == null) return { kind: "none", reason: "no quote" };
  const dir = dirSign(t.direction);
  if (
    t.basis === "stated_trigger" &&
    t.basisPrice != null &&
    dir !== 0 &&
    (t.status === "TRIGGERED" || t.status === "TARGET_HIT" || t.status === "INVALIDATED" || t.status === "CLOSED")
  ) {
    return { kind: "since_called", pct: (dir * (last - t.basisPrice)) / t.basisPrice * 100, basis: t.basisPrice };
  }
  if (t.basis === "first_snapshot" && t.basisPrice != null) {
    return { kind: "since_first_mention", pct: ((last - t.basisPrice) / t.basisPrice) * 100, basis: t.basisPrice };
  }
  return { kind: "none", reason: t.status === "ARMED" ? "armed — not yet triggered" : "no basis yet" };
}

export type MfeMaeView = { mfePct: number; maePct: number; basis: number } | null;

/** MFE/MAE as % excursion from the basis (stated trigger for fired ideas;
 * first observed price for thesis-only). null until a basis exists. */
export function mfeMaeView(t: TrackedIdea): MfeMaeView {
  if (t.basisPrice == null || t.extremes.maxFavorable == null || t.extremes.maxAdverse == null) return null;
  const dir = dirSign(t.direction) || 1; // thesis-only: report raw up/down range
  return {
    mfePct: (dir * (t.extremes.maxFavorable - t.basisPrice)) / t.basisPrice * 100,
    maePct: (dir * (t.extremes.maxAdverse - t.basisPrice)) / t.basisPrice * 100,
    basis: t.basisPrice,
  };
}

// ── capacity enforcement ──────────────────────────────────────────────────────

/** Evict beyond TRACKED_CAP: oldest CLOSED first, then oldest terminal, then
 * oldest stale ACTIVE. Live ARMED/TRIGGERED are never silently dropped — if
 * everything is live we keep them all and report the overflow instead. */
export function enforceCap(tracked: TrackedIdea[]): { kept: TrackedIdea[]; evicted: number; overflow: boolean } {
  if (tracked.length <= TRACKED_CAP) return { kept: tracked, evicted: 0, overflow: false };
  const byOldest = (a: TrackedIdea, b: TrackedIdea) => a.createdAt - b.createdAt;
  const closed = tracked.filter((t) => t.status === "CLOSED").sort(byOldest);
  const terminal = tracked.filter((t) => t.status === "TARGET_HIT" || t.status === "INVALIDATED").sort(byOldest);
  const staleActive = tracked.filter((t) => t.status === "ACTIVE" && t.stale).sort(byOldest);
  const evictable = [...closed, ...terminal, ...staleActive];
  const toEvict = new Set<string>();
  for (const t of evictable) {
    if (tracked.length - toEvict.size <= TRACKED_CAP) break;
    toEvict.add(t.id);
  }
  return {
    kept: tracked.filter((t) => !toEvict.has(t.id)),
    evicted: toEvict.size,
    overflow: tracked.length - toEvict.size > TRACKED_CAP,
  };
}
