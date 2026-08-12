"use client";

// THE CHART DOCK (G3) — left column of the terminal's three-zone desk.
// A vertical stack of self-contained modules; adding a future module
// (options flow, when licensed data exists) is one line here, no layout
// surgery. Stack order: chart → heatmap(+movers) → pulse → tape.
// UX2-T3: Desk Bias + Desk Stats PARKED (components remain, unimported) —
// the long/short counts live in the heatmap header, the stats moved to the
// home brief's DESK LINE.

import type { FeedCard } from "@/lib/intel/publish";
import type { PublicIdea } from "@/lib/ideas";
import type { PublicTapeEntry } from "@/lib/tape";
import IdeaChartModule, { type ChartSelection } from "./IdeaChartModule";
import BookHeatmapModule from "./BookHeatmapModule";
import MarketPulseModule from "./MarketPulseModule";
import TapeModule from "./TapeModule";

export type { ChartSelection };

export default function ChartDock({
  selection,
  onSelect,
  cards,
  liveIdeas,
  tape,
  tapeFailed,
  onTapeRetry,
}: {
  selection: ChartSelection | null;
  /** tile clicks drive the desk's ONE selection (UX2-T4) */
  onSelect: (sel: ChartSelection) => void;
  cards: FeedCard[];
  liveIdeas: PublicIdea[];
  tape: PublicTapeEntry[] | null;
  tapeFailed: boolean;
  onTapeRetry: () => void;
}) {
  return (
    <div className="if-dock-stack">
      <IdeaChartModule selection={selection} />
      <BookHeatmapModule
        cards={cards}
        liveIdeas={liveIdeas}
        selection={selection}
        onSelect={onSelect}
      />
      <MarketPulseModule />
      <TapeModule entries={tape} failed={tapeFailed} onRetry={onTapeRetry} />
    </div>
  );
}
