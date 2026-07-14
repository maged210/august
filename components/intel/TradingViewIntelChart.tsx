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

// The widget paints inside an iframe, so it cannot read our CSS variables. These
// literals are the iframe-side mirror of the desk's --rd-tv-bg / chart-grid tokens:
// dark values serve data-theme dark AND batman (the desk's dark skin), light values
// mirror the [data-theme="light"] token block in app/intel/tokens.css.
const TV_THEME = {
  dark: { theme: "dark" as const, backgroundColor: "rgba(10, 11, 13, 1)", gridColor: "rgba(120, 130, 140, 0.08)" },
  light: { theme: "light" as const, backgroundColor: "rgba(248, 247, 243, 1)", gridColor: "rgba(30, 28, 22, 0.07)" },
};

function readDeskTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

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
  const [reloadKey, setReloadKey] = useState(0); // bump to force a rebuild (Retry)
  // Desk theme (light vs dark/batman): SSR renders no widget, so "dark" is a safe
  // pre-mount default; the observer effect corrects it before the lazy build runs.
  const [deskTheme, setDeskTheme] = useState<"light" | "dark">(() =>
    typeof document === "undefined" ? "dark" : readDeskTheme(),
  );
  const holderRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  // Follow live theme cycling: watch data-theme on <html> (stamped by layout.tsx's
  // pre-hydration script and re-stamped by the home shell's theme toggle). A change
  // flips the state, which re-runs the build effect below — the same rebuild path a
  // symbol/interval change takes.
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDeskTheme(readDeskTheme());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

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
    const tv = TV_THEME[deskTheme];
    script.innerHTML = JSON.stringify({
      symbol,
      interval,
      theme: tv.theme,
      style: "1",
      locale: "en",
      autosize: true,
      hide_side_toolbar: true,
      allow_symbol_change: true,
      backgroundColor: tv.backgroundColor,
      gridColor: tv.gridColor,
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
    // reloadKey lets the Retry button force a rebuild even when symbol/interval are unchanged.
  }, [symbol, interval, inView, height, reloadKey, deskTheme]);

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
      {/* The widget container stays mounted ALWAYS so a symbol/interval change (or Retry)
          can rebuild it; the fallback is overlaid on top rather than replacing it — that
          way a transient load failure is recoverable instead of permanently stuck. */}
      <div className="tvchart-body" style={{ height: height - 32 }}>
        <div className="tradingview-widget-container" ref={widgetRef} style={{ height: height - 32 }}>
          {!inView && <div className="tvchart-skel">Loading chart…</div>}
        </div>
        {failed && (
          <div className="tvchart-fallback tvchart-overlay">
            <div>Chart unavailable (the TradingView widget didn&apos;t load).</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button type="button" className="ibtn ibtn-sm" onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
              <a className="idea-cite" href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noreferrer">
                ▸ open {symbol} on TradingView
              </a>
            </div>
          </div>
        )}
      </div>
      <div className="tvchart-attr">
        <a href={`https://www.tradingview.com/symbols/${encodeURIComponent(symbol)}/`} target="_blank" rel="noreferrer">
          {symbol} chart
        </a>{" "}
        by TradingView
      </div>
    </div>
  );
}
