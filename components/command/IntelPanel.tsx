"use client";

import { useCallback, useEffect, useState } from "react";
import type { Intel } from "@/lib/intel";
import WidgetState from "@/components/WidgetState";

const REFRESH_MS = 5 * 60_000;

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });

// The Intel feed, folded onto the World globe as a collapsible glass panel docked
// to the right: live wire headlines + AUGUST's grounded synthesis. Reads the SAME
// /api/intel the Morning Brief consumes — this is a surface merge, not a new data
// path. Pointer-events live on this box only so the globe keeps its drag/zoom
// everywhere else; it reports its live-wire count up for the World HUD.
export default function IntelPanel({ onCount }: { onCount?: (n: number) => void }) {
  const [data, setData] = useState<Intel | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  // Open on a roomy viewport; start collapsed at narrow widths so the globe reads
  // clean. The 760px boundary matches the CSS @media(max-width:760px) that drops
  // the panel to a mobile chip — keep them in lock-step (no styled-but-collapsed
  // seam): >760 → desktop right-dock, open; ≤760 → mobile chip, collapsed.
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 760);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/intel", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const j: Intel = await res.json();
      setData(j);
      setStatus("live");
      onCount?.(j.articles?.length ?? 0);
    } catch {
      // Sticky-live: a refresh blip never blanks an already-live feed.
      setStatus((s) => (s === "live" ? "live" : "error"));
    }
  }, [onCount]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const fallback = (rows: number) => (
    <WidgetState state={status === "error" ? "error" : "loading"} rows={rows} onRetry={load} />
  );

  const n = data?.articles?.length ?? 0;

  return (
    <div className={`command-intel${open ? " open" : ""}`}>
      <button
        type="button"
        className="command-intel-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? "Collapse intel" : "Expand intel"}
      >
        <span className="command-intel-title">Intel</span>
        <span className="command-intel-meta">
          <span className={`mkt-dot ${status}`} />
          {status === "live" ? `${n} WIRES` : status === "error" ? "OFFLINE" : "…"}
        </span>
        <span className="command-intel-chev" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div className="command-intel-body">
          <section className="ci-block">
            <div className="ci-head">Wire feed</div>
            {data ? (
              data.articles.length ? (
                <ul className="feed-list">
                  {data.articles.map((a, i) => (
                    <li key={a.url || i}>
                      <span className="feed-src">{a.source}</span>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="feed-link"
                      >
                        {a.headline}
                      </a>
                      {a.publishedAt > 0 && (
                        <span className="feed-time">{fmtTime(a.publishedAt)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <WidgetState state="empty" />
              )
            ) : (
              fallback(5)
            )}
          </section>

          <section className="ci-block">
            <div className="ci-head">AUGUST · Synthesis</div>
            {data ? (
              data.synthesis ? (
                <>
                  <p className="synth-body">{data.synthesis}</p>
                  {data.updatedAt > 0 && (
                    <div className="synth-meta">synthesized · {fmtTime(data.updatedAt)}</div>
                  )}
                </>
              ) : (
                <WidgetState state="empty" />
              )
            ) : (
              fallback(3)
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
