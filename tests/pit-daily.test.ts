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
  mergePitPlayers,
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

// ── AUTH-1a: the claim's best-of merge ───────────────────────────────────────

test("claim merge: records best-of, XP max (never summed), account name wins", () => {
  const acct = { ...newPlayer("u:a@b.c"), name: "DESK", xp: 900, level: 2, bestRun: 12, bestRound: 4000, furthestWeek: 2, furthestDay: 3, bestRating: "B", dailyStreak: 1 };
  const dev = { ...newPlayer("v:dev1"), name: "PLAYER", xp: 2500, bestRun: 40, bestRunDate: "2026-08-14", bestRound: 9000, furthestWeek: 1, furthestDay: 4, bestRating: "A", bestDailyRank: 2, dailyStreak: 3, runs: 5, runStreak: 2 };
  const m = mergePitPlayers(acct, dev);
  assert.equal(m.name, "DESK"); // account's chosen board name wins
  assert.equal(m.xp, 2500); // max, not 3400
  assert.equal(m.level, 3); // recomputed from merged XP
  assert.equal(m.bestRun, 40);
  assert.equal(m.bestRunDate, "2026-08-14");
  assert.equal(m.bestRound, 9000);
  assert.equal(m.furthestWeek, 2); // W2D3 beats W1D4 by position
  assert.equal(m.furthestDay, 3);
  assert.equal(m.bestRating, "A");
  assert.equal(m.bestDailyRank, 2);
  assert.equal(m.dailyStreak, 3);
  assert.equal(m.runStreak, 2);
  assert.equal(m.runs, 5);
});

test("claim merge: empty absorb changes nothing; nulls stay null", () => {
  const acct = { ...newPlayer("u:a@b.c"), xp: 100 };
  const m = mergePitPlayers(acct, newPlayer("v:fresh"));
  assert.equal(m.xp, 100);
  assert.equal(m.bestRun, null);
  assert.equal(m.bestRound, null);
  assert.equal(m.bestRating, null);
  assert.equal(m.bestDailyRank, null);
});

test("claim merge: same-date dailies keep max attempts + best pct (cap holds)", () => {
  const a = { ...newPlayer("u:x"), daily: { date: "2026-08-15", attempts: 2, bestPct: 3.2 } };
  const b = { ...newPlayer("v:y"), daily: { date: "2026-08-15", attempts: 3, bestPct: 1.1 } };
  const m = mergePitPlayers(a, b);
  assert.deepEqual(m.daily, { date: "2026-08-15", attempts: 3, bestPct: 3.2 });
});
