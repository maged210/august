"use client";

// MODULE E — DESK BIAS BARS (G3 round 4). Two opposing horizontal bars —
// bullish weight vs bearish — computed ONLY from data already on screen:
// tracked ideas (direction), LIVE ideas (stated side, else derived — UX4),
// and live tape rows (sentiment). Count-weighted, per-side chips, collapsible.

import { useState } from "react";
import type { FeedCard } from "@/lib/intel/publish";
import type { PublicIdea } from "@/lib/ideas";
import type { PublicTapeEntry } from "@/lib/tape";
import { sideOf } from "./derive";

export default function BiasBarsModule({
  cards,
  liveIdeas,
  tape,
}: {
  cards: FeedCard[];
  liveIdeas: PublicIdea[];
  tape: PublicTapeEntry[];
}) {
  const [open, setOpen] = useState(true);

  // one count per item; INVALIDATED/CLOSED ideas no longer express a view
  const activeCards = cards.filter((c) => c.status !== "INVALIDATED" && c.status !== "CLOSED");
  const bullSyms: string[] = [];
  const bearSyms: string[] = [];
  for (const c of activeCards) {
    if (c.direction === "bullish") bullSyms.push(c.ticker);
    else if (c.direction === "bearish") bearSyms.push(c.ticker);
  }
  for (const i of liveIdeas) {
    // UX4 — a stated side wins over the derived fallback; WATCH weighs nothing
    const side = sideOf(i);
    if (side?.side === "LONG") bullSyms.push(i.instrument);
    else if (side?.side === "SHORT") bearSyms.push(i.instrument);
  }
  for (const t of tape) {
    if (t.sentiment === "bull") bullSyms.push(t.symbol);
    else if (t.sentiment === "bear") bearSyms.push(t.symbol);
  }

  const bull = bullSyms.length;
  const bear = bearSyms.length;
  const total = bull + bear;
  const chips = (syms: string[]) => [...new Set(syms.map((s) => s.toUpperCase()))].slice(0, 8);

  return (
    <section className="ifm" aria-label="Desk bias">
      <button
        type="button"
        className="ifm-h ifm-h-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="ifm-title">DESK BIAS</span>
        <span className="ifm-sub">IDEAS + TAPE · COUNT-WEIGHTED</span>
        <span className="ifm-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        total === 0 ? (
          <div className="ifm-body">
            <span className="if-abs">
              <span className="if-abs-g" aria-hidden="true">
                ∅
              </span>{" "}
              no directional ideas or tape yet
            </span>
          </div>
        ) : (
          <div className="ifm-body ifm-bias">
            <div className="ifm-bias-row">
              <span className="ifm-bias-l if-pos">BULL {bull}</span>
              <span className="ifm-bias-track">
                <span
                  className="ifm-bias-fill bull"
                  style={{ width: `${(bull / total) * 100}%` }}
                />
              </span>
            </div>
            <div className="ifm-bias-row">
              <span className="ifm-bias-l if-neg">BEAR {bear}</span>
              <span className="ifm-bias-track">
                <span
                  className="ifm-bias-fill bear"
                  style={{ width: `${(bear / total) * 100}%` }}
                />
              </span>
            </div>
            {chips(bullSyms).length > 0 ? (
              <div className="ifm-bias-chips">
                {chips(bullSyms).map((s) => (
                  <span key={`b${s}`} className="ifm-chip if-pos">
                    {s}
                  </span>
                ))}
              </div>
            ) : null}
            {chips(bearSyms).length > 0 ? (
              <div className="ifm-bias-chips">
                {chips(bearSyms).map((s) => (
                  <span key={`s${s}`} className="ifm-chip if-neg">
                    {s}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  );
}
