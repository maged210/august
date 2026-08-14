// lib/pit-engine — GC-G1 smoke + tuning-round T5 fairness auto-check.
//
// 1) Day 1 played end-to-end programmatically (the dead-button guard).
// 2) TAPE FAIRNESS: blind buy-and-hold and blind short-and-hold across 100
//    seeded weeks must fail every day's mission. A blind win = a broken tape
//    = a failed build.
// 3) Tape v2 hard constraints measured on the real generator output: streak
//    caps, direction changes, guaranteed drawdown AND rally per stock.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LADDER,
  MARGIN_FRAC,
  START_CASH,
  createRoundRun,
  makeRound,
  retuneRun,
  type PitEvent,
  type RoundDef,
} from "../lib/pit-engine";

const SEED = 42;

// ── the smoke: day 1, brief → live → trade → bell → complete → next brief ────

test("day 1 end-to-end: brief → live → position → bell → complete → next brief", () => {
  const def = LADDER[0];
  assert.equal(def.n, 1);
  assert.equal(def.shorts, false);
  assert.equal(def.positions, 1);

  const events: PitEvent[] = [];
  const run = createRoundRun(def, SEED, START_CASH, (e) => events.push(e));
  const N = def.secs * def.tps;
  assert.equal(run.stocks.length, def.stocks);
  for (const s of run.stocks) assert.equal(s.prices.length, N);
  assert.equal(run.equity(), START_CASH);

  // shorts are locked on day 1 — enforced at the engine, not the UI
  run.act(0, -1);
  assert.equal(run.positions.filter(Boolean).length, 0);

  // open a LONG, take it off deliberately mid-day, re-enter
  run.act(0, 1);
  assert.ok(run.positions[0] && run.positions[0].dir === 1);
  for (let k = 0; k < 60; k++) run.tick();
  run.act(0, 0);
  assert.equal(run.positions[0], null);
  assert.ok(run.log.some((t) => t.kind === "close"));
  run.act(0, 1);

  // ride to the bell
  let end: ReturnType<typeof run.tick> = null;
  let guard = 0;
  while (!(end = run.tick()) && guard++ <= N) { /* tick */ }
  assert.equal(end, "bell");

  const before = run.log.filter((t) => t.kind === "close").length;
  const sum = run.finish(false);
  // bell settlement liquidates but does NOT count as trading (T5)
  assert.equal(sum.trades, 1); // only the deliberate mid-day close
  assert.equal(run.log.filter((t) => t.kind === "close").length, before);
  assert.equal(run.positions.filter(Boolean).length, 0);
  assert.equal(sum.margin, false);
  assert.ok(Number.isFinite(sum.endEq) && sum.endEq > START_CASH * MARGIN_FRAC);
  assert.deepEqual(sum.parts.map(([k]) => k), ["P&L", "MISSION", "TIMING", "ACCURACY", "DRAWDOWN"]);
  assert.ok(sum.xp >= 50);
  assert.ok(events.some((e) => e.type === "pop" && /%/.test(e.text)));

  // next brief exists and unlocks shorts
  const next = LADDER[def.n];
  assert.equal(next.n, 2);
  assert.equal(next.shorts, true);
});

test("bell settlement sets no mission flags: momentum + short days can't be blind-held", () => {
  for (const def of [LADDER[1], LADDER[2]]) {
    const run = createRoundRun(def, SEED, START_CASH);
    run.act(0, 1);
    if (def.shorts) run.act(1, -1);
    let end: ReturnType<typeof run.tick> = null;
    while (!(end = run.tick())) { /* tick */ }
    const sum = run.finish(end === "margin");
    assert.equal(sum.trades, 0, `${def.name}: settlement counted as trading`);
    assert.equal(sum.missionHit, false, `${def.name}: blind hold hit the mission`);
  }
});

test("margin call settles as a lost day", () => {
  const run = createRoundRun(LADDER[0], SEED, START_CASH);
  run.act(0, 1);
  const sum = run.finish(true);
  assert.equal(sum.margin, true);
  assert.equal(sum.missionHit, false);
  assert.ok(sum.xp >= 50);
});

// ── T5: the fairness auto-check — 100 seeded weeks ───────────────────────────

function blindMissionHit(def: RoundDef, netPct: number, spyPct: number, eqMaxDD: number): boolean {
  switch (def.missionKey) {
    case "beat": return netPct > spyPct;
    case "momentum": return false; // requires a deliberate profitable sell (settlement rule)
    case "short": return false; // requires a deliberate profitable cover (settlement rule)
    case "survivor": return eqMaxDD < 20;
    case "lowrisk": return netPct >= 0 && eqMaxDD < 5;
  }
}

