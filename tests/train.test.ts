// TRAIN-1 — the lesson engine's contract: validators are pure, tapes are
// deterministic, the sim-ticker rule holds, progress merges as a union.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LESSONS, lessonById, lessonUnlocked, nearExtreme, profitableClose,
  planRatioOk, exitAtPlan, trainedBadge,
} from "../lib/train";
import { makeRound, createRoundRun, START_CASH, CATS, type TradeMark } from "../lib/pit-engine";
import { mergePitPlayers, newPlayer } from "../lib/pit";

test("curriculum: 8 lessons, unlock chain, L1-L3 built for T-G1", () => {
  assert.equal(LESSONS.length, 8);
  for (const l of LESSONS.slice(0, 3)) assert.equal(l.built, true, l.id);
  assert.equal(lessonUnlocked(1, []), true);
  assert.equal(lessonUnlocked(2, []), false);
  assert.equal(lessonUnlocked(2, ["L1"]), true);
  assert.equal(lessonUnlocked(5, ["L1", "L2", "L3"]), false);
  assert.equal(trainedBadge(["L1", "L2", "L3"]), false);
  assert.equal(trainedBadge(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"]), true);
  assert.equal(lessonById("L3")?.ghostPlan, true);
  // v1 reserves the media slot but never fills it (no videos)
  for (const l of LESSONS) assert.equal(l.media, null);
});

test("scripted tapes: deterministic per seed; sim tickers only, never real names", () => {
  const realTickers = new Set(
    Object.entries(CATS)
      .filter(([k]) => !k.startsWith("train"))
      .flatMap(([, c]) => c.tickers),
  );
  for (const l of LESSONS) {
    const a = makeRound(l.day, l.seed);
    const b = makeRound(l.day, l.seed);
    assert.deepEqual(a.stocks[0].prices, b.stocks[0].prices, `${l.id} tape not deterministic`);
    for (const s of a.stocks) {
      assert.equal(realTickers.has(s.ticker), false, `${l.id} leaked real ticker ${s.ticker}`);
      assert.match(s.ticker, /^(IDX|TRN|CHOP)/, `${l.id} ticker ${s.ticker} not sim-flavored`);
    }
  }
});

test("L1 nearExtreme: the tap has to land near the actual edge", () => {
  // a tape with an unambiguous hi at tick 2 and lo at tick 5
  const prices = [100, 101, 110, 104, 102, 90, 95, 96];
  const hiTick = prices.indexOf(Math.max(...prices));
  const loTick = prices.indexOf(Math.min(...prices));
  assert.equal(nearExtreme(prices, hiTick, "hi"), true);
  assert.equal(nearExtreme(prices, loTick, "lo"), true);
  assert.equal(nearExtreme(prices, loTick, "hi"), false, "the low is not the high");
  assert.equal(nearExtreme(prices, 0, "hi"), false, "mid-range tap rejected");
  assert.equal(nearExtreme(prices, -1, "hi"), false);
  assert.equal(nearExtreme([], 0, "hi"), false);
});

test("L2 profitableClose: only a deliberate close with positive gain counts", () => {
  const mk = (kind: "open" | "close", gain?: number): TradeMark =>
    ({ s: 0, tick: 1, price: 100, dir: 1, kind, ...(gain !== undefined ? { gain } : {}) });
  assert.equal(profitableClose([mk("open"), mk("close", 2.4)]), true);
  assert.equal(profitableClose([mk("open"), mk("close", -1.1)]), false);
  assert.equal(profitableClose([mk("open")]), false);
  assert.equal(profitableClose([]), false);
});

test("L3 planRatioOk: 2:1 minimum, stop on the losing side", () => {
  assert.equal(planRatioOk({ entry: 100, stop: 98, target: 104 }), true);
  assert.equal(planRatioOk({ entry: 100, stop: 98, target: 103 }), false, "1.5:1 rejected");
  assert.equal(planRatioOk({ entry: 100, stop: 102, target: 96 }), true, "short-side plan legal");
  assert.equal(planRatioOk({ entry: 100, stop: 102, target: 104 }), false, "stop on the paying side");
  assert.equal(planRatioOk({ entry: 100, stop: 100, target: 104 }), false, "zero risk is not a plan");
});

test("L3 exitAtPlan: the close must land AT the plan, either side", () => {
  const plan = { entry: 100, stop: 98, target: 104 };
  const close = (price: number): TradeMark[] =>
    [{ s: 0, tick: 9, price, dir: 1, kind: "close", gain: price - 100 }];
  assert.equal(exitAtPlan(plan, close(103.6)), true, "at the target");
  assert.equal(exitAtPlan(plan, close(98.3)), true, "at the stop — obeying it counts");
  assert.equal(exitAtPlan(plan, close(101)), false, "mid-plan exit is abandonment");
  assert.equal(exitAtPlan(plan, []), false);
});

test("claim merge: training progress is a union", () => {
  const a = newPlayer("v:one");
  const b = newPlayer("v:two");
  a.training = { done: ["L1", "L2"] };
  b.training = { done: ["L2", "L3"] };
  assert.deepEqual(mergePitPlayers(a, b).training?.done, ["L1", "L2", "L3"]);
  const c = newPlayer("v:three");
  assert.deepEqual(mergePitPlayers(c, b).training?.done, ["L2", "L3"]);
  assert.equal(mergePitPlayers(newPlayer("v:x"), newPlayer("v:y")).training, undefined);
});

test("P5 smoke: L1 end to end — tape to the bell, taps register, L2 unlocks", () => {
  const l1 = lessonById("L1")!;
  const run = createRoundRun(l1.day, l1.seed, START_CASH);
  // ride the whole session to the bell, controls locked (no act calls)
  let end: string | null = null;
  for (let k = 0; k < l1.day.secs * l1.day.tps + 10 && !end; k++) end = run.tick();
  assert.equal(end, "bell", "the L1 tape must end at the bell, not a margin call");
  const prices = run.stocks[0].prices;
  // the learner taps the true extremes — both must validate; a mid-range tap must not
  const hiTick = prices.indexOf(Math.max(...prices));
  const loTick = prices.indexOf(Math.min(...prices));
  assert.equal(nearExtreme(prices, hiTick, "hi"), true, "high tap registers");
  assert.equal(nearExtreme(prices, loTick, "lo"), true, "low tap registers");
  const midPrice = (Math.max(...prices) + Math.min(...prices)) / 2;
  const midTick = prices.findIndex((p) => Math.abs(p - midPrice) < (Math.max(...prices) - Math.min(...prices)) * 0.05);
  if (midTick >= 0) assert.equal(nearExtreme(prices, midTick, "hi"), false, "mid-range tap rejected");
  // completion fires the unlock: L2 opens, L3 stays shut
  const done = ["L1"];
  assert.equal(lessonUnlocked(2, done), true, "L2 unlocks after L1");
  assert.equal(lessonUnlocked(3, done), false, "L3 still needs L2");
});

test("P4: every built lesson carries a learned line for the completion panel", () => {
  for (const l of LESSONS.filter((x) => x.built)) {
    assert.equal(typeof l.learned, "string", l.id);
    assert.ok((l.learned ?? "").length > 10, l.id);
  }
});
