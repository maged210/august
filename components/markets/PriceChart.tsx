"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
} from "lightweight-charts";

type Props = { sym: string; kind: string; label: string };
const TFS = ["1D", "1W", "1M"] as const;

// Canvas can't consume CSS vars, so compute the chart's palette from
// [data-theme] + the root tokens; the dark branch keeps the exact original
// literals, the light one inks the chrome/candles for the off-white stage.
function chartPalette() {
  const light =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";
  if (!light) {
    return {
      text: "#8a8a90",
      grid: "rgba(255,255,255,0.035)",
      border: "rgba(255,255,255,0.08)",
      up: "#7fb0a3",
      down: "#bb7d72",
    };
  }
  const cs = getComputedStyle(document.documentElement);
  return {
    text: cs.getPropertyValue("--ash").trim() || "#5c5d63",
    grid: "rgba(22,24,30,0.07)",
    border: "rgba(22,24,30,0.16)",
    up: cs.getPropertyValue("--pos").trim() || "#3c6f5e",
    down: cs.getPropertyValue("--neg").trim() || "#a8584c",
  };
}

export default function PriceChart({ sym, kind, label }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [tf, setTf] = useState<(typeof TFS)[number]>("1D");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  // Create the chart once.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pal = chartPalette();
    const chart = createChart(el, {
      width: el.clientWidth || 600,
      height: el.clientHeight || 320,
      layout: {
        background: { color: "transparent" },
        textColor: pal.text,
        attributionLogo: false,
        fontFamily: "var(--font-mono), monospace",
        fontSize: 11, // comfort floor (was 10) — axis labels on the TAPE chart
      },
      grid: {
        vertLines: { color: pal.grid },
        horzLines: { color: pal.grid },
      },
      rightPriceScale: { borderColor: pal.border },
      timeScale: { borderColor: pal.border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: pal.up,
      downColor: pal.down,
      borderVisible: false,
      wickUpColor: pal.up,
      wickDownColor: pal.down,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (ref.current) {
        chart.applyOptions({
          width: ref.current.clientWidth,
          height: ref.current.clientHeight,
        });
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Restyle in place when [data-theme] flips — no rebuild, the loaded candles
  // and scales stay put; only the palette is re-applied.
  useEffect(() => {
    const mo = new MutationObserver(() => {
      const pal = chartPalette();
      chartRef.current?.applyOptions({
        layout: { textColor: pal.text },
        grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
        rightPriceScale: { borderColor: pal.border },
        timeScale: { borderColor: pal.border },
      });
      seriesRef.current?.applyOptions({
        upColor: pal.up,
        downColor: pal.down,
        wickUpColor: pal.up,
        wickDownColor: pal.down,
      });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  // Load candles whenever the symbol or timeframe changes.
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    fetch(`/api/markets/history?sym=${encodeURIComponent(sym)}&kind=${kind}&tf=${tf}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !seriesRef.current) return;
        const candles = (j.candles || []) as CandlestickData[];
        if (candles.length) {
          seriesRef.current.setData(candles);
          chartRef.current?.timeScale().fitContent();
          setStatus("ok");
        } else {
          setStatus("error");
        }
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [sym, kind, tf]);

  return (
    <section className="panel mk-chart">
      <div className="panel-head chart-head">
        <span className="chart-title">{label}</span>
        <div className="tf-toggles">
          {TFS.map((t) => (
            <button
              key={t}
              type="button"
              className={`tf${t === tf ? " active" : ""}`}
              onClick={() => setTf(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-body" ref={ref}>
        {status !== "ok" ? (
          <div className="chart-skeleton">
            {status === "loading" ? `loading ${label} · ${tf}…` : `no data · ${label} · ${tf}`}
          </div>
        ) : null}
      </div>
    </section>
  );
}
