"use client";

// MODULE B — MARKET PULSE (G3). Compact tile row over the EXISTING quotes
// route (Yahoo, server-cached): last price, % chg, mini sparkline each.
// Self-contained: owns its fetch loop; absent quotes simply don't render a
// tile (no mock rows).

import { useEffect, useState } from "react";

const PULSE: Array<{ sym: string; label: string }> = [
  { sym: "SPY", label: "SPY" },
  { sym: "QQQ", label: "QQQ" },
  { sym: "NQ=F", label: "NQ" },
  { sym: "BTC-USD", label: "BTC" },
  { sym: "^VIX", label: "VIX" },
];

type Quote = { price: number; chgPct: number; closes: number[] };

function fmtPx(n: number): string {
  return n >= 1000
    ? Math.round(n).toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function LineSpark({ closes, up }: { closes: number[]; up: boolean }) {
  if (closes.length < 2) return null;
  const W = 56;
  const H = 16;
  let min = Math.min(...closes);
  let max = Math.max(...closes);
  const pad = (max - min) * 0.1 || 1;
  min -= pad;
  max += pad;
  const d = closes
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${((i / (closes.length - 1)) * W).toFixed(1)},${(
          H - 2 - ((v - min) / (max - min)) * (H - 4)
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg className="ifm-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <path
        d={d}
        fill="none"
        style={{ stroke: up ? "var(--rd-bull, #6fa085)" : "var(--rd-bear, #cd7e6d)" }}
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function MarketPulseModule() {
  const [quotes, setQuotes] = useState<Record<string, Quote> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const syms = PULSE.map((p) => p.sym).join(",");
    const pull = () => {
      fetch(`/api/intel/quotes?symbols=${encodeURIComponent(syms)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { quotes?: Record<string, Quote> }) => {
          if (!cancelled && j.quotes) setQuotes(j.quotes);
        })
        .catch(() => {
          /* keep the last good tiles — the pulse is a nicety */
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
  }, []);

  const tiles = PULSE.map((p) => ({ ...p, q: quotes?.[p.sym] })).filter(
    (t) => t.q && Number.isFinite(t.q.price) && t.q.price > 0,
  );

  return (
    <section className="ifm" aria-label="Market pulse">
      <div className="ifm-h">
        <span className="ifm-title">MARKET PULSE</span>
      </div>
      {quotes === null ? (
        <div className="ifm-body ifm-pulse" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="if-skel-bar" style={{ width: 84, height: 30 }} />
          ))}
        </div>
      ) : tiles.length === 0 ? (
        <div className="ifm-body">
          <span className="if-abs">
            <span className="if-abs-g" aria-hidden="true">
              ·
            </span>{" "}
            quotes unreachable
          </span>
        </div>
      ) : (
        <div className="ifm-body ifm-pulse">
          {tiles.map((t) => (
            <span key={t.sym} className="ifm-tile">
              <span className="ifm-tile-l">{t.label}</span>
              <span className="ifm-tile-px">{fmtPx(t.q!.price)}</span>
              <span className={`ifm-tile-chg ${t.q!.chgPct >= 0 ? "if-pos" : "if-neg"}`}>
                {t.q!.chgPct >= 0 ? "+" : ""}
                {t.q!.chgPct.toFixed(1)}%
              </span>
              <LineSpark closes={t.q!.closes} up={t.q!.chgPct >= 0} />
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
