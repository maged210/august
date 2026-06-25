"use client";

// TradingView chart — PATH A: the official, free "Advanced Real-Time Chart" embed
// widget (script + iframe). This repo has NO licensed TradingView Advanced Charts
// library, so we use the supported public widget. Consequences we handle honestly:
//   • The widget renders in an IFRAME we cannot draw into — so creator levels CANNOT be
//     painted on the chart. They live in a synchronized rail beside it instead.
//   • Attribution is kept (the widget's required copyright link), per TradingView ToS.
//   • Lazy-loaded: the script is only injected once the chart scrolls into view.
//   • Rebuilt on symbol/interval change; torn down on unmount (no leaked scripts).
//   • This is market DATA from TradingView's own widget — we never scrape their site.

import { useEffect, useRef, useState } from "react";
import { useSymbol } from "./symbolContext";

const SCRIPT_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
const INTERVALS: { key: string; label: string }[] = [
  { key: "5", label: "5m" },
  { key: "15", label: "15m" },
  { key: "60", label: "1H" },
  { key: "D", label: "1D" },
  { key: "W", label: "1W" },
];

export default function TradingViewIntelChart({ height = 460 }: { height?: number }) {
  const { symbol } = useSymbol();
  const [interval, setInterval] = useState("D");
  const [inView, setInView] = useState(false);
  const [failed, setFailed] = useState(false);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  // Lazy: only build the widget once it is near the viewport.
  useEffect(() => {
    const el = holderRef.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setInView(true)),
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  // (Re)build the widget when the symbol/interval changes (and once in view).
  useEffect(() => {
    if (!inView) return;
    const mount = widgetRef.current;
    if (!mount) return;
    setFailed(false);
    mount.innerHTML = "";

    const container = document.createElement("div");
    container.className = "tradingview-widget-container__widget";
    container.style.height = `${height - 32}px`;
    mount.appendChild(container);

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol,
      interval,
      theme: "dark",
      style: "1",
      locale: "en",
      autosize: true,
      hide_side_toolbar: true,
      allow_symbol_change: true,
      backgroundColor: "rgba(10, 11, 13, 1)",
      gridColor: "rgba(120, 130, 140, 0.08)",
      withdateranges: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    const fail = setTimeout(() => {
      // If the iframe never injected (blocked / offline), surface an honest fallback.
      if (!mount.querySelector("iframe")) setFailed(true);
    }, 6000);
    script.onerror = () => setFailed(true);
    mount.appendChild(script);
    return () => clearTimeout(fail);
  }, [symbol, interval, inView, height]);

  return (
    <div className="tvchart" ref={holderRef} style={{ height }}>
      <div className="tvchart-bar">
        <span className="tvchart-sym">{symbol}</span>
        <div className="tvchart-ints">
          {INTERVALS.map((i) => (
            <button
              key={i.key}
              className={`tvchart-int${interval === i.key ? " on" : ""}`}
              onClick={() => setInterval(i.key)}
              type="button"
            >
              {i.label}
            </button>
          ))}
        </div>
      </div>
      {failed ? (
        <div className="tvchart-fallback">
          <div>Chart unavailable (the TradingView widget didn&apos;t load).</div>
          <a className="idea-cite" href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noreferrer">
            ▸ open {symbol} on TradingView
          </a>
        </div>
      ) : (
        <div className="tradingview-widget-container" ref={widgetRef} style={{ height: height - 32 }}>
          {!inView && <div className="tvchart-skel">Loading chart…</div>}
        </div>
      )}
      <div className="tvchart-attr">
        <a href={`https://www.tradingview.com/symbols/${encodeURIComponent(symbol)}/`} target="_blank" rel="noreferrer">
          {symbol} chart
        </a>{" "}
        by TradingView
      </div>
    </div>
  );
}
