// Shared pure derivations for the terminal desk (G3) — used by the blotter
// (IdeasFeed) and the dock modules alike, so the SIDE/symbol/selection logic
// can never drift between the grid, the chart and the heatmap.

import type { FeedCard } from "@/lib/intel/publish";
import type { PublicIdea } from "@/lib/ideas";
import type { ChartSelection } from "./IdeaChartModule";

/** first numeral in a free-form level string ("21,450" / "break of 600") */
export function numOf(s: string): number | null {
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return Number.isFinite(v) ? v : null;
}

/** SIDE derived from entry vs target numerals — the fallback when the desk
 *  never stated one; callers render it in the derived style; null when not
 *  derivable (∅) */
export function liveSide(idea: PublicIdea): "LONG" | "SHORT" | null {
  const e = numOf(idea.entry);
  const t = numOf(idea.target);
  if (e == null || t == null || e === t) return null;
  return t > e ? "LONG" : "SHORT";
}

/** UX4 — the ONE side resolution for a LIVE idea: a stated side (extraction
 *  or /admin) wins and renders solid; otherwise fall back to the derived
 *  entry-vs-target read, marked derived; null = ∅. */
export type ResolvedSide = { side: "LONG" | "SHORT" | "WATCH"; derived: boolean };
export function sideOf(idea: PublicIdea): ResolvedSide | null {
  if (idea.side === "long") return { side: "LONG", derived: false };
  if (idea.side === "short") return { side: "SHORT", derived: false };
  if (idea.side === "watch") return { side: "WATCH", derived: false };
  const d = liveSide(idea);
  return d ? { side: d, derived: true } : null;
}

// Desk shorthand → Yahoo chart symbol. INTEGRITY-1 lifted the table to
// lib/desk-symbols.ts so the server's daily book pass evaluates the SAME
// instrument the desk charts; this re-export keeps every existing import.
import { deskSymbolFor } from "@/lib/desk-symbols";

export function chartSymbolFor(ticker: string): string {
  return deskSymbolFor(ticker);
}

// — the desk's ONE selection constructor pair (G3 r5; moved here for UX2-T4
// so blotter rows and heatmap tiles build byte-identical selections) —

const LIFE_LABEL: Record<string, string> = {
  TRIGGERED: "TRIGGERED",
  ARMED: "ARMED",
  ACTIVE: "ACTIVE",
  TARGET_HIT: "TARGET HIT",
  INVALIDATED: "INVALIDATED",
  CLOSED: "CLOSED",
};

export function selectionFromLive(idea: PublicIdea): ChartSelection {
  return {
    key: `live:${idea.id}`,
    ticker: idea.instrument,
    label: "LIVE",
    levels: {
      entry: numOf(idea.entry) ?? undefined,
      target: numOf(idea.target) ?? undefined,
    },
    triggeredAt: null,
  };
}

export function selectionFromTracked(card: FeedCard): ChartSelection {
  const trig = card.statusHistory.find((h) => h.state === "TRIGGERED");
  return {
    key: `trk:${card.id}`,
    ticker: card.ticker,
    label: LIFE_LABEL[card.status] ?? card.status,
    levels: {
      entry: card.statedLevels.trigger?.value ?? undefined,
      target: card.statedLevels.targets[0]?.value ?? undefined,
      stop: card.statedLevels.invalidation?.value ?? undefined,
    },
    triggeredAt: trig ? trig.at : null,
  };
}
