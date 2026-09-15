"use client";

// UX2-T4/T5 — THE DESK HEATMAP + MOVERS STRIP. A Finviz-style map of OUR
// book: ONE TILE PER TICKER over the published book's live calls (first
// occurrence wins — the list arrives newest-first). Equal tile sizing stays
// the honest layout (no position data exists — a plain filled grid IS the
// squarified treemap for equal weights; hand-rolled, zero dependencies).
// Color encodes TODAY's % move off the existing price pipeline: live
// instruments ride one /api/intel/quotes call (the desk shorthand mapped
// through chartSymbolFor). No quote → a neutral ∅ tile, never a fabricated
// zero. Tile click = the desk's ONE selection (chart dock + detail panel +
// ?idea=). Under the map: today's top/bottom three.
//
// chore/terminal-cut: the tracked cards (the retired desk's publish pipeline)
// no longer feed the map — the book is the live book.
//
// T3 folded the old Desk Bias here: the header carries the long/short book
// counts ("BOOK — n LONG · n SHORT · n unset").

import { useEffect, useMemo, useState } from "react";
import type { PublicIdea } from "@/lib/ideas";
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
  select: ChartSelection;
};

export default function BookHeatmapModule({
  liveIdeas,
  sourcesAnswered = true,
  selection,
  onSelect,
}: {
  liveIdeas: PublicIdea[];
  /** fix/p0-live-trust — false while the book is still loading or has
   *  failed. `liveIdeas` defaults to [] in the parent, so without this the
   *  module cannot tell an empty book from an unread one and states
   *  "0 LONG · 0 SHORT · 0 UNSET" and "nothing on the book yet" as fact. */
  sourcesAnswered?: boolean;
  selection: ChartSelection | null;
  onSelect: (sel: ChartSelection) => void;
}) {
  // today's % for LIVE instruments — one quotes call over the existing route
  const [liveQuotes, setLiveQuotes] = useState<Record<string, Quote>>({});
  const liveSyms = useMemo(
    () => [...new Set(liveIdeas.map((i) => chartSymbolFor(i.instrument)))].sort().join(","),
    [liveIdeas],
  );
  useEffect(() => {
    if (!liveSyms) return;
    let cancelled = false;
    const pull = () => {
      fetch(`/api/intel/quotes?symbols=${encodeURIComponent(liveSyms)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { quotes?: Record<string, Quote> }) => {
          if (!cancelled && j.quotes) setLiveQuotes(j.quotes);
        })
        .catch(() => {
          /* tiles fall back to their honest ∅ state */
        });
    };
    pull();
    const id = window.setInterval(() => {
      if (!document.hidden) pull();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [liveSyms]);

  const tiles: Tile[] = useMemo(() => {
    // ONE TILE PER TICKER — first occurrence (newest) wins
    const seen = new Set<string>();
    const out: Tile[] = [];
    for (const i of liveIdeas) {
      const ticker = i.instrument.toUpperCase();
      if (seen.has(ticker)) continue;
      seen.add(ticker);
      const s = sideOf(i);
      const q = liveQuotes[chartSymbolFor(i.instrument)];
      out.push({
        key: `live:${i.id}`,
        ticker,
        side: s?.side === "LONG" ? "LONG" : s?.side === "SHORT" ? "SHORT" : null,
        quote: q && Number.isFinite(q.chgPct) && q.price > 0 ? q : null,
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
  }, [liveIdeas, liveQuotes]);

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
                title={`${t.ticker}${t.quote ? ` · ${fmtPct(t.quote.chgPct)} today` : " · no quote"} — click to select`}
                onClick={() => onSelect(t.select)}
              >
                <span className="if-hm-tkr">{t.ticker}</span>
                <span className="if-hm-pct">{t.quote ? fmtPct(t.quote.chgPct) : "·"}</span>
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
