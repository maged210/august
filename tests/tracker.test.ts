// Idea Tracker engine — deterministic unit tests. Simulated price sequences
// feed the pure evaluator so the whole lifecycle is verifiable in milliseconds
// instead of trading days. No Redis, no network.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  applyHousekeeping,
  applySnapshot,
  AUTO_CLOSE_TERMINAL_DAYS,
  mfeMaeView,
  newTrackedIdea,
  pnlView,
  PRICE_HISTORY_CAP,
  triggersCompatible,
  upsertIdeas,
  type TrackedIdea,
} from "../lib/intel/tracker";
import type { BriefIdea } from "../lib/intel/types";

// ── fixtures ──────────────────────────────────────────────────────────────────

const T0 = 1_750_000_000_000; // fixed epoch — tests never touch Date.now()
const MIN = 60_000;
const DAY = 86_400_000;

let seq = 0;
function briefIdea(over: Partial<BriefIdea> & { ticker: string }): BriefIdea {
  seq++;
  return {
    id: over.id ?? `idea-${seq}`,
    ticker: over.ticker,
    assetName: null,
    assetType: "equity",
    direction: over.direction ?? "bullish",
    timeHorizon: over.timeHorizon ?? "swing",
    thesis: over.thesis ?? `${over.ticker} setup`,
    catalysts: [],
    entry: over.entry ?? { value: 100, text: "$100" },
    invalidation: over.invalidation ?? { value: null, text: "Not specified" },
    targets: over.targets ?? [],
    risks: [],
    confidence: 0.6,
    explicitness: over.explicitness ?? "explicit",
    creatorDesignation: { isFavoriteSetup: false, isPrediction: false, isWatchlistMention: false },
    sourceSegmentIds: ["seg1"],
    sourceStartSeconds: 10,
    sourceEndSeconds: 40,
    channelTitle: over.channelTitle ?? "TestChannel",
    videoId: over.videoId ?? `vid-${seq}`,
    videoTitle: "t",
    rankScore: 1,
    rankFactors: [],
  } as BriefIdea;
}

/** run a simulated sequence of prices through one idea, 5 min apart */
function run(idea: TrackedIdea, prices: number[], startAt = T0 + MIN): TrackedIdea {
  let t = idea;
  prices.forEach((p, i) => {
    t = applySnapshot(t, { at: startAt + i * 5 * MIN, price: p });
  });
  return t;
}

// ── lifecycle: trigger crossings ─────────────────────────────────────────────

test("bullish cross-up: ARMED → TRIGGERED at the stated trigger, P&L from stated level", () => {
  const t0 = newTrackedIdea(briefIdea({ ticker: "AAA", entry: { value: 100, text: "$100" } }), T0);
  assert.equal(t0.status, "ARMED");
  const t = run(t0, [95, 98, 100.5, 103]);
  assert.equal(t.status, "TRIGGERED");
  const trig = t.statusHistory.find((h) => h.state === "TRIGGERED");
  assert.ok(trig && trig.price === 100.5);
  const pnl = pnlView(t);
  assert.equal(pnl.kind, "since_called");
  if (pnl.kind === "since_called") {
    assert.equal(pnl.basis, 100); // the STATED level, not the crossing print
    assert.ok(Math.abs(pnl.pct - 3) < 1e-9);
  }
});

test("bearish cross-down mirrors the semantics", () => {
  const t0 = newTrackedIdea(
    briefIdea({ ticker: "BBB", direction: "bearish", entry: { value: 50, text: "$50" } }),
    T0,
  );
  const t = run(t0, [53, 51, 49.9, 47]);
  assert.equal(t.status, "TRIGGERED");
  const pnl = pnlView(t);
  assert.equal(pnl.kind, "since_called");
  if (pnl.kind === "since_called") assert.ok(pnl.pct > 0); // bearish: falling price = favorable
});

test("gap through the trigger records the gap honestly (no fabricated cross print)", () => {
  const t0 = newTrackedIdea(briefIdea({ ticker: "GAP", entry: { value: 100, text: "$100" } }), T0);
  const t = run(t0, [90, 112]); // no observation between 90 and 112
  assert.equal(t.status, "TRIGGERED");
  const h = t.statusHistory.find((x) => x.state === "TRIGGERED")!;
  assert.match(h.reason, /gap|beyond stated trigger/i);
  assert.equal(h.price, 112); // the OBSERVED price, never an invented crossing price
});

