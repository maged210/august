"use client";

// UX2-T4/T5 — THE DESK HEATMAP + MOVERS STRIP. A Finviz-style map of OUR
// book: ONE TILE PER TICKER over the published book's live calls (first
// occurrence wins — the list arrives newest-first). Equal tile sizing stays
// the honest layout (no position data exists — a plain filled grid IS the
// squarified treemap for equal weights; hand-rolled, zero dependencies).
// Color encodes TODAY's % move. feat/v4-1-terminal: the map no longer fetches
// its own quotes. It reads the terminal's ONE quote book through the reader
// the feed passes down (lib/quote-book readQuote) — the same chunked fetch
// and the same per-symbol freshness the cards use. The old single call asked
// the route for every symbol at once, the route slices at twenty, and the
// tail went silently blank. Now: a symbol not yet asked → a neutral pending
// tile; a symbol whose batch failed or aged out → an UNAVAILABLE chip on the
// tile, never a blank and never an older round's %. Tile click = the desk's
// ONE selection (chart dock + detail panel + ?idea=). Under the map: today's
// top/bottom three, from fresh quotes only.
//
// chore/terminal-cut: the tracked cards (the retired desk's publish pipeline)
// no longer feed the map — the book is the live book.
//
// T3 folded the old Desk Bias here: the header carries the long/short book
// counts ("BOOK — n LONG · n SHORT · n unset").

import { useMemo } from "react";
import type { PublicIdea } from "@/lib/ideas";
import type { QuoteRead } from "@/lib/quote-book";
import DataTag from "@/components/DataTag";
import type { ChartSelection } from "./IdeaChartModule";
import { chartSymbolFor, selectionFromLive, sideOf } from "./derive";

type Quote = { price: number; chgPct: number };

const fmtPx = (n: number) =>
  n >= 1000
    ? Math.round(n).toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

type Tile = {
  key: string;
  ticker: string;
  side: "LONG" | "SHORT" | null;
  quote: Quote | null;
  /** why there is no quote: not asked yet, or asked and not answered */
  quoteState: "ok" | "pending" | "unavailable";
  select: ChartSelection;
};

