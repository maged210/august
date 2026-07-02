"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Markets } from "@/lib/markets";
import type { DailyBrief } from "@/lib/intel/types";
import Gauge from "@/components/markets/Gauge";
import WidgetState from "@/components/WidgetState";
import BriefPanel from "@/components/intel/BriefPanel";
import { etDateKey } from "@/lib/intel/session";

// WebGL/canvas chart components — browser only.
const PriceChart = dynamic(() => import("@/components/markets/PriceChart"), { ssr: false });
const Sparkline = dynamic(() => import("@/components/markets/Sparkline"), {
  ssr: false,
  loading: () => <div className="spark" />,
});

const REFRESH_MS = 30_000;
// Brief polling is deliberately slower than the tape — a brief changes at most a
// few times a day, and it only polls while this surface is actually on screen.
const BRIEF_REFRESH_MS = 60_000;
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

// DESK (today's brief) is the default read; TAPE is the full live grid; ARCHIVE
// is past briefs only — today never appears there.
type Tab = "DESK" | "TAPE" | "ARCHIVE";
const TABS: Tab[] = ["DESK", "TAPE", "ARCHIVE"];

type BriefFetch = { brief: DailyBrief | null; ownerView: boolean };

export default function MarketsSurface() {
  const [data, setData] = useState<Markets | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [updated, setUpdated] = useState("");
  const [selected, setSelected] = useState<Selected>(DEFAULT_SELECTED);
  const [tab, setTab] = useState<Tab>("DESK");

  // Desk: today's DailyBrief (redacted server-side unless INTEL_OWNER_VIEW).
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [ownerView, setOwnerView] = useState(false);
  const [briefStatus, setBriefStatus] = useState<"loading" | "ready" | "error">("loading");
  const [compiling, setCompiling] = useState(false);
  const [compileMsg, setCompileMsg] = useState<string | null>(null);

  // Archive: past brief dates, expanded rows lazy-fetch their brief once.
  const [archDates, setArchDates] = useState<string[] | null>(null);
  const [archOpen, setArchOpen] = useState<string | null>(null);
  const [archBriefs, setArchBriefs] = useState<Record<string, BriefFetch | "loading" | "error">>({});

  const rootRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(false);

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

  const loadBrief = useCallback(async () => {
    try {
      const res = await fetch(`/api/intel/briefs/${etDateKey()}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const j = (await res.json()) as BriefFetch;
      setBrief(j.brief ?? null);
      setOwnerView(!!j.ownerView);
      setBriefStatus("ready");
    } catch {
      setBriefStatus((s) => (s === "ready" ? "ready" : "error"));
    }
  }, []);

  // The deck keeps every surface mounted, so gate the brief fetch on actual
  // visibility (IntersectionObserver on the surface root — no Deck/page wiring
  // needed): first sight fetches immediately, then a modest cadence while shown.
  useEffect(() => {
    const el = rootRef.current;
    let fetched = false;
    const fetchOnce = () => {
      if (!fetched) {
        fetched = true;
        loadBrief();
      }
    };
    let io: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        ([e]) => {
          visibleRef.current = e.isIntersecting;
          if (e.isIntersecting) fetchOnce();
        },
        { threshold: 0.4 },
      );
      io.observe(el);
    } else {
      // No observer support — fall back to fetch-on-mount + the same interval.
      visibleRef.current = true;
      fetchOnce();
    }
    const id = window.setInterval(() => {
      if (visibleRef.current) loadBrief();
    }, BRIEF_REFRESH_MS);
    return () => {
      io?.disconnect();
      window.clearInterval(id);
    };
  }, [loadBrief]);

  // Compile today's brief through the existing pipeline route (same path the
  // /intel workbench uses) — shown only when no brief exists yet.
  const compileBrief = useCallback(async () => {
    setCompiling(true);
    setCompileMsg(null);
    try {
      const res = await fetch("/api/intel/briefs/today", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Partial<BriefFetch>;
      if (res.ok && j.ok && j.brief) {
        setBrief(j.brief);
        setOwnerView(!!j.ownerView);
        setBriefStatus("ready");
      } else if (res.status === 501) {
        setCompileMsg("needs ANTHROPIC_API_KEY on the server");
      } else if (res.status === 429) {
        setCompileMsg("rate limited — try again in a moment");
      } else {
        setCompileMsg(j.error ? `compile failed: ${j.error}` : "compile failed");
      }
    } catch {
      setCompileMsg("compile failed — connection");
    } finally {
      setCompiling(false);
    }
  }, []);

  // Archive dates refetch on every visit to the tab — the list is cheap, and a
  // once-only fetch goes stale across the ET midnight rollover (yesterday's brief
  // would be missing until a full reload). Today is excluded by contract: today's
  // brief stands alone on DESK.
  const loadDates = useCallback(async () => {
    try {
      const res = await fetch("/api/intel/briefs", { cache: "no-store" });
      const j = (await res.json()) as { dates?: string[] };
      const today = etDateKey();
      setArchDates(Array.isArray(j.dates) ? j.dates.filter((d) => d < today) : []);
    } catch {
      setArchDates((prev) => prev ?? []); // a stale list beats wiping one already shown
    }
  }, []);

  useEffect(() => {
    if (tab === "ARCHIVE") loadDates();
  }, [tab, loadDates]);

  const fetchArchive = useCallback((date: string) => {
    setArchBriefs((p) => ({ ...p, [date]: "loading" }));
    fetch(`/api/intel/briefs/${encodeURIComponent(date)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: BriefFetch) =>
        setArchBriefs((p) => ({ ...p, [date]: { brief: j.brief ?? null, ownerView: !!j.ownerView } })),
      )
      .catch(() => setArchBriefs((p) => ({ ...p, [date]: "error" })));
  }, []);

  const toggleArchive = (date: string) => {
    setArchOpen((cur) => (cur === date ? null : date));
    if (!archBriefs[date]) fetchArchive(date);
  };

  const levels = data?.levels ?? null;
  const fredMissing = !!data && !data.macro.fredAvailable;
  // Shared non-data state for every panel: skeleton while connecting, FEED
  // OFFLINE · RETRY if the first load failed. Stale data keeps rendering as data.
  const fallback = (rows: number) => (
    <WidgetState state={status === "error" ? "error" : "loading"} rows={rows} onRetry={load} />
  );

  // The NQ levels panel renders in two places (TAPE grid + DESK right column) —
  // one definition so the markup can't drift.
  const levelsPanel = (!data || levels) && (
    <section className="panel mk-levels">
      <div className="panel-head">{data?.levels?.proxy ?? "NQ"} · Levels</div>
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
  );

  return (
    <div className="surface markets-surface" ref={rootRef}>
      <header className="surface-head">
        <h2 className="surface-title">Markets</h2>
        <div className="mkt-head-right">
          <nav className="mkt-tabs" role="tablist" aria-label="Markets views">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`mkt-tab${tab === t ? " on" : ""}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
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
        </div>
      </header>

      {/* ── DESK — today's brief, compiled from the intel pipeline ── */}
      {tab === "DESK" && (
        <div className="desk-wrap">
          {brief ? (
            <BriefPanel brief={brief} ownerView={ownerView} aside={levelsPanel || undefined} />
          ) : briefStatus === "loading" ? (
            <WidgetState state="loading" rows={6} />
          ) : briefStatus === "error" ? (
            <WidgetState state="error" onRetry={loadBrief} />
          ) : (
            <section className="panel desk-compile">
              <div className="panel-head">Desk · {etDateKey()}</div>
              <p className="desk-compile-lead">No brief compiled for today.</p>
              <button
                type="button"
                className="desk-compile-btn"
                disabled={compiling}
                aria-busy={compiling}
                onClick={compileBrief}
              >
                {compiling ? "COMPILING…" : "COMPILE TODAY'S BRIEF →"}
              </button>
              {compileMsg ? <div className="desk-note">{compileMsg}</div> : null}
            </section>
          )}
          <a className="desk-workbench" href="/intel">
            WORKBENCH ▸
          </a>
        </div>
      )}

      {/* ── ARCHIVE — past briefs only; expanding lazy-fetches that date ── */}
      {tab === "ARCHIVE" && (
        <div className="arch-wrap">
          {archDates === null ? (
            <WidgetState state="loading" rows={4} />
          ) : archDates.length === 0 ? (
            <div className="muted">No archived briefs yet.</div>
          ) : (
            archDates.map((d) => {
              const entry = archBriefs[d];
              const open = archOpen === d;
              return (
                <div key={d} className="arch-row">
                  <button
                    type="button"
                    className={`arch-head${open ? " on" : ""}`}
                    aria-expanded={open}
                    onClick={() => toggleArchive(d)}
                  >
                    <span className="arch-chev">{open ? "▾" : "▸"}</span>
                    <span className="arch-date">{d}</span>
                  </button>
                  {open ? (
                    !entry || entry === "loading" ? (
                      <WidgetState state="loading" rows={4} />
                    ) : entry === "error" ? (
                      <WidgetState state="error" onRetry={() => fetchArchive(d)} />
                    ) : entry.brief ? (
                      <BriefPanel brief={entry.brief} ownerView={entry.ownerView} />
                    ) : (
                      <div className="muted">No brief stored for this date.</div>
                    )
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── TAPE — the full live market grid ── */}
      {tab === "TAPE" && (
        <div className="markets-grid">
          {/* sector strip — hidden when loaded-but-empty (no inert shell) */}
          {(!data || data.sectors.length > 0) && (
            <section className="panel mk-sectors">
              <div className="panel-head">Sectors</div>
              {data ? (
                <div className="sector-strip">
                  {data.sectors.map((s) => (
                    <div key={s.etf} className="sector-chip" title={s.etf}>
                      <span className="sector-name">{s.name}</span>
                      <span className={sign(s.chgPct)}>{pct(s.chgPct)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                fallback(2)
              )}
            </section>
          )}

          {/* watchlist with sparklines — hidden when loaded-but-empty */}
          {(!data || data.watchlist.length > 0) && (
            <section className="panel mk-watch">
              <div className="panel-head">Watchlist · click to chart</div>
              {data ? (
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
              ) : (
                fallback(8)
              )}
            </section>
          )}

          {/* hero price chart */}
          <PriceChart sym={selected.sym} kind={selected.kind} label={selected.label} />

          {/* NQ levels — hidden when loaded but no levels data */}
          {levelsPanel}

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

          {/* movers — hidden when loaded-but-empty */}
          {(!data ||
            data.movers.gainers.length > 0 ||
            data.movers.losers.length > 0 ||
            data.movers.actives.length > 0) && (
            <section className="panel mk-movers">
              <div className="panel-head">Movers</div>
              {data ? (
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
              ) : (
                fallback(5)
              )}
            </section>
          )}

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

          {/* flow lite — hidden when loaded-but-empty */}
          {(!data || data.flow.length > 0) && (
            <section className="panel mk-flow">
              <div className="panel-head">
                Flow · Lite <span className="todo">proxy</span>
              </div>
              {data ? (
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
                fallback(5)
              )}
              <div className="flow-note">
                Unusual equity volume — free stand-in for options flow (real flow is paid).
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
