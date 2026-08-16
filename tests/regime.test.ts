// lib/regime — MARKET REGIME must be deterministic, explainable, and honest
// (UNAVAILABLE under 2 inputs; agreement is a count, never a dressed-up %).

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRegime, parseStatedLevel, sparkTrendPct, sparkTrendPts, vixBucket } from "../lib/regime";

const BASE = {
  spyTrendPct: null, qqqTrendPct: null, vix: null, vixTrendPts: null,
  bookLongs: 0, bookShorts: 0, nqVsLevelPct: null,
};

test("regime: risk-on day — rising indexes, low falling VIX, long book", () => {
  const r = computeRegime({
    ...BASE, spyTrendPct: 2.4, qqqTrendPct: 3.1, vix: 13.8, vixTrendPts: -2.2,
    bookLongs: 6, bookShorts: 1, nqVsLevelPct: 1.4,
  });
  assert.equal(r.label, "RISK ON");
  assert.equal(r.because.length, 5);
  assert.deepEqual(r.agreement, { agree: 5, voting: 5 });
  assert.ok(r.because.every((b) => b.value.length > 0)); // every input shows its live value
});

test("regime: risk-off day — falling tape, high rising VIX, short book", () => {
  const r = computeRegime({
    ...BASE, spyTrendPct: -3.2, qqqTrendPct: -4.4, vix: 31.0, vixTrendPts: 6.5,
    bookLongs: 1, bookShorts: 5, nqVsLevelPct: -2.2,
  });
  assert.equal(r.label, "RISK OFF");
  assert.equal(r.agreement?.agree, 5);
});

test("regime: mixed inputs land NEUTRAL, never forced to a side", () => {
  const r = computeRegime({
    ...BASE, spyTrendPct: 1.8, qqqTrendPct: 2.0, vix: 27.0, vixTrendPts: 2.0,
    bookLongs: 2, bookShorts: 2,
  });
  assert.equal(r.label, "NEUTRAL");
});

test("regime: fewer than 2 inputs ⇒ UNAVAILABLE, no agreement number", () => {
  const r = computeRegime({ ...BASE, vix: 18 });
  assert.equal(r.label, "UNAVAILABLE");
  assert.equal(r.agreement, null);
  const none = computeRegime(BASE);
  assert.equal(none.label, "UNAVAILABLE");
  assert.equal(none.because.length, 0);
});

test("regime: deterministic — same inputs, same read", () => {
  const i = { ...BASE, spyTrendPct: 0.4, vix: 19.0, bookLongs: 3, bookShorts: 1 };
  assert.deepEqual(computeRegime(i), computeRegime(i));
});

test("vix buckets are fixed thresholds", () => {
  assert.equal(vixBucket(12), "LOW");
  assert.equal(vixBucket(17), "NORMAL");
  assert.equal(vixBucket(24), "ELEVATED");
  assert.equal(vixBucket(33), "HIGH");
});

test("stated-level parsing: commas, k-suffix, prose; garbage refuses", () => {
  assert.equal(parseStatedLevel("21,450"), 21450);
  assert.equal(parseStatedLevel("break of 21400"), 21400);
  assert.equal(parseStatedLevel("reclaim 21.5k"), 21500);
  assert.equal(parseStatedLevel("no entry"), null);
  assert.equal(parseStatedLevel(""), null);
  assert.equal(parseStatedLevel(null), null);
  assert.equal(parseStatedLevel("above 72"), null); // too small to be an NQ level
});

test("spark trends: % and points, honest null when thin", () => {
  assert.ok(Math.abs((sparkTrendPct([100, 110]) ?? 0) - 10) < 1e-9);
  assert.equal(sparkTrendPct([100]), null);
  assert.equal(sparkTrendPct(undefined), null);
  assert.equal(sparkTrendPts([20, 14.5]), -5.5);
});