export default function BookHeatmapModule({
  liveIdeas,
  sourcesAnswered = true,
  quoteFor,
  selection,
  onSelect,
}: {
  liveIdeas: PublicIdea[];
  /** fix/p0-live-trust — false while the book is still loading or has
   *  failed. `liveIdeas` defaults to [] in the parent, so without this the
   *  module cannot tell an empty book from an unread one and states
   *  "0 LONG · 0 SHORT · 0 UNSET" and "nothing on the book yet" as fact. */
  sourcesAnswered?: boolean;
  /** the terminal's ONE quote reader — see the header note */
  quoteFor: (symbol: string) => QuoteRead;
  selection: ChartSelection | null;
  onSelect: (sel: ChartSelection) => void;
}) {
  const tiles: Tile[] = useMemo(() => {
    // ONE TILE PER TICKER — first occurrence (newest) wins
    const seen = new Set<string>();
    const out: Tile[] = [];
    for (const i of liveIdeas) {
      const ticker = i.instrument.toUpperCase();
      if (seen.has(ticker)) continue;
      seen.add(ticker);
      const s = sideOf(i);
      const r = quoteFor(chartSymbolFor(i.instrument));
      // a tile's color is today's %: an answered quote with no % carried is
      // as unusable here as no quote — it says so rather than shading zero
      const usable = r.state === "ok" && r.chgPct != null && Number.isFinite(r.chgPct);
      out.push({
        key: `live:${i.id}`,
        ticker,
        side: s?.side === "LONG" ? "LONG" : s?.side === "SHORT" ? "SHORT" : null,
        quote: usable ? { price: r.price, chgPct: r.chgPct as number } : null,
        quoteState: usable ? "ok" : r.state === "pending" ? "pending" : "unavailable",
        select: selectionFromLive(i),
      });
    }
    // F4 — Finviz reading order: hottest gainers first, losers last, the
    // quote-less tail at the end
    out.sort((a, b) => {
      if (!a.quote && !b.quote) return 0;
      if (!a.quote) return 1;
      if (!b.quote) return -1;
      return b.quote.chgPct - a.quote.chgPct;
    });
    return out;
  }, [liveIdeas, quoteFor]);

  const longs = tiles.filter((t) => t.side === "LONG").length;
  const shorts = tiles.filter((t) => t.side === "SHORT").length;
  const unset = tiles.length - longs - shorts;

  // movers — one entry per ticker (best-informed quote), today's extremes
  const movers = useMemo(() => {
    const byTicker = new Map<string, Tile>();
    for (const t of tiles) {
      if (!t.quote) continue;
      if (!byTicker.has(t.ticker)) byTicker.set(t.ticker, t);
    }
    const rows = [...byTicker.values()].sort((a, b) => b.quote!.chgPct - a.quote!.chgPct);
    // top 3 and bottom 3, never overlapping when the book is small
    const top = rows.slice(0, 3);
    const bottom = rows.slice(Math.max(3, rows.length - 3)).reverse();
    return { top, bottom };
  }, [tiles]);

  // F4 — saturation scales with |today %|: ±1% faint (~0.15), ±5% clear
  // (~0.42), ±10%+ hot (capped so tile labels stay readable)
  const tileStyle = (t: Tile): React.CSSProperties => {
    if (!t.quote) return {};
    const a = Math.min(0.78, 0.08 + Math.abs(t.quote.chgPct) * 0.068);
    return {
      background:
        t.quote.chgPct >= 0
          ? `rgba(111, 160, 133, ${a.toFixed(2)})`
          : `rgba(205, 126, 109, ${a.toFixed(2)})`,
    };
  };

  return (
    <section className="ifm" aria-label="Desk heatmap">
      <div className="ifm-h">
        <span className="ifm-title">BOOK</span>
        <span className="ifm-sub">
          {sourcesAnswered ? `${longs} LONG · ${shorts} SHORT · ${unset} UNSET` : "— LONG · — SHORT · — UNSET"}
        </span>
      </div>
      {!sourcesAnswered ? (
        <div className="ifm-body">
          <span className="if-abs">
            <span className="if-abs-g" aria-hidden="true">
              ·
            </span>{" "}
            the book hasn&apos;t loaded
          </span>
        </div>
      ) : tiles.length === 0 ? (
        <div className="ifm-body">
          <span className="if-abs">
            <span className="if-abs-g" aria-hidden="true">
              ·
            </span>{" "}
            nothing on the book yet
          </span>
        </div>
      ) : (
        <div className="ifm-body">
          <div className="if-hm" role="listbox" aria-label="Book heatmap — one tile per ticker">
            {tiles.map((t) => {
              // key match, or ticker match — the map always shows where the
              // selected instrument lives
              const sel =
                selection != null &&
                (selection.key === t.key || selection.ticker.trim().toUpperCase() === t.ticker);
              return (
              <button
                key={t.key}
                type="button"
                role="option"
                aria-selected={sel}
                className={`if-hm-tile${sel ? " sel" : ""}${t.quote ? "" : " noq"}`}
                style={tileStyle(t)}
                title={`${t.ticker}${
                  t.quote ? ` · ${fmtPct(t.quote.chgPct)} today` : t.quoteState === "pending" ? " · quote loading" : " · quote unavailable"
                } — click to select`}
                onClick={() => onSelect(t.select)}
              >
                <span className="if-hm-tkr">{t.ticker}</span>
                {t.quote ? (
                  <span className="if-hm-pct">{fmtPct(t.quote.chgPct)}</span>
                ) : t.quoteState === "unavailable" ? (
                  <DataTag kind="unavail" compact />
                ) : (
                  <span className="if-hm-pct">·</span>
                )}
              </button>
              );
            })}
          </div>

          {/* T5 — movers: today's top/bottom three across the book */}
          {movers.top.length > 0 || movers.bottom.length > 0 ? (
            <div className="if-mv">
              {movers.top.map((t) => (
                <span key={`t${t.ticker}`} className="if-mv-row">
                  <span className="if-mv-tkr">{t.ticker}</span>
                  <span className="if-mv-px">{fmtPx(t.quote!.price)}</span>
                  <span className={`if-mv-pct ${t.quote!.chgPct >= 0 ? "if-pos" : "if-neg"}`}>{fmtPct(t.quote!.chgPct)}</span>
                </span>
              ))}
              {movers.bottom.map((t) => (
                <span key={`b${t.ticker}`} className="if-mv-row">
                  <span className="if-mv-tkr">{t.ticker}</span>
                  <span className="if-mv-px">{fmtPx(t.quote!.price)}</span>
                  <span className={`if-mv-pct ${t.quote!.chgPct >= 0 ? "if-pos" : "if-neg"}`}>{fmtPct(t.quote!.chgPct)}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
