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
import { computeOptionMetrics, spreadPct, quoteFromContract, providerStatusForHttp, type NormalizedContract } from "../lib/intel/options.ts";
import { rankOption } from "../lib/intel/options-rank.ts";
import { normalizeOptionIdea, numberSupported, type RawOptionIdea } from "../lib/intel/normalize.ts";
import { pickExpiration, passesLiquidity, effLiquidity, priceOf, convictionFor } from "../lib/intel/candidates.ts";
import { mergeOptionSettings } from "../lib/intel/option-settings.ts";
import { redactBrief } from "../lib/intel/redact.ts";
import { DEFAULT_OPTION_CANDIDATE_SETTINGS } from "../lib/intel/types.ts";
import type { BriefIdea, DailyBrief, OptionIdea } from "../lib/intel/types.ts";

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

test("dte: calendar days to an ISO expiration", () => {
  assert.equal(dte("2025-06-30", BASE), 5); // calendar delta, not weekend-aware
  assert.equal(dte(null, BASE), null);
});

test("resolveExpiration: impossible day (2/30) is not resolved (no fabricated ISO)", () => {
  assert.equal(resolveExpiration("2/30", BASE).resolved, null);
  assert.equal(resolveExpiration("7/3", BASE).resolved, "2025-07-03"); // valid M/D still works
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

// --- options math: credit spread / put debit / net<=0 (sign-convention guards) -----
test("computeOptionMetrics: call credit spread — credit profit, width-minus-credit loss", () => {
  const m = computeOptionMetrics("call_credit_spread", [
    leg({ action: "sell", optionType: "call", strike: 100, premium: 5 }),
    leg({ action: "buy", optionType: "call", strike: 105, premium: 2 }),
  ]);
  assert.equal(m.maxProfit, 300); // net credit 3 ×100
  assert.equal(m.maxLoss, 200); // (5 width − 3) ×100
  assert.deepEqual(m.breakevens, [103]); // min strike + credit
});

test("computeOptionMetrics: put debit spread — breakeven below the long strike", () => {
  const m = computeOptionMetrics("put_debit_spread", [
    leg({ action: "buy", optionType: "put", strike: 100, premium: 5 }),
    leg({ action: "sell", optionType: "put", strike: 95, premium: 2 }),
  ]);
  assert.equal(m.maxLoss, 300);
  assert.equal(m.maxProfit, 200);
  assert.deepEqual(m.breakevens, [97]); // max strike − net debit
});

test("computeOptionMetrics: a non-positive net spread yields nothing (no nonsense math)", () => {
  const m = computeOptionMetrics("call_debit_spread", [
    leg({ action: "buy", optionType: "call", strike: 100, premium: 2 }),
    leg({ action: "sell", optionType: "call", strike: 105, premium: 5 }),
  ]);
  assert.deepEqual(m.breakevens, []);
  assert.equal(m.maxLoss, null);
});

// --- provider helpers ----------------------------------------------------
test("quoteFromContract: Greeks are ALWAYS null (provider supplies none)", () => {
  const c: NormalizedContract = { contractSymbol: "X", strike: 100, type: "call", bid: 1, ask: 1.2, mid: 1.1, last: 1.1, volume: 5, openInterest: 9, impliedVolatility: 0.5 };
  const q = quoteFromContract(c, true, 123);
  assert.equal(q.delta, null);
  assert.equal(q.gamma, null);
  assert.equal(q.theta, null);
  assert.equal(q.vega, null);
  assert.equal(q.delayed, true);
  assert.equal(q.quoteTimestamp, 123);
});

test("providerStatusForHttp: honest mapping of HTTP status → provider state", () => {
  assert.equal(providerStatusForHttp(401), "unauthorized");
  assert.equal(providerStatusForHttp(403), "unauthorized");
  assert.equal(providerStatusForHttp(429), "rate_limited");
  assert.equal(providerStatusForHttp(404), "unsupported_symbol");
  assert.equal(providerStatusForHttp(200), "delayed");
  assert.equal(providerStatusForHttp(500), "provider_error");
});

// --- candidate decision helpers (controls must be honored; 0DTE off) ------
const contract = (over: Partial<NormalizedContract>): NormalizedContract => ({
  contractSymbol: "C", strike: 100, type: "call", bid: null, ask: null, mid: null, last: null, volume: null, openInterest: null, impliedVolatility: null, ...over,
});
const epoch = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

test("pickExpiration: 0DTE excluded by default; nearest-to-band-midpoint chosen", () => {
  const exps = [epoch(2025, 6, 25), epoch(2025, 6, 26), epoch(2025, 7, 5), epoch(2025, 7, 25), epoch(2025, 8, 24)]; // 0,1,10,30,60 DTE
  const pick = pickExpiration(exps, DEFAULT_OPTION_CANDIDATE_SETTINGS, BASE); // band 7..45, mid 26
  assert.equal(pick?.dte, 30); // 30 is the in-band expiry closest to 26
  assert.equal(pick?.iso, "2025-07-25");
});

test("pickExpiration: a 0DTE-only chain returns null unless allow0DTE is set", () => {
  const only0 = [epoch(2025, 6, 25)];
  assert.equal(pickExpiration(only0, DEFAULT_OPTION_CANDIDATE_SETTINGS, BASE), null);
  assert.equal(pickExpiration(only0, { ...DEFAULT_OPTION_CANDIDATE_SETTINGS, allow0DTE: true }, BASE)?.dte, 0);
});

test("effLiquidity: open interest when present, else today's volume", () => {
  assert.deepEqual(effLiquidity(contract({ openInterest: 300, volume: 10 })), { value: 300, basis: "oi" });
  assert.deepEqual(effLiquidity(contract({ openInterest: 0, volume: 120 })), { value: 120, basis: "volume" });
});

test("priceOf: mid in RTH, last after hours, null when neither", () => {
  assert.deepEqual(priceOf(contract({ mid: 1.2, last: 1.0 })), { value: 1.2, basis: "mid" });
  assert.deepEqual(priceOf(contract({ mid: 0, last: 3 })), { value: 3, basis: "last" });
  assert.deepEqual(priceOf(contract({ mid: 0, last: 0 })), { value: null, basis: null });
});

test("passesLiquidity: OI gate with volume fallback, spread gate only when two-sided, price required", () => {
  const s = DEFAULT_OPTION_CANDIDATE_SETTINGS; // minOI 100, minVol 0, maxSpread 0.15
  // tight two-sided market, OI met → passes
  assert.equal(passesLiquidity(contract({ openInterest: 200, bid: 0.98, ask: 1.02, mid: 1.0 }), s), true);
  // wide spread on a real two-sided market → rejected
  assert.equal(passesLiquidity(contract({ openInterest: 200, bid: 0.8, ask: 1.2, mid: 1.0 }), s), false);
  // after-hours (bid/ask 0) but real OI + a last price → spread gate skipped, passes
  assert.equal(passesLiquidity(contract({ openInterest: 200, bid: 0, ask: 0, mid: 0, last: 5 }), s), true);
  // OI below floor with no volume → rejected
  assert.equal(passesLiquidity(contract({ openInterest: 50, volume: 0, mid: 1 }), s), false);
  // overnight: OI 0 and only thin volume → effective liquidity below floor → rejected
  assert.equal(passesLiquidity(contract({ openInterest: 0, volume: 40, mid: 1 }), s), false);
});

test("convictionFor: short-dated = lotto, cheap = speculative, else standard", () => {
  assert.equal(convictionFor(500, 1), "lotto");
  assert.equal(convictionFor(50, 30), "speculative");
  assert.equal(convictionFor(200, 30), "standard");
});

// --- the anti-hallucination gate (normalize.ts) ---------------------------
const rawOpt = (over: Partial<RawOptionIdea> = {}): RawOptionIdea => ({
  underlyingSymbol: "NVDA",
  direction: "bullish",
  strategyType: "long_call",
  origin: "directional_only",
  timeHorizon: "swing",
  legs: [{ action: "buy", optionType: "call", strike: null }],
  confidence: 0.6,
  explicitness: "inferred",
  sourceSegmentIds: ["s1"],
  ...over,
});

test("numberSupported: only numbers literally in the cited text are supported", () => {
  assert.equal(numberSupported(120, "I like the 120 calls"), true);
  assert.equal(numberSupported(999, "I like calls"), false);
  assert.equal(numberSupported(null, "anything"), true);
});

test("normalizeOptionIdea: a strike NOT in the transcript is dropped to null (never invented)", () => {
  const n = normalizeOptionIdea(rawOpt({ creatorSpecifiedContract: true, legs: [{ action: "buy", optionType: "call", strike: 999 }] }), "NVDA", "NVDA calls into earnings", BASE);
  assert.equal(n.legs[0].strike, null);
  assert.equal(n.creatorSpecifiedContract, false); // nothing concrete survived
  assert.ok(n.warnings.some((w) => w.includes("999")));
});

test("normalizeOptionIdea: a strike the creator actually said is kept", () => {
  const n = normalizeOptionIdea(rawOpt({ creatorSpecifiedContract: true, legs: [{ action: "buy", optionType: "call", strike: 120 }] }), "NVDA", "grab the 120 calls", BASE);
  assert.equal(n.legs[0].strike, 120);
  assert.equal(n.creatorSpecifiedContract, true);
});

test("normalizeOptionIdea: bullish does NOT force calls — legs/strategy are kept as stated", () => {
  const n = normalizeOptionIdea(rawOpt({ direction: "bullish", strategyType: "long_put", legs: [{ action: "buy", optionType: "put", strike: null }] }), "NVDA", "bullish but hedging with puts", BASE);
  assert.equal(n.strategyType, "long_put");
  assert.equal(n.legs[0].optionType, "put");
});

test("normalizeOptionIdea: an unspoken premium is dropped; origin can never become a candidate", () => {
  const n = normalizeOptionIdea(rawOpt({ quotedPremium: 3.5, origin: "august_candidate" as RawOptionIdea["origin"] }), "NVDA", "NVDA calls, no price mentioned", BASE);
  assert.equal(n.quotedPremium, null);
  assert.equal(n.origin, "directional_only"); // a transcript can never mint an august_candidate
});

test("normalizeOptionIdea: an unsupported trigger warns exactly ONCE (no duplicate)", () => {
  const n = normalizeOptionIdea(rawOpt({ underlyingTrigger: 555 }), "NVDA", "NVDA calls", BASE);
  assert.equal(n.underlyingTrigger, null);
  assert.equal(n.warnings.filter((w) => w.includes("555")).length, 1);
});

// --- option-candidate settings validation --------------------------------
test("mergeOptionSettings: rejects wrong types and null on non-nullable numerics", () => {
  const base = DEFAULT_OPTION_CANDIDATE_SETTINGS;
  assert.equal(mergeOptionSettings(base, { allow0DTE: "yes" }).allow0DTE, false); // non-bool ignored
  assert.equal(mergeOptionSettings(base, { allow0DTE: true }).allow0DTE, true);
  assert.equal(mergeOptionSettings(base, { minOpenInterest: null }).minOpenInterest, base.minOpenInterest); // non-nullable, null rejected
  assert.equal(mergeOptionSettings(base, { minOpenInterest: -5 }).minOpenInterest, base.minOpenInterest); // negative rejected
  assert.equal(mergeOptionSettings(base, { maxPremium: null }).maxPremium, null); // nullable cap accepts null
  assert.equal(mergeOptionSettings(base, { maxLossCap: 500 }).maxLossCap, 500);
});

test("mergeOptionSettings: inverted DTE band is swapped so min<=max; unknown keys ignored", () => {
  const out = mergeOptionSettings(DEFAULT_OPTION_CANDIDATE_SETTINGS, { preferredDteMin: 50, preferredDteMax: 10, bogusKey: 1 });
  assert.ok(out.preferredDteMin <= out.preferredDteMax);
  assert.equal(out.preferredDteMin, 10);
  assert.equal(out.preferredDteMax, 50);
  assert.equal("bogusKey" in out, false);
});

// --- source privacy (redact.ts) --------------------------------------------
const mkBriefIdea = (): BriefIdea => ({
  id: "ti_1",
  ticker: "NVDA",
  assetName: "NVIDIA",
  assetType: "equity",
  direction: "bullish",
  timeHorizon: "swing",
  thesis: "Breakout continuation over 120",
  catalysts: ["earnings"],
  entry: { value: 120, type: "price", text: "over 120" },
  invalidation: { value: 112, type: "price", text: "loses 112" },
  targets: [{ value: 130, type: "price", text: "130" }],
  risks: [],
  confidence: 0.8,
  explicitness: "explicit",
  creatorDesignation: { isFavoriteSetup: true, isPrediction: false, isWatchlistMention: false },
  sourceSegmentIds: ["s1"],
  sourceStartSeconds: 61,
  sourceEndSeconds: 88,
  chapter: { title: "Setups", normalizedCategory: "favorite_setups", startSeconds: 60, endSeconds: 90, priority: "high", creatorDefined: true },
  videoId: "vid123",
  channelTitle: "Some Channel",
  videoTitle: "Nightly prep",
  rankScore: 7.5,
  rankFactors: [],
});

const mkBrief = (): DailyBrief => ({
  date: "2026-06-30",
  generatedAt: 1,
  marketSession: "closed",
  posture: "risk-on",
  whatChanged: "",
  whatMattersTomorrow: "",
  read60: "Sixty seconds.",
  bullCase: "",
  bearCase: "",
  watchAtOpen: "",
  invalidation: "",
  topIdeas: [mkBriefIdea()],
  creatorFavorites: [mkBriefIdea()],
  consensus: [{
    ticker: "NVDA",
    direction: "bullish",
    sources: [{ channelTitle: "Some Channel", videoId: "vid123", startSeconds: 61, explicitness: "explicit" }],
    agreement: "single",
    note: "Single source.",
  }],
  levels: [{
    id: "lv1", instrument: "NQ", level: 20000, levelText: "20000", type: "support", explanation: "prior low",
    videoId: "vid123", sourceSegmentIds: ["s2"], sourceStartSeconds: 120, sourceEndSeconds: 130,
  }],
  catalysts: [{
    name: "CPI", eventTime: null, importance: "high", affectedTickers: [], creatorMentioned: true,
    externallyVerified: false, explanation: "", sourceSegmentIds: ["s3"],
  }],
  risks: [],
  sourceVideoIds: ["vid123"],
  grounded: true,
  options: {
    bestCreatorPlays: [],
    augustCandidates: [{ ...mkOption({ origin: "august_candidate", videoId: "vid123" }), channelTitle: "Some Channel", videoTitle: "Nightly prep", rankScore: 50, rankFactors: [] }],
    directionalOnly: [],
    optionsRisk: [],
    providerStatus: "delayed",
    consensus: [],
  },
});

test("redactBrief: no attribution or evidence field survives (exports carry no sources)", () => {
  const json = JSON.stringify(redactBrief(mkBrief()));
  for (const key of ["channelTitle", "videoTitle", "videoId", "sourceSegmentIds", "sourceStartSeconds", "sourceEndSeconds", "sourceChapterId", "chapter"]) {
    assert.equal(json.includes(`"${key}"`), false, `"${key}" must not survive redaction`);
  }
  assert.equal(json.includes("Some Channel"), false);
  assert.equal(json.includes("vid123"), false);
});

test("redactBrief: keeps the tradecraft, empties sourceVideoIds, never mutates input", () => {
  const brief = mkBrief();
  const out = redactBrief(brief);
  assert.equal(out.topIdeas[0].ticker, "NVDA");
  assert.equal(out.topIdeas[0].entry.text, "over 120");
  assert.equal(out.topIdeas[0].rankScore, 7.5);
  assert.equal(out.consensus[0].sources.length, 1); // the agreement signal survives
  assert.equal(out.options?.augustCandidates.length, 1);
  assert.deepEqual(out.sourceVideoIds, []);
  // the stored brief keeps full provenance for the owner
  assert.equal(brief.topIdeas[0].channelTitle, "Some Channel");
  assert.deepEqual(brief.sourceVideoIds, ["vid123"]);
});