test("fairness: blind hold (long AND short) fails the mission on all 100 seeded weeks", () => {
  const broken: string[] = [];
  for (let seed = 1; seed <= 100; seed++) {
    for (const def of LADDER) {
      const { stocks, spy } = makeRound(def, seed);
      const last = spy.length - 1;
      const spyPct = (spy[last] / spy[0] - 1) * 100;
      const dirs: Array<1 | -1> = def.shorts ? [1, -1] : [1];
      for (let s = 0; s < stocks.length; s++) {
        const p = stocks[s].prices;
        for (const dir of dirs) {
          // all-in hold equity path, closed form
          let peakE = -Infinity, maxDD = 0;
          let e = 1;
          for (let k = 0; k < p.length; k++) {
            e = dir === 1 ? p[k] / p[0] : 2 - p[k] / p[0];
            peakE = Math.max(peakE, e);
            maxDD = Math.max(maxDD, (1 - e / peakE) * 100);
          }
          const netPct = (e - 1) * 100;
          if (blindMissionHit(def, netPct, spyPct, maxDD)) {
            broken.push(`seed ${seed} day ${def.n} ${stocks[s].ticker} ${dir === 1 ? "long" : "short"} net ${netPct.toFixed(1)} dd ${maxDD.toFixed(1)}`);
          }
        }
      }
    }
  }
  assert.deepEqual(broken, [], `broken tapes:\n${broken.slice(0, 12).join("\n")}`);
});

// ── tape v2 hard constraints, measured on real output ────────────────────────

test("every stock gets its guaranteed drawdown AND rally; day-1 closes under SPY", () => {
  for (let seed = 1; seed <= 25; seed++) {
    for (const def of LADDER) {
      const { stocks, spyNet } = makeRound(def, seed);
      for (const st of stocks) {
        const p = st.prices;
        let peak = -Infinity, trough = Infinity, dd = 0, rally = 0;
        for (const v of p) {
          peak = Math.max(peak, v);
          trough = Math.min(trough, v);
          dd = Math.max(dd, (1 - v / peak) * 100);
          rally = Math.max(rally, (v / trough - 1) * 100);
        }
        assert.ok(dd >= def.minDD * 0.95, `day ${def.n} seed ${seed} ${st.ticker}: dd ${dd.toFixed(1)} < ${def.minDD}`);
        assert.ok(rally >= def.minRally * 0.95, `day ${def.n} seed ${seed} ${st.ticker}: rally ${rally.toFixed(1)} < ${def.minRally}`);
        const net = (p[p.length - 1] / p[0] - 1) * 100;
        if (def.capBelowSpy !== undefined) {
          assert.ok(net <= spyNet - def.capBelowSpy + 0.01, `day ${def.n} seed ${seed} ${st.ticker}: net ${net.toFixed(1)} vs spy ${spyNet.toFixed(1)}`);
        }
      }
    }
  }
});

test("streak cap + direction changes: no monotonic grinds", () => {
  for (let seed = 1; seed <= 25; seed++) {
    for (const def of LADDER) {
      const { stocks } = makeRound(def, seed);
      for (const st of stocks) {
        const p = st.prices;
        let streak = 0, maxStreak = 0, prev = 0, flips = 0;
        for (let k = 1; k < p.length; k++) {
          const s = Math.sign(p[k] - p[k - 1]);
          if (s === 0) continue;
          if (s === prev) streak += 1;
          else { if (prev !== 0) flips += 1; streak = 1; prev = s; }
          maxStreak = Math.max(maxStreak, streak);
        }
        // nominal cap 6; bridge correction may stretch a run slightly
        assert.ok(maxStreak <= 9, `day ${def.n} seed ${seed} ${st.ticker}: streak ${maxStreak}`);
        assert.ok(flips >= p.length / 8, `day ${def.n} seed ${seed} ${st.ticker}: only ${flips} direction changes in ${p.length} ticks`);
      }
    }
  }
});

test("tapes are seed-deterministic — same seed, same market for everyone", () => {
  const a = makeRound(LADDER[2], 777);
  const b = makeRound(LADDER[2], 777);
  assert.deepEqual(a.stocks.map((s) => s.ticker), b.stocks.map((s) => s.ticker));
  assert.deepEqual(a.stocks[0].prices, b.stocks[0].prices);
  assert.deepEqual(a.catalysts, b.catalysts);
  for (const c of a.catalysts) assert.ok(c.clueAt < c.at);
});

test("engine guards: position cap, flatten, flip; retune carries the book", () => {
  const def = LADDER[2]; // 2 positions, shorts on
  const run = createRoundRun(def, SEED, START_CASH);
  for (let k = 0; k < 40; k++) run.tick();
  run.act(0, 1);
  run.act(1, -1);
  run.act(2, 1); // over the cap — refused
  assert.equal(run.positions.filter(Boolean).length, 2);
  run.act(0, 0);
  assert.equal(run.positions[0], null);
  run.act(1, 1); // flip short → long
  assert.equal(run.positions[1]?.dir, 1);

  // T3: retune mid-day — prices continue seamlessly, positions/cash survive
  const priceBefore = run.px(1);
  const tuned = retuneRun(run, { tps: 1, vol: 1.5, drift: 1, retrace: 1.2, events: 1 });
  assert.equal(tuned.px(1, 0), priceBefore);
  assert.equal(tuned.positions[1]?.dir, 1);
  assert.ok(Math.abs(tuned.equity() - run.equity()) < 1e-6);
  const sum = (() => { let e: ReturnType<typeof tuned.tick> = null; while (!(e = tuned.tick())) { /* tick */ } return tuned.finish(e === "margin"); })();
  assert.ok(Number.isFinite(sum.endEq));
});
