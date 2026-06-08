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
    const chart = createChart(el, {
      width: el.clientWidth || 600,
      height: el.clientHeight || 320,
      layout: {
        background: { color: "transparent" },
        textColor: "#8a8a90",
        attributionLogo: false,
        fontFamily: "var(--font-mono), monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.035)" },
        horzLines: { color: "rgba(255,255,255,0.035)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#7fb0a3",
      downColor: "#bb7d72",
      borderVisible: false,
      wickUpColor: "#7fb0a3",
      wickDownColor: "#bb7d72",
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
