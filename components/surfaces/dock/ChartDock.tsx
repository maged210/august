"use client";

// THE CHART DOCK (G3) — left column of the terminal's three-zone desk.
// A vertical stack of self-contained modules; adding a future module
// (options flow, when licensed data exists) is one line here, no layout
// surgery. Stack order: chart → heatmap(+movers) → pulse → tape.
// UX2-T3: Desk Bias + Desk Stats PARKED (components remain, unimported) —
// the long/short counts live in the heatmap header, the stats moved to the
// home brief's DESK LINE.

import type { PublicIdea } from "@/lib/ideas";
import type { PublicTapeEntry } from "@/lib/tape";
import type { QuoteRead } from "@/lib/quote-book";
import IdeaChartModule, { type ChartSelection } from "./IdeaChartModule";
import BookHeatmapModule from "./BookHeatmapModule";
import MarketPulseModule from "./MarketPulseModule";
import TapeModule from "./TapeModule";
import NqLevelsModule from "./NqLevelsModule";
import VixContextModule from "./VixContextModule";

export type { ChartSelection };

export default function ChartDock({
  selection,
  onSelect,
  liveIdeas,
  sourcesAnswered = true,
  quoteFor,
  tape,
  tapeFailed,
  onTapeRetry,
}: {
  selection: ChartSelection | null;
  /** tile clicks drive the desk's ONE selection (UX2-T4) */
  onSelect: (sel: ChartSelection) => void;
  liveIdeas: PublicIdea[];
  /** fix/p0-live-trust — false while the book is unread, so the heatmap can
   *  say so instead of asserting an empty book */
  sourcesAnswered?: boolean;
  /** the feed's ONE quote reader (lib/quote-book readQuote over the shared
   *  book) — the heatmap shows exactly what the cards show */
  quoteFor: (symbol: string) => QuoteRead;
  tape: PublicTapeEntry[] | null;
  tapeFailed: boolean;
  onTapeRetry: () => void;
}) {
  return (
    <div className="if-dock-stack">
      <IdeaChartModule selection={selection} />
      <BookHeatmapModule
        liveIdeas={liveIdeas}
        sourcesAnswered={sourcesAnswered}
        quoteFor={quoteFor}
        selection={selection}
        onSelect={onSelect}
      />
      <NqLevelsModule liveIdeas={liveIdeas} />
      <VixContextModule />
      <MarketPulseModule />
      <TapeModule entries={tape} failed={tapeFailed} onRetry={onTapeRetry} />
    </div>
  );
}
