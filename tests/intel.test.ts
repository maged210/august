// Unit tests for Market Intel's pure logic. Runs on Node's built-in test runner with
// native TypeScript type-stripping (Node 23+/24). No test framework dependency is added.
// Run with `npm test` (which adds tests/ts-resolve.mjs — a tiny in-thread resolve hook
// that lets extensionless relative imports like "./dates" resolve to ".ts" under the
// native runner). Modules under test avoid the "@/" path alias; functions that touch
// live APIs/Redis are covered by tsc + the production build, not unit tests.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseYouTubeUrl, parseDescriptionChapters } from "../lib/intel/youtube.ts";
import { parseManualTranscript } from "../lib/intel/transcript.ts";
import { normalizeChapterTitle } from "../lib/intel/chapters.ts";
import { isStale, marketSession, etDateKey } from "../lib/intel/session.ts";
import { resolveExpiration, dte } from "../lib/intel/dates.ts";
import { computeOptionMetrics, spreadPct } from "../lib/intel/options.ts";
import { rankOption } from "../lib/intel/options-rank.ts";
import type { OptionIdea } from "../lib/intel/types.ts";

test("parseYouTubeUrl: watch URL → video id", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/watch?v=Eo_B71QWJa8"), { kind: "video", videoId: "Eo_B71QWJa8" });
});
test("parseYouTubeUrl: youtu.be short link", () => {
  assert.deepEqual(parseYouTubeUrl("https://youtu.be/m4J0RwYTT_E"), { kind: "video", videoId: "m4J0RwYTT_E" });
});
test("parseYouTubeUrl: /live/ URL", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/live/m4J0RwYTT_E"), { kind: "video", videoId: "m4J0RwYTT_E" });
});
test("parseYouTubeUrl: channel id", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"), { kind: "channelId", channelId: "UCabcdefghijklmnopqrstuv" });
});
test("parseYouTubeUrl: @handle", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/@StockedUp"), { kind: "handle", handle: "StockedUp" });
});
test("parseYouTubeUrl: bare video id", () => {
  assert.deepEqual(parseYouTubeUrl("Eo_B71QWJa8"), { kind: "video", videoId: "Eo_B71QWJa8" });
});
test("parseYouTubeUrl: junk → unknown", () => {
  assert.equal(parseYouTubeUrl("hello world").kind, "unknown");
});

test("parseManualTranscript: preserves timestamps (two-line YT format)", () => {
  const r = parseManualTranscript("0:00\nGood morning traders\n0:12\nSPY looks weak today");
  assert.equal(r.status, "available");
  assert.equal(r.segments?.length, 2);
  assert.equal(r.segments?.[0].startSeconds, 0);
  assert.equal(r.segments?.[1].startSeconds, 12);
  assert.match(r.segments?.[1].text ?? "", /SPY looks weak/);
});
test("parseManualTranscript: inline timestamps with hours", () => {
  const r = parseManualTranscript("1:02:03 closing thoughts here");
  assert.equal(r.segments?.[0].startSeconds, 3723);
});
test("parseManualTranscript: plain prose chunks + flags missing timestamps", () => {
  const r = parseManualTranscript("word ".repeat(200).trim());
  assert.equal(r.status, "available");
  assert.ok((r.segments?.length ?? 0) >= 2);
  assert.match(r.note ?? "", /No timestamps/);
});
test("parseManualTranscript: empty → unavailable", () => {
  assert.equal(parseManualTranscript("").status, "unavailable");
});

test("normalizeChapterTitle: favorite setups → high priority", () => {
  const n = normalizeChapterTitle("Favorite Setups & Predictions");
  assert.equal(n.category, "favorite_setups");
  assert.equal(n.priority, "high");
});
test("normalizeChapterTitle: sponsor → low/advertisement", () => {
  assert.equal(normalizeChapterTitle("Sponsor — use code AUGUST").category, "advertisement");
});
test("normalizeChapterTitle: unknown → unrelated/low", () => {
  assert.equal(normalizeChapterTitle("Random musings").priority, "low");
});

