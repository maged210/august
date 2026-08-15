// lib/pit-share + S8 randomness policy — GAME-5 delta verification.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChallenge,
  buildShareText,
  dailyNumber,
  deskTeaserVisibility,
  glyphStrip,
  parseChallenge,
  pickStamp,
} from "../lib/pit-share";
import { dailySeed } from "../lib/pit";
import { LADDER, START_CASH, careerDaySeed, createRoundRun, makeRound, weekAdjust } from "../lib/pit-engine";
import type { TradeMark } from "../lib/pit-engine";

// ── S6: share content matches the run ────────────────────────────────────────

test("share text: facts line, glyph strip, link — reads like a real drop", () => {
  const log: TradeMark[] = [
    { s: 0, tick: 10, price: 100, dir: 1, kind: "open" },
    { s: 0, tick: 90, price: 104, dir: 1, kind: "close", gain: 4.1 },
    { s: 1, tick: 120, price: 50, dir: -1, kind: "open" },
    { s: 1, tick: 200, price: 51, dir: -1, kind: "close", gain: -2.0 },
    { s: 0, tick: 300, price: 99, dir: 1, kind: "open" },
    { s: 0, tick: 400, price: 105, dir: 1, kind: "close", gain: 6.0 },
  ];
  const glyphs = glyphStrip(log, "daily");
  assert.equal(glyphs, "🟩🟥🟩🔔");
  const text = buildShareText({ tag: "#12", pct: 8.23, trades: 3, stamp: "DIAMOND HANDS", glyphs, url: "https://x.test/?view=pit&challenge=5.1.1.823" });
  assert.equal(text, "THE PIT #12 · +8.2% · 3 trades · DIAMOND HANDS\n🟩🟥🟩🔔\nhttps://x.test/?view=pit&challenge=5.1.1.823");
  // no-trade day stays honest
  assert.equal(glyphStrip([], "busted"), "▫💀");
  const flat = buildShareText({ tag: "W2D4", pct: -61.0, trades: 0, stamp: "margin called", glyphs: "▫💀", url: "u" });
  assert.match(flat, /^THE PIT W2D4 · -61\.0% · 0 trades · margin called\n/);
});

test("share text: run summary → asserted content (smoke tie-in)", () => {
  const def = LADDER[0];
  const run = createRoundRun(def, 42, START_CASH);
  run.act(0, 1);
  for (let k = 0; k < 80; k++) run.tick();
  run.act(0, 0); // one deliberate close
  let end: ReturnType<typeof run.tick> = null;
  while (!(end = run.tick())) { /* tick */ }
  const sum = run.finish(false);
  const text = buildShareText({
    tag: "W1D1", pct: sum.roundPct, trades: sum.trades,
    stamp: pickStamp({ ...sum, missionKey: def.missionKey }),
    glyphs: glyphStrip(run.log, "day"),
    url: "https://x.test",
  });
  assert.match(text, new RegExp(`^THE PIT W1D1 · [+-]?${Math.abs(sum.roundPct).toFixed(1)}% · ${sum.trades} trade`));
  const closes = run.log.filter((m) => m.kind === "close").length;
  const glyphCount = (text.match(/🟩|🟥/g) ?? []).length;
  assert.equal(glyphCount, Math.min(closes, 12));
});

test("stamp priority: diamond beats everything; paper is the confession", () => {
  const base = { stamps: [] as string[], missionHit: false, margin: false, bonus: [] as Array<[string, number]> };
  assert.equal(pickStamp({ ...base, stamps: ["diamond", "paper"] }), "DIAMOND HANDS");
  assert.equal(pickStamp({ ...base, missionHit: true, missionKey: "survivor" }), "survived the crash");
  assert.equal(pickStamp({ ...base, bonus: [["PERFECT DAY", 1000]] }), "PERFECT DAY");
  assert.equal(pickStamp({ ...base, stamps: ["paper"] }), "PAPER HANDS");
  assert.equal(pickStamp({ ...base, margin: true }), "margin called");
  assert.equal(pickStamp(base), null);
});

test("daily numbering: epoch day is #1 and counts forward", () => {
  assert.equal(dailyNumber("2026-08-15"), 1);
  assert.equal(dailyNumber("2026-08-16"), 2);
  assert.equal(dailyNumber("2026-09-15"), 32);
});

// ── S6: challenge links — deterministic same-tape ────────────────────────────

test("challenge: build/parse round-trips; garbage refuses", () => {
  const c = { seed: 48213, week: 2, day: 3, pct: 12.4 };
  const s = buildChallenge(c);
  assert.equal(s, "48213.2.3.1240");
  assert.deepEqual(parseChallenge(s), c);
  assert.equal(parseChallenge("x"), null);
  assert.equal(parseChallenge("1.99.1.0"), null);
  assert.equal(parseChallenge("0.1.1.0"), null);
  assert.equal(parseChallenge(null), null);
  const neg = parseChallenge(buildChallenge({ seed: 7, week: 1, day: 1, pct: -61 }));
  assert.equal(neg?.pct, -61);
});

test("challenge determinism: two profiles opening the same link get the same tape", () => {
  const c = parseChallenge("48213.2.3.1240")!;
  const def = weekAdjust(LADDER[c.day - 1], c.week);
  const a = makeRound(def, c.seed);
  const b = makeRound(def, c.seed);
  assert.deepEqual(a.stocks.map((s) => s.ticker), b.stocks.map((s) => s.ticker));
  assert.deepEqual(a.stocks[0].prices, b.stocks[0].prices);
  assert.deepEqual(a.events, b.events);
});

// ── S8: the randomness policy, both directions ───────────────────────────────

test("S8 career: two runs produce DIFFERENT Day-1 tapes; same run replays the same", () => {
  const runA = 48213, runB = 48214;
  const def = LADDER[0];
  const a = makeRound(def, careerDaySeed(runA, 1, 1));
  const b = makeRound(def, careerDaySeed(runB, 1, 1));
  assert.notDeepEqual(a.stocks[0].prices, b.stocks[0].prices);
  // and day seeds never collide trivially across the (week, day) grid
  const seen = new Set<number>();
  for (let r = 1; r <= 50; r++) for (let w = 1; w <= 8; w++) for (let d = 1; d <= 5; d++) {
    seen.add(careerDaySeed(r, w, d));
  }
  assert.equal(seen.size, 50 * 8 * 5);
  // determinism within a run: the same (runId, week, day) always replays
  assert.equal(careerDaySeed(runA, 3, 2), careerDaySeed(runA, 3, 2));
});

test("S8 daily: two clean profiles on today's date get IDENTICAL tapes", () => {
  const seed = dailySeed("2026-08-15");
  assert.equal(seed, dailySeed("2026-08-15"));
  const def = LADDER[0];
  const a = makeRound(def, seed);
  const b = makeRound(def, seed);
  assert.deepEqual(a.stocks[0].prices, b.stocks[0].prices);
  assert.deepEqual(a.events, b.events); // events inherit the tape's policy
  // ...and career seeds never accidentally equal the daily seed space by fiat
  assert.notEqual(careerDaySeed(seed, 1, 1), seed);
});

// ── S7 ───────────────────────────────────────────────────────────────────────

test("desk teaser visibility: open today, lock-ready for AUTH-1", () => {
  assert.equal(deskTeaserVisibility(), "open");
});
