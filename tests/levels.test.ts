// lib/levels — R2 session math: honest nulls (VWAP without volume, overnight
// without coverage), calculated bias, generated VIX context.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLevels, etMinutes, levelsBias, vixContext } from "../lib/levels";
import type { Candle, DailyBar } from "../lib/markets";

// 2026-08-14 (Fri): 14:30 UTC = 10:30 ET (DST). Overnight: 08:00 UTC = 04:00 ET.
const RTH_TS = Date.UTC(2026, 7, 14, 14, 30) / 1000;
const ON_TS = Date.UTC(2026, 7, 14, 8, 0) / 1000;

const daily: DailyBar[] = [
  { t: 1, o: 100, h: 106, l: 98, c: 104 }, // prior-prior
  { t: 2, o: 104, h: 110, l: 102, c: 108 }, // YESTERDAY — the prev bar
  { t: 3, o: 108, h: 112, l: 107, c: 111 }, // today, forming
];

function bar(ts: number, px: number, volume?: number): Candle {
  return { time: ts, open: px, high: px + 1, low: px - 1, close: px, ...(volume !== undefined ? { volume } : {}) };
}

test("levels: prev H/L/C + pivot from the completed daily bar", () => {
  const l = computeLevels(daily, [bar(RTH_TS, 111, 100)]);
  assert.equal(l.prevHigh, 110);
  assert.equal(l.prevLow, 102);
  assert.equal(l.prevClose, 108);
  assert.ok(Math.abs(l.pivot! - (110 + 102 + 108) / 3) < 1e-9);
  assert.equal(l.price, 111);
  assert.equal(l.asOf, RTH_TS);
});

test("levels: VWAP only with volume — no volume, no VWAP (never approximated)", () => {
  const withVol = computeLevels(daily, [bar(RTH_TS, 110, 100), bar(RTH_TS + 300, 112, 300)]);
  assert.ok(withVol.vwap !== null);
  // typical prices weighted 1:3 → closer to the second bar
  assert.ok(withVol.vwap! > 111);
  const noVol = computeLevels(daily, [bar(RTH_TS, 110), bar(RTH_TS + 300, 112)]);
  assert.equal(noVol.vwap, null);
});

test("levels: overnight H/L needs ≥30min of genuine overnight bars", () => {
  const onBars = Array.from({ length: 8 }, (_, i) => bar(ON_TS + i * 300, 105 + i * 0.1, 10));
  const l = computeLevels(daily, [...onBars, bar(RTH_TS, 111, 100)]);
  assert.ok(l.onHigh !== null && l.onLow !== null);
  assert.ok(l.onHigh! >= 105.7 + 1 - 1e-9); // includes bar highs
  const thin = computeLevels(daily, [bar(ON_TS, 105, 10), bar(RTH_TS, 111, 100)]);
  assert.equal(thin.onHigh, null); // one overnight bar isn't a session
});

test("etMinutes: RTH vs overnight classification", () => {
  assert.equal(etMinutes(RTH_TS), 10 * 60 + 30);
  assert.equal(etMinutes(ON_TS), 4 * 60);
});

test("bias: majority of present inputs; UNAVAILABLE under 2; band is neutral", () => {
  const bull = levelsBias({ price: 112, prevHigh: 110, prevLow: 102, prevClose: 108, pivot: 106.67, vwap: 110.5, onHigh: null, onLow: null, asOf: 1 });
  assert.equal(bull.label, "BULLISH");
  assert.equal(bull.votes.length, 3);
  const bear = levelsBias({ price: 100, prevHigh: 110, prevLow: 102, prevClose: 108, pivot: 106.67, vwap: 105, onHigh: null, onLow: null, asOf: 1 });
  assert.equal(bear.label, "BEARISH");
  const flat = levelsBias({ price: 108.05, prevHigh: 110, prevLow: 102, prevClose: 108, pivot: 108.1, vwap: null, onHigh: null, onLow: null, asOf: 1 });
  assert.equal(flat.label, "NEUTRAL"); // within ±0.1% bands
  const un = levelsBias({ price: 100, prevHigh: null, prevLow: null, prevClose: null, pivot: null, vwap: 101, onHigh: null, onLow: null, asOf: 1 });
  assert.equal(un.label, "UNAVAILABLE"); // one input can't carry a read
  assert.equal(levelsBias({ price: null, prevHigh: 1, prevLow: 1, prevClose: 1, pivot: 1, vwap: 1, onHigh: null, onLow: null, asOf: null }).label, "UNAVAILABLE");
});

test("vix context: sentences generated from the numbers, null without them", () => {
  assert.equal(vixContext(-4.2, 0.8, 1.1), "volatility falling while equities rise — risk appetite holding");
  assert.equal(vixContext(6.1, -1.2, -0.9), "volatility rising as equities fall — hedging demand up");
  assert.equal(vixContext(3.0, 0.9, 0.7), "volatility rising WITH equities — unstable tape, moves distrusted");
  assert.equal(vixContext(-2.0, -0.8, -0.6), "volatility falling as equities fall — an orderly decline, not panic");
  assert.equal(vixContext(0.2, 0.05, -0.02), "volatility flat while equities drift");
  assert.equal(vixContext(null, 1, 1), null);
  assert.equal(vixContext(2, null, null), null);
});
