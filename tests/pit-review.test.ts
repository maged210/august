// lib/pit-review — R3 post-trade explanations: observable facts only,
// deterministic, dry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { explainTrades } from "../lib/pit-review";
import type { GameEvent, Stock, TradeMark } from "../lib/pit-engine";

// a hand-built tape: rises 100→110 over 100 ticks, then falls to 104
const prices = [
  ...Array.from({ length: 100 }, (_, i) => 100 + i * 0.1),
  ...Array.from({ length: 60 }, (_, i) => 110 - i * 0.1),
];
const stocks: Stock[] = [{ ticker: "NVDA", prices }];
const tps = 6;

function ev(at: number, label: string, misleading = false): GameEvent {
  return {
    id: 1, kind: "news", scope: "stock", stocks: [0], at, clueAt: null,
    windowTicks: 0, label, eyebrow: "BREAKING", headlineDir: 1,
    actualDir: misleading ? -1 : 1, misleading, mag: 3, hit: false,
  };
}

test("review: entry near the low + exit before the event window", () => {
  const log: TradeMark[] = [
    { s: 0, tick: 2, price: prices[2], dir: 1, kind: "open" },
    { s: 0, tick: 60, price: prices[60], dir: 1, kind: "close", gain: 5.7 },
  ];
  const reviews = explainTrades(stocks, [ev(90, "GUIDANCE CUT")], log, { tps });
  assert.equal(reviews.length, 1);
  assert.match(reviews[0].text, /^LONG NVDA \+5\.7%/);
  // tick-2 range is degenerate — no entry-quality claim may fire
  assert.ok(!/session low|session high/.test(reviews[0].text));
  assert.match(reviews[0].text, /exited 5s before the GUIDANCE CUT window/);
});

test("review: held through a lying headline; hindsight stated dryly", () => {
  const log: TradeMark[] = [
    { s: 0, tick: 10, price: prices[10], dir: 1, kind: "open" },
    { s: 0, tick: 98, price: prices[98], dir: 1, kind: "close", gain: 8.6 },
  ];
  const reviews = explainTrades(stocks, [ev(50, "EARNINGS BEAT", true)], log, { tps });
  assert.match(reviews[0].text, /held through the EARNINGS BEAT print \(the headline lied\)/);
  // exit at the top before the fall: the exit dodged the drop
  const r2 = explainTrades(stocks, [], log, { tps });
  assert.match(r2[0].text, /dodged/);
});

test("review: adverse excursion is called out; unmatched closes skipped", () => {
  // short opened at the bottom of the rise — rides +X% against before the fall
  const log: TradeMark[] = [
    { s: 0, tick: 5, price: prices[5], dir: -1, kind: "open" },
    { s: 0, tick: 130, price: prices[130], dir: -1, kind: "close", gain: -2.7 },
  ];
  const reviews = explainTrades(stocks, [], log, { tps });
  assert.match(reviews[0].text, /sat through -9\.\d% against the position/);
  assert.deepEqual(explainTrades(stocks, [], [{ s: 0, tick: 5, price: 1, dir: 1, kind: "close", gain: 1 }], { tps }), []);
});

test("review: deterministic — same inputs, same lines", () => {
  const log: TradeMark[] = [
    { s: 0, tick: 2, price: prices[2], dir: 1, kind: "open" },
    { s: 0, tick: 60, price: prices[60], dir: 1, kind: "close", gain: 5.7 },
  ];
  assert.deepEqual(explainTrades(stocks, [], log, { tps }), explainTrades(stocks, [], log, { tps }));
});
