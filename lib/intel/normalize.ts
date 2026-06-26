// The anti-hallucination CORE for option ideas — PURE and dependency-light (only
// ./types + ./dates + ./options), so it is unit-testable under `node --test` without
// pulling in the Anthropic SDK / "@/" aliases that the rest of extract.ts needs.
//
// Guarantees enforced here (every one is tested):
//   • A strike/premium/trigger/target/invalidation NOT literally present in the cited
//     transcript text is dropped to null (with a warning) — never invented.
//   • A relative/explicit expiration resolves only when safe (else null) — never guessed.
//   • origin is creator_explicit ONLY when the model said so; otherwise directional_only.
//     An august_candidate can NEVER originate from a transcript.
//   • creatorSpecifiedContract is true only if a real strike or expiration survived.
//   • Bullish does NOT force calls; we keep exactly the legs/strategy the model returned.

import type { Explicitness, OptionIdea, OptionLeg, OptionOrigin, OptionStrategyType, ResolvedDate } from "./types";
import { resolveExpiration } from "./dates";
import { computeOptionMetrics, type OptionMetrics } from "./options";

// Structural input shape (what the model emits per option idea, pre-validation).
export type RawOptionIdea = {
  underlyingSymbol: string;
  direction: OptionIdea["direction"];
  strategyType: OptionStrategyType;
  origin: "creator_explicit" | "directional_only";
  creatorSpecifiedContract?: boolean;
  timeHorizon: OptionIdea["timeHorizon"];
  legs: { action: "buy" | "sell"; optionType: "call" | "put"; strike?: number | null; expirationText?: string | null }[];
  expirationText?: string | null;
  entryConditionText?: string;
  underlyingTrigger?: number | null;
  underlyingInvalidation?: number | null;
  underlyingTargets?: number[];
  quotedPremium?: number | null;
  catalysts?: string[];
  risks?: string[];
  conviction?: OptionIdea["conviction"];
  confidence: number;
  explicitness: Explicitness;
  sourceSegmentIds: string[];
};

/** All numeric tokens that literally appear in `text` (commas stripped). */
export const numbersIn = (text: string): Set<string> => {
  const set = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) set.add(m[0].replace(/,/g, ""));
  return set;
};

/** True if `value` is null (nothing to support) or literally appears in `citedText`
 *  (exact, or within 0.1% to tolerate speech-to-text rounding). */
export function numberSupported(value: number | null, citedText: string): boolean {
  if (value === null) return true;
  const nums = numbersIn(citedText);
  for (const n of nums) {
    const x = Number(n);
    if (Number.isFinite(x) && (x === value || Math.abs(x - value) / Math.max(1, Math.abs(value)) < 0.001)) return true;
  }
  return false;
}

export type NormalizedOption = {
  strategyType: OptionStrategyType;
  origin: OptionOrigin;
  creatorSpecifiedContract: boolean;
  legs: OptionLeg[];
  expirationText: ResolvedDate | null;
  quotedPremium: number | null;
  underlyingTrigger: number | null;
  underlyingInvalidation: number | null;
  underlyingTargets: number[];
  metrics: OptionMetrics;
  warnings: string[];
};

/** Apply the anti-hallucination guards to one raw option idea against its cited text.
 *  `sym` is the already-normalized + ticker-validated underlying. Pure + deterministic. */
export function normalizeOptionIdea(o: RawOptionIdea, sym: string, citedText: string, baseMs: number): NormalizedOption {
  const warnings: string[] = [];
  // Drop any number not literally in the cited transcript (never invent), warning once.
  const guard = (v: number | null | undefined): number | null => {
    if (typeof v !== "number") return null;
    if (numberSupported(v, citedText)) return v;
    warnings.push(`${sym}: dropped unsupported number ${v}.`);
    return null;
  };

  const legs: OptionLeg[] = (o.legs ?? []).map((l) => {
    const strike = guard(l.strike); // unsupported strike → null (never invented)
    const rdText = l.expirationText ?? o.expirationText ?? null;
    const rd = rdText ? resolveExpiration(rdText, baseMs) : null;
    return { action: l.action, optionType: l.optionType, quantity: 1, strike, expiration: rd?.resolved ?? null, contractSymbol: null };
  });

  const expirationText = o.expirationText
    ? resolveExpiration(o.expirationText, baseMs)
    : o.legs?.find((l) => l.expirationText)?.expirationText
      ? resolveExpiration(o.legs.find((l) => l.expirationText)!.expirationText!, baseMs)
      : null;

  const quotedPremium = guard(o.quotedPremium);
  const underlyingTrigger = guard(o.underlyingTrigger); // computed ONCE (no duplicate warning)
  const underlyingInvalidation = guard(o.underlyingInvalidation);
  const underlyingTargets = (o.underlyingTargets ?? []).filter((t) => numberSupported(t, citedText));

  const strategyType: OptionStrategyType = o.strategyType ?? "unspecified";
  const origin: OptionOrigin = o.origin === "creator_explicit" ? "creator_explicit" : "directional_only";
  const creatorSpecifiedContract = !!o.creatorSpecifiedContract && legs.some((l) => l.strike !== null || l.expiration !== null);

  // Metrics only when a single-leg premium + strike are known; spreads need both legs
  // priced (no chain at extraction time → spreads stay null until enrichment).
  const pricedLegs = legs.map((l) => ({ ...l, premium: legs.length === 1 ? quotedPremium : null }));
  const metrics = computeOptionMetrics(strategyType, pricedLegs);

  return { strategyType, origin, creatorSpecifiedContract, legs, expirationText, quotedPremium, underlyingTrigger, underlyingInvalidation, underlyingTargets, metrics, warnings };
}