test("first observation already beyond trigger says so explicitly", () => {
  const t0 = newTrackedIdea(briefIdea({ ticker: "PRE", entry: { value: 100, text: "$100" } }), T0);
  const t = run(t0, [120]);
  assert.equal(t.status, "TRIGGERED");
  assert.match(t.statusHistory.at(-1)!.reason, /first observation/i);
});

// ── lifecycle: target / invalidation ordering ────────────────────────────────

test("target then invalidation across snapshots: TARGET_HIT is terminal and sticks", () => {
  const t0 = newTrackedIdea(
    briefIdea({
      ticker: "TGT",
      entry: { value: 100, text: "$100" },
      invalidation: { value: 95, text: "$95" },
      targets: [{ value: 110, text: "$110" }],
    }),
    T0,
  );
  const t = run(t0, [101, 111, 94]); // triggered → target → later breaks invalidation
  assert.equal(t.status, "TARGET_HIT"); // the call played out first; later action irrelevant
});

test("invalidation before target: INVALIDATED", () => {
  const t0 = newTrackedIdea(
    briefIdea({
      ticker: "INV",
      entry: { value: 100, text: "$100" },
      invalidation: { value: 95, text: "$95" },
      targets: [{ value: 110, text: "$110" }],
    }),
    T0,
  );
  const t = run(t0, [101, 94.5, 111]);
  assert.equal(t.status, "INVALIDATED");
});

test("invalidation crossed while still ARMED kills the setup before it fires", () => {
  const t0 = newTrackedIdea(
    briefIdea({ ticker: "DEAD", entry: { value: 100, text: "$100" }, invalidation: { value: 90, text: "$90" } }),
    T0,
  );
  const t = run(t0, [92, 89]);
  assert.equal(t.status, "INVALIDATED");
  assert.match(t.statusHistory.at(-1)!.reason, /before the trigger/i);
});

test("target AND invalidation both crossed in one observation resolves conservatively with an explicit reason", () => {
  // A single print can satisfy BOTH conditions only when the stated levels are
  // inverted (creator said invalidation ABOVE target for a bullish idea — a
  // real data-quality case the engine must not resolve optimistically).
  // Path to reach it: the trigger is gap-crossed ABOVE the inverted
  // invalidation (120 > 108, so the ARMED invalidation check doesn't fire),
  // then a print lands between target and inverted invalidation.
  const weird = newTrackedIdea(
    briefIdea({
      ticker: "AMB",
      direction: "bullish",
      entry: { value: 100, text: "$100" },
      invalidation: { value: 108, text: "$108" }, // inverted: above the target
      targets: [{ value: 105, text: "$105" }],
    }),
    T0,
  );
  const w = run(weird, [120, 106]); // 120: TRIGGERED (above inv, so not invalidated)
  // 106 ≥ 105 (target crossed) AND 106 ≤ 108 (invalidation crossed) — both at once.
  assert.equal(w.status, "INVALIDATED");
  assert.match(w.statusHistory.at(-1)!.reason, /order unknowable|conservative/i);
});

test("inverted invalidation above price while ARMED invalidates immediately (deterministic, never optimistic)", () => {
  const t0 = newTrackedIdea(
    briefIdea({
      ticker: "AMB2",
      direction: "bullish",
      entry: { value: 100, text: "$100" },
      invalidation: { value: 108, text: "$108" },
      targets: [{ value: 105, text: "$105" }],
    }),
    T0,
  );
  const t = run(t0, [101]); // 101 ≤ 108 → the stated invalidation reads as crossed pre-trigger
  assert.equal(t.status, "INVALIDATED");
  assert.match(t.statusHistory.at(-1)!.reason, /before the trigger/i);
});

// ── thesis-only honesty ───────────────────────────────────────────────────────

