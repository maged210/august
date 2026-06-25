// AUGUST options-contract CANDIDATES — SERVER ONLY. Generates *current* contract
// candidates for a directional thesis, but ONLY from a connected options-chain
// provider (here: the reused, keyless, DELAYED Yahoo source). Every candidate is
// labeled origin "august_candidate" and is explicitly NOT a creator recommendation.
//
// Honesty constraints baked in:
//   • Never invents data. If the chain is unavailable we return the provider status
//     and zero candidates — the rest of Intel still works.
//   • This provider supplies NO Greeks, so the configured delta band CANNOT be applied
//     faithfully. We select by MONEYNESS as a transparent proxy and say so in `risks`.
//   • A candidate is a *starting point for research*, ranked by fit + data quality,
//     never by expected profitability. No execution, ever.

import type {
  OptionCandidateSettings,
  OptionDirection,
  OptionIdea,
  OptionLeg,
  OptionStrategyType,
  OptionsProviderStatus,
} from "./types";
import { getOptionChain, type ChainResult, type NormalizedContract, computeOptionMetrics, spreadPct } from "./options";
import { dte } from "./dates";

let candSeq = 0;
const candId = () => `oc_${(candSeq++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export type CandidateThesis = {
  underlyingSymbol: string;
  direction: OptionDirection;
  timeHorizon: OptionIdea["timeHorizon"];
  catalysts: string[];
  underlyingTrigger: number | null;
  underlyingInvalidation: number | null;
  underlyingTargets: number[];
  // evidence carried from the source idea so candidates stay attributable
  sourceChapterId: string | null;
  sourceSegmentIds: string[];
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  videoId?: string;
};

export type CandidateResult = {
  status: OptionsProviderStatus;
  delayed: boolean;
  candidates: OptionIdea[];
  note: string;
};

const isoFromEpochSec = (sec: number): string => {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

/** Choose a provider expiration whose DTE sits inside the configured band. */
function pickExpiration(expirations: number[], s: OptionCandidateSettings, nowMs: number): { epoch: number; iso: string; dte: number } | null {
  const scored = expirations
    .map((e) => ({ epoch: e, iso: isoFromEpochSec(e), dte: dte(isoFromEpochSec(e), nowMs) ?? -1 }))
    .filter((x) => x.dte >= 0)
    .filter((x) => (s.allow0DTE ? true : x.dte >= 1));
  if (!scored.length) return null;
  const inBand = scored.filter((x) => x.dte >= s.preferredDteMin && x.dte <= s.preferredDteMax);
  const pool = inBand.length ? inBand : scored;
  // closest to the middle of the preferred band
  const mid = (s.preferredDteMin + s.preferredDteMax) / 2;
  return pool.reduce((best, x) => (Math.abs(x.dte - mid) < Math.abs(best.dte - mid) ? x : best), pool[0]);
}

// Per-share price to evaluate a contract with: live mid during RTH, else the last trade
// (a real, delayed price) after hours when bid/ask are 0/absent. Never fabricated.
function priceOf(c: NormalizedContract): number | null {
  if (c.mid !== null && c.mid > 0) return c.mid;
  if (c.last !== null && c.last > 0) return c.last;
  return null;
}

// Effective liquidity: open interest when present, else today's volume. OI is an
// end-of-day figure (republished next morning) and reads 0 overnight — exactly when the
// evening brief runs — so we fall back to real traded volume rather than rejecting
// everything. Both are real, never fabricated.
function effLiquidity(c: NormalizedContract): { value: number; basis: "oi" | "volume" } {
  const oi = c.openInterest ?? 0;
  if (oi > 0) return { value: oi, basis: "oi" };
  return { value: c.volume ?? 0, basis: "volume" };
}

function passesLiquidity(c: NormalizedContract, s: OptionCandidateSettings): boolean {
  if (effLiquidity(c).value < s.minOpenInterest) return false;
  if ((c.volume ?? 0) < s.minVolume) return false;
  // Spread gate only when a real two-sided market exists (after hours bid/ask are 0).
  if (c.bid !== null && c.ask !== null && c.bid > 0 && c.ask > 0) {
    const sp = spreadPct(c);
    if (sp !== null && sp > s.maxBidAskSpreadPct) return false;
  }
  if (priceOf(c) === null) return false; // need a real price to evaluate honestly
  return true;
}

function convictionFor(premiumPerContract: number | null, d: number): OptionIdea["conviction"] {
  if (d <= 2) return "lotto";
  if (premiumPerContract !== null && premiumPerContract < 75) return "speculative";
  return "standard";
}

function baseIdea(t: CandidateThesis, strategy: OptionStrategyType, legs: OptionLeg[]): OptionIdea {
  return {
    id: candId(),
    underlyingSymbol: t.underlyingSymbol,
    direction: t.direction,
    strategyType: strategy,
    origin: "august_candidate",
    creatorSpecifiedContract: false,
    timeHorizon: t.timeHorizon,
    legs,
    entryCondition: { type: "unspecified", value: null, text: "AUGUST-generated candidate — entry at your discretion." },
    underlyingTrigger: t.underlyingTrigger,
    underlyingInvalidation: t.underlyingInvalidation,
    underlyingTargets: t.underlyingTargets,
    expirationText: null,
    quotedPremium: null, // a candidate has no creator-quoted premium
    contractQuote: null,
    breakevens: [],
    maxProfit: null,
    maxLoss: null,
    riskRewardRatio: null,
    catalysts: t.catalysts,
    risks: [
      "AUGUST-GENERATED CONTRACT CANDIDATE — not a creator recommendation and not advice.",
      "Provider supplies no Greeks; selected by moneyness as a delta proxy.",
      "Pricing is delayed; verify the live quote before acting.",
    ],
    optionsRisk: { liquidity: null, thetaDecay: null, volatility: null, earnings: null, assignment: null, staleness: "Delayed contract pricing." },
    conviction: "standard",
    confidence: 0.4,
    explicitness: "inferred",
    status: "watching",
    videoId: t.videoId,
    sourceChapterId: t.sourceChapterId,
    sourceSegmentIds: t.sourceSegmentIds,
    sourceStartSeconds: t.sourceStartSeconds,
    sourceEndSeconds: t.sourceEndSeconds,
  };
}

/** Build current candidates for one directional thesis. Bullish→calls, bearish→puts. */
export async function generateCandidates(t: CandidateThesis, settings: OptionCandidateSettings, nowMs = Date.now()): Promise<CandidateResult> {
  const dir = t.direction;
  if (dir !== "bullish" && dir !== "bearish") {
    return { status: "unsupported_symbol", delayed: true, candidates: [], note: "Candidates are generated for directional (bullish/bearish) theses only." };
  }
  const near = await getOptionChain(t.underlyingSymbol).catch(() => null);
  if (!near || (near.status !== "delayed" && near.status !== "connected")) {
    return { status: near?.status ?? "provider_error", delayed: true, candidates: [], note: providerNote(near?.status ?? "provider_error") };
  }
  const exp = pickExpiration(near.expirations, settings, nowMs);
  if (!exp) return { status: near.status, delayed: near.delayed, candidates: [], note: "No expiration available within the configured DTE band." };

  const chain: ChainResult = exp.epoch === near.expiration ? near : (await getOptionChain(t.underlyingSymbol, exp.epoch).catch(() => null)) ?? near;
  const under = chain.underlyingPrice ?? near.underlyingPrice;
  if (under === null) return { status: chain.status, delayed: chain.delayed, candidates: [], note: "Underlying price unavailable from provider." };

  const optType: "call" | "put" = dir === "bullish" ? "call" : "put";
  const side = optType === "call" ? chain.calls : chain.puts;
  // Moneyness proxy for the delta band: ~ATM ≈ 0.5Δ. Keep strikes within a window of
  // the underlying so we land near the configured band without fabricating Greeks.
  const liquid = side
    .filter((c) => passesLiquidity(c, settings))
    .filter((c) => Math.abs(c.strike - under) / under <= 0.12) // ±12% of spot
    .sort((a, b) => Math.abs(a.strike - under) - Math.abs(b.strike - under));

  const out: OptionIdea[] = [];

  // 1) Single-leg directional (if allowed): nearest ATM + one OTM for cheaper premium.
  if (settings.allowSingleLeg) {
    const picks: NormalizedContract[] = [];
    const atm = liquid[0];
    if (atm) picks.push(atm);
    const otm = liquid.find((c) => (optType === "call" ? c.strike > under : c.strike < under) && c !== atm);
    if (otm) picks.push(otm);
    for (const c of picks) {
      const premium = priceOf(c); // per share (mid in RTH, else last)
      const perContract = premium !== null ? premium * 100 : null;
      if (settings.maxPremium !== null && perContract !== null && perContract > settings.maxPremium) continue;
      const strategy: OptionStrategyType = optType === "call" ? "long_call" : "long_put";
      const leg: OptionLeg = { action: "buy", optionType: optType, quantity: 1, strike: c.strike, expiration: exp.iso, contractSymbol: c.contractSymbol || null };
      const idea = baseIdea(t, strategy, [leg]);
      const m = computeOptionMetrics(strategy, [{ ...leg, premium }]);
      idea.breakevens = m.breakevens;
      idea.maxProfit = m.maxProfit;
      idea.maxLoss = m.maxLoss; // = premium×100 for a long single leg
      idea.riskRewardRatio = m.riskRewardRatio;
      if (settings.maxLossCap !== null && idea.maxLoss !== null && idea.maxLoss > settings.maxLossCap) continue;
      idea.contractQuote = quoteFor(c, chain.delayed, chain.quoteTimestamp);
      idea.conviction = convictionFor(perContract, exp.dte);
      idea.optionsRisk = riskNotes(c, exp.dte, false);
      out.push(idea);
    }
  }

  // 2) One defined-risk vertical debit spread (if allowed): buy ATM, sell next OTM.
  if (settings.allowDefinedRisk && liquid.length >= 2) {
    const longLeg = liquid[0];
    const shortLeg = side
      .filter((c) => passesLiquidity(c, settings))
      .filter((c) => (optType === "call" ? c.strike > longLeg.strike : c.strike < longLeg.strike))
      .sort((a, b) => Math.abs(a.strike - longLeg.strike) - Math.abs(b.strike - longLeg.strike))[0];
    const longPx = priceOf(longLeg);
    const shortPx = shortLeg ? priceOf(shortLeg) : null;
    if (shortLeg && longPx !== null && shortPx !== null) {
      const strategy: OptionStrategyType = optType === "call" ? "call_debit_spread" : "put_debit_spread";
      const legs: OptionLeg[] = [
        { action: "buy", optionType: optType, quantity: 1, strike: longLeg.strike, expiration: exp.iso, contractSymbol: longLeg.contractSymbol || null },
        { action: "sell", optionType: optType, quantity: 1, strike: shortLeg.strike, expiration: exp.iso, contractSymbol: shortLeg.contractSymbol || null },
      ];
      const m = computeOptionMetrics(strategy, [
        { ...legs[0], premium: longPx },
        { ...legs[1], premium: shortPx },
      ]);
      if (m.maxLoss !== null && (settings.maxLossCap === null || m.maxLoss <= settings.maxLossCap) && (settings.maxPremium === null || m.maxLoss <= settings.maxPremium)) {
        const idea = baseIdea(t, strategy, legs);
        idea.breakevens = m.breakevens;
        idea.maxProfit = m.maxProfit;
        idea.maxLoss = m.maxLoss;
        idea.riskRewardRatio = m.riskRewardRatio;
        idea.contractQuote = quoteFor(longLeg, chain.delayed, chain.quoteTimestamp);
        idea.conviction = "standard";
        idea.optionsRisk = { ...riskNotes(longLeg, exp.dte, true), assignment: "Short leg can be assigned early near/at the money or before ex-dividend." };
        out.push(idea);
      }
    }
  }

  const capped = out.slice(0, Math.max(1, settings.maxCandidatesPerThesis));
  return {
    status: chain.status,
    delayed: chain.delayed,
    candidates: capped,
    note: capped.length ? `${capped.length} candidate(s) at ${exp.iso} (${exp.dte}DTE) — delayed data, no Greeks.` : "No contracts passed the liquidity/risk filters.",
  };
}

function quoteFor(c: NormalizedContract, delayed: boolean, ts: number | null): OptionIdea["contractQuote"] {
  return {
    contractSymbol: c.contractSymbol || null,
    bid: c.bid, ask: c.ask, mid: c.mid, last: c.last,
    openInterest: c.openInterest, volume: c.volume, impliedVolatility: c.impliedVolatility,
    delta: null, gamma: null, theta: null, vega: null,
    quoteTimestamp: ts, delayed,
  };
}

function riskNotes(c: NormalizedContract, d: number, defined: boolean): OptionIdea["optionsRisk"] {
  const sp = spreadPct(c);
  const liq = effLiquidity(c);
  return {
    liquidity: `${liq.basis === "oi" ? `OI ${liq.value}` : `Vol ${liq.value} (OI unpublished overnight)`}${sp !== null ? `, spread ${(sp * 100).toFixed(0)}%` : ""}${liq.value < 100 ? " — thin" : ""}.`,
    thetaDecay: d <= 2 ? `~${d}DTE — severe time decay.` : d <= 10 ? `~${d}DTE — meaningful theta.` : `~${d}DTE.`,
    volatility: c.impliedVolatility !== null ? `IV ~${(c.impliedVolatility * 100).toFixed(0)}% (delayed).` : null,
    earnings: null,
    assignment: null,
    staleness: defined ? "Both legs priced from delayed quotes." : "Delayed contract pricing.",
  };
}

function providerNote(s: OptionsProviderStatus): string {
  switch (s) {
    case "missing_configuration": return "Connect an options-chain provider to generate current contract candidates.";
    case "unauthorized": return "Options provider rejected the request (unauthorized).";
    case "rate_limited": return "Options provider rate-limited — try again shortly.";
    case "unsupported_symbol": return "No option chain for this symbol from the provider.";
    case "stale": return "Options data is stale.";
    default: return "Options provider unavailable — transcript ideas remain available; only current candidates are disabled.";
  }
}
