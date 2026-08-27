"use client";

// UX2-T4/T5 — THE DESK HEATMAP + MOVERS STRIP. A Finviz-style map of OUR
// book. INTEGRITY-1 DEDUPE RULE: ONE TILE PER TICKER — an instrument that is
// both a live desk call and a tracked card renders once, and TRACKED WINS
// while its lifecycle is OPEN (the tracked card carries the measured
// lifecycle; the live row is the same call before measurement). A TERMINAL
// tracked card (target hit / invalidated / closed) is history and never
// shadows a current live call on the same ticker. Within a source, first
// occurrence wins (both lists arrive newest-first). Equal tile sizing stays
// the honest layout (no
// position data exists — a plain filled grid IS the squarified treemap for
// equal weights; hand-rolled, zero dependencies). Color encodes
// TODAY's % move off the existing price pipeline: tracked rows already carry
// their quote; live instruments ride one /api/intel/quotes call (the desk
// shorthand mapped through chartSymbolFor). No quote → a neutral ∅ tile,
// never a fabricated zero. Tile click = the desk's ONE selection (chart dock
// + detail panel + ?idea=). Under the map: today's top/bottom three.
//
// T3 folded the old Desk Bias here: the header carries the long/short book
// counts ("BOOK — n LONG · n SHORT · n unset").

import { useEffect, useMemo, useState } from "react";
import type { FeedCard } from "@/lib/intel/publish";
import type { PublicIdea } from "@/lib/ideas";
import type { ChartSelection } from "./IdeaChartModule";
import { chartSymbolFor, selectionFromLive, selectionFromTracked, sideOf } from "./derive";

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
  cards,
  liveIdeas,
  selection,
  onSelect,
}: {
  cards: FeedCard[];
  liveIdeas: PublicIdea[];
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
    // ONE TILE PER TICKER, TRACKED WINS — while the lifecycle is OPEN. Order
    // of claim: open tracked cards (ARMED/ACTIVE/TRIGGERED — the measured
    // current call), then live desk calls, then terminal tracked cards
    // (TARGET_HIT/INVALIDATED/CLOSED — history must not shadow a current call
    // on the same ticker). Within a source, first occurrence (newest) wins.
    const seen = new Set<string>();
    const out: Tile[] = [];
    const trackedTile = (c: FeedCard): Tile => ({
      key: `trk:${c.id}`,
      ticker: c.ticker.toUpperCase(),
      side: c.direction === "bullish" ? "LONG" : c.direction === "bearish" ? "SHORT" : null,
      quote: c.quote && Number.isFinite(c.quote.chgPct) ? c.quote : null,
      select: selectionFromTracked(c),
    });
    const isOpen = (c: FeedCard) =>
      c.status === "ARMED" || c.status === "ACTIVE" || c.status === "TRIGGERED";
    for (const c of cards.filter(isOpen)) {
      const ticker = c.ticker.toUpperCase();
      if (seen.has(ticker)) continue;
      seen.add(ticker);
      out.push(trackedTile(c));
    }
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
    for (const c of cards.filter((c) => !isOpen(c))) {
      const ticker = c.ticker.toUpperCase();
      if (seen.has(ticker)) continue;
      seen.add(ticker);
      out.push(trackedTile(c));
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
  }, [liveIdeas, cards, liveQuotes]);

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
          {longs} LONG · {shorts} SHORT · {unset} UNSET
        </span>
      </div>
      {tiles.length === 0 ? (
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
          <div className="if-hm" role="listbox" aria-label="Book heatmap — one tile per ticker, tracked wins">
            {tiles.map((t) => {
              // key match, or ticker match when the selected row's tile was
              // claimed by the other source — the map always shows where the
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