test("thesis-only idea stays ACTIVE forever; price-since-mention, never trade P&L", () => {
  const t0 = newTrackedIdea(
    briefIdea({ ticker: "THX", entry: { value: null, text: "Not specified" } }),
    T0,
  );
  assert.equal(t0.status, "ACTIVE");
  const t = run(t0, [100, 150, 50, 200]);
  assert.equal(t.status, "ACTIVE"); // no fabricated transitions, ever
  const pnl = pnlView(t);
  assert.equal(pnl.kind, "since_first_mention");
  if (pnl.kind === "since_first_mention") {
    assert.equal(pnl.basis, 100); // first OBSERVED price
    assert.ok(Math.abs(pnl.pct - 100) < 1e-9); // 100 → 200
  }
});

test("watch/neutral direction with a numeric level is still thesis-only (no direction → no crossing semantics)", () => {
  const t0 = newTrackedIdea(
    briefIdea({ ticker: "WCH", direction: "watch", entry: { value: 100, text: "$100" } }),
    T0,
  );
  assert.equal(t0.status, "ACTIVE");
  assert.equal(run(t0, [90, 110]).status, "ACTIVE");
});

test("ARMED has no P&L — nothing was called into action yet", () => {
  const t0 = newTrackedIdea(briefIdea({ ticker: "ARM", entry: { value: 100, text: "$100" } }), T0);
  const t = run(t0, [95, 96]);
  assert.equal(t.status, "ARMED");
  assert.equal(pnlView(t).kind, "none");
});

// ── MFE / MAE ─────────────────────────────────────────────────────────────────

test("MFE/MAE measured from the stated trigger after firing (bullish)", () => {
  const t0 = newTrackedIdea(briefIdea({ ticker: "MFE", entry: { value: 100, text: "$100" } }), T0);
  const t = run(t0, [99, 101, 108, 96, 104]);
  const v = mfeMaeView(t)!;
  assert.equal(v.basis, 100);
  assert.ok(Math.abs(v.mfePct - 8) < 1e-9); // high 108 vs stated 100
  assert.ok(Math.abs(v.maePct - -4) < 1e-9); // low 96 vs stated 100
});

test("MFE/MAE for bearish ideas is direction-relative (drop = favorable)", () => {
  const t0 = newTrackedIdea(
    briefIdea({ ticker: "MAE", direction: "bearish", entry: { value: 100, text: "$100" } }),
    T0,
  );
  const t = run(t0, [101, 99, 92, 103]);
  const v = mfeMaeView(t)!;
  assert.ok(v.mfePct > 0); // fell to 92 → favorable for a short call
  assert.ok(v.maePct < 0); // rallied to 103 → adverse
});

// ── snapshots: ring buffer + idempotency ─────────────────────────────────────

test("price history is ring-capped and extremes survive the trim", () => {
  const t0 = newTrackedIdea(briefIdea({ ticker: "RING", entry: { value: 1, text: "$1" } }), T0);
  const many = Array.from({ length: PRICE_HISTORY_CAP + 50 }, (_, i) => 10 + (i % 7));
  many[3] = 99; // extreme early — will be trimmed out of the ring
  const t = run(t0, many);
  assert.equal(t.priceHistory.length, PRICE_HISTORY_CAP);
  assert.equal(t.extremes.maxFavorable, 99); // extremes never lose truth to the cap
});

test("snapshots inside the min gap are dropped (idempotent overlapping pings)", () => {
  const t0 = newTrackedIdea(briefIdea({ ticker: "DUP", entry: { value: 100, text: "$100" } }), T0);
  let t = applySnapshot(t0, { at: T0 + MIN, price: 95 });
  t = applySnapshot(t, { at: T0 + MIN + 30_000, price: 200 }); // 30s later — ignored
  assert.equal(t.priceHistory.length, 1);
  assert.equal(t.status, "ARMED"); // the ignored observation caused no transition
});

// ── dedupe / merge / conflicts ────────────────────────────────────────────────

