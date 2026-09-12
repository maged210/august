"use client";

// MODULE B — MARKET PULSE (G3). Compact tile row over the EXISTING quotes
// route (Yahoo, server-cached): last price, % chg, mini sparkline each.
// Self-contained: owns its fetch loop; absent quotes simply don't render a
// tile (no mock rows).

import DataTag from "@/components/DataTag";
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
        <DataTag kind="delayed" detail="60s" title="Yahoo quotes · 60s server cache" />
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
        /* feature/density-pass — five PLAIN ROWS, reusing the module-stats row
           primitive that is already styled (.ifm-stat*): label left, value
           right, hairline between. The tiles and the sparkline are gone. A
           symbol whose quote failed still renders no row — 0-5, not padded. */
        <div className="ifm-body ifm-stats">
          {tiles.map((t) => (
            <div key={t.sym} className="ifm-stat">
              <span className="ifm-stat-l">{t.label}</span>
              <span className="ifm-stat-v">
                {fmtPx(t.q!.price)}{" "}
                <span className={t.q!.chgPct >= 0 ? "if-pos" : "if-neg"}>
                  {t.q!.chgPct >= 0 ? "+" : ""}
                  {t.q!.chgPct.toFixed(1)}%
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
