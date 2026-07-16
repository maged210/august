// Unit tests for Market Intel's pure logic. Runs on Node's built-in test runner with
// native TypeScript type-stripping (Node 23+/24). No test framework dependency is added.
// Run with `npm test` (which adds tests/ts-resolve.mjs — a tiny in-thread resolve hook
// that lets extensionless relative imports like "./dates" resolve to ".ts" and maps the
// "@/" path alias to the repo root under the native runner). Functions that touch
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
import { DEFAULT_OPTION_CANDIDATE_SETTINGS } from "../lib/intel/types.ts";
import type { BriefIdea, DailyBrief, IntelSource, IntelVideo, OptionIdea, TradeIdea, VideoAnalysis } from "../lib/intel/types.ts";
import { validateRawShape, ExtractionFailedError } from "../lib/intel/extract.ts";
import {
  ANALYZING_LOCK_MS,
  deriveRowRepair,
  failureRowPatch,
  isProcessingLocked,
  isStrictlyPoorer,
} from "../lib/intel/pipeline.ts";
import { buildIdentityScrubber, intelOwnerView, redactBrief, storeIdentityStrings } from "../lib/intel/redact.ts";
import { deriveIntelAttributionGate, OWNER_EMAIL } from "../lib/user-scope.ts";
import { briefToMarkdown } from "../lib/intel/brief.ts";
import {
  inspectorQuoteView,
  mergeQuotes,
  selQuoteFresh,
  selQuoteUpsert,
  SEL_QUOTE_CAP,
  SEL_QUOTE_STALE_MS,
  type SelQuoteMap,
} from "../lib/intel/selQuotes.ts";
import {
  applyPublish,
  applyUnpublish,
  buildFeedCards,
  FEED_FORBIDDEN_KEYS,
  PUBLIC_ATTRIBUTION,
  PUBLISHED_CAP,
  refreshSnapshots,
  snapshotFromTracked,
  type PublishedEntry,
} from "../lib/intel/publish.ts";
import { applySnapshot, newTrackedIdea } from "../lib/intel/tracker.ts";
import { decideVideoMerge, isSoftDuplicate, normalizeVideoTitle, SOFT_DUP_WINDOW_MS } from "../lib/intel/store.ts";

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
const ATTRIBUTION_KEYS = ["channelTitle", "videoTitle", "videoId", "sourceSegmentIds", "sourceStartSeconds", "sourceEndSeconds", "sourceChapterId", "chapter"];

