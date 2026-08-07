"use client";

// MODULE C — DESK STATS (G3). A thin strip computed ONLY from the tracked
// ideas already on the wire (FeedCard rows) — zero new data sources. Every
// number is labeled by what it actually measures; absent measurements render
// the ∅ treatment, never a zero.

import type { FeedCard } from "@/lib/intel/publish";

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export default function DeskStatsModule({ cards }: { cards: FeedCard[] }) {
  const tracked = cards.length;
  const triggered = cards.filter(
    (c) => c.status === "TRIGGERED" || c.status === "TARGET_HIT",
  ).length;

  // win rate / best / worst — since-called measurements ONLY (the ° price-
  // since-mention numbers are not trade P&L and stay out of the stats)
  const called = cards.filter(
    (c): c is FeedCard & { pnl: { kind: "since_called"; pct: number } } =>
      !!c.pnl && c.pnl.kind === "since_called",
  );
  const wins = called.filter((c) => c.pnl.pct > 0).length;
  const winRate = called.length > 0 ? (wins / called.length) * 100 : null;
  const best =
    called.length > 0
      ? called.reduce((a, b) => (a.pnl.pct >= b.pnl.pct ? a : b))
      : null;
  const worst =
    called.length > 0
      ? called.reduce((a, b) => (a.pnl.pct <= b.pnl.pct ? a : b))
      : null;

  const mfes = cards.filter((c) => c.mfeMae);
  const avgMfe =
    mfes.length > 0 ? mfes.reduce((s, c) => s + c.mfeMae!.mfePct, 0) / mfes.length : null;
  const avgMae =
    mfes.length > 0 ? mfes.reduce((s, c) => s + c.mfeMae!.maePct, 0) / mfes.length : null;

  const row = (label: string, value: React.ReactNode) => (
    <div className="ifm-stat">
      <span className="ifm-stat-l">{label}</span>
      <span className="ifm-stat-v">{value}</span>
    </div>
  );
  const absent = (
    <span className="if-abs">
      <span className="if-abs-g" aria-hidden="true">
        ∅
      </span>{" "}
      none yet
    </span>
  );

  return (
    <section className="ifm" aria-label="Desk stats">
      <div className="ifm-h">
        <span className="ifm-title">DESK STATS</span>
        <span className="ifm-sub">SINCE-CALL BASIS</span>
      </div>
      <div className="ifm-body ifm-stats">
        {row("TRACKED", <>{tracked}</>)}
        {row("TRIGGERED", <>{triggered}</>)}
        {row(
          "WIN RATE",
          winRate != null ? (
            <>
              {winRate.toFixed(0)}%{" "}
              <span className="ifm-stat-n">
                {wins}/{called.length}
              </span>
            </>
          ) : (
            absent
          ),
        )}
        {row(
          "AVG MFE / MAE",
          avgMfe != null && avgMae != null ? (
            <>
              <span className="if-pos">{pct(avgMfe)}</span> /{" "}
              <span className="if-neg">{pct(avgMae)}</span>
            </>
          ) : (
            absent
          ),
        )}
        {row(
          "BEST CALL",
          best ? (
            <>
              {best.ticker} <span className="if-pos">{pct(best.pnl.pct)}</span>
            </>
          ) : (
            absent
          ),
        )}
        {row(
          "WORST CALL",
          worst ? (
            <>
              {worst.ticker}{" "}
              <span className={worst.pnl.pct >= 0 ? "if-pos" : "if-neg"}>
                {pct(worst.pnl.pct)}
              </span>
            </>
          ) : (
            absent
          ),
        )}
      </div>
    </section>
  );
}
