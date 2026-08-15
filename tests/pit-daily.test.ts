// lib/pit — GAME-5 DAILY PIT + records, pure layer. The store is best-effort
// Upstash and stays untested here (no network in tests).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_ATTEMPTS,
  applyDaily,
  applyProgress,
  betterRating,
  dailyAttemptsLeft,
  dailySeed,
  newPlayer,
  prevDate,
} from "../lib/pit";
import { LADDER, makeRound } from "../lib/pit-engine";

test("daily determinism: same date ⇒ same seed ⇒ identical tape for everyone", () => {
  assert.equal(dailySeed("2026-08-15"), dailySeed("2026-08-15"));
  assert.notEqual(dailySeed("2026-08-15"), dailySeed("2026-08-16"));
  const a = makeRound(LADDER[0], dailySeed("2026-08-15"));
  const b = makeRound(LADDER[0], dailySeed("2026-08-15"));
  assert.deepEqual(a.stocks.map((s) => s.ticker), b.stocks.map((s) => s.ticker));
  assert.deepEqual(a.stocks[0].prices, b.stocks[0].prices);
  assert.deepEqual(a.events, b.events);
});

test("attempt cap: exactly 3, then refused; board takes best-of-three only", () => {
  const p = newPlayer("v:test");
  const date = "2026-08-15";
  assert.equal(dailyAttemptsLeft(p, date), DAILY_ATTEMPTS);
  assert.deepEqual(applyDaily(p, 2.5, date), { improved: true });
  assert.deepEqual(applyDaily(p, -4.0, date), { improved: false }); // worse — best stands
  assert.equal(p.daily?.bestPct, 2.5);
  assert.deepEqual(applyDaily(p, 7.1, date), { improved: true });
  assert.equal(p.daily?.bestPct, 7.1);
  assert.equal(dailyAttemptsLeft(p, date), 0);
  assert.equal(applyDaily(p, 99, date), null); // the 4th is refused
  assert.equal(p.daily?.bestPct, 7.1);
  // the date turns — fresh attempts, best resets
  const next = "2026-08-16";
  assert.equal(dailyAttemptsLeft(p, next), DAILY_ATTEMPTS);
  assert.deepEqual(applyDaily(p, 1.0, next), { improved: true });
  assert.equal(p.daily?.bestPct, 1.0);
});

test("daily streak: consecutive dates extend, gaps reset to 1", () => {
  const p = newPlayer("v:test");
  applyDaily(p, 1, "2026-08-15");
  assert.equal(p.dailyStreak, 1);
  applyDaily(p, 1, "2026-08-15"); // same date — streak unchanged
  assert.equal(p.dailyStreak, 1);
  applyDaily(p, 1, "2026-08-16");
  assert.equal(p.dailyStreak, 2);
  applyDaily(p, 1, "2026-08-20"); // gap
  assert.equal(p.dailyStreak, 1);
  assert.equal(prevDate("2026-08-16"), "2026-08-15");
  assert.equal(prevDate("2026-03-01"), "2026-02-28");
});

test("the ghost only moves forward; FURTHEST YET fires once per new ground", () => {
  const p = newPlayer("v:test");
  assert.equal(applyProgress(p, 1, 1), true);
  assert.equal(applyProgress(p, 1, 1), false);
  assert.equal(applyProgress(p, 1, 3), true);
  assert.equal(applyProgress(p, 1, 2), false); // behind the ghost
  assert.equal(applyProgress(p, 2, 1), true); // new week beats any earlier day
  assert.equal(p.furthestWeek, 2);
  assert.equal(p.furthestDay, 1);
});

test("best rating keeps the higher letter", () => {
  assert.equal(betterRating(null, "C"), "C");
  assert.equal(betterRating("C", "A"), "A");
  assert.equal(betterRating("A", "B"), "A");
  assert.equal(betterRating("A", "A+"), "A+");
  assert.equal(betterRating("A+", "F"), "A+");
});
