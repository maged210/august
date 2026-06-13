"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Markets } from "@/lib/markets";
import Gauge from "@/components/markets/Gauge";
import WidgetState from "@/components/WidgetState";

// WebGL/canvas chart components — browser only.
const PriceChart = dynamic(() => import("@/components/markets/PriceChart"), { ssr: false });
const Sparkline = dynamic(() => import("@/components/markets/Sparkline"), {
  ssr: false,
  loading: () => <div className="spark" />,
});

const REFRESH_MS = 30_000;
const POS = "#7fb0a3";
const NEG = "#bb7d72";
const ASH = "#8a8a90";
const AMBER = "#c9a24a";
const GREEN = "#9bbf8a";

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const sign = (n: number) => (n >= 0 ? "pos" : "neg");
const fmt = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const last = (n: number) =>
  n >= 1000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Selected = { sym: string; kind: string; label: string };
const DEFAULT_SELECTED: Selected = { sym: "QQQ", kind: "yahoo", label: "QQQ · NQ proxy" };

export default function MarketsSurface() {
  const [data, setData] = useState<Markets | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [updated, setUpdated] = useState("");
  const [selected, setSelected] = useState<Selected>(DEFAULT_SELECTED);

  // Exposed so the shared error state's RETRY button can refetch directly.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const j: Markets = await res.json();
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

  const levels = data?.levels ?? null;
  const fredMissing = !!data && !data.macro.fredAvailable;
  // Shared non-data state for every panel: skeleton while connecting, FEED
  // OFFLINE · RETRY if the first load failed. Stale data keeps rendering as data.
  const fallback = (rows: number) => (
    <WidgetState state={status === "error" ? "error" : "loading"} rows={rows} onRetry={load} />
  );

  return (
    <div className="surface markets-surface">
      <header className="surface-head">
        <h2 className="surface-title">Markets</h2>
        <div className="mkt-status">
          <span className={`mkt-dot ${status}`} />
          <span className="mkt-status-text">
            {status === "live"
              ? `LIVE · ${updated} · delayed free proxies`
              : status === "error"
                ? "feed unavailable — retrying"
                : "connecting to feeds…"}
          </span>
        </div>
      </header>

      <div className="markets-grid">
        {/* sector strip */}
        <section className="panel mk-sectors">
          <div className="panel-head">Sectors</div>
          {data ? (
            data.sectors.length ? (
              <div className="sector-strip">
                {data.sectors.map((s) => (
                  <div key={s.etf} className="sector-chip" title={s.etf}>
                    <span className="sector-name">{s.name}</span>
                    <span className={sign(s.chgPct)}>{pct(s.chgPct)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <WidgetState state="empty" />
            )
          ) : (
            fallback(2)
          )}
        </section>

        {/* watchlist with sparklines (proxies + crypto) */}
        <section className="panel mk-watch">
          <div className="panel-head">Watchlist · click to chart</div>
          {data ? (
            !data.watchlist.length ? (
              <WidgetState state="empty" />
            ) : (
            <table className="term-table watch-table">
              <tbody>
                {data.watchlist.map((q) => (
                  <tr
                    key={q.sym}
                    className={`watch-row${selected.sym === q.chartSym ? " sel" : ""}`}
                    onClick={() =>
                      setSelected({ sym: q.chartSym, kind: q.kind, label: `${q.sym} · ${q.desc}` })
                    }
                  >
                    <td className="t-sym">
                      {q.sym}
                      {q.proxy ? <span className="proxy-tag">px</span> : null}
                    </td>
                    <td className="t-spark">
                      <Sparkline data={q.spark} up={q.chgPct >= 0} />
                    </td>
                    <td className="t-last">{last(q.last)}</td>
                    <td className={`t-chg ${sign(q.chgPct)}`}>{pct(q.chgPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )
          ) : (
            fallback(8)
          )}
        </section>

        {/* hero price chart */}
        <PriceChart sym={selected.sym} kind={selected.kind} label={selected.label} />

        {/* NQ levels */}
        <section className="panel mk-levels">
          <div className="panel-head">NQ · Levels</div>
          {levels ? (
            <>
              <div className="nq-price">
                {fmt(levels.current)}{" "}
                <span className={levels.above ? "pos" : "neg"}>
                  {levels.above ? "above pivot" : "below pivot"}
                </span>
              </div>
              <ul className="kv-list">
                <li className="lvl-res">
                  <span>Resistance</span>
                  <span>{fmt(levels.resistance)}</span>
                </li>
                <li className="lvl-piv">
                  <span>Pivot</span>
                  <span>{fmt(levels.pivot)}</span>
                </li>
                <li className="lvl-sup">
                  <span>Support</span>
                  <span>{fmt(levels.support)}</span>
                </li>
                <li>
                  <span>O/N High</span>
                  <span>{fmt(levels.onHigh)}</span>
                </li>
                <li>
                  <span>O/N Low</span>
                  <span>{fmt(levels.onLow)}</span>
                </li>
              </ul>
              <div className="lvl-note">{levels.proxy} · prior session</div>
            </>
          ) : (
            fallback(5)
          )}
        </section>

        {/* gauge cluster */}
        <section className="panel mk-gauges">
          <div className="panel-head">
            Gauges {fredMissing ? <span className="todo">FRED key for macro</span> : null}
          </div>
          <div className="gauge-grid">
            <Gauge
              label="Crypto Fear / Greed"
              value={data?.fng?.value ?? null}
              min={0}
              max={100}
              display={(v) => String(Math.round(v))}
              note={data?.fng?.label}
              zones={[
                { upTo: 25, color: NEG },
                { upTo: 45, color: AMBER },
                { upTo: 55, color: ASH },
                { upTo: 75, color: GREEN },
                { upTo: 100, color: POS },
              ]}
            />
            <Gauge
              label="VIX"
              value={data?.vix ?? null}
              min={10}
              max={40}
              display={(v) => v.toFixed(1)}
              zones={[
                { upTo: 15, color: POS },
                { upTo: 20, color: ASH },
                { upTo: 30, color: AMBER },
                { upTo: 40, color: NEG },
              ]}
            />
            <Gauge
              label="10Y − 2Y"
              value={data?.macro.t10y2y ?? null}
              min={-1}
              max={3}
              display={(v) => `${v.toFixed(2)}%`}
              note={data?.macro.t10y2y != null && data.macro.t10y2y < 0 ? "inverted" : undefined}
              unavailable={fredMissing ? "needs FRED key" : undefined}
              zones={[
                { upTo: 0, color: NEG },
                { upTo: 3, color: POS },
              ]}
            />
            <Gauge
              label="Fin. Stress"
              value={data?.macro.stress ?? null}
              min={-2}
              max={4}
              display={(v) => v.toFixed(2)}
              unavailable={fredMissing ? "needs FRED key" : undefined}
              zones={[
                { upTo: 0, color: POS },
                { upTo: 4, color: NEG },
              ]}
            />
          </div>
        </section>

        {/* movers */}
        <section className="panel mk-movers">
          <div className="panel-head">Movers</div>
          {data ? (
            !data.movers.gainers.length &&
            !data.movers.losers.length &&
            !data.movers.actives.length ? (
              <WidgetState state="empty" />
            ) : (
            <div className="movers-cols">
              <div>
                <div className="movers-h pos">Gainers</div>
                {data.movers.gainers.map((m) => (
                  <div key={m.sym} className="mover">
                    <span className="mover-sym">{m.sym}</span>
                    <span className="pos">{pct(m.chgPct)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="movers-h neg">Losers</div>
                {data.movers.losers.map((m) => (
                  <div key={m.sym} className="mover">
                    <span className="mover-sym">{m.sym}</span>
                    <span className="neg">{pct(m.chgPct)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="movers-h">Active</div>
                {data.movers.actives.map((m) => (
                  <div key={m.sym} className="mover">
                    <span className="mover-sym">{m.sym}</span>
                    <span className={sign(m.chgPct)}>{pct(m.chgPct)}</span>
                  </div>
                ))}
              </div>
            </div>
            )
          ) : (
            fallback(5)
          )}
        </section>

        {/* econ calendar */}
        <section className="panel mk-econ">
          <div className="panel-head">Economic Calendar · US · today</div>
          {data ? (
            <ul className="econ-list">
              {data.econ.length ? (
                data.econ.map((e, i) => (
                  <li key={i}>
                    <span className="econ-t">{e.time}</span>
                    <span className="econ-e">{e.title}</span>
                    <span className={`econ-i ${e.impact}`}>{e.impact || "—"}</span>
                  </li>
                ))
              ) : (
                <li className="muted">No US events today</li>
              )}
            </ul>
          ) : (
            fallback(4)
          )}
        </section>

        {/* flow lite */}
        <section className="panel mk-flow">
          <div className="panel-head">
            Flow · Lite <span className="todo">proxy</span>
          </div>
          {data ? (
            data.flow.length ? (
              <ul className="flow-list">
                {data.flow.map((f) => (
                  <li key={f.sym}>
                    <span className="flow-sym">{f.sym}</span>
                    <span className={sign(f.chgPct)}>{pct(f.chgPct)}</span>
                    <span className="flow-mult">{f.volMult.toFixed(1)}× vol</span>
                  </li>
                ))}
              </ul>
            ) : (
              <WidgetState state="empty" />
            )
          ) : (
            fallback(5)
          )}
          <div className="flow-note">
            Unusual equity volume — free stand-in for options flow (real flow is paid).
          </div>
        </section>
      </div>
    </div>
  );
}
