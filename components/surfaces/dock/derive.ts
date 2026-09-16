// Shared pure derivations for the terminal desk (G3) — used by the card list
// (IdeasFeed) and the dock modules alike, so the SIDE/symbol/selection logic
// can never drift between the cards, the chart and the heatmap.
//
// feat/v4-1-terminal: numOf / liveSide / sideOf moved to lib/idea-card.ts
// (lib code must not import a component file); this file re-exports them so
// every existing dock import keeps working unchanged.

import type { PublicIdea } from "@/lib/ideas";
import type { ChartSelection } from "./IdeaChartModule";
import { entryLevelOf, numOf } from "@/lib/idea-card";

export { numOf, liveSide, sideOf, entryLevelOf, type ResolvedSide } from "@/lib/idea-card";

// Desk shorthand → Yahoo chart symbol. INTEGRITY-1 lifted the table to
// lib/desk-symbols.ts so the server's daily book pass evaluates the SAME
// instrument the desk charts; this re-export keeps every existing import.
import { deskSymbolFor } from "@/lib/desk-symbols";

export function chartSymbolFor(ticker: string): string {
  return deskSymbolFor(ticker);
}

// — the desk's ONE selection constructor (G3 r5; moved here for UX2-T4 so
// blotter rows and heatmap tiles build byte-identical selections). The
// tracked-card constructor went with the retired lane (chore/terminal-cut). —

export function selectionFromLive(idea: PublicIdea): ChartSelection {
  return {
    key: `live:${idea.id}`,
    ticker: idea.instrument,
    label: "LIVE",
    levels: {
      // v4-1 — the ENTRY line is the pass's parsed trigger when it read one
      // (the level the chip is judged against), else the entry's first
      // price-like numeral; the phone chart (IdeaBody) draws the same number
      entry: entryLevelOf(idea) ?? undefined,
      target: numOf(idea.target) ?? undefined,
      // v4-1 — a stated stop draws on the dock chart too (the module always
      // supported it; the constructor never passed it)
      stop: numOf(idea.stop) ?? undefined,
    },
    triggeredAt: null,
  };
}