test("parseDescriptionChapters: extracts ordered chapters", () => {
  const ch = parseDescriptionChapters("0:00 Intro\n5:18 Tomorrow's Catalysts\n10:48 Favorite Setups & Predictions");
  assert.equal(ch.length, 3);
  assert.equal(ch[2].startSeconds, 648);
  assert.equal(ch[2].title, "Favorite Setups & Predictions");
});
test("parseDescriptionChapters: a single timestamp is not enough", () => {
  assert.equal(parseDescriptionChapters("3:30 just one line").length, 0);
});

test("isStale: yesterday is stale, now is not", () => {
  assert.equal(isStale(Date.now() - 3 * 86_400_000), true);
  assert.equal(isStale(Date.now()), false);
});
test("marketSession + etDateKey are well-formed", () => {
  assert.ok(["premarket", "regular", "afterhours", "closed"].includes(marketSession()));
  assert.match(etDateKey(), /^\d{4}-\d{2}-\d{2}$/);
});

// ===========================================================================
// PASS 3 — OPTIONS
// ===========================================================================

// Wednesday, 2025-06-25 @ noon ET (16:00Z) — a stable anchor for relative dates.
const BASE = Date.UTC(2025, 5, 25, 16);
const isFriday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay() === 5;

test("resolveExpiration: explicit ISO date passes through (high confidence)", () => {
  const r = resolveExpiration("expires 2025-07-18", BASE);
  assert.equal(r.resolved, "2025-07-18");
  assert.equal(r.confidence, "high");
  assert.match(r.text, /2025-07-18/); // original wording preserved
});

test("resolveExpiration: 'this Friday' resolves to the coming Friday", () => {
  const r = resolveExpiration("this Friday", BASE);
  assert.equal(r.resolved, "2025-06-27");
  assert.ok(isFriday(r.resolved!));
});

test("resolveExpiration: 'next Friday' is a week later, still a Friday", () => {
  const r = resolveExpiration("next Friday", BASE);
  assert.equal(r.resolved, "2025-07-04");
  assert.ok(isFriday(r.resolved!));
});

test("resolveExpiration: unsafe wording → resolved null (never invents a date)", () => {
  const r = resolveExpiration("sometime soon", BASE);
  assert.equal(r.resolved, null);
  assert.equal(r.confidence, "none");
});

test("resolveExpiration: 0DTE on a weekday resolves to the base day", () => {
  const r = resolveExpiration("0DTE", BASE);
  assert.equal(r.resolved, "2025-06-25");
  assert.equal(r.confidence, "high");
});

test("resolveExpiration: 0DTE on a weekend is low confidence", () => {
  const sat = Date.UTC(2025, 5, 28, 16); // Saturday
  assert.equal(resolveExpiration("0dte", sat).confidence, "low");
});

test("dte: trading days to an ISO expiration", () => {
  assert.equal(dte("2025-06-30", BASE), 5);
  assert.equal(dte(null, BASE), null);
});

// --- options math (per single contract, ×100) -----------------------------
const leg = (over: Partial<{ action: "buy" | "sell"; optionType: "call" | "put"; strike: number; premium: number | null }>) => ({
  action: over.action ?? "buy",
  optionType: over.optionType ?? "call",
  quantity: 1,
  strike: over.strike ?? null,
  expiration: null,
  contractSymbol: null,
  premium: over.premium ?? null,
});

test("computeOptionMetrics: long call — breakeven & capped loss, unlimited upside", () => {
  const m = computeOptionMetrics("long_call", [leg({ optionType: "call", strike: 100, premium: 5 })]);
  assert.deepEqual(m.breakevens, [105]);
  assert.equal(m.maxLoss, 500);
  assert.equal(m.maxProfit, null); // unlimited
});

test("computeOptionMetrics: long put — defined max profit & loss", () => {
  const m = computeOptionMetrics("long_put", [leg({ optionType: "put", strike: 100, premium: 4 })]);
  assert.deepEqual(m.breakevens, [96]);
  assert.equal(m.maxLoss, 400);
  assert.equal(m.maxProfit, 9600);
});

test("computeOptionMetrics: call debit spread — width-minus-net profit, net-debit loss", () => {
  const m = computeOptionMetrics("call_debit_spread", [
    leg({ action: "buy", optionType: "call", strike: 100, premium: 5 }),
    leg({ action: "sell", optionType: "call", strike: 105, premium: 2 }),
  ]);
  assert.equal(m.maxLoss, 300); // net debit 3 ×100
  assert.equal(m.maxProfit, 200); // (5 width − 3) ×100
  assert.deepEqual(m.breakevens, [103]);
});

