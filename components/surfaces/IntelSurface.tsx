"use client";

import { useCallback, useEffect, useState } from "react";
import type { Intel } from "@/lib/intel";
import WidgetState from "@/components/WidgetState";

const REFRESH_MS = 5 * 60_000;

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });

export default function IntelSurface() {
  const [data, setData] = useState<Intel | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [updated, setUpdated] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/intel", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const j: Intel = await res.json();
      setData(j);
      setStatus("live");
      setUpdated(new Date().toLocaleTimeString("en-US", { hour12: false }));
    } catch {
      setStatus((s) => (s === "live" ? "live" : "error"));
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const fallback = (rows: number) => (
    <WidgetState state={status === "error" ? "error" : "loading"} rows={rows} onRetry={load} />
  );

  return (
    <div className="surface intel-surface">
      <header className="surface-head">
        <h2 className="surface-title">Intel</h2>
        <div className="mkt-status">
          <span className={`mkt-dot ${status}`} />
          <span className="mkt-status-text">
            {status === "live"
              ? `LIVE · ${updated} · wire feeds`
              : status === "error"
                ? "feeds unavailable — retrying"
                : "connecting to feeds…"}
          </span>
        </div>
      </header>

      <div className="intel-grid">
        <section className="panel intel-feed">
          <div className="panel-head">Sources</div>
          {data ? (
            data.articles.length ? (
              <ul className="feed-list">
                {data.articles.map((a, i) => (
                  <li key={i}>
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
            fallback(6)
          )}
        </section>

        <section className="panel intel-synth">
          <div className="panel-head">AUGUST · Synthesis</div>
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

        <section className="panel intel-globe">
          <div className="panel-head">Globe</div>
          <p className="globe-hint">
            Ask me to <em>look closer</em> at any place — &ldquo;show me the Strait of
            Hormuz&rdquo; — and I&rsquo;ll open the globe over the deck and fly there.
          </p>
          <span className="todo">overlay active · data layers later</span>
        </section>
      </div>
    </div>
  );
}
