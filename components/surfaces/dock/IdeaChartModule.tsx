"use client";

// MODULE A — IDEA CHART (G3). Clicking any blotter row loads that ticker here.
// TradingView Lightweight Charts (open-source library, bundled — NOT an iframe
// embed widget), lazy-imported inside the effect so the chart engine never
// rides the initial chunk. Data = daily candles from /api/intel/bars (the
// existing Yahoo pipeline; no new source). Matrix-themed from the live token
// values, with ENTRY / TARGET / STOP price lines where stated and the
// TRIGGERED point marked from status history.

import { useEffect, useRef, useState } from "react";
import { chartSymbolFor } from "./derive";

export type ChartSelection = {
  /** blotter row key — lets the grid highlight the charted row */
  key: string;
  ticker: string;
  /** status word shown beside the ticker ("LIVE", "TRIGGERED", …) */
  label: string;
  levels: { entry?: number; target?: number; stop?: number };
  /** first TRIGGERED transition (epoch ms) from status history, if any */
  triggeredAt?: number | null;
};

type Bar = { t: number; o: number; h: number; l: number; c: number };

export default function IdeaChartModule({ selection }: { selection: ChartSelection | null }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "empty">("idle");
  // bump on <html data-theme> flips → full rebuild with the new token values
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  const ticker = selection?.ticker ?? null;
  const entry = selection?.levels.entry;
  const target = selection?.levels.target;
  const stop = selection?.levels.stop;
  const triggeredAt = selection?.triggeredAt ?? null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ticker) {
      setState("idle");
      return;
    }
    let disposed = false;
    let chart: { remove: () => void } | null = null;
    setState("loading");

    (async () => {
      const symbol = chartSymbolFor(ticker);
      const [lib, res] = await Promise.all([
        import("lightweight-charts"),
        fetch(`/api/intel/bars?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (disposed) return;
      const bars: Bar[] = Array.isArray(res?.bars) ? res.bars : [];
      if (bars.length < 2) {
        // free-form instruments the provider can't resolve chart nothing —
        // the honest empty state, never a fake series (FILL 3 rule)
        setState("empty");
        return;
      }

      // Matrix theming from the LIVE token values (light/dark/matrix all work)
      const cs = getComputedStyle(host);
      const tok = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
      const bull = tok("--rd-bull", "#6fa085");
      const bear = tok("--rd-bear", "#cd7e6d");
      const text = tok("--rd-t-faint", "#6b727a");
      const grid = tok("--rd-hair-05", "rgba(255, 255, 255, 0.05)");
      const blue = tok("--rd-blue", "#6aa0c8");
      const mono = tok("--rd-mono", "IBM Plex Mono") || "IBM Plex Mono";

      host.replaceChildren(); // drop any prior chart DOM before mounting anew
      const c = lib.createChart(host, {
        autoSize: true,
        layout: {
          background: { color: "transparent" },
          textColor: text,
          fontSize: 10,
          fontFamily: mono,
        },
        grid: {
          vertLines: { color: grid },
          horzLines: { color: grid },
        },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: false },
        crosshair: { mode: 0 },
      });
      chart = c;
      const series = c.addSeries(lib.CandlestickSeries, {
        upColor: bull,
        downColor: bear,
        borderUpColor: bull,
        borderDownColor: bear,
        wickUpColor: bull,
        wickDownColor: bear,
      });
      series.setData(
        bars.map((b) => ({
          time: b.t as import("lightweight-charts").UTCTimestamp,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        })),
      );

      // stated levels only — an absent level draws nothing (∅ rule)
      const line = (price: number | undefined, color: string, title: string) => {
        if (price == null || !Number.isFinite(price) || price <= 0) return;
        series.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: lib.LineStyle.Dashed,
          axisLabelVisible: true,
          title,
        });
      };
      line(entry, blue, "ENTRY");
      line(target, bull, "TGT");
      line(stop, bear, "STOP");

      // TRIGGERED marker — the first bar at/after the recorded transition;
      // silently absent when the trigger predates the 3-month window
      if (triggeredAt) {
        const trigSec = Math.floor(triggeredAt / 1000);
        const bar = bars.find((b) => b.t >= trigSec) ?? null;
        if (bar) {
          lib.createSeriesMarkers(series, [
            {
              time: bar.t as import("lightweight-charts").UTCTimestamp,
              position: "belowBar",
              color: bull,
              shape: "arrowUp",
              text: "TRIG",
            },
          ]);
        }
      }

      c.timeScale().fitContent();
      setState("ready");
    })().catch(() => {
      if (!disposed) setState("empty");
    });

    return () => {
      disposed = true;
      chart?.remove();
      host.replaceChildren();
    };
    // themeTick forces a rebuild with fresh token values on theme flips
  }, [ticker, entry, target, stop, triggeredAt, themeTick]);

  return (
    <section className="ifm" aria-label="Idea chart">
      <div className="ifm-h">
        <span className="ifm-title">IDEA CHART</span>
        {selection ? (
          <span className="ifm-sub">
            {selection.ticker} · {selection.label}
          </span>
        ) : null}
      </div>
      <div className="ifm-chart-wrap">
        <div ref={hostRef} className="ifm-chart" />
        {state === "loading" ? (
          <div className="ifm-veil" aria-hidden="true">
            <span className="if-skel-bar hi" style={{ width: 90 }} />
          </div>
        ) : null}
        {state === "empty" && selection ? (
          <div className="ifm-veil">
            <span className="if-abs">
              <span className="if-abs-g" aria-hidden="true">
                ·
              </span>{" "}
              no chart data for {selection.ticker}
            </span>
          </div>
        ) : null}
        {state === "idle" ? (
          <div className="ifm-veil">
            <span className="if-abs">
              <span className="if-abs-g" aria-hidden="true">
                ·
              </span>{" "}
              select a blotter row to chart it
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