test("computeOptionMetrics: missing premium → nothing computed (no fabrication)", () => {
  const m = computeOptionMetrics("long_call", [leg({ optionType: "call", strike: 100, premium: null })]);
  assert.deepEqual(m.breakevens, []);
  assert.equal(m.maxLoss, null);
  assert.equal(m.maxProfit, null);
});

test("computeOptionMetrics: missing strike → nothing computed", () => {
  const m = computeOptionMetrics("long_call", [leg({ optionType: "call", strike: undefined, premium: 5 })]);
  assert.deepEqual(m.breakevens, []);
});

test("spreadPct: relative bid/ask spread, null when unpriced", () => {
  assert.equal(spreadPct({ bid: 1, ask: 1.2, mid: 1.1 } as never), 0.182);
  assert.equal(spreadPct({ bid: null, ask: 1.2, mid: 1.1 } as never), null);
  assert.equal(spreadPct(null), null);
});

// --- transparent ranking --------------------------------------------------
function mkOption(over: Partial<OptionIdea> = {}): OptionIdea {
  return {
    id: "oi_test",
    underlyingSymbol: "NVDA",
    direction: "bullish",
    strategyType: "long_call",
    origin: "creator_explicit",
    creatorSpecifiedContract: true,
    timeHorizon: "swing",
    legs: [{ action: "buy", optionType: "call", quantity: 1, strike: 120, expiration: "2025-07-18", contractSymbol: null }],
    entryCondition: { type: "unspecified", value: null, text: "" },
    underlyingTrigger: 118,
    underlyingInvalidation: 112,
    underlyingTargets: [130],
    expirationText: { text: "July 18", resolved: "2025-07-18", confidence: "high" },
    quotedPremium: 4,
    contractQuote: null,
    breakevens: [124],
    maxProfit: null,
    maxLoss: 400,
    riskRewardRatio: null,
    catalysts: ["earnings"],
    risks: [],
    optionsRisk: { liquidity: null, thetaDecay: null, volatility: null, earnings: null, assignment: null, staleness: null },
    conviction: "standard",
    confidence: 0.7,
    explicitness: "explicit",
    status: "watching",
    sourceChapterId: null,
    sourceSegmentIds: ["s1"],
    sourceStartSeconds: 10,
    sourceEndSeconds: 20,
    ...over,
  };
}

test("rankOption: returns a 0..100 score with shown factors that sum to it", () => {
  const { score, factors } = rankOption(mkOption(), { sourcesForSymbol: 2, newest: BASE, publishedAt: BASE });
  assert.ok(score >= 0 && score <= 100, `score in range, got ${score}`);
  assert.ok(factors.length >= 6, "every weighted factor is shown");
  const summed = Math.round(factors.reduce((a, f) => a + f.weight, 0));
  assert.equal(summed, score); // the score is exactly the shown breakdown — no hidden term
});

test("rankOption: an invalidated setup is penalized", () => {
  const live = rankOption(mkOption(), { sourcesForSymbol: 2, newest: BASE, publishedAt: BASE }).score;
  const dead = rankOption(mkOption({ status: "invalidated" }), { sourcesForSymbol: 2, newest: BASE, publishedAt: BASE }).score;
  assert.ok(dead < live, `invalidated (${dead}) should rank below live (${live})`);
});

test("rankOption: explicit creator contract beats a bare directional thesis", () => {
  const explicit = rankOption(mkOption(), { sourcesForSymbol: 1, newest: BASE, publishedAt: BASE }).score;
  const directional = rankOption(
    mkOption({ origin: "directional_only", creatorSpecifiedContract: false, explicitness: "inferred", legs: [{ action: "buy", optionType: "call", quantity: 1, strike: null, expiration: null, contractSymbol: null }], breakevens: [], maxLoss: null }),
    { sourcesForSymbol: 1, newest: BASE, publishedAt: BASE },
  ).score;
  assert.ok(explicit > directional, `explicit ${explicit} > directional ${directional}`);
});