test("same source re-mention with compatible trigger merges into ONE idea; latest explicit statement wins", () => {
  const a = briefIdea({ ticker: "FCEL", entry: { value: 30.8, text: "$30.80" }, thesis: "old thesis" });
  const day1 = upsertIdeas([], [a], T0);
  assert.equal(day1.tracked.length, 1);
  const b = briefIdea({
    ticker: "FCEL",
    entry: { value: 30.85, text: "$30.85" }, // within 0.5% — same level restated
    thesis: "refined thesis",
    targets: [{ value: 40, text: "$40" }],
  });
  const day2 = upsertIdeas(day1.tracked, [b], T0 + DAY);
  assert.equal(day2.tracked.length, 1);
  assert.equal(day2.merged, 1);
  const t = day2.tracked[0];
  assert.equal(t.thesis, "refined thesis");
  assert.equal(t.sourceRefs.length, 2); // prior statement preserved
  assert.equal(t.statedLevels.targets[0]?.value, 40);
});

test("re-running the same brief is a no-op (idempotent ingestion)", () => {
  const a = briefIdea({ ticker: "IDM" });
  const r1 = upsertIdeas([], [a], T0);
  const r2 = upsertIdeas(r1.tracked, [a], T0 + MIN);
  assert.equal(r2.tracked.length, 1);
  assert.equal(r2.merged, 0);
  assert.equal(r2.added, 0);
});

test("FCEL conflict: two incompatible triggers from one source stay as linked variants, both visible", () => {
  const a = briefIdea({ ticker: "FCEL", entry: { value: 30.8, text: "$30.80" } });
  const b = briefIdea({ ticker: "FCEL", entry: { value: 38.0, text: "$38.00" } });
  const r = upsertIdeas([], [a, b], T0);
  assert.equal(r.tracked.length, 2); // never silently merged or discarded
  assert.equal(r.conflicts, 1);
  assert.ok(r.tracked[0].conflictKey && r.tracked[0].conflictKey === r.tracked[1].conflictKey);
});

test("different channels never merge — identity is per-source", () => {
  const a = briefIdea({ ticker: "XCH", channelTitle: "Alpha" });
  const b = briefIdea({ ticker: "XCH", channelTitle: "Beta" });
  const r = upsertIdeas([], [a, b], T0);
  assert.equal(r.tracked.length, 2);
  assert.equal(r.conflicts, 0); // cross-source disagreement is consensus's job, not a conflict
});

test("a mention after CLOSED starts a fresh lifecycle; the closed record stays", () => {
  const a = briefIdea({ ticker: "REO" });
  let tracked = upsertIdeas([], [a], T0).tracked;
  tracked = [{ ...tracked[0], status: "CLOSED" as const, closedAt: T0 + DAY, closedReason: "test" }];
  const b = briefIdea({ ticker: "REO" });
  const r = upsertIdeas(tracked, [b], T0 + 2 * DAY);
  assert.equal(r.tracked.length, 2);
  assert.equal(r.added, 1);
});

test("triggersCompatible: null merges, tolerance splits", () => {
  assert.ok(triggersCompatible(null, { value: 10, text: "$10" }));
  assert.ok(triggersCompatible({ value: 100, text: "" }, { value: 100.4, text: "" }));
  assert.ok(!triggersCompatible({ value: 30.8, text: "" }, { value: 38, text: "" }));
});

// ── housekeeping: staleness + auto-close ─────────────────────────────────────

test("stale marking is visible, never a deletion; terminal ideas auto-close after the horizon", () => {
  const t0 = newTrackedIdea(briefIdea({ ticker: "OLD", entry: { value: 100, text: "$100" } }), T0);
  const aged = applyHousekeeping(t0, T0 + 6 * DAY);
  assert.equal(aged.stale, true);
  assert.notEqual(aged.status, "CLOSED"); // stale ≠ gone

  const fired = run(t0, [101, 111]); // TRIGGERED (no target stated → stays TRIGGERED)
  assert.equal(fired.status, "TRIGGERED");
  const terminal = run(
    newTrackedIdea(
      briefIdea({ ticker: "TRM", entry: { value: 100, text: "$100" }, targets: [{ value: 110, text: "$110" }] }),
      T0,
    ),
    [101, 111],
  );
  assert.equal(terminal.status, "TARGET_HIT");
  const closed = applyHousekeeping(terminal, T0 + (AUTO_CLOSE_TERMINAL_DAYS + 2) * DAY);
  assert.equal(closed.status, "CLOSED");
  assert.match(closed.closedReason ?? "", /auto-closed/);
});
