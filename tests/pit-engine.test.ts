// lib/pit-engine — the GC-G1 smoke test: Round 1 played end-to-end,
// programmatically. BRIEF (the round def) → LIVE (createRoundRun) → open a
// position → BELL → ROUND COMPLETE (scored summary) → next brief exists.
// This is the structural guard against the dead-button class of bug: if the
// engine can't carry a full round without the DOM, the gate stays shut.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LADDER,
  MARGIN_FRAC,
  START_CASH,
  TPS,
  createRoundRun,
  makeRound,
  type Pop,
} from "../lib/pit-engine";

const SEED = 42;

test("round 1 end-to-end: brief → live → position → bell → complete → next brief", () => {
  // BRIEF — the ladder's opening round
  const def = LADDER[0];
  assert.equal(def.n, 1);
  assert.equal(def.shorts, false);
  assert.equal(def.positions, 1);

  // LIVE — the engine boots with full-length tapes for every stock
  const pops: Pop[] = [];
  const run = createRoundRun(def, SEED, START_CASH, (p) => pops.push(p));
  const N = def.secs * TPS;
  assert.equal(run.stocks.length, def.stocks);
  for (const s of run.stocks) assert.equal(s.prices.length, N);
  assert.equal(run.i, 0);
  assert.equal(run.equity(), START_CASH);

  // shorts are locked in round 1 — the SHORT rule holds at the engine, not the UI
  run.act(0, -1);
  assert.equal(run.positions.filter(Boolean).length, 0);

  // open a LONG, all-in single position
  run.act(0, 1);
  const pos = run.positions[0];
  assert.ok(pos && pos.dir === 1 && pos.qty > 0);

  // ride to the BELL — R1 is gentle; a margin call here would be a tape bug
  let end: ReturnType<typeof run.tick> = null;
  let guard = 0;
  while (!(end = run.tick()) && guard++ <= N) { /* tick */ }
  assert.equal(end, "bell");
  assert.equal(run.i, N - 1);

  // ROUND COMPLETE — flattened, scored, XP granted
  const sum = run.finish(false);
  assert.equal(run.positions.filter(Boolean).length, 0);
  assert.equal(sum.margin, false);
  assert.ok(Number.isFinite(sum.endEq) && sum.endEq > 0);
  assert.ok(sum.endEq > START_CASH * MARGIN_FRAC);
  assert.equal(sum.parts.length, 5);
  assert.deepEqual(sum.parts.map(([k]) => k), ["P&L", "MISSION", "TIMING", "ACCURACY", "DRAWDOWN"]);
  assert.ok(sum.score >= 0);
  assert.ok(sum.xp >= 50);
  assert.ok(sum.trades >= 1); // the bell flattens the open position
  assert.ok(pops.some((p) => /%/.test(p.text))); // the flatten popped a P&L read

  // NEXT BRIEF — the ladder continues and unlocks shorts
  const next = LADDER[sum.margin ? 0 : def.n];
  assert.equal(next.n, 2);
  assert.equal(next.shorts, true);
});

test("margin call settles as a lost round: mission failed, run flagged", () => {
  const def = LADDER[0];
  const run = createRoundRun(def, SEED, START_CASH);
  run.act(0, 1);
  const sum = run.finish(true);
  assert.equal(sum.margin, true);
  assert.equal(sum.missionHit, false);
  assert.equal(sum.parts.find(([k]) => k === "MISSION")?.[1], 0);
  assert.ok(sum.xp >= 50); // the floor keeps a wipeout from feeling like nothing
});

test("tapes are seed-deterministic — same seed, same market for everyone", () => {
  const a = makeRound(LADDER[2], 777);
  const b = makeRound(LADDER[2], 777);
  assert.deepEqual(a.stocks.map((s) => s.ticker), b.stocks.map((s) => s.ticker));
  assert.deepEqual(a.stocks[0].prices, b.stocks[0].prices);
  assert.deepEqual(a.catalysts, b.catalysts);
  // catalysts carry the fairness clue window ahead of the move
  for (const c of a.catalysts) assert.ok(c.clueAt < c.at);
});

test("engine guards: position cap, flatten, and the flip", () => {
  const def = LADDER[2]; // 2 positions, shorts on
  const run = createRoundRun(def, SEED, START_CASH);
  for (let k = 0; k < 30; k++) run.tick();
  run.act(0, 1);
  run.act(1, -1);
  run.act(2, 1); // over the cap — refused
  assert.equal(run.positions.filter(Boolean).length, 2);
  run.act(0, 0); // flatten
  assert.equal(run.positions[0], null);
  run.act(1, 1); // flip short → long
  assert.equal(run.positions[1]?.dir, 1);
});
