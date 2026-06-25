// Transparent options ranking — NO black-box AI score. Each factor is scored out of a
// documented max and shown to the user. A score is FIT + DATA QUALITY, never a
// probability of profit, and is never driven by cheap premium alone.
//
// Default weights (max points) — total 100:
//   thesisMatch 25 · liquidity 20 · spreadQuality 15 · timeframeFit 15 ·
//   catalystFit 10 · riskDefinition 10 · sourceConfirmation 5

import type { OptionIdea, RankFactor } from "./types";
import { dte } from "./dates";
import { spreadPct } from "./options";

export type RankResult = { score: number; factors: RankFactor[] };

export function rankOption(
  idea: OptionIdea,
  ctx: { sourcesForSymbol: number; newest: number; publishedAt: number },
): RankResult {
  const factors: RankFactor[] = [];
  const f = (factor: string, pts: number, max: number, note: string) => {
    factors.push({ factor, weight: Number(pts.toFixed(1)), note: `${pts.toFixed(1)}/${max} — ${note}` });
    return pts;
  };
  let score = 0;

  // thesisMatch (25)
  {
    let p = 0;
    if (idea.explicitness === "explicit") p += 10;
    if (idea.creatorSpecifiedContract && idea.legs.some((l) => l.strike !== null)) p += 8;
    else if (idea.direction !== "watch") p += 4;
    if (idea.underlyingTrigger !== null || idea.underlyingInvalidation !== null) p += 7;
    p = Math.min(25, p);
    score += f("thesis match", p, 25, idea.explicitness === "explicit" ? "creator-stated thesis" : "AUGUST-inferred");
  }
  // liquidity (20)
  {
    const q = idea.contractQuote;
    let p: number;
    let note: string;
    if (!q || q.openInterest === null) {
      p = 6;
      note = "options chain unavailable";
    } else {
      const oi = q.openInterest;
      p = oi >= 1000 ? 12 : oi >= 100 ? 8 : 3;
      if ((q.volume ?? 0) >= 500) p += 8;
      else if ((q.volume ?? 0) >= 100) p += 4;
      p = Math.min(20, p);
      note = `OI ${oi}${q.volume !== null ? `, vol ${q.volume}` : ""}`;
    }
    score += f("liquidity", p, 20, note);
  }
  // spreadQuality (15)
  {
    const sp = idea.contractQuote ? spreadPct({ bid: idea.contractQuote.bid, ask: idea.contractQuote.ask, mid: idea.contractQuote.mid } as never) : null;
    let p: number;
    let note: string;
    if (sp === null) {
      p = 6;
      note = "spread unavailable";
    } else {
      p = sp < 0.05 ? 15 : sp < 0.1 ? 11 : sp < 0.2 ? 7 : 3;
      note = `bid/ask ${(sp * 100).toFixed(0)}% of mid`;
    }
    score += f("spread quality", p, 15, note);
  }
  // timeframeFit (15)
  {
    const exp = idea.legs.find((l) => l.expiration)?.expiration ?? null;
    const d = dte(exp);
    let p: number;
    let note: string;
    if (d === null) {
      p = 7;
      note = "expiration not specified";
    } else {
      const wantShort = idea.timeHorizon === "intraday" || idea.timeHorizon === "event";
      const wantLong = idea.timeHorizon === "longer_term";
      const ok = wantShort ? d <= 7 : wantLong ? d >= 30 : d >= 3 && d <= 60;
      p = ok ? 13 : 8;
      note = `${d} DTE vs ${idea.timeHorizon}`;
    }
    score += f("timeframe fit", p, 15, note);
  }
  // catalystFit (10)
  {
    const p = idea.catalysts.length ? 10 : 4;
    score += f("catalyst fit", p, 10, idea.catalysts.length ? idea.catalysts[0] : "no catalyst stated");
  }
  // riskDefinition (10)
  {
    const p = idea.maxLoss !== null && idea.strategyType.includes("spread") ? 10 : idea.strategyType.startsWith("long_") ? 7 : 4;
    score += f("risk definition", p, 10, idea.maxLoss !== null ? "defined max loss" : "undefined / not computable");
  }
  // sourceConfirmation (5)
  {
    const p = ctx.sourcesForSymbol > 1 ? 5 : 2;
    score += f("source confirmation", p, 5, `${ctx.sourcesForSymbol} source(s)`);
  }
  // recency adjustment (small, within the above scale)
  if (ctx.newest > 0 && idea.status === "invalidated") {
    score -= 15;
    factors.push({ factor: "invalidated", weight: -15, note: "-15 — setup already invalidated" });
  }

  return { score: Math.round(score), factors };
}
