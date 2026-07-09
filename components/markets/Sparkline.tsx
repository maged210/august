"use client";

import { useEffect, useRef } from "react";
import { createChart, AreaSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";

// A tiny lightweight-charts area sparkline. Static after setData (no animation
// loop), so many of them on a watchlist stay cheap.

// Canvas can't consume CSS vars, so resolve the market colors from the root
// tokens when the light theme is on; dark keeps the exact original literals.
function seriesColor(up: boolean): string {
  if (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light") {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(up ? "--pos" : "--neg")
      .trim();
    if (v) return v;
  }
  return up ? "#7fb0a3" : "#bb7d72";
}

export default function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const color = seriesColor(up);
    const chart = createChart(el, {
      width: el.clientWidth || 84,
      height: 26,
      layout: { background: { color: "transparent" }, textColor: "transparent", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderVisible: false },
      crosshair: { horzLine: { visible: false }, vertLine: { visible: false } },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: color,
      lineWidth: 1,
      topColor: color + "30",
      bottomColor: color + "00",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth || 84 });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [up]);

  // Restyle in place when [data-theme] flips (declared after the build effect,
  // so it always sees the freshly built series).
  useEffect(() => {
    const mo = new MutationObserver(() => {
      const color = seriesColor(up);
      seriesRef.current?.applyOptions({
        lineColor: color,
        topColor: color + "30",
        bottomColor: color + "00",
      });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, [up]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !data || data.length < 2) return;
    // sequential integer "times" — the axis is hidden, so this just orders points.
    s.setData(data.map((v, i) => ({ time: (i + 1) as never, value: v })));
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={ref} className="spark" />;
}