const mkBriefIdea = (over: Partial<BriefIdea> = {}): BriefIdea => ({
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
  ...over,
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
  for (const key of ATTRIBUTION_KEYS) {
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

// --- prose scrub (redact.ts) — field deletion can't catch attribution the
// --- LLM wrote INTO brief prose (observed leak: a channel name inside
// --- brief.invalidation text). Every string field must come out scrubbed.

test("prose scrub: channel + video names inside LLM prose become 'the source' on every string field", () => {
  const brief = mkBrief();
  brief.invalidation = "Setup dies if the level Some Channel flagged at 112 breaks.";
  brief.whatChanged = "Nightly prep covered a rotation into energy names.";
  brief.read60 = "SOME CHANNEL is bullish NVDA."; // case-insensitive
  brief.topIdeas[0].thesis = "Breakout continuation over 120 per some channel.";
  brief.risks = ["Some Channel disagrees with its own prior take."]; // arrays of strings walk too
  const out = redactBrief(brief);
  const json = JSON.stringify(out);
  assert.equal(/some channel/i.test(json), false, "channel name must not survive in prose");
  assert.equal(/nightly prep/i.test(json), false, "video title must not survive in prose");
  assert.equal(out.invalidation, "Setup dies if the level the source flagged at 112 breaks.");
  assert.equal(out.read60, "the source is bullish NVDA.");
  assert.equal(out.topIdeas[0].thesis, "Breakout continuation over 120 per the source.");
  assert.equal(out.risks[0], "the source disagrees with its own prior take.");
  // OWNER output untouched: redaction is the non-owner branch — the input
  // brief still carries the prose verbatim
  assert.equal(brief.invalidation.includes("Some Channel"), true);
  assert.equal(brief.whatChanged.includes("Nightly prep"), true);
});

test("prose scrub: word-boundary matching never mangles tickers; longest identity wins; <3-char identities dropped", () => {
  const brief = mkBrief();
  brief.topIdeas[0].channelTitle = "Stocked";
  brief.topIdeas[0].videoTitle = "Stocked Weekly Watchlist";
  brief.whatChanged = "per stocked: watch STOCKEDX, then the Stocked Weekly Watchlist recap.";
  const out = redactBrief(brief);
  // "STOCKEDX" contains the identity but is its own token — untouched;
  // the full video title (longest) is replaced whole, not channel-first
  assert.equal(out.whatChanged, "per the source: watch STOCKEDX, then the the source recap.");
  // a 1–2 char identity would mangle ordinary words — the scrubber drops it
  assert.equal(buildIdentityScrubber(["", "  ", "ab"]), null);
  const scrub = buildIdentityScrubber(["Up"]);
  assert.equal(scrub, null);
});

test("prose scrub: STORE identities thread in — names the brief items no longer carry still come out", () => {
  const brief = mkBrief();
  brief.bullCase = "EnergyDeskTV thinks NVDA runs; 'Tuesday Full Recap' has the details.";
  const sources: IntelSource[] = [{
    id: "c1", type: "channel", channelId: "UCabcdefghijklmnopqrstuv", channelTitle: "EnergyDeskTV",
    title: "EnergyDeskTV", url: "https://youtube.com/@EnergyDeskTV", enabled: true,
    created: 0, lastChecked: 0, lastProcessed: 0, status: "active",
  }];
  const videos: IntelVideo[] = [{
    videoId: "v9", sourceId: "c1", channelTitle: "EnergyDeskTV", title: "Tuesday Full Recap",
    publishedAt: 0, liveState: "uploaded", status: "analyzed", transcriptStatus: "available",
    created: 0, updated: 0,
  }];
  const out = redactBrief(brief, storeIdentityStrings(sources, videos));
  const json = JSON.stringify(out);
  assert.equal(/EnergyDeskTV/i.test(json), false);
  assert.equal(/Tuesday Full Recap/i.test(json), false);
  assert.ok(out.bullCase.includes("the source"));
  assert.ok(brief.bullCase.includes("EnergyDeskTV")); // input (owner view) untouched
});

test("prose scrub: the markdown export surface is clean too (redact → briefToMarkdown)", () => {
  const brief = mkBrief();
  brief.read60 = "Some Channel says buy; Nightly prep covers the rest.";
  const md = briefToMarkdown(redactBrief(brief));
  assert.equal(/some channel/i.test(md), false);
  assert.equal(/nightly prep/i.test(md), false);
  assert.equal(/vid123/i.test(md), false);
  assert.ok(md.includes("the source"));
  // the OWNER export is the unredacted branch — prose verbatim
  assert.ok(/some channel/i.test(briefToMarkdown(brief)));
});

// --- selection quotes (selQuotes.ts) — a selected row outside the 30s poll
// --- set (past-day boards, >20-symbol briefs) fetches its ONE symbol into a
// --- separate LRU map merged at read time, so the poll's wholesale
// --- replacement never starves the inspector.

type Q = { price: number; prevClose: number; chgPct: number; closes: number[] };
const mkQuote = (price: number): Q => ({ price, prevClose: price - 1, chgPct: 1, closes: [price - 2, price - 1, price] });

test("selection quote survives a 30s poll replacement tick (merged at read time)", () => {
  let sel: SelQuoteMap<Q> = new Map();
  sel = selQuoteUpsert(sel, "fcel", mkQuote(2.1), 1_000); // lower-case in, canonical key out
  // poll tick 1
  let poll: Record<string, Q> = { NVDA: mkQuote(120) };
  let merged = mergeQuotes(poll, sel);
  assert.equal(merged.FCEL?.price, 2.1);
  assert.equal(merged.NVDA?.price, 120);
  // poll tick 2: the map is REPLACED wholesale (the bug's mechanism) —
  // the selection entry still reads through
  poll = { SPY: mkQuote(500) };
  merged = mergeQuotes(poll, sel);
  assert.equal(merged.FCEL?.price, 2.1);
  assert.equal(merged.NVDA, undefined);
  // overlap: the fresher poll quote wins over the selection entry
  poll = { FCEL: mkQuote(2.5) };
  assert.equal(mergeQuotes(poll, sel).FCEL?.price, 2.5);
});

test("selection map is a bounded LRU: cap evicts oldest, re-upsert refreshes recency", () => {
  let sel: SelQuoteMap<Q> = new Map();
  for (let i = 0; i < SEL_QUOTE_CAP; i++) sel = selQuoteUpsert(sel, `T${i}`, mkQuote(i), i);
  assert.equal(sel.size, SEL_QUOTE_CAP);
  sel = selQuoteUpsert(sel, "T0", mkQuote(99), 100); // refresh the oldest entry…
  sel = selQuoteUpsert(sel, "NEW", mkQuote(7), 101); // …so the overflow evicts T1, not T0
  assert.equal(sel.size, SEL_QUOTE_CAP);
  assert.ok(sel.has("T0"));
  assert.equal(sel.has("T1"), false);
  assert.ok(sel.has("NEW"));
  assert.equal(sel.get("T0")?.quote.price, 99);
  assert.equal(sel.get("T0")?.at, 100); // timestamp refreshed with the quote
});

test("selQuoteFresh: fresh within the 60s TTL, stale past it, symbol case-insensitive", () => {
  const sel = selQuoteUpsert(new Map<string, { quote: Q; at: number }>(), "FCEL", mkQuote(2), 10_000);
  assert.equal(selQuoteFresh(sel, "fcel", 10_000 + SEL_QUOTE_STALE_MS), true);
  assert.equal(selQuoteFresh(sel, "FCEL", 10_001 + SEL_QUOTE_STALE_MS), false); // re-selection refetches
  assert.equal(selQuoteFresh(sel, "MISSING", 10_000), false);
});

test("inspector view contract: a loading treatment ONLY while a fetch is in flight — the permanent pulse is unreachable", () => {
  assert.equal(inspectorQuoteView(true, false), "full");
  assert.equal(inspectorQuoteView(true, true), "full"); // stale-refresh keeps the full body up
  assert.equal(inspectorQuoteView(false, true), "loading"); // genuinely in flight — resolves by construction
  // no quote + nothing in flight can NEVER present as loading: the ∅
  // null-quote inspector body renders (thesis, levels, lifecycle, evidence,
  // PUBLISH — live-price block absent-treated with RETRY QUOTE)
  assert.equal(inspectorQuoteView(false, false), "noquote");
});

// --- publish + public feed (publish.ts) -------------------------------------
const T0 = Date.UTC(2026, 0, 5, 15);

test("snapshotFromTracked: whitelist only — captures the core, carries zero source linkage", () => {
  const t = newTrackedIdea(mkBriefIdea(), T0);
  const snap = snapshotFromTracked(t);
  const json = JSON.stringify(snap);
  for (const key of [...ATTRIBUTION_KEYS, "sourceRefs", "conflictKey", "ideaIds"]) {
    assert.equal(json.includes(`"${key}"`), false, `"${key}" must not appear in a publish snapshot`);
  }
  assert.equal(snap.ticker, "NVDA");
  assert.equal(snap.statedLevels.trigger?.value, 120);
  assert.equal(snap.firstMentionAt, T0);
  assert.equal(snap.statusAtPublish, "ARMED");
});

test("applyPublish: idempotent, and an unknown tracked id is rejected (never invented)", () => {
  const t = newTrackedIdea(mkBriefIdea(), T0);
  const first = applyPublish([], [t], t.id, T0 + 1);
  assert.ok(first.ok && !first.already && first.entries.length === 1);
  const again = applyPublish(first.ok ? first.entries : [], [t], t.id, T0 + 2);
  assert.ok(again.ok && again.already && again.entries.length === 1);
  assert.equal(again.ok && again.entries[0].publishedAt, T0 + 1); // original publish time survives
  const missing = applyPublish([], [t], "nope", T0);
  assert.deepEqual(missing, { ok: false, error: "tracked_not_found" });
});

test("applyPublish: cap holds at PUBLISHED_CAP — oldest published falls out", () => {
  const t = newTrackedIdea(mkBriefIdea(), T0);
  const snap = snapshotFromTracked(t);
  const entries: PublishedEntry[] = Array.from({ length: PUBLISHED_CAP }, (_, i) => ({
    trackedId: `old_${i}`,
    publishedAt: i + 1,
    snapshot: snap,
  }));
  const res = applyPublish(entries, [t], t.id, T0);
  assert.ok(res.ok && !res.already);
  assert.equal(res.ok && res.entries.length, PUBLISHED_CAP);
  assert.equal(res.ok && res.evicted.length, 1);
  assert.equal(res.ok && res.evicted[0].trackedId, "old_0"); // oldest publishedAt out
  assert.ok(res.ok && res.entries.some((e) => e.trackedId === t.id));
});

test("applyUnpublish: idempotent — reports whether anything was removed", () => {
  const t = newTrackedIdea(mkBriefIdea(), T0);
  const pub = applyPublish([], [t], t.id, T0);
  const entries = pub.ok ? pub.entries : [];
  const removed = applyUnpublish(entries, t.id);
  assert.equal(removed.removed, true);
  assert.equal(removed.entries.length, 0);
  const again = applyUnpublish(removed.entries, t.id);
  assert.equal(again.removed, false);
});

test("feed: serialized JSON carries ZERO source attribution; attribution is fixed to AUGUST DESK", () => {
  const armed = newTrackedIdea(mkBriefIdea(), T0);
  const triggered = { ...applySnapshot(armed, { at: T0 + 10_000, price: 121 }, { force: true }), conflictKey: "Some Channel|NVDA|bullish" };
  assert.equal(triggered.status, "TRIGGERED"); // precondition: real transition, real history
  const pub = applyPublish([], [triggered], triggered.id, T0 + 20_000);
  const cards = buildFeedCards(pub.ok ? pub.entries : [], [triggered], {
    NVDA: { price: 121.5, prevClose: 118, chgPct: 2.9, closes: [118, 120, 121.5] },
  });
  assert.equal(cards.length, 1);
  const json = JSON.stringify(cards);
  for (const key of FEED_FORBIDDEN_KEYS) {
    assert.equal(json.includes(`"${key}"`), false, `"${key}" must not appear in the public feed`);
  }
  assert.equal(json.includes("Some Channel"), false);
  assert.equal(json.includes("vid123"), false);
  const card = cards[0];
  assert.equal(card.attribution, PUBLIC_ATTRIBUTION);
  assert.equal(card.conflict, true); // the marker survives; the key (with the channel) does not
  assert.equal(card.status, "TRIGGERED");
  assert.equal(card.pnl?.kind, "since_called"); // P&L only from the STATED trigger
  assert.equal(card.quote?.price, 121.5);
  assert.ok(card.statusHistory.length >= 2 && card.priceHistory.length === 1);
});

test("feed: identity prose scrub — a channel/video name inside thesis or level text never reaches the public feed", () => {
  const idea = mkBriefIdea({
    thesis: "Breakout continuation over 120 — Some Channel's favorite setup from Nightly prep.",
    entry: { value: 120, type: "price", text: "over 120, the level Some Channel flagged" },
  });
  const t = newTrackedIdea(idea, T0);
  const pub = applyPublish([], [t], t.id, T0 + 1);
  const sources: IntelSource[] = [{
    id: "c1", type: "channel", channelId: "UCsomechannelidxxxxxxxxx", channelTitle: "Some Channel",
    title: "Some Channel", url: "https://youtube.com/@somechannel", enabled: true,
    created: 0, lastChecked: 0, lastProcessed: 0, status: "active",
  }];
  const videos: IntelVideo[] = [{
    videoId: "vid123", sourceId: "c1", channelTitle: "Some Channel", title: "Nightly prep",
    publishedAt: 0, liveState: "uploaded", status: "analyzed", transcriptStatus: "available",
    created: 0, updated: 0,
  }];
  const cards = buildFeedCards(pub.ok ? pub.entries : [], [t], {}, storeIdentityStrings(sources, videos));
  assert.equal(cards.length, 1);
  const json = JSON.stringify(cards);
  assert.equal(/some channel/i.test(json), false, "channel name must not survive in feed prose");
  assert.equal(/nightly prep/i.test(json), false, "video title must not survive in feed prose");
  assert.equal(cards[0].thesis, "Breakout continuation over 120 — the source's favorite setup from the source.");
  assert.equal(cards[0].statedLevels.trigger?.text, "over 120, the level the source flagged");
  assert.equal(cards[0].ticker, "NVDA"); // tickers/structure untouched
  assert.equal(cards[0].attribution, PUBLIC_ATTRIBUTION);
  // owner-side tracker input untouched (redaction is a wire concern)
  assert.ok(t.thesis.includes("Some Channel"));
  // no identities threaded (store hiccup) → cards still build, keys still stripped
  const unscrubbed = buildFeedCards(pub.ok ? pub.entries : [], [t]);
  assert.equal(unscrubbed.length, 1);
});

test("feed: an evicted tracker row renders from the snapshot — stale-marked, nothing invented", () => {
  const t = newTrackedIdea(mkBriefIdea(), T0);
  const pub = applyPublish([], [t], t.id, T0 + 1);
  const cards = buildFeedCards(pub.ok ? pub.entries : [], []); // tracker row gone
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.live, false);
  assert.equal(card.evicted, true);
  assert.equal(card.stale, true);
  assert.equal(card.status, "ARMED"); // last known state, from the snapshot
  assert.equal(card.pnl, null); // absent data stays absent
  assert.equal(card.lastQuote, null);
  assert.deepEqual(card.statusHistory, []);
  assert.deepEqual(card.priceHistory, []);
  assert.equal(card.extremes, null);
  assert.equal(card.ticker, "NVDA");
  assert.equal(card.statedLevels.trigger?.value, 120);
});

test("refreshSnapshots: lastKnownStatus follows the live row, so eviction shows real last state", () => {
  const armed = newTrackedIdea(mkBriefIdea(), T0);
  const pub = applyPublish([], [armed], armed.id, T0 + 1);
  const entries = pub.ok ? pub.entries : [];
  const triggered = applySnapshot(armed, { at: T0 + 10_000, price: 121 }, { force: true });
  const refreshed = refreshSnapshots(entries, new Map([[triggered.id, triggered]]));
  assert.equal(refreshed.changed, true);
  assert.equal(refreshed.entries[0].snapshot.lastKnownStatus, "TRIGGERED");
  const again = refreshSnapshots(refreshed.entries, new Map([[triggered.id, triggered]]));
  assert.equal(again.changed, false);
  const cards = buildFeedCards(refreshed.entries, []); // now evicted
  assert.equal(cards[0].status, "TRIGGERED");
});

test("feed sort: TRIGGERED → ARMED → ACTIVE → terminal, deterministic id tie-break", () => {
  const armedA = newTrackedIdea(mkBriefIdea({ id: "t_a2", ticker: "AAA" }), T0);
  const armedB = newTrackedIdea(mkBriefIdea({ id: "t_a9", ticker: "BBB" }), T0);
  const trig = applySnapshot(newTrackedIdea(mkBriefIdea({ id: "t_trig", ticker: "CCC" }), T0), { at: T0 + 10_000, price: 121 }, { force: true });
  const active = newTrackedIdea(mkBriefIdea({ id: "t_act", ticker: "DDD", entry: { value: null, type: "unspecified", text: "Not specified" } }), T0);
  let hit = applySnapshot(newTrackedIdea(mkBriefIdea({ id: "t_hit", ticker: "EEE" }), T0), { at: T0 + 10_000, price: 121 }, { force: true });
  hit = applySnapshot(hit, { at: T0 + 20_000, price: 131 }, { force: true });
  assert.equal(hit.status, "TARGET_HIT");
  const tracked = [armedA, armedB, trig, active, hit];
  let entries: PublishedEntry[] = [];
  for (const t of [hit, active, armedB, armedA, trig]) {
    const r = applyPublish(entries, tracked, t.id, T0 + 100); // identical publish time → id tie-break
    entries = r.ok ? r.entries : entries;
  }
  const order = buildFeedCards(entries, tracked).map((c) => `${c.status}:${c.id}`);
  assert.deepEqual(order, ["TRIGGERED:t_trig", "ARMED:t_a2", "ARMED:t_a9", "ACTIVE:t_act", "TARGET_HIT:t_hit"]);
});

// --- video soft-dedup (store.ts pure helpers) --------------------------------
const mkVideo = (over: Partial<IntelVideo> = {}): IntelVideo => ({
  videoId: "v_orig",
  sourceId: "UC1",
  channelId: "UC1",
  channelTitle: "Chan",
  title: "Morning LIVE: SPY levels 6/25",
  publishedAt: T0,
  liveState: "uploaded",
  status: "transcript_pending",
  transcriptStatus: "pending",
  created: T0,
  updated: T0,
  ...over,
});

test("normalizeVideoTitle: case/punctuation/whitespace/emoji-insensitive key", () => {
  assert.equal(normalizeVideoTitle("  Morning LIVE: SPY levels — 6/25!! \u{1F534}"), normalizeVideoTitle("morning live spy levels 6 25"));
  assert.notEqual(normalizeVideoTitle("SPY levels 6/25"), normalizeVideoTitle("SPY levels 6/26"));
  assert.equal(normalizeVideoTitle("\u{1F534}\u{1F534}"), ""); // symbols-only titles never match anything
});

test("decideVideoMerge: richer status wins regardless of argument order", () => {
  const analyzed = mkVideo({ videoId: "vA", status: "analyzed" });
  const pending = mkVideo({ videoId: "vB", status: "transcript_pending", publishedAt: T0 + 3_600_000 });
  assert.equal(decideVideoMerge(analyzed, pending)?.keep.videoId, "vA");
  assert.equal(decideVideoMerge(pending, analyzed)?.keep.videoId, "vA");
  const ready = mkVideo({ videoId: "vC", status: "transcript_ready" });
  assert.equal(decideVideoMerge(ready, pending)?.keep.videoId, "vC"); // analyzed > transcript_ready > pending
  const older = mkVideo({ videoId: "vD", created: T0 - 1 });
  assert.equal(decideVideoMerge(older, mkVideo({ videoId: "vE" }))?.keep.videoId, "vD"); // tie → older record
});

test("decideVideoMerge: only same-channel same-title twins inside the 48h window", () => {
  const base = mkVideo({ videoId: "v1" });
  assert.equal(decideVideoMerge(base, mkVideo({ videoId: "v2", publishedAt: T0 + SOFT_DUP_WINDOW_MS + 1 })), null); // outside window
  assert.equal(decideVideoMerge(base, mkVideo({ videoId: "v3", channelId: "UC2" })), null); // different channel
  assert.equal(decideVideoMerge(base, mkVideo({ videoId: "v4", channelId: undefined })), null); // unknown channel never merges
  assert.equal(decideVideoMerge(base, mkVideo({ videoId: "v5", title: "totally different show" })), null);
  assert.equal(decideVideoMerge(base, base), null); // same id is not a twin
  assert.equal(isSoftDuplicate(base, mkVideo({ videoId: "v6", publishedAt: T0 + SOFT_DUP_WINDOW_MS })), true); // boundary inclusive
});

// ── pipeline honesty: extraction failures are loud, never empty "analyzed" ──

const mkAnalysis = (over: Partial<VideoAnalysis> = {}): VideoAnalysis => ({
  videoId: "v_orig",
  analysisVersion: "3",
  marketDate: "2026-07-15",
  publishedAt: "2026-07-15T12:00:00.000Z",
  pass: "full",
  overallSummary: "Creator sees chop into CPI.",
  marketRegime: { label: "mixed", explanation: "", confidence: 0.5 },
  claims: [],
  tradeIdeas: [],
  optionIdeas: [],
  levels: [],
  catalysts: [],
  risks: [],
  watchItems: [],
  openQuestions: [],
  warnings: [],
  generatedAt: Date.now(),
  ...over,
});
const stubIdeas = (n: number) => Array.from({ length: n }, () => ({} as TradeIdea));
const stubLevels = (n: number) => Array.from({ length: n }, () => ({} as VideoAnalysis["levels"][number]));

test("validateRawShape: well-formed tool input passes; empty-but-valid input passes (0-idea success is legal)", () => {
  const good = validateRawShape({ overallSummary: "s", marketRegime: { label: "mixed" }, claims: [], tradeIdeas: [], levels: [], catalysts: [] });
  assert.equal(good.ok, true);
  // model genuinely found nothing — shape-valid; honesty is decided downstream
  assert.equal(validateRawShape({ overallSummary: "quiet tape", claims: [], tradeIdeas: [], levels: [], catalysts: [] }).ok, true);
});

test("validateRawShape: truncation-mangled input (claims not an array) is a chunk failure, not a crash", () => {
  // real-world crash from the logs: "(raw.claims ?? []).filter is not a function"
  const bad = validateRawShape({ overallSummary: "s", claims: "SPY is heavy" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, "claims_not_array");
  const badIdeas = validateRawShape({ tradeIdeas: { ticker: "SPY" } });
  assert.equal(badIdeas.ok, false);
  if (!badIdeas.ok) assert.equal(badIdeas.reason, "tradeIdeas_not_array");
});

test("validateRawShape: non-object inputs are rejected", () => {
  assert.equal(validateRawShape(null).ok, false);
  assert.equal(validateRawShape("truncated json").ok, false);
  assert.equal(validateRawShape([1, 2]).ok, false);
  assert.equal(validateRawShape({ overallSummary: 42 }).ok, false);
});

test("ExtractionFailedError: carries the honest prefix + detail for the video row", () => {
  const e = new ExtractionFailedError("all 2 extraction call(s) failed: output truncated (max_tokens)");
  assert.ok(e instanceof Error);
  assert.match(e.message, /^AI extraction failed — /);
  assert.match(e.message, /max_tokens/);
});

test("isStrictlyPoorer: only the truncation signature (BOTH counts shrink) blocks an overwrite", () => {
  assert.equal(isStrictlyPoorer({ ideas: 4, levels: 0 }, { ideas: 11, levels: 7 }), true); // observed clobber shape
  assert.equal(isStrictlyPoorer({ ideas: 9, levels: 11 }, { ideas: 11, levels: 7 }), false); // legit re-extraction
  assert.equal(isStrictlyPoorer({ ideas: 11, levels: 0 }, { ideas: 11, levels: 7 }), false); // equal ideas → allowed
  assert.equal(isStrictlyPoorer({ ideas: 5, levels: 7 }, { ideas: 5, levels: 7 }), false); // identical
});

test("isProcessingLocked: a fresh analyzing row locks; a stale or settled row does not", () => {
  const now = Date.now();
  assert.equal(isProcessingLocked({ status: "analyzing", updated: now - 5_000 }, now), true);
  assert.equal(isProcessingLocked({ status: "analyzing", updated: now - ANALYZING_LOCK_MS - 1 }, now), false); // crashed run must not wedge the video
  assert.equal(isProcessingLocked({ status: "analyzed", updated: now }, now), false);
  assert.equal(isProcessingLocked({ status: "failed", updated: now }, now), false);
});

test("failureRowPatch: extraction throws → failed status carrying the REAL reason", () => {
  const p = failureRowPatch("AI extraction failed — all 2 extraction call(s) failed: api_error", false);
  assert.equal(p.status, "failed");
  assert.match(p.error, /api_error/);
  const q = failureRowPatch(null, false);
  assert.equal(q.status, "failed");
  assert.equal(q.error, "Extraction produced no analysis.");
});

test("failureRowPatch: a failed RERUN keeps the surviving analysis but says so on the row", () => {
  const p = failureRowPatch("AI extraction failed — output truncated (max_tokens)", true);
  assert.equal(p.status, "analyzed"); // the good data is still stored — do not bury it
  assert.match(p.error, /kept the existing analysis/i);
  assert.match(p.error, /max_tokens/);
});

test("deriveRowRepair: analyzed row over a total-failure blob (no summary, all empty) → failed", () => {
  const v = mkVideo({ status: "analyzed", ideaCount: 0, optionCount: 0, levelCount: 0 });
  const blob = mkAnalysis({ overallSummary: "" });
  const r = deriveRowRepair(v, blob);
  assert.equal(r?.kind, "failed_extraction");
  if (r?.kind === "failed_extraction") assert.match(r.error, /AI extraction failed/);
});

test("deriveRowRepair: genuinely-empty extraction (summary present, 0 ideas) is honest — NOT a failure", () => {
  const v = mkVideo({ status: "analyzed", ideaCount: 0, optionCount: 0, levelCount: 0 });
  const blob = mkAnalysis({ overallSummary: "Nothing actionable today." });
  assert.equal(deriveRowRepair(v, blob), null); // analyzed + 0 ideas stays analyzed + 0 ideas
});

test("deriveRowRepair: drifted row counts are recomputed from the blob; missing blob repairs nothing", () => {
  const v = mkVideo({ status: "analyzed", ideaCount: 0, optionCount: 0, levelCount: 0 });
  const blob = mkAnalysis({ tradeIdeas: stubIdeas(5), levels: stubLevels(8) });
  const r = deriveRowRepair(v, blob);
  assert.equal(r?.kind, "recount");
  if (r?.kind === "recount") assert.deepEqual(r.patch, { ideaCount: 5, optionCount: 0, levelCount: 8 });
  assert.equal(deriveRowRepair(v, null), null); // never fabricate from an absent blob
  assert.equal(deriveRowRepair(mkVideo({ status: "failed" }), blob), null); // only analyzed/preliminary rows
});

test("deriveRowRepair: idempotent — applying the recount patch yields no further repair", () => {
  const blob = mkAnalysis({ tradeIdeas: stubIdeas(5), levels: stubLevels(8) });
  const v = mkVideo({ status: "analyzed", ideaCount: 0, optionCount: 0, levelCount: 0 });
  const r = deriveRowRepair(v, blob);
  assert.equal(r?.kind, "recount");
  const repaired = { ...v, ...(r?.kind === "recount" ? r.patch : {}) };
  assert.equal(deriveRowRepair(repaired, blob), null);
});

// ===========================================================================
// THE ATTRIBUTION BOUNDARY — who may see source attribution (redact.ts's
// intelOwnerView → user-scope's deriveIntelAttributionGate). Pure derivation,
// so all five paths are covered without a session or an env mutation.
// ===========================================================================

const NON_OWNER = "viv@example.com";

test("attribution gate: configured + owner session → full attribution", () => {
  assert.deepEqual(
    deriveIntelAttributionGate({ configured: true, email: OWNER_EMAIL, production: false }),
    { ok: true },
  );
  // production changes NOTHING once auth is actually configured
  assert.deepEqual(
    deriveIntelAttributionGate({ configured: true, email: OWNER_EMAIL, production: true }),
    { ok: true },
  );
});

test("attribution gate: configured + non-owner session → 403, in every environment", () => {
  for (const production of [false, true]) {
    assert.deepEqual(
      deriveIntelAttributionGate({ configured: true, email: NON_OWNER, production }),
      { ok: false, status: 403 },
      `non-owner must never see attribution (production=${production})`,
    );
  }
});

test("attribution gate: configured + signed out → 401, in every environment", () => {
  for (const production of [false, true]) {
    assert.deepEqual(
      deriveIntelAttributionGate({ configured: true, email: null, production }),
      { ok: false, status: 401 },
      `signed-out must never see attribution (production=${production})`,
    );
  }
});

test("attribution gate: unconfigured auth in dev/test → the single-user fallback (owner)", () => {
  // Byte-identical to pre-multi-user behavior: the desk works out of the box.
  assert.deepEqual(
    deriveIntelAttributionGate({ configured: false, email: null, production: false }),
    { ok: true },
  );
});

test("attribution gate: unconfigured auth in PRODUCTION → FAILS CLOSED (redacted)", () => {
  // The whole point of decision #4: a deployed environment that lost its auth
  // env vars (AUTH_SECRET dropped, env group unlinked, secretless preview
  // build) must NOT hand full source attribution to the public. Privacy is the
  // product's promise — a config accident can never be what breaks it.
  assert.deepEqual(
    deriveIntelAttributionGate({ configured: false, email: null, production: true }),
    { ok: false, status: 403 },
    "unconfigured auth in production must resolve to REDACTED, never to owner",
  );
});

test("attribution gate: ONLY unconfigured-in-production diverges from the single-user fallback", () => {
  // Pins the blast radius of the fail-closed rule: it changes exactly one input
  // and leaves every configured path alone.
  const inputs = [
    { configured: true, email: OWNER_EMAIL },
    { configured: true, email: NON_OWNER },
    { configured: true, email: null },
    { configured: false, email: null },
  ];
  const diverged = inputs.filter(
    (i) =>
      JSON.stringify(deriveIntelAttributionGate({ ...i, production: true })) !==
      JSON.stringify(deriveIntelAttributionGate({ ...i, production: false })),
  );
  assert.deepEqual(diverged, [{ configured: false, email: null }]);
});

// --- the async contract (SHIP-BLOCKER regression pin) ----------------------
// intelOwnerView was SYNC before the multi-user merge (`if (!intelOwnerView())`).
// It is now ASYNC, and a Promise is ALWAYS truthy — so an un-awaited call site
// silently becomes a permanently-false guard that serves full attribution to
// everyone. These pin the shape so a regression to sync is catchable here.

test("intelOwnerView: is an async function (a sync regression breaks every guard)", () => {
  assert.equal(
    intelOwnerView.constructor.name,
    "AsyncFunction",
    "intelOwnerView must stay async — see the un-awaited-guard hazard below",
  );
});

test("intelOwnerView: returns a thenable, and an un-awaited guard is provably always-false", () => {
  const returned = intelOwnerView();
  assert.equal(typeof (returned as Promise<boolean>)?.then, "function", "must return a Promise");
  void (returned as Promise<boolean>).catch(() => {}); // no session in unit tests — never a rejection leak
  // THE hazard, stated as an assertion: this is why every call site must await.
  assert.equal(!Promise.resolve(false), false, "a Promise is truthy even when it resolves false");
});

// --- the WIRING pin (the leak this catches actually shipped) ----------------
// The gate DERIVATION above is fully covered, but derivation tests cannot see
// which gate a route actually calls. Two attribution-bearing READ routes were
// found wired to the WRITE gate (gateIntelMutationOrRespond) during the
// multi-user merge integration: GET /api/intel/tracker (tracked rows carry
// sourceRefs = videoId + channelTitle, and conflictKey embeds the channel) and
// GET /api/intel/videos/[id] (the full source bundle: channel, title,
// transcript, per-segment evidence). The write gate resolves "unconfigured →
// open" in EVERY environment by design, so both served full attribution to the
// public in a production deploy that lost its auth env vars — precisely the
// hole decision #4's fail-closed rule exists to close, reached through the
// wrong gate.
//
// The invariant: every attribution-bearing READ surface must reference the
// attribution boundary — gateIntelAttributionOrRespond, or intelOwnerView for
// the surfaces that serve a REDACTED view instead of refusing outright. A route
// rewired to the write gate alone drops its reference and fails here. (Source
// text, not module load: route modules pull in next-auth/Redis at import.)

const ATTRIBUTION_READ_ROUTES = [
  // refuse outright — nothing is servable to a non-owner
  { file: "app/api/intel/sources/route.ts", why: "the source roster IS the watched-channel list" },
  { file: "app/api/intel/videos/route.ts", why: "video rows carry channel/title attribution" },
  { file: "app/api/intel/videos/[id]/route.ts", why: "the bundle is pure source material" },
  { file: "app/api/intel/ask/route.ts", why: "cited answers name channels in prose" },
  { file: "app/api/intel/tracker/route.ts", why: "tracked rows carry sourceRefs + conflictKey" },
  // serve a redacted view instead — gated via intelOwnerView
  { file: "app/api/intel/overview/route.ts", why: "sources/videos/brief attribution" },
  { file: "app/api/intel/briefs/route.ts", why: "relays ownerView to the client" },
  { file: "app/api/intel/briefs/[date]/route.ts", why: "full provenance for the owner only" },
  { file: "app/api/intel/export/[date]/route.ts", why: "exports carry attribution for the owner" },
] as const;

test("attribution wiring: every attribution-bearing READ route rides the attribution boundary", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const { file, why } of ATTRIBUTION_READ_ROUTES) {
    const src = await readFile(root + file, "utf8");
    assert.ok(
      src.includes("gateIntelAttributionOrRespond") || src.includes("intelOwnerView"),
      `${file} serves attribution (${why}) but references no attribution gate — ` +
        "the write gate is NOT a substitute: it resolves unconfigured→open in production",
    );
  }
});
