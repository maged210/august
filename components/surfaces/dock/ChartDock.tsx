"use client";

// THE CHART DOCK (G3) — left column of the terminal's three-zone desk.
// A vertical stack of self-contained modules; adding a future module
// (options flow, when licensed data exists) is one line here, no layout
// surgery. Stack order: chart → pulse → tape → bias → stats.

import type { FeedCard } from "@/lib/intel/publish";
import type { PublicIdea } from "@/lib/ideas";
import type { PublicTapeEntry } from "@/lib/tape";
import IdeaChartModule, { type ChartSelection } from "./IdeaChartModule";
import MarketPulseModule from "./MarketPulseModule";
import TapeModule from "./TapeModule";
import BiasBarsModule from "./BiasBarsModule";
import DeskStatsModule from "./DeskStatsModule";

export type { ChartSelection };

export default function ChartDock({
  selection,
  cards,
  liveIdeas,
  tape,
  tapeFailed,
  onTapeRetry,
}: {
  selection: ChartSelection | null;
  cards: FeedCard[];
  liveIdeas: PublicIdea[];
  tape: PublicTapeEntry[] | null;
  tapeFailed: boolean;
  onTapeRetry: () => void;
}) {
  return (
    <div className="if-dock-stack">
      <IdeaChartModule selection={selection} />
      <MarketPulseModule />
      <TapeModule entries={tape} failed={tapeFailed} onRetry={onTapeRetry} />
      <BiasBarsModule cards={cards} liveIdeas={liveIdeas} tape={tape ?? []} />
      <DeskStatsModule cards={cards} />
    </div>
  );
}
