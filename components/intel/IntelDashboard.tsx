"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BriefIdea,
  Chapter,
  ChapterCategory,
  ConsensusItem,
  DailyBrief,
  Explicitness,
  IntelCatalyst,
  IntelLevel,
  IntelSource,
  IntelVideo,
  OptionBriefIdea,
  OptionIdea,
  TradeIdea,
  ValueField,
  VideoAnalysis,
} from "@/lib/intel/types";
import { SymbolProvider } from "./symbolContext";
import OptionsWorkspace from "./OptionsWorkspace";
import { mfeMaeView, pnlView, type TrackedIdea, type TrackedStatus } from "@/lib/intel/tracker";

// ── types ────────────────────────────────────────────────────────────────────

type Overview = {
  config: { storage: boolean; ai: boolean; youtube: boolean };
  clock: { date: string; nice: string; time: string; session: string; sessionLabel: string };
  lastSync: number;
  lastBriefAt: number;
  lastProcessed: number;
  sources: IntelSource[];
  videos: IntelVideo[];
  brief: DailyBrief | null;
};

type QuoteMap = Record<string, { price: number; prevClose: number; chgPct: number; closes: number[] }>;
type Tab = "BOARD" | "BRIEF" | "SOURCES" | "OPTIONS" | "ASK";
type IdeaStatus = "WATCH" | "TRIG" | "ARMED" | "ACTIVE" | "INVLD";
type BlotterIdea = BriefIdea & { __fav?: boolean; quote: QuoteMap[string] | null };

// /api/intel/desk payload (SPEC-wiring §4 #1) — each part independently
// nullable; a null part means its component renders NOTHING (no placeholder).
type DeskFng = { value: number; rating: string; asOf: number };
type DeskSector = { code: string; name: string; etf: string; chgPct: number };
type DeskEarning = { symbol: string; date: string; hour: "bmo" | "amc" | "dmh" | null };
type DeskData = {
  fng: DeskFng | null;
  sectors: DeskSector[] | null;
  earnings: DeskEarning[] | null;
  watchlistSize: number;
};

// ── constants ────────────────────────────────────────────────────────────────

// Design macro list (SPEC-wiring §2.3) — all keyless Yahoo symbols through the
// existing /api/intel/quotes path; zero new data sources.
// TODO(stage 2+): US10Y via ^TNX needs divide-by-10 + basis-point change
// formatting (SPEC-wiring §2.3) — deferred; do not add ^TNX without that math.
const TAPE_MACRO = ["^GSPC", "^NDX", "^DJI", "^RUT", "^VIX", "DX-Y.NYB", "CL=F", "GC=F", "BTC-USD"];
// display labels for the tape (strip Yahoo's ^ / =F / exchange suffixes)
const TAPE_LABEL: Record<string, string> = {
  "^GSPC": "SPX", "^NDX": "NDX", "^DJI": "DJI", "^RUT": "RUT", "^VIX": "VIX",
  "DX-Y.NYB": "DXY", "CL=F": "WTI", "GC=F": "GOLD", "BTC-USD": "BTC",
};

const TF_FULL: Record<string, string> = {
  intraday: "INTRADAY", next_session: "NEXT SESSION", swing: "SWING", long_term: "LONG TERM", unspecified: "—",
};

// DESIGN grouping rule (SPEC-wiring §2.1 tf row): intraday + next_session share
// the hero TODAY group, swing is SHORT-TERM, long_term/unspecified are LONG-TERM.
const TF_GROUP: Record<string, string> = {
  intraday: "TODAY · TOP IDEAS",
  next_session: "TODAY · TOP IDEAS",
  swing: "SHORT-TERM · SWING",
  long_term: "LONG-TERM",
  unspecified: "LONG-TERM",
};

// horizon group chrome (SPEC-desktop §2.6.2 item 3) — subs/ticks verbatim
const BOARD_GROUPS: { key: string; sub: string; hero?: boolean; tickCls: string }[] = [
  { key: "TODAY · TOP IDEAS", sub: "next session · highest urgency", hero: true, tickCls: "rd-tick-today" },
  { key: "SHORT-TERM · SWING", sub: "days to weeks", tickCls: "rd-tick-swing" },
  { key: "LONG-TERM", sub: "position · months+", tickCls: "rd-tick-long" },
];

const CAT_LABEL: Partial<Record<ChapterCategory, string>> = {
  market_outlook: "Outlook", market_recap: "Recap", overnight_news: "Overnight",
  macro_news: "Macro", economic_calendar: "Econ", earnings: "Earnings",
  technical_analysis: "Technical", favorite_setups: "Setups", predictions: "Predictions",
  watchlist: "Watchlist", options_flow: "Options Flow", trade_management: "Trade Mgmt",
  risk_management: "Risk", closing_comments: "Closing", advertisement: "Ad",
  unrelated: "Unrelated",
};

// ── helpers ──────────────────────────────────────────────────────────────────

const watchUrl = (v: string, t?: number) =>
  `https://www.youtube.com/watch?v=${v}${t ? `&t=${Math.floor(t)}s` : ""}`;
const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ageStr = (since: number) => {
  const m = Math.max(1, Math.round((Date.now() - since) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};
// human ages everywhere — "11h ago", never "692m ago"
const ago = (ms: number) => (ms ? `${ageStr(ms)} ago` : "never");
const etClock = () =>
  new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const fmtPx = (n: number) =>
  n >= 1000 ? n.toFixed(2) : n >= 10 ? n.toFixed(2) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
// design price format (SPEC-desktop §3.3): $ + thousands separators, always 2dp
const rdPx = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// ET clock with seconds — the board error line wants a precise real timestamp
const etClockSec = () =>
  new Date().toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

function deriveStatus(idea: BlotterIdea): IdeaStatus {
  const q = idea.quote;
  if (!q) return "WATCH";
  const { price } = q;
  const ent = idea.entry?.value;
  const inv = idea.invalidation?.value;
  // Invalidated
  if (inv != null && inv > 0) {
    if (idea.direction === "bullish" && price < inv) return "INVLD";
    if (idea.direction === "bearish" && price > inv) return "INVLD";
  }
  // Triggered
  if (ent != null && ent > 0) {
    if (idea.direction === "bullish" && price >= ent) return "TRIG";
    if (idea.direction === "bearish" && price <= ent) return "TRIG";
  }
  // Armed: creator favorite OR within 5% of entry
  if (idea.__fav) return "ARMED";
  if (ent != null && ent > 0 && Math.abs((price - ent) / ent) <= 0.05) return "ARMED";
  // Active: has live price
  return "ACTIVE";
}

function buildBlotter(brief: DailyBrief | null, quotes: QuoteMap): BlotterIdea[] {
  if (!brief) return [];
  const seen = new Set<string>();
  const favIds = new Set(brief.creatorFavorites.map((f) => f.id));
  return [...brief.creatorFavorites, ...brief.topIdeas]
    .filter((idea) => { if (seen.has(idea.id)) return false; seen.add(idea.id); return true; })
    .map((idea) => ({ ...idea, __fav: favIds.has(idea.id), quote: quotes[idea.ticker.toUpperCase()] ?? null }));
}

// AT-THE-OPEN gate states, design palette (SPEC-desktop §2.6.1): CLEARED green,
// BROKEN red, and a not-yet-tripped distance shown in the design's amber
// "pending" treatment (the sign stays in the label — no green/red guessing).
function atOpenState(l: IntelLevel, quotes: QuoteMap): { label: string; cls: string } {
  const q = quotes[l.instrument.toUpperCase()];
  if (!q || l.level == null) return { label: "—", cls: "" };
  const { price } = q;
  const pct = ((price - l.level) / l.level) * 100;
  if (l.type === "resistance" || l.type === "breakout") {
    if (price > l.level) return { label: "CLEARED", cls: "rd-open-ok" };
  }
  if (l.type === "support" || l.type === "breakdown") {
    if (price < l.level) return { label: "BROKEN", cls: "rd-open-broken" };
  }
  return { label: (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%", cls: "rd-open-wait" };
}

function val(v: { value: number | null; text: string }) {
  if (v.value === null && (!v.text || /not specified/i.test(v.text)))
    return <AbsentCell />; // REUSED design absent treatment (∅ n/s)
  return <b>{v.text || (v.value !== null ? String(v.value) : "—")}</b>;
}

// ── micro components ─────────────────────────────────────────────────────────
// rd-chip is the token-system mini-chip for the BRIEF/SOURCES/drawer bodies
// (mono 7.5px, 2px radius, currentColor border) — copy unchanged, colors map
// onto the P palette; the dashed-inf variant mirrors the INFERRED evidence chip.

function DirBadge({ d }: { d: TradeIdea["direction"] }) {
  const cls = d === "bullish" ? "rd-chip-ok" : d === "bearish" ? "rd-chip-err" : d === "watch" ? "rd-chip-warn" : "rd-chip-dim";
  return <span className={`rd-chip ${cls}`}>{d}</span>;
}

function ExpBadge({ e }: { e: "explicit" | "inferred" }) {
  return (
    <span className={`rd-chip ${e === "explicit" ? "rd-chip-info" : "rd-chip-inf"}`}>
      {e === "explicit" ? "Direct source" : "Inference"}
    </span>
  );
}

// hex → rgba at a given alpha (design hexA — SVG presentation attrs can't take var())
const hexA = (h: string, a: number) => {
  const m = h.replace("#", "");
  return `rgba(${parseInt(m.slice(0, 2), 16)},${parseInt(m.slice(2, 4), 16)},${parseInt(m.slice(4, 6), 16)},${a})`;
};

/** Inspector chart — design 352×92 area chart (SPEC-desktop §2.6.3 item 7,
 * scaling math ported from the design's buildChart) drawn from the REAL ~1mo
 * of DAILY closes (SPEC-wiring §2.4; the design's seeded intraday series must
 * not ship — the honest `1M · DAILY` axis label lives in the PRICE ACTION sub).
 * The series ends at the live quote (design contract: last point = live), the
 * dashed line is the stated trigger, H/L labels read the closes array only. */
function InspChart({ closes, live, trigger, lineColor }: {
  closes: number[];
  live: number;
  trigger: number | null;
  lineColor: string;
}) {
  if (!closes || closes.length < 2) {
    // the design specifies no no-series treatment — small honest absent line
    return (
      <div className="rd-chart rd-chart-noseries">
        <span className="rd-abs"><span className="rd-abs-g" aria-hidden="true">∅</span> NO SERIES</span>
      </div>
    );
  }
  const W = 352, H = 92, padX = 3, padT = 11, padB = 11;
  const series = [...closes, live];
  const n = series.length;
  const vals = trigger != null ? [...series, trigger] : series;
  let ymin = Math.min(...vals), ymax = Math.max(...vals);
  const pad = (ymax - ymin) * 0.16 || live * 0.02 || 1;
  ymin -= pad; ymax += pad;
  const xAt = (i: number) => padX + (i / (n - 1)) * (W - 2 * padX);
  const yAt = (v: number) => (H - padB) - ((v - ymin) / (ymax - ymin)) * (H - padT - padB);
  let lp = `M ${xAt(0).toFixed(1)},${yAt(series[0]).toFixed(1)}`;
  for (let i = 1; i < n; i++) lp += ` L ${xAt(i).toFixed(1)},${yAt(series[i]).toFixed(1)}`;
  const ap = `${lp} L ${xAt(n - 1).toFixed(1)},${H} L ${xAt(0).toFixed(1)},${H} Z`;
  const trigY = trigger != null ? yAt(trigger) : null;
  const liveX = xAt(n - 1), liveY = yAt(live);
  return (
    <div className="rd-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="1-month daily-close price chart">
        <title>{`1M · DAILY closes${trigger != null ? ` · trigger ${rdPx(trigger)}` : ""}`}</title>
        <line x1={0} y1={23} x2={W} y2={23} stroke="rgba(255,255,255,0.035)" strokeWidth={1} />
        <line x1={0} y1={46} x2={W} y2={46} stroke="rgba(255,255,255,0.035)" strokeWidth={1} />
        <line x1={0} y1={69} x2={W} y2={69} stroke="rgba(255,255,255,0.035)" strokeWidth={1} />
        <path d={ap} fill={hexA(lineColor, 0.1)} />
        {trigY != null && (
          <line x1={0} y1={trigY} x2={W} y2={trigY} stroke="rgba(106,160,200,0.55)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        <path d={lp} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={liveX} cy={liveY} r={6} fill="none" stroke={lineColor} strokeWidth={1} opacity={0.35} />
        <circle cx={liveX} cy={liveY} r={3.2} fill={lineColor} />
      </svg>
      <span className="rd-chart-h">H {rdPx(Math.max(...closes))}</span>
      <span className="rd-chart-l">L {rdPx(Math.min(...closes))}</span>
      {trigger != null && trigY != null && (
        <span className="rd-chart-trig" style={{ top: trigY }}>❝ TRIG {rdPx(trigger)}</span>
      )}
      <span className="rd-chart-live" style={{ top: liveY }}>
        <span className="rd-chart-live-dot" aria-hidden="true">◉</span>
        {rdPx(live)}
      </span>
    </div>
  );
}

// ── PageHeader ───────────────────────────────────────────────────────────────

function PageHeader({
  data, clock, tab, onTab, blotter, busy, onSync, onGenerateBrief, fng,
}: {
  data: Overview;
  clock: string;
  tab: Tab;
  onTab: (t: Tab) => void;
  blotter: BlotterIdea[];
  busy: string | null;
  onSync: () => void;
  onGenerateBrief: () => void;
  fng: DeskFng | null;
}) {
  const counts = { TRIG: 0, ARMED: 0, ACTIVE: 0 };
  for (const idea of blotter) {
    const s = deriveStatus(idea);
    if (s === "TRIG") counts.TRIG++;
    else if (s === "ARMED") counts.ARMED++;
    else if (s === "ACTIVE") counts.ACTIVE++;
  }

  const tabs: { key: Tab; label: string; fkey: string }[] = [
    { key: "BOARD", label: "BOARD", fkey: "F1" },
    { key: "BRIEF", label: "BRIEF", fkey: "F2" },
    { key: "SOURCES", label: "SOURCES", fkey: "F3" },
    { key: "OPTIONS", label: "OPTIONS", fkey: "F4" },
    { key: "ASK", label: "ASK", fkey: "F5" },
  ];

  // Redesign chrome (SPEC-desktop §2.1 + §2.2). Only REAL destinations ship in
  // the workspace tabs bar: INTEL (this route, active) + the AUGUST home at /.
  // The design's MARKETS/ORB/SCREENER/JOURNAL tabs are dead routes — not
  // rendered (SPEC-wiring §2.11). Fkeys F1–F5 are the real tabs; F6 = SYNC.
  return (
    <>
      {/* BAR 1 — app nav + function keys */}
      <div className="rd-bar1">
        <div className="rd-bar1-left">
          <span className="rd-brand"><span className="rd-brand-dot" aria-hidden="true" />AUGUST</span>
          <span className="rd-bar1-div" aria-hidden="true" />
          <nav className="rd-wstabs" aria-label="AUGUST workspaces">
            <span className="rd-wstab on" aria-current="page">INTEL</span>
            <a className="rd-wstab" href="/">AUGUST</a>
          </nav>
        </div>
        <div className="rd-fkeys">
          {tabs.map((t) => (
            <button key={t.key} type="button" className="rd-fkey" aria-pressed={tab === t.key} onClick={() => onTab(t.key)}>
              <span className={`rd-fkey-k${tab === t.key ? " on" : ""}`}>{t.fkey}</span>
              {t.label}
            </button>
          ))}
          <button type="button" className="rd-fkey" disabled={busy === "sync"} aria-busy={busy === "sync"} onClick={onSync}>
            <span className="rd-fkey-k">F6</span>
            {busy === "sync" ? "SYNC…" : "SYNC"}
          </button>
        </div>
      </div>

      {/* BAR 2 — title + counts + actions */}
      <div className="rd-bar2">
        <div className="rd-topglow" aria-hidden="true" />
        <div className="rd-bar2-left">
          <h1 className="rd-title">MARKET INTEL</h1>
          <span className="rd-livechip"><span className="rd-livechip-dot" aria-hidden="true" />LIVE</span>
          <span className="rd-meta">
            <span className="rd-datechip">{data.clock.nice.toUpperCase()}</span>
            DESK: {data.clock.sessionLabel.toUpperCase()} · {blotter.length} TRACKED
            {/* stage-5: F&G band chip appended LAST so its async arrival never
                shifts the date/desk text (absent while the fng part is null) */}
            <FngChip fng={fng} />
          </span>
        </div>
        <div className="rd-bar2-right">
          {/* pills always mount (zero counts dim on mobile, hide on desktop) so
              the wrapped mobile geometry never shifts when counts land */}
          <span className={`rd-count rd-count-trig${counts.TRIG ? "" : " rd-count-zero"}`}>
            <span className="rd-count-dot" aria-hidden="true" />
            {counts.TRIG} TRIGGERED
          </span>
          <span className={`rd-count rd-count-arm${counts.ARMED ? "" : " rd-count-zero"}`}>{counts.ARMED} ARMED</span>
          <span className={`rd-count rd-count-act${counts.ACTIVE ? "" : " rd-count-zero"}`}>{counts.ACTIVE} ACTIVE</span>
          <span className="rd-bar2-div" aria-hidden="true" />
          <button type="button" className="rd-btn" disabled={busy === "sync"} aria-busy={busy === "sync"} onClick={onSync}>
            {busy === "sync" ? "SYNCING…" : "SYNC"}
          </button>
          <button type="button" className="rd-btn rd-btn-acc" disabled={busy === "brief" || !data.config.ai} aria-busy={busy === "brief"} onClick={onGenerateBrief}>
            {busy === "brief" ? "…" : "BRIEF"}
          </button>
          <a className="rd-btn" href="/api/intel/export/today">EXPORT</a>
          <a className="rd-btn" href="/">← AUGUST</a>
        </div>
      </div>
    </>
  );
}

// ── StatusBar ────────────────────────────────────────────────────────────────

function StatusBar({
  data, clock, latencyMs, lastQuoteOkAt, trackerOk,
}: {
  data: Overview;
  clock: string;
  latencyMs: number | null;
  lastQuoteOkAt: number | null;
  trackerOk: boolean | null;
}) {
  const { lastSync, lastBriefAt } = data;
  // Honest chrome (SPEC-wiring §2.10): quotes arrive via 30s HTTP polling —
  // no websocket exists, so FEED says POLL 30s, never WS. DATA degrades to
  // STALE when two consecutive polls fail to land (75s), LATENCY is the
  // measured last roundtrip, KEY is the real YOUTUBE_API_KEY flag, TRACKER
  // reports the engine's reachability (retained — the design dropped it, but
  // rows silently fall back to derived statuses when the tracker is down and
  // the chrome must say so). Ages are human (30h, never 1821m). Volatile
  // values sit in fixed ch-slots so neighbors never shift between polls.
  const dataState =
    lastQuoteOkAt === null ? "WAITING" : Date.now() - lastQuoteOkAt < 75_000 ? "LIVE" : "STALE";
  const slowLat = latencyMs !== null && latencyMs > 2000;
  const items: { label: string; val: string; dot: string | null; valCls: string }[] = [
    { label: "SESSION", val: data.clock.sessionLabel.toUpperCase(), dot: "rd-dot-amber", valCls: "rd-sb-amber" },
    {
      label: "DATA", val: dataState,
      dot: dataState === "LIVE" ? "rd-dot-ok rd-dot-glow" : dataState === "STALE" ? "rd-dot-amber" : "rd-dot-idle",
      valCls: `${dataState === "LIVE" ? "rd-sb-ok" : dataState === "STALE" ? "rd-sb-amber" : "rd-sb-plain"} rd-slot7`,
    },
    { label: "FEED", val: "POLL 30s", dot: dataState === "LIVE" ? "rd-dot-ok" : "rd-dot-idle", valCls: "rd-sb-plain" },
    {
      label: "LATENCY", val: latencyMs !== null ? `${latencyMs}ms` : "—",
      dot: latencyMs === null ? "rd-dot-idle" : slowLat ? "rd-dot-amber" : "rd-dot-ok",
      valCls: `${slowLat ? "rd-sb-amber" : "rd-sb-plain"} rd-slot6`,
    },
    {
      label: "KEY", val: data.config.youtube ? "YT_API OK" : "YT_API UNSET",
      dot: data.config.youtube ? "rd-dot-ok" : "rd-dot-amber",
      valCls: data.config.youtube ? "rd-sb-plain" : "rd-sb-amber",
    },
    {
      label: "TRACKER", val: trackerOk === null ? "—" : trackerOk ? "ON" : "OFFLINE",
      dot: trackerOk === null ? null : trackerOk ? "rd-dot-ok" : "rd-dot-amber",
      valCls: `${trackerOk === null ? "rd-sb-plain" : trackerOk ? "rd-sb-ok" : "rd-sb-amber"} rd-slot7`,
    },
    { label: "LAST SYNC", val: lastSync ? ageStr(lastSync) : "—", dot: null, valCls: "rd-sb-plain" },
    { label: "BRIEF", val: lastBriefAt ? ageStr(lastBriefAt) : "—", dot: null, valCls: "rd-sb-plain" },
  ];
  return (
    <div className="rd-sb">
      {items.map((it) => (
        <span key={it.label} className="rd-sb-item">
          {it.dot && <span className={`rd-sb-dot ${it.dot}`} aria-hidden="true" />}
          <span className="rd-sb-label">{it.label}</span>
          <span className={`rd-sb-val ${it.valCls}`}>{it.val}</span>
        </span>
      ))}
      {/* HH:MM ET, 1/min tick — no 1 Hz re-render of the bar for seconds.
          The design's REC indicator is mock (nothing records) — not shipped. */}
      <span className="rd-sb-item rd-sb-now">
        <span className="rd-sb-label">NOW</span>
        <span className="rd-sb-val rd-sb-clockval">{clock} ET</span>
      </span>
    </div>
  );
}

// ── LiveTape ─────────────────────────────────────────────────────────────────

type TapeItem =
  | { kind: "macro"; sym: string; price: number; chgPct: number }
  | { kind: "watch"; sym: string; price: number; chgPct: number; status: IdeaStatus };

// design lifeShort text + lifeMap colors for watchlist tails (SPEC-desktop
// §3.1/§3.3). WATCH is a real derived state with no design equivalent — kept
// honest, rendered in the low-emphasis color.
const TAPE_LIFE: Record<IdeaStatus, { label: string; color: string }> = {
  TRIG: { label: "TRIG", color: "var(--rd-bull)" },
  ARMED: { label: "ARMED", color: "var(--rd-amber)" },
  ACTIVE: { label: "ACTIVE", color: "var(--rd-blue)" },
  INVLD: { label: "INVAL", color: "var(--rd-bear)" },
  WATCH: { label: "WATCH", color: "var(--rd-lo)" },
};
// design price format for the tape (§3.3): thousands separators, 2dp
const tapePx = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** one run of tape content — rendered twice back-to-back for the design's
 * seamless −50% marquee loop; the duplicate is aria-hidden decoration */
function TapeRun({
  macro, watch, duplicate,
}: {
  macro: Extract<TapeItem, { kind: "macro" }>[];
  watch: Extract<TapeItem, { kind: "watch" }>[];
  duplicate?: boolean;
}) {
  return (
    <div className={`rd-tape-run${duplicate ? " rd-tape-dup" : ""}`} aria-hidden={duplicate || undefined}>
      {macro.map((t) => (
        <span key={t.sym} className="rd-tape-q">
          <span className="rd-tape-sym">{TAPE_LABEL[t.sym] ?? t.sym.replace(/^\^/, "")}</span>
          <span className="rd-tape-px">{tapePx(t.price)}</span>
          <span className={`rd-tape-inst ${t.chgPct >= 0 ? "rd-tape-up" : "rd-tape-dn"}`}>
            {t.chgPct >= 0 ? "▲" : "▼"}{fmtPct(t.chgPct)}
          </span>
        </span>
      ))}
      {watch.length > 0 && (
        <>
          <span className="rd-tape-divider">WATCHLIST</span>
          {watch.map((t) => (
            <span key={t.sym} className="rd-tape-q">
              <span className="rd-tape-sym">{t.sym}</span>
              <span className="rd-tape-px">${fmtPx(t.price)}</span>
              <span className="rd-tape-watchtail" style={{ color: TAPE_LIFE[t.status].color }}>
                {TAPE_LIFE[t.status].label}
              </span>
            </span>
          ))}
        </>
      )}
    </div>
  );
}

function LiveTape({ tape }: { tape: TapeItem[] }) {
  const macro = tape.filter((t) => t.kind === "macro") as Extract<TapeItem, { kind: "macro" }>[];
  const watch = tape.filter((t) => t.kind === "watch") as Extract<TapeItem, { kind: "watch" }>[];
  // Design tape (SPEC-desktop §2.4): LIVE TAPE badge cell + 64s marquee that
  // pauses on hover (and under prefers-reduced-motion, via tokens.css). The
  // 30px fixed height keeps the old 23px no-CLS reservation; the honest
  // AWAITING FIRST QUOTE state stays until the first quote lands.
  return (
    <div className="rd-tape">
      <span className="rd-tape-badge">
        <span className="rd-tape-badge-dot" aria-hidden="true" />
        LIVE TAPE
      </span>
      <div className="rd-tape-scroll">
        {tape.length === 0 ? (
          <span className="rd-tape-await">TAPE · AWAITING FIRST QUOTE</span>
        ) : (
          <div className="rd-tape-track">
            <TapeRun macro={macro} watch={watch} />
            <TapeRun macro={macro} watch={watch} duplicate />
          </div>
        )}
      </div>
    </div>
  );
}

// ── evidence system (SPEC-wiring §2.2 / SPEC-desktop §3.4) ───────────────────
// TWO honest provenance levels ship: DIRECT (explicit idea + verbatim source
// text on a ValueField) and INFERRED (idea-level explicitness === "inferred").
// EXTRACTED is deliberately NOT emitted — its chip CSS (.rd-ev-extracted) is
// kept for a future third per-field provenance level. Explicit ideas with no
// verbatim level text get the absent glyph, never a decorative DIRECT chip.

type EvKind = "DIRECT" | "INFERRED";

function EvChip({ kind }: { kind: EvKind }) {
  return kind === "DIRECT" ? (
    <span className="rd-ev rd-ev-direct"><span className="rd-ev-g" aria-hidden="true">▮</span>DIRECT</span>
  ) : (
    <span className="rd-ev rd-ev-inferred"><span className="rd-ev-g" aria-hidden="true">~</span>INFERRED</span>
  );
}

const hasVerbatim = (v: ValueField | undefined | null): boolean =>
  !!v && !!v.text && !/not specified/i.test(v.text);

function ideaEvKind(idea: BlotterIdea): EvKind | null {
  if (idea.explicitness === "inferred") return "INFERRED";
  if (hasVerbatim(idea.entry) || hasVerbatim(idea.invalidation) || hasVerbatim(idea.targets[0])) return "DIRECT";
  return null; // explicit, but no verbatim level text — no chip
}

// ── value-cell renderers (design mkQuoted / mkInferred / mkNarr / ABSENT) ────

/** mkQuoted — numeric level quoted verbatim from the transcript (❝ + dotted underline) */
function QuotedCell({ text }: { text: string }) {
  return (
    <span className="rd-cell" title={text}>
      <span className="rd-cell-g rd-g-quote" aria-hidden="true">❝</span>
      <span className="rd-cell-qv">{text}</span>
    </span>
  );
}
/** mkInferred — level AUGUST inferred, not stated (~) */
function InferredCell({ text }: { text: string }) {
  return (
    <span className="rd-cell" title={text}>
      <span className="rd-cell-g rd-g-inf" aria-hidden="true">~</span>
      <span className="rd-cell-iv">{text}</span>
    </span>
  );
}
/** mkNarr — qualitative condition quoted from the transcript (❝, no underline) */
function NarrCell({ text }: { text: string }) {
  return (
    <span className="rd-cell" title={text}>
      <span className="rd-cell-g rd-g-quote" aria-hidden="true">❝</span>
      <span className="rd-cell-nv">{text}</span>
    </span>
  );
}
/** ABSENT — nothing stated by the source */
function AbsentCell({ text = "n/s" }: { text?: string }) {
  return (
    <span className="rd-abs">
      <span className="rd-abs-g" aria-hidden="true">∅</span> {text}
    </span>
  );
}

/** ValueField → designed cell, exactly per SPEC-wiring §2.2 last paragraph:
 * inferred idea → mkInferred; value != null → mkQuoted (verbatim text
 * preferred; `numeric` forces the $ figure for level columns); text-only
 * condition → mkNarr; nothing stated → ABSENT (`absentText` picks the
 * design's context copy — rows say "n/s", inspector levels say
 * "Not stated by source"). */
function ValueCell({ v, explicitness, numeric, absentText }: {
  v: ValueField | undefined; explicitness: Explicitness; numeric?: boolean; absentText?: string;
}) {
  const text = hasVerbatim(v) ? v!.text : null;
  const val = v?.value ?? null;
  if (val == null && !text) return <AbsentCell text={absentText} />;
  const shown = numeric ? (val != null ? rdPx(val) : text!) : (text ?? rdPx(val!));
  if (explicitness === "inferred") return <InferredCell text={shown} />;
  if (val != null) return <QuotedCell text={shown} />;
  return <NarrCell text={shown} />;
}

// ── life badges (tracker-driven; SPEC-desktop §2.6.2 cell 1) ─────────────────
// Engine states map onto the design families (SPEC-wiring §2.1): TARGET_HIT
// keeps the engine's TGT ✓ badge in the TRIGGERED (green) family; CLOSED and
// stale rows take the design's EXPIRED visual (labels stay honest); the
// conflict `!` marker is retained. Untracked rows fall back to deriveStatus.

const RD_LIFE: Record<TrackedStatus, { label: string; cls: string; family: string }> = {
  TRIGGERED: { label: "TRIG", cls: "rd-life-trig", family: "lc-trig" },
  ARMED: { label: "ARMED", cls: "rd-life-arm", family: "lc-arm" },
  ACTIVE: { label: "ACTIVE", cls: "rd-life-act", family: "lc-act" },
  TARGET_HIT: { label: "TGT ✓", cls: "rd-life-tgt", family: "lc-tgt" },
  INVALIDATED: { label: "INVAL", cls: "rd-life-inval", family: "lc-inval" },
  CLOSED: { label: "EXP", cls: "rd-life-exp", family: "lc-exp" },
};
const RD_LIFE_DERIVED: Record<IdeaStatus, { label: string; cls: string; family: string }> = {
  TRIG: { label: "TRIG", cls: "rd-life-trig", family: "lc-trig" },
  ARMED: { label: "ARMED", cls: "rd-life-arm", family: "lc-arm" },
  ACTIVE: { label: "ACTIVE", cls: "rd-life-act", family: "lc-act" },
  INVLD: { label: "INVAL", cls: "rd-life-inval", family: "lc-inval" },
  WATCH: { label: "WATCH", cls: "rd-life-watch", family: "lc-watch" }, // real derived state, no design equivalent — low emphasis
};

/** life meta for a row: badge label/class + accent family + live (glow) flag */
function rowLife(idea: BlotterIdea, tracked: TrackedIdea | null) {
  if (tracked) {
    const meta = RD_LIFE[tracked.status];
    const expired = tracked.status === "CLOSED" || tracked.stale;
    return {
      ...meta,
      cls: expired ? "rd-life-exp" : meta.cls,
      family: expired ? "lc-exp" : meta.family,
      live: tracked.status === "TRIGGERED" && !tracked.stale,
      title: [tracked.statusHistory.at(-1)?.reason, tracked.stale ? "stale — no recent mentions" : null]
        .filter(Boolean).join(" · ") || undefined,
      conflict: !!tracked.conflictKey,
    };
  }
  const s = deriveStatus(idea);
  return {
    ...RD_LIFE_DERIVED[s],
    live: s === "TRIG",
    title: "derived client-side — no tracker record",
    conflict: false,
  };
}

// ── direction cell (design dirMap; watch → NEUTRAL styling, word in tooltip) ─

const RD_DIR: Record<TradeIdea["direction"], { label: string; glyph: string; cls: string; title?: string }> = {
  bullish: { label: "BULL", glyph: "▲", cls: "rd-dir-bull" },
  bearish: { label: "BEAR", glyph: "▼", cls: "rd-dir-bear" },
  neutral: { label: "NEUT", glyph: "◆", cls: "rd-dir-neut" },
  watch: { label: "NEUT", glyph: "◆", cls: "rd-dir-neut", title: "watch idea" },
};

// design P-palette hexes for SVG strokes (presentation attrs can't take var())
const RD_HEX = { bull: "#6fa085", bear: "#cd7e6d", amber: "#bfa05a" };

// ── spark (52×20 path + end dot; SPEC-desktop §2.6.2 cell 11) ────────────────
/** Drawn from the REAL ~1mo of DAILY closes (SPEC-wiring §2.4 — never seeded
 * paths); labeled honestly via <title> + the board legend. Color follows the
 * design rule (§3.6): favored-vs-trigger → bull/amber, else direction color. */
function RdSpark({ closes, color }: { closes: number[]; color: string }) {
  if (!closes || closes.length < 2) return <span className="rd-abs-dash" aria-hidden="true">—</span>;
  const W = 52, H = 20, padY = 3;
  let min = Math.min(...closes), max = Math.max(...closes);
  const pad = (max - min) * 0.1 || Math.abs(closes[closes.length - 1]) * 0.01 || 1;
  min -= pad; max += pad;
  const xAt = (i: number) => (i / (closes.length - 1)) * W;
  const yAt = (v: number) => (H - padY) - ((v - min) / (max - min)) * (H - 2 * padY);
  const d = closes.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  return (
    <svg
      className="rd-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H}
      preserveAspectRatio="none" role="img" aria-label="1-month daily-close sparkline"
    >
      <title>1M · DAILY closes</title>
      <path d={d} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={xAt(closes.length - 1)} cy={yAt(closes[closes.length - 1])} r="1.6" fill={color} />
    </svg>
  );
}

// ── Δ→TRIG cell: PAST/TO TRIGGER delta + the rail (pos 4–96%) ────────────────
/** Delta math ported verbatim from the design source (SPEC-desktop §3.3;
 * design lines ~803–815). Bull/bear get the favored-side framing; the design
 * has no neutral/watch delta — those show the honest signed distance with no
 * PAST/TO label. Shared by the row cell and the inspector Δ → TRIGGER block. */
function deltaView(live: number, trig: number, dir: TradeIdea["direction"]): {
  val: string; label: "PAST TRIGGER" | "TO TRIGGER" | null; cls: string;
} {
  const bull = dir === "bullish";
  if (bull || dir === "bearish") {
    const favored = bull ? live >= trig : live <= trig;
    if (favored) {
      const pastPct = ((live - trig) / trig) * 100;
      return { val: (pastPct >= 0 ? "+" : "") + pastPct.toFixed(2) + "%", label: "PAST TRIGGER", cls: "rd-delta-past" };
    }
    const needPct = bull ? ((trig - live) / live) * 100 : ((live - trig) / live) * 100;
    return { val: "+" + Math.abs(needPct).toFixed(2) + "%", label: "TO TRIGGER", cls: "rd-delta-to" };
  }
  const pct = ((live - trig) / trig) * 100;
  return { val: (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%", label: null, cls: "rd-delta-plain" };
}

/** rail pos() 4–96% + the deltaView value — pure presentation over live price
 * + stated trigger. */
function DeltaCell({ live, trig, dir }: { live: number | null; trig: number | null; dir: TradeIdea["direction"] }) {
  if (live == null || trig == null || trig <= 0) return <span className="rd-abs-dash" aria-hidden="true">—</span>;
  let lo = Math.min(live, trig), hi = Math.max(live, trig);
  const span = (hi - lo) || live * 0.04;
  lo -= span * 0.6; hi += span * 0.6;
  const pos = (p: number) => Math.max(4, Math.min(96, ((p - lo) / (hi - lo)) * 100));
  const livePos = pos(live), trigPos = pos(trig);
  const { val, label, cls } = deltaView(live, trig, dir);
  return (
    <span className={`rd-delta ${cls}`}>
      <span className="rd-delta-val">{val}</span>
      {label && <span className="rd-delta-label">{label}</span>}
      <span className="rd-rail" aria-hidden="true">
        <span className="rd-rail-fill" style={{ left: `${Math.min(livePos, trigPos)}%`, width: `${Math.abs(livePos - trigPos)}%` }} />
        <span className="rd-rail-dot rd-rail-trig" style={{ left: `${trigPos}%` }} />
        <span className="rd-rail-dot rd-rail-live" style={{ left: `${livePos}%` }} />
      </span>
    </span>
  );
}

// ── BlotterRow (design grouped-board row; data logic unchanged) ──────────────

function BlotterRow({
  idea, tracked, selected, onSelect,
}: {
  idea: BlotterIdea;
  tracked: TrackedIdea | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const dir = idea.direction;
  const closes = idea.quote?.closes ?? [];

  // trigger precedence unchanged: tracked ideas use the tracker's (possibly
  // restated) trigger; untracked fall back to the idea's stated entry value.
  const trigVal = tracked ? tracked.statedLevels.trigger?.value ?? null : idea.entry?.value ?? null;
  const live = idea.quote?.price ?? null;

  // P&L — engine rules (the law): signed % since the STATED trigger only when
  // it fired; thesis-only ideas show price-since-mention marked °; ARMED none.
  const pnl = tracked ? pnlView(tracked) : { kind: "none" as const, reason: "untracked" };
  const pnlText =
    pnl.kind === "since_called" ? fmtPct(pnl.pct)
    : pnl.kind === "since_first_mention" ? `${fmtPct(pnl.pct)}°`
    : "—";
  const pnlCls = pnl.kind === "none" ? "" : pnl.pct >= 0 ? "rd-pos" : "rd-neg";
  const pnlTitle =
    pnl.kind === "since_called" ? `since called — vs stated trigger $${fmtPx(pnl.basis)}`
    : pnl.kind === "since_first_mention" ? `° price since first mention (no stated trigger — not trade P&L)`
    : pnl.kind === "none" ? pnl.reason : undefined;

  const life = rowLife(idea, tracked);
  const dirMeta = RD_DIR[dir];
  const ev = ideaEvKind(idea);
  const conf = Math.round(idea.confidence * 100);

  // spark color per the design rule (§3.6): levels → favored? bull : amber,
  // else direction color (bearish → bear, everything else → bull)
  const favored = trigVal != null && trigVal > 0 && live != null
    ? (dir === "bullish" ? live >= trigVal : live <= trigVal)
    : null;
  const sparkColor = favored != null
    ? (favored ? RD_HEX.bull : RD_HEX.amber)
    : dir === "bearish" ? RD_HEX.bear : RD_HEX.bull;

  return (
    <div
      className={`rd-row ${life.family}${selected ? " sel" : ""}${life.live ? " live" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return; // let the source link keep its keys
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }
      }}
    >
      <span className="rd-row-accent" aria-hidden="true" />
      {life.live && <span className="rd-row-wash" aria-hidden="true" />}
      {selected && <span className="rd-row-selwash" aria-hidden="true" />}
      {selected && <span className="rd-row-ring" aria-hidden="true" />}
      <div className="rd-row-grid">
        <span className="rd-c">
          <span className={`rd-life ${life.cls}`} title={life.title}>
            <span className="rd-life-dot" aria-hidden="true" />
            {life.label}
            {life.conflict && <span className="rd-life-conflict" title="conflicting stated triggers from this source">!</span>}
          </span>
        </span>
        <span className="rd-c rd-c-ticker">{idea.ticker}</span>
        <span className={`rd-c rd-c-dir ${dirMeta.cls}`} title={dirMeta.title}>
          <span className="rd-dir-g" aria-hidden="true">{dirMeta.glyph}</span>
          {dirMeta.label}
        </span>
        <span className="rd-c rd-c-tf">{TF_FULL[idea.timeHorizon] ?? "—"}</span>
        <span className="rd-c rd-c-thesis" title={idea.thesis}>{idea.thesis}</span>
        <span className="rd-c rd-c-val"><ValueCell v={idea.entry} explicitness={idea.explicitness} /></span>
        <span className="rd-c rd-c-val">
          {trigVal != null
            ? idea.explicitness === "inferred"
              ? <InferredCell text={rdPx(trigVal)} />
              : <QuotedCell text={rdPx(trigVal)} />
            : <AbsentCell />}
        </span>
        <span className="rd-c rd-c-val"><ValueCell v={idea.invalidation} explicitness={idea.explicitness} numeric /></span>
        <span className="rd-c rd-c-val"><ValueCell v={idea.targets[0]} explicitness={idea.explicitness} numeric /></span>
        <span className="rd-c rd-c-live">
          {live != null
            ? <><span className="rd-live-dot-g" aria-hidden="true">◉</span>{rdPx(live)}</>
            : <span className="rd-abs-dash" aria-hidden="true">—</span>}
        </span>
        <span
          className="rd-c rd-c-delta"
          title={live != null && trigVal != null && trigVal > 0 ? `live ${rdPx(live)} vs stated trigger ${rdPx(trigVal)}` : undefined}
        >
          <DeltaCell live={live} trig={trigVal != null && trigVal > 0 ? trigVal : null} dir={dir} />
        </span>
        <span className={`rd-c rd-c-pnl ${pnlCls}`} title={pnlTitle}>{pnlText}</span>
        <span className="rd-c rd-c-age" title={tracked ? "tracked since first mention" : "not tracked"}>
          {tracked ? ageStr(tracked.createdAt) : "—"}
        </span>
        <span className="rd-c rd-c-spark"><RdSpark closes={closes} color={sparkColor} /></span>
        <span className="rd-c rd-c-conf">
          <span className="rd-conf-bar" aria-hidden="true"><span className="rd-conf-fill" style={{ width: `${conf}%` }} /></span>
          {conf}%
        </span>
        <span className="rd-c rd-c-evid">
          {ev ? <EvChip kind={ev} /> : <span className="rd-abs-dash" title="explicit idea · no verbatim level text">—</span>}
        </span>
        <span className="rd-c rd-c-src">
          {idea.videoId ? (
            <a
              href={watchUrl(idea.videoId, idea.sourceStartSeconds)}
              target="_blank" rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="open source at timestamp"
            >
              ▸ {idea.channelTitle} @ {mmss(idea.sourceStartSeconds)} · rank {idea.rankScore.toFixed(2)}
            </a>
          ) : (
            <span>{idea.channelTitle} · rank {idea.rankScore.toFixed(2)}</span>
          )}
        </span>
      </div>
    </div>
  );
}

// ── BlotterTable ─────────────────────────────────────────────────────────────

type BlotterFilter = "ALL" | "TRACKED" | "TRIGGERED" | "ARMED" | "ACTIVE" | "INVALIDATED";

/** one vocabulary for filtering, whether the row is tracker-driven or derived */
function effectiveStatus(idea: BlotterIdea, tracked: TrackedIdea | null): TrackedStatus {
  if (tracked) return tracked.status;
  const s = deriveStatus(idea);
  return s === "TRIG" ? "TRIGGERED" : s === "INVLD" ? "INVALIDATED" : s === "WATCH" ? "ACTIVE" : s;
}

/** the rows the current filter admits — single source of truth shared by the
 * board and the inspector breadcrumb's DERIVED n/{visible} denominator
 * (SPEC-wiring §2.11: the design's /6 was hardcoded) */
function visibleBlotter(ideas: BlotterIdea[], trackedByIdeaId: Map<string, TrackedIdea>, filter: BlotterFilter): BlotterIdea[] {
  return ideas.filter((idea) => {
    const t = trackedByIdeaId.get(idea.id) ?? null;
    if (filter === "ALL") return true;
    if (filter === "TRACKED") return t !== null && t.statedLevels.trigger?.value != null; // level-anchored only
    return effectiveStatus(idea, t) === filter;
  });
}

// design loading skeleton (SPEC-desktop §2.6.2): 13 bars per row with the
// design's widths/heights (first bar "auto" → 40px) and stagger delays
const SKEL_BARS = [
  { w: 40, h: 13, hi: true }, { w: 34, h: 13, hi: true }, { w: 28, h: 12 }, { w: 46, h: 12 },
  { w: 50, h: 12 }, { w: 58, h: 12 }, { w: 60, h: 12 }, { w: 52, h: 12 },
  { w: 58, h: 13, hi: true }, { w: 48, h: 12 }, { w: 44, h: 10 }, { w: 50, h: 12 }, { w: 46, h: 12 },
];
const SKEL_DELAYS = [0, 0.07, 0.12, 0.17, 0.22, 0.27, 0.32, 0.37, 0.42, 0.47, 0.52, 0.57, 0.62];

function BoardLoading() {
  return (
    <div role="status" aria-label="Syncing sources and extracting ideas">
      <div className="rd-load-strip">
        <span className="rd-load-dot" aria-hidden="true" />
        SYNCING SOURCES · EXTRACTING IDEAS…
      </div>
      {[0, 1, 2, 3, 4, 5].map((r) => (
        <div key={r} className="rd-skelrow" aria-hidden="true">
          {SKEL_BARS.map((b, i) => (
            <span
              key={i}
              className={`rd-skelbar${b.hi ? " hi" : ""}`}
              style={{ width: b.w, height: b.h, animationDelay: `${SKEL_DELAYS[i]}s` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const BOARD_COLS = [
  "STATUS", "TICKER", "DIR", "TF", "THESIS", "ENTRY", "TRIGGER", "INVALID", "TARGET",
  "LIVE", "Δ→TRIG", "P&L", "AGE", "SPARK", "CONF", "EVID", "SRC",
];

function BlotterTable({
  ideas, trackedByIdeaId, filter, selectedId, onSelect, loading, busy, aiOn, onAddSource, onGenerateBrief,
}: {
  ideas: BlotterIdea[];
  trackedByIdeaId: Map<string, TrackedIdea>;
  filter: BlotterFilter;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** a sync or brief run is in flight — with zero rows, show the design's loading treatment */
  loading: boolean;
  busy: string | null;
  aiOn: boolean;
  onAddSource: () => void;
  onGenerateBrief: () => void;
}) {
  if (ideas.length === 0) {
    if (loading) return <BoardLoading />;
    // design EMPTY state, verbatim copy (SPEC-wiring §2.12) — buttons wired to
    // the real actions: ADD SOURCE opens the SOURCES tab, GENERATE BRIEF runs
    // the real handler (disabled without ANTHROPIC_API_KEY, same as the header)
    return (
      <div className="rd-board-empty">
        <div className="rd-empty-glyph" aria-hidden="true">∅</div>
        <div className="rd-empty-title">NO IDEAS ON THE BOARD</div>
        <p className="rd-empty-copy">
          No trade ideas have been extracted yet. Add a source or generate tonight&apos;s brief to populate the blotter.
        </p>
        <div className="rd-empty-btns">
          <button type="button" className="rd-btn-lg rd-btn-lg-acc" onClick={onAddSource}>ADD SOURCE</button>
          <button
            type="button" className="rd-btn-lg"
            disabled={busy === "brief" || !aiOn} aria-busy={busy === "brief"}
            title={!aiOn ? "needs ANTHROPIC_API_KEY" : undefined}
            onClick={onGenerateBrief}
          >
            {busy === "brief" ? "GENERATING…" : "GENERATE BRIEF"}
          </button>
        </div>
      </div>
    );
  }

  const visible = visibleBlotter(ideas, trackedByIdeaId, filter);

  if (visible.length === 0) {
    // filter-miss state — no design equivalent; kept with the honest copy,
    // restyled to the empty-state treatment (SPEC-wiring §2.12 last row)
    return (
      <div className="rd-board-empty rd-board-nomatch">
        <div className="rd-empty-glyph" aria-hidden="true">∅</div>
        <div className="rd-empty-title">NO IDEAS MATCH</div>
        <p className="rd-empty-copy">No ideas in the {filter.toLowerCase()} state right now.</p>
      </div>
    );
  }

  const groups: Record<string, BlotterIdea[]> = {};
  for (const idea of visible) {
    const g = TF_GROUP[idea.timeHorizon] ?? "LONG-TERM";
    if (!groups[g]) groups[g] = [];
    groups[g].push(idea);
  }

  return (
    <div className="rd-board-wrap">
      <div className="rd-board-min">
        <div className="rd-colhead">
          {BOARD_COLS.map((c) => (
            <span
              key={c}
              title={c === "P&L" ? "signed vs stated trigger; ° = price since first mention"
                : c === "SPARK" ? "~1 month of daily closes" : undefined}
            >
              {c}
            </span>
          ))}
        </div>
        {BOARD_GROUPS.map((g) => {
          const rows = groups[g.key];
          if (!rows?.length) return null;
          return (
            <Fragment key={g.key}>
              <div className={`rd-group${g.hero ? " hero" : ""}`}>
                <span className={`rd-group-tick ${g.tickCls}`} aria-hidden="true" />
                <span className="rd-group-label">{g.key}</span>
                <span className="rd-group-sub">{g.sub}</span>
                <span className="rd-group-hair" aria-hidden="true" />
                <span className="rd-group-count">{rows.length} IDEA{rows.length !== 1 ? "S" : ""}</span>
              </div>
              {rows.map((idea) => (
                <BlotterRow
                  key={idea.id}
                  idea={idea}
                  tracked={trackedByIdeaId.get(idea.id) ?? null}
                  selected={selectedId === idea.id}
                  onSelect={() => onSelect(idea.id)}
                />
              ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ── OptionsIntelPanel ────────────────────────────────────────────────────────

function OptionsIntelPanel({ brief }: { brief: DailyBrief | null }) {
  const [open, setOpen] = useState(false);
  if (!brief?.options) return null;
  const { bestCreatorPlays, augustCandidates } = brief.options;
  const playCount = bestCreatorPlays.length;
  const candCount = augustCandidates.length;
  if (!playCount && !candCount) return null;

  const optDir = (o: OptionBriefIdea) =>
    o.direction === "bullish" ? <span className="bl-bull-glyph" style={{ fontSize: 9 }}>▲ BULL</span>
    : o.direction === "bearish" ? <span className="bl-bear-glyph" style={{ fontSize: 9 }}>▼ BEAR</span>
    : <span className="bl-neut-glyph" style={{ fontSize: 9 }}>— NEUT</span>;

  const optContract = (o: OptionBriefIdea) => {
    if (!o.legs.length) return "—";
    return o.legs.map((l) => `${l.action} ${l.strike ?? "?"}${l.optionType === "call" ? "C" : "P"}`).join(" / ");
  };

  return (
    <div className="bl-optx">
      <button className="bl-optx-toggle" onClick={() => setOpen((o) => !o)}>
        <span style={{ marginRight: 4, opacity: 0.5 }}>{open ? "▾" : "▸"}</span>
        <span className="bl-optx-title">OPTIONS INTEL</span>
        <span style={{ opacity: 0.45 }}>creator option plays · AUGUST candidates · secondary</span>
        <div className="bl-optx-counts">
          {playCount > 0 && <span className="bl-optx-cp">{playCount} PLAY{playCount !== 1 ? "S" : ""}</span>}
          {candCount > 0 && <span className="bl-optx-cp">{candCount} CANDIDATE{candCount !== 1 ? "S" : ""}</span>}
        </div>
      </button>
      {open && (
        <div style={{ overflowX: "auto" }}>
          <table className="bl-optx-table">
            <thead>
              <tr>
                <th className="bl-optx-th">TICKER</th>
                <th className="bl-optx-th">STRUCTURE</th>
                <th className="bl-optx-th">DIR</th>
                <th className="bl-optx-th">REF LEVEL</th>
                <th className="bl-optx-th">SIZING / EXPIRY</th>
                <th className="bl-optx-th">EVIDENCE</th>
              </tr>
            </thead>
            <tbody>
              {bestCreatorPlays.length > 0 && (
                <>
                  <tr className="bl-optx-section-row"><td colSpan={6}>CREATOR PLAYS</td></tr>
                  {bestCreatorPlays.map((o, i) => (
                    <tr key={i}>
                      <td className="bl-optx-td bl-optx-tkr">{o.underlyingSymbol}</td>
                      <td className="bl-optx-td">{o.strategyType.replace(/_/g, " ")}</td>
                      <td className="bl-optx-td">{optDir(o)}</td>
                      <td className="bl-optx-td" style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
                        {optContract(o)}
                      </td>
                      <td className="bl-optx-td" style={{ fontSize: 10, opacity: 0.7 }}>
                        {o.quotedPremium != null ? `$${o.quotedPremium}` : <span className="bl-ns">∅ not sized</span>}
                        {o.expirationText?.resolved ? ` → ${o.expirationText.resolved}` : o.expirationText?.text ? ` → ${o.expirationText.text}` : ""}
                      </td>
                      <td className="bl-optx-td">
                        <span className={`bl-ev ${o.origin === "creator_explicit" ? "bl-ev-direct" : "bl-ev-inferred"}`}>
                          {o.origin === "creator_explicit" ? "DIRECT" : "INFERRED"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </>
              )}
              {augustCandidates.length > 0 && (
                <>
                  <tr className="bl-optx-section-row">
                    <td colSpan={3}>AUGUST CANDIDATES</td>
                    <td colSpan={3} style={{ opacity: 0.35, fontSize: 7, fontFamily: "var(--font-mono), monospace", textTransform: "uppercase" }}>
                      AUGUST-generated · not creator-stated
                    </td>
                  </tr>
                  {augustCandidates.map((o, i) => (
                    <tr key={i}>
                      <td className="bl-optx-td bl-optx-tkr">{o.underlyingSymbol}</td>
                      <td className="bl-optx-td">{o.strategyType.replace(/_/g, " ")}</td>
                      <td className="bl-optx-td">{optDir(o)}</td>
                      <td className="bl-optx-td" style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
                        {o.legs[0]?.strike != null ? <span style={{ color: "var(--bone)" }}>${o.legs[0].strike}</span> : <span className="bl-ns">∅ not sized</span>}
                      </td>
                      <td className="bl-optx-td"><span className="bl-ns">∅ not sized</span></td>
                      <td className="bl-optx-td">
                        <span className="bl-ev bl-ev-inferred">INFERRED</span>
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
          <div className="bl-optx-foot">
            ∿ AUGUST suggests the structure and references the quoted equity trigger — never the strike or size. ∅ not sized until you set it.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inspector ────────────────────────────────────────────────────────────────

/** LIFECYCLE panel — everything here is read straight off the tracked record:
 * real transition history, real snapshot ring, MFE/MAE from the engine. The
 * design has no lifecycle surface — this is a kept real panel in the rd- skin. */
function LifecyclePanel({ t, variants }: { t: TrackedIdea; variants: TrackedIdea[] }) {
  const pnl = pnlView(t);
  const mm = mfeMaeView(t);
  const snaps = t.priceHistory;
  const fmtT = (ms: number) =>
    new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div className="rd-lifec">
      <div className="rd-insp-seclabel rd-lifec-head">
        LIFECYCLE · TRACKED {ageStr(t.createdAt)}
        {t.stale && <span className="rd-lifec-stale" title="no recent mentions">STALE</span>}
      </div>

      {/* state timeline — times + prices, honest reasons on hover */}
      <div className="rd-tl">
        {t.statusHistory.map((h, i) => (
          <div key={i} className="rd-tl-step" title={h.reason}>
            <span className={`rd-life rd-life-sm ${RD_LIFE[h.state].cls}`}>
              <span className="rd-life-dot" aria-hidden="true" />
              {RD_LIFE[h.state].label}
            </span>
            <span className="rd-tl-when">{fmtT(h.at)}</span>
            {h.price != null && <span className="rd-tl-px">{rdPx(h.price)}</span>}
          </div>
        ))}
      </div>

      {/* P&L + MFE/MAE — labeled by basis, per the law; ° marks the
          price-since-first-mention basis (never trade P&L) */}
      <div className="rd-lifec-nums">
        <div className="rd-lifec-num" title={pnl.kind !== "none" ? `basis ${rdPx(pnl.basis)}` : undefined}>
          <div className="rd-insp-stat-label">{pnl.kind === "since_first_mention" ? "SINCE 1st MENTION" : "P&L SINCE CALLED"}</div>
          <div className={`rd-insp-stat-val ${pnl.kind !== "none" && pnl.pct >= 0 ? "rd-pos" : pnl.kind !== "none" ? "rd-neg" : ""}`}>
            {pnl.kind === "none" ? "—" : pnl.kind === "since_first_mention" ? `${fmtPct(pnl.pct)}°` : fmtPct(pnl.pct)}
          </div>
        </div>
        <div className="rd-lifec-num" title={mm ? `measured from basis ${rdPx(mm.basis)}` : undefined}>
          <div className="rd-insp-stat-label">MFE / MAE</div>
          <div className="rd-insp-stat-val">
            {mm ? <><span className="rd-pos">{fmtPct(mm.mfePct)}</span> / <span className="rd-neg">{fmtPct(mm.maePct)}</span></> : "—"}
          </div>
        </div>
      </div>
      {pnl.kind === "since_first_mention" && (
        <div className="rd-lifec-note">° no stated trigger — price move since first mention, not trade P&amp;L</div>
      )}

      {/* snapshot sparkline from the recorded ring buffer (tracker's own data) */}
      {snaps.length >= 2 && (
        <div className="rd-lifec-spark">
          <MiniSparkWide snaps={snaps} basis={t.basisPrice} up={t.direction !== "bearish"} />
          <div className="rd-lifec-sparkmeta">{snaps.length} snapshots · cap {128} · tracker observations</div>
        </div>
      )}

      {/* conflict variants — both stated triggers stay visible, never merged */}
      {variants.length > 0 && (
        <div className="rd-lifec-vars">
          <div className="rd-lifec-varhead">⚠ CONFLICTING STATED TRIGGERS (SAME SOURCE)</div>
          {variants.map((v) => (
            <div key={v.id} className="rd-lifec-var">
              <span className={`rd-life rd-life-sm ${RD_LIFE[v.status].cls}`}>
                <span className="rd-life-dot" aria-hidden="true" />
                {RD_LIFE[v.status].label}
              </span>
              <span>trigger {v.statedLevels.trigger?.value != null ? rdPx(v.statedLevels.trigger.value) : v.statedLevels.trigger?.text ?? "∅"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** wider sparkline over the tracker's own snapshots (not Yahoo closes) — the
 * basis line takes the design's dashed trigger-blue treatment */
function MiniSparkWide({ snaps, basis, up }: { snaps: { at: number; price: number }[]; basis: number | null; up: boolean }) {
  const W = 240, H = 40;
  const px = snaps.map((s) => s.price);
  const all = basis != null ? [...px, basis] : px;
  const min = Math.min(...all), max = Math.max(...all), range = max - min || 1;
  const toY = (v: number) => H - ((v - min) / range) * (H - 4) - 2;
  const pts = px.map((v, i) => `${((i / (px.length - 1)) * W).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="tracker snapshot sparkline">
      {basis != null && (
        <line x1={0} y1={toY(basis)} x2={W} y2={toY(basis)} stroke="rgba(106,160,200,0.55)" strokeWidth="1" strokeDasharray="3 3" />
      )}
      <polyline points={pts} fill="none" stroke={up ? RD_HEX.bull : RD_HEX.bear} strokeWidth="1.3" />
    </svg>
  );
}

/** design dirLabel for the posture chip (SPEC-desktop §3.3); watch is a real
 * state with no design equivalent — labeled honestly in the NEUT styling */
const RD_DIR_LABEL: Record<TradeIdea["direction"], string> = {
  bullish: "BULLISH", bearish: "BEARISH", neutral: "NEUTRAL", watch: "WATCH",
};
// stat-strip TIMEFRAME short forms (design: NEXT/SWING/LONG; the real horizons
// add INTRA for intraday — honest, no design equivalent)
const RD_TF_SHORT: Record<string, string> = {
  intraday: "INTRA", next_session: "NEXT", swing: "SWING", long_term: "LONG", unspecified: "—",
};

/** per-field evidence chip — ONLY when honest (SPEC-wiring §2.2): the idea's
 * explicitness gates the kind, and DIRECT additionally requires the field's
 * own verbatim source text. No content → no chip; explicit idea without
 * verbatim text on this field → no chip. Never the design's decorative
 * hardcoded DIRECT. */
function fieldEvKind(
  v: { value: number | null; text: string } | undefined | null,
  explicitness: Explicitness,
): EvKind | null {
  const has = !!v && (v.value != null || hasVerbatim(v));
  if (!has) return null;
  if (explicitness === "inferred") return "INFERRED";
  return hasVerbatim(v) ? "DIRECT" : null;
}

/** idea-mode inspector body — design §2.6.3, every value wired to the real
 * idea/tracker/quote (quote is guaranteed by the caller: no quote → the
 * AWAITING ANALYSIS state renders instead) */
function InspectorIdea({ idea, quote, tracked, variants }: {
  idea: BlotterIdea;
  quote: NonNullable<BlotterIdea["quote"]>;
  tracked: TrackedIdea | null;
  variants: TrackedIdea[];
}) {
  const live = quote.price;
  const life = rowLife(idea, tracked);
  const dirMeta = RD_DIR[idea.direction];
  const ev = ideaEvKind(idea);
  const conf = Math.round(idea.confidence * 100);

  // trigger precedence unchanged (same as the board row): tracked ideas use
  // the tracker's stated trigger; untracked fall back to the stated entry value
  const trigVal = tracked ? tracked.statedLevels.trigger?.value ?? null : idea.entry?.value ?? null;
  const trigSrc = tracked ? tracked.statedLevels.trigger : idea.entry;
  const delta = trigVal != null && trigVal > 0 ? deltaView(live, trigVal, idea.direction) : null;

  // chart line follows the design rule (§3.6, same as the board sparks):
  // with a stated trigger the favored side paints bull/amber; otherwise the
  // direction color
  const favored = trigVal != null && trigVal > 0
    ? (idea.direction === "bullish" ? live >= trigVal : live <= trigVal)
    : null;
  const lineColor = favored != null
    ? (favored ? RD_HEX.bull : RD_HEX.amber)
    : idea.direction === "bearish" ? RD_HEX.bear : RD_HEX.bull;

  // TRADE PLAN cells — ValueField-driven, no invented wording (the design's
  // "Break $X" fallback is dropped: a bare level is shown, never a direction
  // verb AUGUST didn't hear)
  const tgt = idea.targets[0];
  const planEntry = hasVerbatim(idea.entry) ? idea.entry.text : trigVal != null ? rdPx(trigVal) : null;
  const planExit = hasVerbatim(idea.invalidation)
    ? idea.invalidation.text
    : idea.invalidation?.value != null ? rdPx(idea.invalidation.value) : null;
  const planTp = tgt ? (hasVerbatim(tgt) ? tgt.text : tgt.value != null ? rdPx(tgt.value) : null) : null;

  // LEVELS fields — REUSED cell renderers + honest per-field chips (§2.2)
  const catalyst = idea.catalysts[0] ?? null;
  const insFields = [
    {
      key: "ENTRY", cls: "rd-lev-entry",
      ev: fieldEvKind(idea.entry, idea.explicitness),
      cell: <ValueCell v={idea.entry} explicitness={idea.explicitness} absentText="Not stated by source" />,
    },
    {
      key: "TRIGGER", cls: "rd-lev-trigger",
      ev: trigVal != null
        ? (idea.explicitness === "inferred" ? "INFERRED" as const : hasVerbatim(trigSrc) ? "DIRECT" as const : null)
        : null,
      cell: trigVal != null
        ? (idea.explicitness === "inferred" ? <InferredCell text={rdPx(trigVal)} /> : <QuotedCell text={rdPx(trigVal)} />)
        : <AbsentCell text="Not stated by source" />,
    },
    {
      key: "INVALIDATION", cls: "rd-lev-inval",
      ev: fieldEvKind(idea.invalidation, idea.explicitness),
      cell: <ValueCell v={idea.invalidation} explicitness={idea.explicitness} numeric absentText="Not stated by source" />,
    },
    {
      key: "TARGET", cls: "rd-lev-target",
      ev: fieldEvKind(tgt, idea.explicitness),
      cell: <ValueCell v={tgt} explicitness={idea.explicitness} numeric absentText="Not stated by source" />,
    },
    {
      // the catalyst string IS the field's extracted source text — chip kind
      // from the idea's explicitness, only when a catalyst exists
      key: "CATALYST", cls: "rd-lev-cat",
      ev: catalyst ? (idea.explicitness === "inferred" ? "INFERRED" as const : "DIRECT" as const) : null,
      cell: catalyst ? <span className="rd-lev-plain">{catalyst}</span> : <AbsentCell text="Not stated by source" />,
    },
  ];

  return (
    <div className="rd-insp-body">
      {/* title row: ticker + tracker-driven life chip + live block */}
      <div className="rd-insp-top">
        <div className="rd-insp-idrow">
          <span className="rd-insp-ticker" title={idea.assetName || undefined}>{idea.ticker}</span>
          <span className={`rd-life rd-life-lg ${life.cls}`} title={life.title}>
            <span className="rd-life-dot" aria-hidden="true" />
            {life.label}
            {life.conflict && <span className="rd-life-conflict" title="conflicting stated triggers from this source">!</span>}
          </span>
        </div>
        <div className="rd-insp-liveblk">
          <div className="rd-insp-livelabel">LIVE · REAL-TIME</div>
          <div className="rd-insp-liveprice">
            <span className="rd-live-dot-g" aria-hidden="true">◉</span>
            {rdPx(live)}
          </div>
        </div>
      </div>

      {/* stat strip: DIR / TIMEFRAME / CONF / RANK — all real (the design's
          fifth EVID:DIRECT cell was hardcoded mock; the honest idea-level
          chip lives in the posture row below) */}
      <div className="rd-insp-stats">
        <div className="rd-insp-stat">
          <div className="rd-insp-stat-label">DIR</div>
          <div className={`rd-insp-stat-val ${dirMeta.cls}`} title={dirMeta.title}>{dirMeta.label}</div>
        </div>
        <div className="rd-insp-stat">
          <div className="rd-insp-stat-label">TIMEFRAME</div>
          <div className="rd-insp-stat-val">{RD_TF_SHORT[idea.timeHorizon] ?? "—"}</div>
        </div>
        <div className="rd-insp-stat">
          <div className="rd-insp-stat-label">CONF</div>
          <div className="rd-insp-stat-val">{conf}%</div>
        </div>
        <div className="rd-insp-stat">
          <div className="rd-insp-stat-label">RANK</div>
          <div className="rd-insp-stat-val">{idea.rankScore.toFixed(2)}</div>
        </div>
      </div>

      {/* posture chips: direction + honest idea-level evidence; FAV and
          PREDICTION are real facts with no design chip — kept, low emphasis */}
      <div className="rd-insp-chips">
        <span className={`rd-pchip ${dirMeta.cls}`} title={dirMeta.title}>{RD_DIR_LABEL[idea.direction]}</span>
        {ev && (
          <span className={`rd-ev rd-ev-lg ${ev === "DIRECT" ? "rd-ev-direct" : "rd-ev-inferred"}`}>
            <span className="rd-ev-g" aria-hidden="true">{ev === "DIRECT" ? "▮" : "~"}</span>
            {ev} SOURCE
          </span>
        )}
        {idea.__fav && <span className="rd-pchip rd-pchip-fact" title="creator favorite">FAV</span>}
        {idea.creatorDesignation.isPrediction && <span className="rd-pchip rd-pchip-fact">PREDICTION</span>}
      </div>

      {/* thesis */}
      <p className="rd-insp-thesis">{idea.thesis}</p>

      {/* TRADE PLAN */}
      <div className="rd-insp-seclabel rd-plan-head">TRADE PLAN</div>
      <div className="rd-plan">
        <div className="rd-plan-box rd-plan-entry">
          <div className="rd-plan-lab">ENTRY</div>
          {planEntry ? <div className="rd-plan-val">{planEntry}</div> : <AbsentCell />}
        </div>
        <div className="rd-plan-box rd-plan-exit">
          <div className="rd-plan-lab">EXIT / STOP</div>
          {planExit ? <div className="rd-plan-val">{planExit}</div> : <AbsentCell />}
        </div>
        <div className="rd-plan-box rd-plan-tp">
          <div className="rd-plan-lab">TAKE-PROFIT</div>
          {planTp ? <div className="rd-plan-val">{planTp}</div> : <AbsentCell text="n/s — thesis-driven" />}
        </div>
      </div>

      {/* PRICE ACTION header — honest 1M · DAILY axis label (SPEC-wiring §2.4
          replaces the design's `5D · 15m · illustrative`) + real Δ → TRIGGER */}
      <div className="rd-pa-row">
        <div>
          <div className="rd-insp-seclabel">PRICE ACTION</div>
          <div className="rd-pa-sub">1M · DAILY</div>
        </div>
        <div className="rd-pa-right">
          {delta ? (
            <>
              <div className="rd-pa-deltalabel">Δ → TRIGGER</div>
              <div
                className={`rd-pa-deltaval ${delta.cls}`}
                title={trigVal != null ? `live ${rdPx(live)} vs stated trigger ${rdPx(trigVal)}` : undefined}
              >
                {delta.val}{delta.label && <span className="rd-pa-deltatag"> {delta.label}</span>}
              </div>
            </>
          ) : (
            <span className="rd-notrig">
              <span className="rd-notrig-g" aria-hidden="true">~</span>
              NO TRIGGER · THESIS-DRIVEN
            </span>
          )}
        </div>
      </div>
      <InspChart
        closes={quote.closes}
        live={live}
        trigger={trigVal != null && trigVal > 0 ? trigVal : null}
        lineColor={lineColor}
      />

      {/* tracker lifecycle — real transition history + excursions */}
      {tracked && <LifecyclePanel t={tracked} variants={variants} />}

      {/* LEVELS */}
      <div className="rd-insp-seclabel rd-lev-head">LEVELS · EACH TAGGED BY EVIDENCE</div>
      <div className="rd-lev-grid">
        {insFields.map((f) => (
          <div key={f.key} className={`rd-lev-f ${f.cls}`}>
            <div className="rd-lev-lab">
              <span className="rd-lev-lab-t">{f.key}</span>
              {f.ev && <EvChip kind={f.ev} />}
            </div>
            {f.cell}
          </div>
        ))}
      </div>

      {/* footer: confidence + source cite (deep link at timestamp) */}
      <div className="rd-insp-foot">
        <div className="rd-insp-conf">
          CONF
          <span className="rd-insp-conf-bar" aria-hidden="true">
            <span className="rd-insp-conf-fill" style={{ width: `${conf}%` }} />
          </span>
          <span className="rd-insp-conf-pct">{conf}%</span>
        </div>
        {idea.videoId ? (
          <a
            className="rd-insp-src"
            href={watchUrl(idea.videoId, idea.sourceStartSeconds)}
            target="_blank" rel="noreferrer"
            title="open source at timestamp"
          >
            ▸ {idea.channelTitle} @ {mmss(idea.sourceStartSeconds)} · rank {idea.rankScore.toFixed(2)}
          </a>
        ) : (
          <span className="rd-insp-src">▸ {idea.channelTitle} · rank {idea.rankScore.toFixed(2)}</span>
        )}
      </div>
    </div>
  );
}

function Inspector({ idea, tracked, variants, rowNo, rowCount }: {
  idea: BlotterIdea | null;
  tracked: TrackedIdea | null;
  variants: TrackedIdea[];
  /** 1-based position of the selected row among the visible rows in display
   * order — null when the selection is filtered out of view */
  rowNo: number | null;
  rowCount: number;
}) {
  // breadcrumb (§2.11): ticker · setup word · n/{visible}. The setup word is
  // CAT_LABEL of the idea's chapter category when present, else omitted —
  // never an invented classifier (SPEC-wiring §2.1). Denominator DERIVED.
  const setup = idea?.chapter ? CAT_LABEL[idea.chapter.normalizedCategory] : undefined;
  const crumb = idea
    ? [idea.ticker, setup, rowNo != null ? `${rowNo}/${rowCount}` : null].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="rd-insp">
      <div className="rd-insp-head">
        <span className="rd-insp-title">INSPECTOR</span>
        {crumb && <span className="rd-insp-crumb" title={crumb}>▸ {crumb}</span>}
      </div>
      {!idea ? (
        /* design EMPTY state, verbatim copy (§2.12) — replaces SELECT A ROW */
        <div className="rd-insp-state">
          <div className="rd-insp-state-glyph" aria-hidden="true">∅</div>
          <div className="rd-insp-state-title">NOTHING SELECTED</div>
          <p className="rd-insp-state-copy">Populate the board, then select a row to inspect its thesis and evidence.</p>
        </div>
      ) : !idea.quote ? (
        /* design LOADING state (§2.12), used honestly: a row is selected but
           its quote hasn't landed yet (quotes map miss) */
        <div className="rd-insp-state rd-insp-loading" role="status">
          <span className="rd-insp-pulse" aria-hidden="true" />
          <div className="rd-insp-state-title">AWAITING ANALYSIS</div>
          <span className="sr-only">Awaiting market data for {idea.ticker}</span>
          <div className="rd-insp-shimmers" aria-hidden="true">
            <span className="rd-shim" />
            <span className="rd-shim" style={{ width: "70%", animationDelay: "0.2s" }} />
            <span className="rd-shim" style={{ width: "84%", animationDelay: "0.4s" }} />
          </div>
        </div>
      ) : (
        <InspectorIdea idea={idea} quote={idea.quote} tracked={tracked} variants={variants} />
      )}
    </div>
  );
}

// ── stage-5 fold-ins (SPEC-wiring §2.5–2.7 / SPEC-desktop §2.5) ──────────────
// The design's overview band folded into the rail. HARD RULES carried in code:
// every component here renders NOTHING when its desk part is null — the rail
// simply tightens. No placeholder boxes, no fake neutral-50 gauge, and the
// crypto F&G index is never silently substituted for CNN's equity index.

// F&G band thresholds + colors (SPEC-desktop §2.5a, exact):
// ≤24 EXTREME FEAR · ≤44 FEAR · ≤55 NEUTRAL · ≤74 GREED · else EXTREME GREED
const FNG_BANDS: { max: number; label: string; c: string }[] = [
  { max: 24, label: "EXTREME FEAR", c: "#cd7e6d" },
  { max: 44, label: "FEAR", c: "#c68a5e" },
  { max: 55, label: "NEUTRAL", c: "#bfa05a" },
  { max: 74, label: "GREED", c: "#6fa085" },
  { max: 100, label: "EXTREME GREED", c: "#74b08a" },
];
const fngBand = (v: number) => FNG_BANDS.find((b) => v <= b.max) ?? FNG_BANDS[FNG_BANDS.length - 1];
const fngClamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

// gauge geometry (SPEC-desktop §2.5a): cx=100 cy=104 r=82, 5 arcs spanning
// 180→144→108→72→36→0.01 degrees — fixed, computed once at module level
const GAUGE_SEGS: { d: string; color: string }[] = (() => {
  const cx = 100, cy = 104, r = 82;
  const stops = [180, 144, 108, 72, 36, 0.01];
  const colors = ["#b06a58", "#c68a5e", "#ad9158", "#6fa085", "#74b08a"];
  const pt = (deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  return colors.map((color, i) => {
    const [x1, y1] = pt(stops[i]);
    const [x2, y2] = pt(stops[i + 1]);
    return { d: `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`, color };
  });
})();

/** F&G band chip in the title-bar meta cluster. The design computed the chip
 * border/bg (hexA(c,0.42) / hexA(c,0.09)) without binding them — this chip is
 * their use. Data is CNN's EQUITY index via /api/intel/desk; when that part
 * is null (CNN down, no cache) the chip is absent — never a fake neutral. */
function FngChip({ fng }: { fng: DeskFng | null }) {
  if (!fng) return null;
  const v = fngClamp(fng.value);
  const band = fngBand(v);
  return (
    <span
      className="rd-fng-chip"
      style={{ color: band.c, borderColor: hexA(band.c, 0.42), background: hexA(band.c, 0.09) }}
      title={`CNN Fear & Greed (equities) — ${v} · ${band.label}`}
    >
      F&amp;G {v} · {band.label}
    </span>
  );
}

/** MARKET SENTIMENT — the design's 5-segment semicircle gauge (§2.5a), needle
 * at 180 − 1.8·value, value + regime line, FEAR/GREED axis. Renders nothing
 * without a real CNN reading. */
function SentimentGauge({ fng }: { fng: DeskFng | null }) {
  if (!fng) return null;
  const v = fngClamp(fng.value);
  const band = fngBand(v);
  const a = ((180 - 1.8 * v) * Math.PI) / 180;
  const nx = 100 + 74 * Math.cos(a); // needle at r−8 = 74
  const ny = 104 - 74 * Math.sin(a);
  return (
    <section className="rd-lsec">
      <div className="rd-ts-card">
        <div className="rd-ts-head">
          <span className="rd-ts-title">MARKET SENTIMENT</span>
          <span className="rd-ts-hair" aria-hidden="true" />
          <span className="rd-ts-note">CNN F&amp;G</span>
        </div>
        <svg
          className="rd-gauge-svg"
          viewBox="0 0 200 118"
          role="img"
          aria-label={`CNN Fear and Greed index ${v} — ${band.label}`}
        >
          {GAUGE_SEGS.map((s) => (
            <path key={s.color} d={s.d} stroke={s.color} strokeWidth={13} strokeLinecap="butt" opacity={0.85} fill="none" />
          ))}
          <line x1={100} y1={104} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke="#e9ebee" strokeWidth={2.4} strokeLinecap="round" />
          <circle cx={100} cy={104} r={5} fill="#e9ebee" />
        </svg>
        <div className="rd-gauge-vrow">
          <span className="rd-gauge-val" style={{ color: band.c }}>{v}</span>
          <span className="rd-gauge-regime" style={{ color: band.c }}>{band.label}</span>
        </div>
        <div className="rd-gauge-axis" aria-hidden="true"><span>FEAR</span><span>GREED</span></div>
      </div>
    </section>
  );
}

/** SECTOR HEAT MAP — 11 SPDR heat boxes (real Yahoo chgPct via the desk
 * endpoint), intensity scaled to the day's max |Δ| (§2.6.2b formulas exact),
 * ▾ MOVE / A–Z sort toggle as client state. 3-column rail adaptation of the
 * design's 4-column band card. Hidden when the sectors part is null. */
function SectorStrip({ sectors }: { sectors: DeskSector[] | null }) {
  const [sort, setSort] = useState<"move" | "name">("move");
  if (!sectors || sectors.length === 0) return null;
  const maxAbs = Math.max(...sectors.map((s) => Math.abs(s.chgPct)), 0.01);
  const rows = [...sectors].sort(
    sort === "move" ? (x, y) => y.chgPct - x.chgPct : (x, y) => x.code.localeCompare(y.code),
  );
  return (
    <section className="rd-lsec">
      <div className="rd-ts-card">
        <div className="rd-ts-head">
          <span className="rd-ts-title">SECTOR HEAT MAP</span>
          <span className="rd-ts-hair" aria-hidden="true" />
          <button
            type="button"
            className="rd-sec-sort"
            aria-pressed={sort === "name"}
            aria-label="Sort sectors alphabetically instead of by move"
            onClick={() => setSort((s) => (s === "move" ? "name" : "move"))}
          >
            {sort === "move" ? "▾ MOVE" : "A–Z"}
          </button>
        </div>
        <div className="rd-sec-tiles">
          {rows.map((s) => {
            const t = Math.min(1, Math.abs(s.chgPct) / maxAbs);
            const base = s.chgPct >= 0 ? "111,158,131" : "197,133,117";
            const text = s.chgPct >= 0 ? (t > 0.55 ? "#c3e4d1" : "#93c1a6") : (t > 0.55 ? "#ecbcb0" : "#d3a396");
            return (
              <div
                key={s.etf}
                className="rd-sec-tile"
                title={`${s.name} (${s.etf}) ${fmtPct(s.chgPct)}`}
                style={{
                  background: `rgba(${base},${(0.1 + t * 0.44).toFixed(3)})`,
                  borderColor: `rgba(${base},${(0.22 + t * 0.4).toFixed(3)})`,
                }}
              >
                <span className="rd-sec-name">{s.code}</span>
                <span className="rd-sec-pct" style={{ color: text }}>{fmtPct(s.chgPct)}</span>
              </div>
            );
          })}
        </div>
        <div className="rd-sec-legend" aria-hidden="true">
          <span>−</span><span className="rd-sec-swatch" /><span>+</span>
        </div>
      </div>
    </section>
  );
}

// "Mon Jun 30" per the design's catalyst chips — UTC keeps the date-only
// string from sliding a day in western timezones
const catDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const md = d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
  return `${wd} ${md}`;
};

const CAT_HOUR: Record<string, { tag: string; cls: string; title: string }> = {
  bmo: { tag: "BMO", cls: "rd-cat-bmo", title: "before market open" },
  amc: { tag: "AMC", cls: "rd-cat-amc", title: "after market close" },
  dmh: { tag: "—", cls: "rd-cat-dmh", title: "during market hours" },
};

/** CATALYSTS — verified Finnhub earnings dates for the tracked watchlist
 * (§2.7). Note copy is real ("{hits} of {watchlist} watchlist · <7 sessions"
 * — the design's 'illustrative' is gone by design). Hidden when the earnings
 * part is null (FINNHUB_API_KEY unset / fetch failed) AND when the window is
 * simply empty — a note with zero rows isn't a designed state. */
function CatalystLine({ earnings, watchlistSize }: {
  earnings: DeskEarning[] | null;
  watchlistSize: number;
}) {
  if (!earnings || earnings.length === 0) return null;
  const hits = new Set(earnings.map((e) => e.symbol)).size;
  return (
    <section className="rd-lsec">
      <div className="rd-lsec-head"><span className="rd-lsec-h">CATALYSTS</span></div>
      <div className="rd-cat-rows">
        {earnings.map((e) => {
          const h = e.hour ? CAT_HOUR[e.hour] : null;
          return (
            <span
              key={`${e.symbol}-${e.date}`}
              className="rd-cat-chip"
              title={`${e.symbol} earnings · ${e.date}${h ? ` · ${h.title}` : ""}`}
            >
              <span className="rd-cat-tkr">{e.symbol}</span>
              <span className="rd-cat-date">{catDate(e.date)}</span>
              <span className={`rd-cat-tag ${h ? h.cls : "rd-cat-dmh"}`}>{h ? h.tag : "—"}</span>
            </span>
          );
        })}
      </div>
      <div className="rd-cat-note">{hits} of {watchlistSize} watchlist · &lt;7 sessions</div>
    </section>
  );
}

// ── UsMapPanel (stage 6 — SPEC-wiring §2.8, SPEC-desktop §2.5d) ──────────────

/** lib/intel/hq.json — hand-curated ticker → HQ table with BUILD-TIME-projected
 * geoAlbersUsa x/y (scripts/build-us-map.mjs). Tickers absent from it are
 * silently dot-less BY DESIGN — never geocode, never guess. To add a ticker:
 * add its lat/lon to the HQ table in the script, re-run
 * `node scripts/build-us-map.mjs`, commit both generated JSONs. */
type HqEntry = { x?: number; y?: number; city: string; nonUS?: boolean };
type MapAssets = { states: { viewBox: string; paths: string[] }; hq: Record<string, HqEntry> };

/** MAP THE STOCKS — flat SVG over build-time-precomputed geoAlbersUsa state
 * outlines (§2.8 renderer decision: no MapLibre, zero runtime network). Dots
 * only for watchlist tickers with curated HQ coordinates; radius/color from
 * the REAL chgPct in the quotes map (design dot spec: r = 3 + min(5,|pct|),
 * green/red by sign). A tracked ticker with no quote yet gets a minimal ash
 * dot — no ring, no pct claim. Non-US HQs (incl. off-composite Puerto Rico)
 * are listed in the one-line footer instead of being guessed onto the map. */
function UsMapPanel({ blotter, trackedByIdeaId, quotes }: {
  blotter: BlotterIdea[];
  trackedByIdeaId: Map<string, TrackedIdea>;
  quotes: QuoteMap;
}) {
  // Committed local JSONs behind a dynamic import: the design's LOADING MAP…
  // is the (lazy) chunk in flight, MAP OFFLINE is the import failing — both
  // verbatim states stay reachable instead of decorative.
  const [assets, setAssets] = useState<MapAssets | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([import("@/lib/intel/us-states-paths.json"), import("@/lib/intel/hq.json")])
      .then(([s, h]) => {
        if (!alive) return;
        setAssets({ states: s.default, hq: h.default as Record<string, HqEntry> });
      })
      .catch(() => { if (alive) setOffline(true); });
    return () => { alive = false; };
  }, []);

  // static outline layer, memoized — the 30s quote poll re-renders the rail,
  // and 51 state paths never change once the chunk lands
  const outlines = useMemo(
    () =>
      assets && (
        <g aria-hidden="true">
          {assets.states.paths.map((d, i) => (
            <path key={i} className="rd-map-state" d={d} />
          ))}
        </g>
      ),
    [assets],
  );

  // watchlist = blotter tickers ∪ live tracked tickers (the board the user
  // sees plus level-anchored ideas still open on the tracker)
  const syms = new Set<string>();
  for (const i of blotter) syms.add(i.ticker.toUpperCase());
  for (const t of trackedByIdeaId.values()) if (t.status !== "CLOSED") syms.add(t.ticker.toUpperCase());

  const dots: { t: string; x: number; y: number; r: number; c: string | null; city: string; pct: number | null }[] = [];
  const nonUS: string[] = [];
  if (assets) {
    for (const t of [...syms].sort()) {
      const e = assets.hq[t];
      if (!e) continue; // not curated — silently dot-less (see HqEntry note)
      if (e.nonUS) { nonUS.push(t); continue; }
      if (e.x == null || e.y == null) continue;
      const pct = quotes[t]?.chgPct ?? null;
      dots.push({
        t, x: e.x, y: e.y, city: e.city, pct,
        r: pct != null ? 3 + Math.min(5, Math.abs(pct)) : 2.4,
        c: pct != null ? (pct >= 0 ? "#6fa085" : "#c58575") : null, // §2.5d literals
      });
    }
  }

  return (
    <section className="rd-lsec">
      <div className="rd-ts-card">
        <div className="rd-ts-head">
          <span className="rd-ts-title">MAP THE STOCKS</span>
          <span className="rd-ts-hair" aria-hidden="true" />
          <span className="rd-ts-note">HQ · US</span>
        </div>
        <div className="rd-map-body">
          {offline ? (
            <div className="rd-map-offline">MAP OFFLINE</div>
          ) : !assets ? (
            <div className="rd-map-pending">LOADING MAP…</div>
          ) : (
            <svg
              className="rd-map-svg"
              viewBox={assets.states.viewBox}
              role="img"
              aria-label={`US map of watchlist headquarters — ${dots.length} plotted`}
            >
              {outlines}
              {dots.map((d) => (
                <g key={d.t}>
                  <title>{`${d.t} · ${d.city}${d.pct != null ? ` · ${fmtPct(d.pct)}` : ""}`}</title>
                  {d.c ? (
                    <>
                      <circle cx={d.x} cy={d.y} r={d.r} fill={d.c} opacity={0.35} />
                      <circle cx={d.x} cy={d.y} r={2.4} fill={d.c} />
                    </>
                  ) : (
                    <circle cx={d.x} cy={d.y} r={2.4} className="rd-map-dot-ash" />
                  )}
                  <text className="rd-map-lbl" x={d.x} y={d.y - d.r - 4} textAnchor="middle">{d.t}</text>
                </g>
              ))}
            </svg>
          )}
        </div>
        {assets && !offline && nonUS.length > 0 && (
          <div className="rd-map-foot">
            +{" "}
            {nonUS.map((t, i) => (
              <Fragment key={t}>
                {i > 0 && ", "}
                <b>{t}</b>
              </Fragment>
            ))}{" "}
            (off-map)
          </div>
        )}
      </div>
    </section>
  );
}

// ── LeftPanel (design left rail — SPEC-desktop §2.6.1, SPEC-wiring §2.11) ────

/** TOP STOCKS — pure client derivation (SPEC-wiring §2.11): the blotter
 * sorted by rankScore desc, top 5. Row spec from the design's TOP STOCKS
 * TODAY card (SPEC-desktop §2.6.2 item 6), adapted to the 252px rail: rank ·
 * life chip (borderless variant) · ticker · dir glyph · live px · ›. The life
 * chip reuses rowLife so the rail can never disagree with the board; clicking
 * a row selects that idea on the board. Zero ideas → the section is absent. */
function TopStocksPanel({ blotter, trackedByIdeaId, onSelectIdea }: {
  blotter: BlotterIdea[];
  trackedByIdeaId: Map<string, TrackedIdea>;
  onSelectIdea: (id: string) => void;
}) {
  const top = [...blotter].sort((a, b) => b.rankScore - a.rankScore).slice(0, 5);
  if (top.length === 0) return null;
  return (
    <section className="rd-lsec">
      <div className="rd-ts-card">
        <div className="rd-ts-head">
          <span className="rd-ts-title">TOP STOCKS TODAY</span>
          <span className="rd-ts-hair" aria-hidden="true" />
          <span className="rd-ts-note">click → plan</span>
        </div>
        {top.map((idea, i) => {
          const life = rowLife(idea, trackedByIdeaId.get(idea.id) ?? null);
          const dirMeta = RD_DIR[idea.direction];
          return (
            <button
              key={idea.id}
              type="button"
              className="rd-ts-row"
              onClick={() => onSelectIdea(idea.id)}
              title={`${idea.ticker} · ${RD_DIR_LABEL[idea.direction]} · rank ${idea.rankScore.toFixed(2)} — open on the board`}
            >
              <span className="rd-ts-rank">{i + 1}</span>
              <span className={`rd-ts-life ${life.family}`} title={life.title}>
                <span className="rd-life-dot" aria-hidden="true" />
                {life.label}
              </span>
              <span className="rd-ts-tkr">{idea.ticker}</span>
              <span className={`rd-ts-dirg ${dirMeta.cls}`} aria-hidden="true">{dirMeta.glyph}</span>
              <span className="rd-ts-px">{idea.quote ? rdPx(idea.quote.price) : "—"}</span>
              <span className="rd-ts-go" aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function LeftPanel({
  brief, quotes, onReload,
  onSync, onGenerateBrief, busy, lastBriefAt, aiOn,
  sourceCount, videoCount, onGoSources,
  blotter, trackedByIdeaId, onSelectIdea, desk,
}: {
  brief: DailyBrief | null;
  onReload: () => Promise<void>;
  quotes: QuoteMap;
  onSync: () => void;
  onGenerateBrief: () => void;
  busy: string | null;
  lastBriefAt: number;
  aiOn: boolean;
  sourceCount: number;
  videoCount: number;
  onGoSources: () => void;
  blotter: BlotterIdea[];
  trackedByIdeaId: Map<string, TrackedIdea>;
  onSelectIdea: (id: string) => void;
  desk: DeskData | null;
}) {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <div className="rd-lrail">
      {/* quick actions — per-op aria-busy + both-disabled-while-busy semantics
          and the ai gating on BRIEF preserved exactly */}
      <section className="rd-lsec">
        <div className="rd-lp-actions">
          <button type="button" className="rd-btn rd-lp-btn" disabled={!!busy} aria-busy={busy === "sync"} onClick={onSync}>
            {busy === "sync" ? "Syncing…" : "SYNC"}
          </button>
          <button type="button" className="rd-btn rd-btn-acc rd-lp-btn" disabled={!!busy || !aiOn} aria-busy={busy === "brief"} onClick={onGenerateBrief}>
            {busy === "brief" ? "Generating…" : "BRIEF"}
          </button>
        </div>
        {lastBriefAt > 0 && (
          <div className="rd-lp-age">brief {ago(lastBriefAt)}{!aiOn ? " · needs ANTHROPIC_API_KEY" : ""}</div>
        )}
      </section>

      {/* stage-5/6 fold-ins in the design's order (sentiment → sectors → map
          → catalysts — the overview band precedes board content in the
          design, so they sit at the top of the rail; the catalysts line sits
          below the band). Mount order is FIXED: sections appear once when
          their data lands, but never re-order. Desk-fed sections render
          nothing while their part is null; the map always renders (its own
          LOADING MAP… / MAP OFFLINE states own the empty frame). */}
      <SentimentGauge fng={desk?.fng ?? null} />
      <SectorStrip sectors={desk?.sectors ?? null} />
      <UsMapPanel blotter={blotter} trackedByIdeaId={trackedByIdeaId} quotes={quotes} />
      <CatalystLine earnings={desk?.earnings ?? null} watchlistSize={desk?.watchlistSize ?? 0} />

      {/* TOP STOCKS — derived, absent until the blotter has ideas. */}
      <TopStocksPanel blotter={blotter} trackedByIdeaId={trackedByIdeaId} onSelectIdea={onSelectIdea} />

      {/* TONIGHT'S BRIEF digest + AT THE OPEN (one section, per the design) */}
      {brief && (
        <section className="rd-lsec">
          <div className="rd-lsec-head"><span className="rd-lsec-h">TONIGHT&apos;S BRIEF</span></div>
          {brief.posture && <p className="rd-digest-p">{brief.posture}</p>}
          <dl className="rd-digest-dl">
            {brief.watchAtOpen && (
              <div className="rd-digest-f"><dt>At open</dt><dd>{brief.watchAtOpen}</dd></div>
            )}
            {brief.whatMattersTomorrow && (
              <div className="rd-digest-f"><dt>Tomorrow</dt><dd>{brief.whatMattersTomorrow}</dd></div>
            )}
            {brief.invalidation && (
              <div className="rd-digest-f"><dt>Invalidation</dt><dd>{brief.invalidation}</dd></div>
            )}
          </dl>
          {(brief.bullCase || brief.bearCase) && (
            <div className="rd-digest-bb">
              <div className="rd-bb rd-bb-bull"><div className="rd-bb-h">BULL</div><p>{brief.bullCase || "—"}</p></div>
              <div className="rd-bb rd-bb-bear"><div className="rd-bb-h">BEAR</div><p>{brief.bearCase || "—"}</p></div>
            </div>
          )}
          {brief.levels.length > 0 && (
            <>
              <div className="rd-open-label">AT THE OPEN</div>
              {brief.levels.slice(0, 10).map((l) => {
                const { label, cls } = atOpenState(l, quotes);
                return (
                  <div key={l.id} className="rd-open-row">
                    <span className="rd-open-tkr">{l.instrument}</span>
                    <span className="rd-open-cond">
                      {l.type === "resistance" ? "clears" : l.type === "support" ? "holds" : l.type}
                      {l.level != null && <b>${l.level}</b>}
                    </span>
                    <span className={`rd-open-st ${cls || "rd-open-ns"}`}>{label}</span>
                  </div>
                );
              })}
            </>
          )}
        </section>
      )}

      {/* CAPTURE — one lightweight add action; management lives in SOURCES (F3) */}
      <section className="rd-lsec">
        <div className="rd-lsec-head"><span className="rd-lsec-h">CAPTURE</span></div>
        <button type="button" className="rd-btn rd-cap-add" aria-expanded={addOpen} onClick={() => setAddOpen((o) => !o)}>
          {addOpen ? "− CLOSE" : "+ ADD SOURCE"}
        </button>
        {addOpen && (
          <div className="rd-cap-body">
            <AddSource onReload={onReload} compact />
            <div className="rd-cap-hint">processing continues in SOURCES</div>
          </div>
        )}
        <button type="button" className="rd-cap-srcline" onClick={onGoSources}>
          {sourceCount} SOURCE{sourceCount !== 1 ? "S" : ""} · {videoCount} VIDEO{videoCount !== 1 ? "S" : ""} → F3 SOURCES
        </button>
      </section>
    </div>
  );
}

// ── AskBar ───────────────────────────────────────────────────────────────────

function AskBar({ ai }: { ai: boolean }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{
    answer: string;
    citations: { videoId: string; videoTitle: string; channelTitle: string; startSeconds: number; note: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [askErr, setAskErr] = useState(false);

  const ask = async () => {
    if (q.trim().length < 3) return;
    setBusy(true);
    setAskErr(false);
    try {
      const r = await fetch("/api/intel/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const j = await r.json();
      // a 500 error payload has no answer string — never render an empty popover
      if (r.ok && typeof j.answer === "string") { setRes(j); }
      else { setAskErr(true); }
    } catch { setAskErr(true); }
    finally { setBusy(false); }
  };

  // design ASK AUGUST band (SPEC-desktop §2.7) on the existing pinned bar:
  // label + › prompt + accent-hairline input shell + accent Ask button. Error
  // state + dismiss + the ANTHROPIC_API_KEY gating are unchanged; the design's
  // fake block caret is not shipped (a real input has a real caret).
  return (
    <div className="rd-askbar">
      {askErr && !res && (
        <div className="rd-askbar-ans">
          <span className="rd-state rd-state-err">ASK failed — try again.</span>
          <button type="button" className="rd-btn rd-btn-sm rd-btn-ghost" style={{ marginLeft: 10 }} onClick={() => setAskErr(false)}>Dismiss</button>
        </div>
      )}
      {res && (
        <div className="rd-askbar-ans">
          <div style={{ marginBottom: 8 }}>{res.answer}</div>
          {res.citations.map((c, i) => (
            <a key={i} className="rd-cite" style={{ display: "block" }} href={watchUrl(c.videoId, c.startSeconds)} target="_blank" rel="noreferrer">
              ▸ {c.channelTitle || c.videoTitle} @ {mmss(c.startSeconds)} — {c.note}
            </a>
          ))}
          <button type="button" className="rd-btn rd-btn-sm rd-btn-ghost" style={{ marginTop: 8 }} onClick={() => setRes(null)}>Dismiss</button>
        </div>
      )}
      <label className="rd-askbar-label" htmlFor="rd-ask-input">ASK AUGUST</label>
      <div className="rd-askbar-shell">
        <span className="rd-askbar-prompt" aria-hidden="true">›</span>
        <input
          id="rd-ask-input"
          className="rd-askbar-input"
          placeholder={ai ? "what did the source say about QQQ, and which ideas have no stated invalidation?" : "ask AUGUST (needs ANTHROPIC_API_KEY)"}
          value={q}
          disabled={!ai}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
        />
      </div>
      <button type="button" className="rd-ask-btn" disabled={busy || !ai || q.trim().length < 3} onClick={ask}>
        {busy ? "…" : "ASK"}
      </button>
    </div>
  );
}

// ── preserved sub-components ─────────────────────────────────────────────────

function IdeaCard({ idea, favorite, onOpenVideo }: { idea: BriefIdea | TradeIdea; favorite?: boolean; onOpenVideo?: (id: string) => void }) {
  const b = idea as BriefIdea;
  return (
    <div className="rd-idea">
      <div className="rd-idea-top">
        <span className="rd-idea-tkr">{idea.ticker}</span>
        {idea.assetName && <span className="rd-idea-name">{idea.assetName}</span>}
        <DirBadge d={idea.direction} />
        <span className="rd-chip rd-chip-dim">{idea.timeHorizon.replace("_", " ")}</span>
        <ExpBadge e={idea.explicitness} />
        {favorite && <span className="rd-chip rd-chip-fav">Creator favorite</span>}
        {idea.creatorDesignation.isPrediction && <span className="rd-chip rd-chip-info">Prediction</span>}
        {idea.enriched?.triggered && <span className="rd-chip rd-chip-ok">Triggered</span>}
        {idea.enriched?.invalidated && <span className="rd-chip rd-chip-err">Invalidated</span>}
      </div>
      <div className="rd-idea-thesis">{idea.thesis}</div>
      <div className="rd-idea-grid">
        <div className="rd-idea-f"><span>Entry</span>{val(idea.entry)}</div>
        <div className="rd-idea-f"><span>Invalidation</span>{val(idea.invalidation)}</div>
        <div className="rd-idea-f"><span>Target</span>{idea.targets[0] ? val(idea.targets[0]) : <AbsentCell />}</div>
        <div className="rd-idea-f"><span>Catalyst</span><b>{idea.catalysts[0] ?? "—"}</b></div>
        {idea.enriched?.price != null && <div className="rd-idea-f"><span>Live price</span><b>${idea.enriched.price.toFixed(2)}</b></div>}
        <div className="rd-idea-f"><span>Confidence</span><b>{(idea.confidence * 100).toFixed(0)}%</b></div>
      </div>
      {idea.videoId && (
        <a className="rd-cite" href={watchUrl(idea.videoId, idea.sourceStartSeconds)} target="_blank" rel="noreferrer">
          ▸ {b.channelTitle ?? "source"} @ {mmss(idea.sourceStartSeconds)}
          {b.rankScore !== undefined ? ` · rank ${b.rankScore}` : ""}
        </a>
      )}
    </div>
  );
}

function LevelRow({ l }: { l: IntelLevel }) {
  return (
    <div className="rd-lvlrow">
      <span className="rd-lvlrow-tkr">{l.instrument}</span>
      <span className="rd-chip rd-chip-dim">{l.type}</span>
      <span className="rd-lvlrow-val">
        {/* level text is the creator's verbatim qualitative wording → the
            design's narrative-cell treatment (REUSED NarrCell) */}
        {l.level !== null ? <b>{l.level}</b> : l.levelText ? <NarrCell text={l.levelText} /> : <AbsentCell />}
        {l.crossed ? <span className="rd-chip rd-chip-ok" style={{ marginLeft: 6 }}>crossed</span> : null}
      </span>
      {l.videoId
        ? <a className="rd-cite" href={watchUrl(l.videoId, l.sourceStartSeconds)} target="_blank" rel="noreferrer">@{mmss(l.sourceStartSeconds)}</a>
        : <span className="rd-cite">@{mmss(l.sourceStartSeconds)}</span>}
    </div>
  );
}

function CatalystRow({ c }: { c: IntelCatalyst }) {
  return (
    <div className="rd-catrow">
      <b>{c.name}</b>{" "}
      <span className={`rd-chip ${c.importance === "high" ? "rd-chip-err" : c.importance === "medium" ? "rd-chip-warn" : "rd-chip-dim"}`}>{c.importance}</span>{" "}
      <span className={`rd-chip ${c.externallyVerified ? "rd-chip-ok" : "rd-chip-inf"}`}>{c.externallyVerified ? "Verified" : "Creator claim"}</span>
      {c.eventTime && <span className="rd-catrow-time">{c.eventTime}</span>}
      {c.affectedTickers.length > 0 && <span className="rd-catrow-tkrs"> · {c.affectedTickers.join(" ")}</span>}
    </div>
  );
}

function DrawerOptionRow({ o }: { o: OptionIdea }) {
  const origin =
    o.origin === "creator_explicit" ? <span className="rd-chip rd-chip-info">Creator play</span>
    : o.origin === "august_candidate" ? <span className="rd-chip rd-chip-inf">AUGUST candidate</span>
    : <span className="rd-chip rd-chip-warn">Directional only</span>;
  const contract = o.legs.length
    ? o.legs.map((l) => `${l.action} ${l.strike ?? "?"}${l.optionType === "call" ? "C" : "P"}${l.expiration ? ` ${l.expiration}` : ""}`).join(" / ")
    : "no contract specified";
  return (
    <div className="rd-idea">
      <div className="rd-idea-top">
        <span className="rd-idea-tkr">{o.underlyingSymbol}</span>
        <span className={`rd-chip ${o.direction === "bullish" ? "rd-chip-ok" : o.direction === "bearish" ? "rd-chip-err" : "rd-chip-dim"}`}>{o.direction}</span>
        <span className="rd-chip rd-chip-dim">{o.strategyType.replace(/_/g, " ")}</span>
        {origin}
      </div>
      <div className="rd-opt-contract">{contract}</div>
      <div className="rd-idea-grid">
        {/* relative expiry wording is verbatim creator phrasing → NarrCell */}
        <div className="rd-idea-f"><span>Expiration</span>{o.expirationText?.resolved ? <b>{o.expirationText.resolved}</b> : o.expirationText?.text ? <NarrCell text={o.expirationText.text} /> : <AbsentCell />}</div>
        <div className="rd-idea-f"><span>Creator premium</span>{o.quotedPremium !== null ? <b>${o.quotedPremium}</b> : <AbsentCell />}</div>
        <div className="rd-idea-f"><span>Breakeven</span>{o.breakevens.length ? <b>{o.breakevens.join(", ")}</b> : <AbsentCell text="Not computable" />}</div>
      </div>
      {o.videoId && <a className="rd-cite" href={watchUrl(o.videoId, o.sourceStartSeconds)} target="_blank" rel="noreferrer">▸ source @ {mmss(o.sourceStartSeconds)}</a>}
    </div>
  );
}

function ConsensusRow({ c }: { c: ConsensusItem }) {
  const cls = c.agreement === "conflict" ? "rd-chip-err" : c.agreement === "agree" ? "rd-chip-ok" : "rd-chip-dim";
  return (
    <div className="rd-consrow">
      <span className="rd-consrow-tkr">{c.ticker}</span>
      <span className="rd-consrow-srcs">{c.sources.map((s) => s.channelTitle).join(" · ")}</span>
      <span className={`rd-chip ${cls}`}>{c.agreement}</span>
    </div>
  );
}

type AddResult = { url: string; status: "ok" | "exists" | "err"; label: string };

function AddSource({ onReload, compact }: { onReload: () => Promise<void>; compact?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AddResult[]>([]);

  const submit = async () => {
    const urls = text.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean);
    if (!urls.length) return;
    setBusy(true);
    setResults([]);
    const out: AddResult[] = [];
    for (const url of urls) {
      try {
        const r = await fetch("/api/intel/sources", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
        });
        const j = await r.json();
        if (j.ok) out.push({ url, status: "ok", label: j.source?.title ?? url });
        else if (j.error === "already_exists") out.push({ url, status: "exists", label: j.source?.title ?? url });
        else out.push({ url, status: "err", label: j.error ?? "error" });
      } catch { out.push({ url, status: "err", label: "network error" }); }
    }
    setResults(out);
    setBusy(false);
    setText("");
    await onReload();
  };

  if (compact) {
    return (
      <div>
        <textarea
          className="rd-input rd-add-ta rd-add-ta-sm"
          placeholder={"Paste URL · @handle · video\n(newline or comma-separated)"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); }}
        />
        <div style={{ marginTop: 5, display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" className="rd-btn rd-btn-sm rd-btn-acc" disabled={busy || !text.trim()} onClick={submit}>
            {busy ? "Adding…" : "Add"}
          </button>
          <span className="rd-note" style={{ fontSize: 9 }}>Ctrl+Enter</span>
        </div>
        {results.length > 0 && (
          <div className="rd-add-results">
            {results.map((r, i) => (
              <div key={i} className={`rd-add-result ${r.status === "ok" ? "rd-add-ok" : r.status === "exists" ? "rd-add-exist" : "rd-add-err"}`} style={{ fontSize: 9.5 }}>
                {r.status === "ok" ? "✓" : r.status === "exists" ? "=" : "✗"} {r.label}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rd-card">
      <div className="rd-card-h">Add sources</div>
      <textarea
        className="rd-input rd-add-ta"
        placeholder={"Paste one or more URLs (newline- or comma-separated):\nchannel URL · @handle · video URL"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); }}
      />
      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="rd-btn rd-btn-acc" disabled={busy || !text.trim()} onClick={submit}>
          {busy ? "Adding…" : "Add"}
        </button>
        <span className="rd-note">Ctrl+Enter to submit</span>
      </div>
      {results.length > 0 && (
        <div className="rd-add-results">
          {results.map((r, i) => (
            <div key={i} className={`rd-add-result ${r.status === "ok" ? "rd-add-ok" : r.status === "exists" ? "rd-add-exist" : "rd-add-err"}`}>
              {r.status === "ok" ? "✓" : r.status === "exists" ? "=" : "✗"} {r.label}
            </div>
          ))}
        </div>
      )}
      <div className="rd-note" style={{ marginTop: 8 }}>Seeds: paste a Stock Market Live or StockedUp video URL to start, or a channel to monitor.</div>
    </div>
  );
}

function SourceMonitor({ sources, onRemove }: { sources: IntelSource[]; onRemove: (id: string) => void }) {
  return (
    <div className="rd-card">
      <div className="rd-card-h">Source Monitor · {sources.length}</div>
      {sources.length === 0 ? <div className="rd-state">No sources yet.</div> : sources.map((s) => (
        <div key={s.id} className="rd-irow">
          {s.thumbnail ? <img className="rd-irow-thumb" src={s.thumbnail} alt="" /> : <span className="rd-irow-thumb" aria-hidden="true" />}
          <div className="rd-irow-main">
            <div className="rd-irow-title">{s.title}</div>
            <div className="rd-irow-meta">
              <span>{s.type}</span>
              <span className={`rd-chip ${s.status === "active" ? "rd-chip-ok" : "rd-chip-warn"}`}>{s.status}</span>
              <span>checked {ago(s.lastChecked)}</span>
              {s.error && <span className="rd-warn">{s.error}</span>}
            </div>
          </div>
          <div className="rd-irow-actions">
            <a className="rd-btn rd-btn-sm rd-btn-ghost" href={s.url} target="_blank" rel="noreferrer">View</a>
            <button type="button" className="rd-btn rd-btn-sm rd-btn-ghost" onClick={() => onRemove(s.id)}>Remove</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function statusBadge(v: IntelVideo) {
  if (v.liveState === "live") return <span className="rd-chip rd-chip-err">Live</span>;
  if (v.status === "analyzing") return <span className="rd-chip rd-chip-warn">Processing</span>;
  if (v.status === "preliminary") return <span className="rd-chip rd-chip-warn">Preliminary</span>;
  if (v.status === "analyzed") return <span className="rd-chip rd-chip-ok">Analyzed</span>;
  if (v.transcriptStatus === "pending" || v.transcriptStatus === "unavailable")
    return <span className="rd-chip rd-chip-dim">Transcript {v.transcriptStatus}</span>;
  return <span className="rd-chip rd-chip-dim">{v.status}</span>;
}

function VideoLibrary({ videos, onOpen }: { videos: IntelVideo[]; onOpen: (id: string) => void }) {
  return (
    <div className="rd-card">
      <div className="rd-card-h">Video Library · {videos.length}</div>
      {videos.length === 0 ? <div className="rd-state">No videos yet — add a video source above.</div> : videos.slice(0, 20).map((v) => (
        <div key={v.videoId} className="rd-irow clickable" onClick={() => onOpen(v.videoId)}>
          {v.thumbnail ? <img className="rd-irow-thumb" src={v.thumbnail} alt="" /> : <span className="rd-irow-thumb" aria-hidden="true" />}
          <div className="rd-irow-main">
            <div className="rd-irow-title">{v.title}</div>
            <div className="rd-irow-meta">
              <span>{v.channelTitle ?? ""}</span>
              {statusBadge(v)}
              {v.stale && <span className="rd-chip rd-chip-warn">Stale</span>}
              {typeof v.ideaCount === "number" && <span>{v.ideaCount} ideas{v.optionCount ? ` · ${v.optionCount} options` : ""} · {v.levelCount ?? 0} levels</span>}
            </div>
          </div>
          <div className="rd-irow-actions"><span className="rd-btn rd-btn-sm rd-btn-ghost">Open</span></div>
        </div>
      ))}
    </div>
  );
}

function VideoDrawer({ videoId, onClose, onProcessed, aiOn }: { videoId: string; onClose: () => void; onProcessed: () => void; aiOn: boolean }) {
  const [bundle, setBundle] = useState<{ video: IntelVideo; analysis: VideoAnalysis | null; chapters: Chapter[] } | null>(null);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [selectedChapterSec, setSelectedChapterSec] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const r = await fetch(`/api/intel/videos/${encodeURIComponent(videoId)}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      setBundle(await r.json());
    } catch { setLoadErr(true); }
  }, [videoId]);
  useEffect(() => { load(); }, [load]);

  const process = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/intel/videos/${encodeURIComponent(videoId)}/transcript`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript }),
      });
      const j = await r.json();
      if (!j.ok) setErr(`Processing failed: ${j.error ?? "error"}`);
      else { setTranscript(""); await load(); onProcessed(); }
    } finally { setBusy(false); }
  }, [transcript, videoId, load, onProcessed]);

  const v = bundle?.video, a = bundle?.analysis, chapters = bundle?.chapters ?? [];
  const selectedChapter = selectedChapterSec !== null ? chapters.find((ch) => ch.startSeconds === selectedChapterSec) ?? null : null;
  const filter = <T extends { sourceStartSeconds: number }>(arr: T[]) =>
    selectedChapter ? arr.filter((i) => i.sourceStartSeconds >= selectedChapter.startSeconds && i.sourceStartSeconds < selectedChapter.endSeconds) : arr;
  const visibleIdeas = a?.tradeIdeas ? filter(a.tradeIdeas) : [];
  const visibleOptions = a?.optionIdeas ? filter(a.optionIdeas) : [];
  const visibleLevels = a?.levels ? filter(a.levels) : [];

  return (
    <>
      <div className="rd-drawer-scrim" onClick={onClose} />
      <div className="rd-drawer">
        <button type="button" className="rd-drawer-x" onClick={onClose} aria-label="Close">✕</button>
        {!bundle && loadErr ? (
          <div className="rd-state rd-state-err" style={{ marginTop: 32 }}>
            Couldn&apos;t load this video. <button type="button" className="rd-btn rd-btn-sm" onClick={load}>Retry</button>
          </div>
        ) : !bundle ? (
          <>
            <div className="rd-shim rd-shim-block" style={{ height: 22, width: "70%" }} />
            <div className="rd-shim rd-shim-block" style={{ height: 14, width: "45%" }} />
            <div className="rd-shim rd-shim-block" style={{ height: 120 }} />
          </>
        ) : (
          <>
            <div className="rd-drawer-kicker">VIDEO</div>
            <h3 className="rd-drawer-title">{v?.title}</h3>
            <div className="rd-irow-meta" style={{ marginBottom: 12 }}>
              <span>{v?.channelTitle}</span>
              {v && statusBadge(v)}
              {v?.stale && <span className="rd-chip rd-chip-warn">Stale</span>}
              <a className="rd-cite" href={watchUrl(videoId)} target="_blank" rel="noreferrer">▸ open on YouTube</a>
            </div>
            {v?.status !== "analyzed" && (
              <div className="rd-card rd-tx" style={{ marginTop: 12 }}>
                <div className="rd-tx-step">
                  {a?.pass === "preliminary" ? "STEP 1 CONT. · PASTE FULL TRANSCRIPT" : "STEP 1 · PASTE TRANSCRIPT"}
                </div>
                {a?.pass === "preliminary" && (
                  <div className="rd-note" style={{ marginBottom: 10, fontSize: 10.5 }}>
                    Preliminary pass done — paste the full transcript for the complete analysis.
                  </div>
                )}
                <div className="rd-tx-how">
                  YouTube → ··· (below video) → Show transcript → copy all → paste here
                </div>
                <textarea
                  className="rd-input rd-tx-ta"
                  aria-label="Paste video transcript"
                  placeholder={"Paste transcript here. Timestamps included when present.\n\n(YouTube → below video → ··· → Show transcript → copy)"}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
                <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                  <button type="button" className="rd-btn rd-btn-acc rd-tx-btn" disabled={busy || !aiOn || transcript.trim().length < 40} onClick={process}>
                    {busy ? "Analyzing…" : "Analyze →"}
                  </button>
                  {!aiOn && <span className="rd-note rd-warn">Needs ANTHROPIC_API_KEY.</span>}
                  {err && <span className="rd-note rd-state-err">{err}</span>}
                </div>
              </div>
            )}
            {a?.warnings?.length ? <div className="rd-note rd-warn" style={{ marginBottom: 8 }}>{a.warnings.join(" · ")}</div> : null}
            {chapters.length > 0 && (
              <div className="rd-card">
                <div className="rd-card-h">Chapters {selectedChapter && <button type="button" className="rd-btn rd-btn-sm rd-btn-ghost" onClick={() => setSelectedChapterSec(null)}>Clear filter</button>}</div>
                {chapters.map((ch) => (
                  <div key={ch.startSeconds} className={`rd-chap${selectedChapterSec === ch.startSeconds ? " active" : ""}`} role="button" tabIndex={0}
                    onClick={() => setSelectedChapterSec(selectedChapterSec === ch.startSeconds ? null : ch.startSeconds)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedChapterSec(selectedChapterSec === ch.startSeconds ? null : ch.startSeconds); }}>
                    <a className="rd-chap-t" href={watchUrl(videoId, ch.startSeconds)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{mmss(ch.startSeconds)}</a>
                    <span className={ch.priority === "high" ? "rd-chap-hi" : ""}>{ch.title}</span>
                    {!ch.creatorDefined && <span className="rd-chip rd-chip-inf">AUGUST</span>}
                    <span className="rd-chap-cat">{CAT_LABEL[ch.normalizedCategory] ?? ch.normalizedCategory}</span>
                  </div>
                ))}
              </div>
            )}
            {a && (
              <>
                {a.overallSummary && <div className="rd-card"><div className="rd-card-h">Summary {a.pass === "preliminary" && <span className="rd-chip rd-chip-warn">Preliminary</span>}</div><p className="rd-body-p">{a.overallSummary}</p></div>}
                {selectedChapter && <div className="rd-chap-filter"><span>Filtering:</span><b>{selectedChapter.title}</b><button type="button" className="rd-btn rd-btn-sm rd-btn-ghost" onClick={() => setSelectedChapterSec(null)}>Clear</button></div>}
                {visibleIdeas.length > 0 && <div className="rd-card"><div className="rd-card-h">Trade Ideas · {visibleIdeas.length}{selectedChapter ? " (in chapter)" : ""}</div>{visibleIdeas.map((i) => <IdeaCard key={i.id} idea={i} favorite={i.creatorDesignation.isFavoriteSetup} />)}</div>}
                {visibleOptions.length > 0 && <div className="rd-card"><div className="rd-card-h">Option Ideas · {visibleOptions.length}{selectedChapter ? " (in chapter)" : ""}</div>{visibleOptions.map((o) => <DrawerOptionRow key={o.id} o={o} />)}</div>}
                {visibleLevels.length > 0 && <div className="rd-card"><div className="rd-card-h">Levels · {visibleLevels.length}{selectedChapter ? " (in chapter)" : ""}</div>{visibleLevels.map((l) => <LevelRow key={l.id} l={l} />)}</div>}
                {a.catalysts.length > 0 && <div className="rd-card"><div className="rd-card-h">Catalysts</div>{a.catalysts.map((c, i) => <CatalystRow key={i} c={c} />)}</div>}
                <button type="button" className="rd-btn rd-btn-sm rd-btn-ghost" onClick={async () => { setBusy(true); await fetch(`/api/intel/videos/${encodeURIComponent(videoId)}/reprocess`, { method: "POST" }); await load(); onProcessed(); setBusy(false); }}>Reprocess</button>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function BriefCard({ brief, ai, onOpenVideo, historical }: { brief: DailyBrief | null; ai: boolean; onOpenVideo: (id: string) => void; historical?: boolean }) {
  const [read60, setRead60] = useState(false);
  if (!brief) {
    return (
      <div className="rd-card">
        <div className="rd-card-h">{historical ? "No brief for this date" : "Tonight's Brief"}</div>
        <div className="rd-state">{historical ? "No brief was stored for this date." : <>No brief generated yet. Add a source, process a transcript, then press <b>Generate Brief</b>{!ai ? " (needs ANTHROPIC_API_KEY)" : ""}.</>}</div>
      </div>
    );
  }
  return (
    <>
      <div className="rd-card">
        <div className="rd-card-h">
          {historical ? `Brief · ${brief.date}` : `Tonight's Brief · ${brief.date}`}
          <button type="button" className="rd-btn rd-btn-sm rd-btn-ghost" onClick={() => setRead60((r) => !r)}>{read60 ? "Full" : "Read in 60s"}</button>
        </div>
        {brief.read60 && read60 && <p className="rd-read60">{brief.read60}</p>}
        {!brief.grounded && <div className="rd-note rd-warn">AI narrative offline — structured intel only.</div>}
        {!read60 && <dl style={{ margin: 0 }}>
          {brief.posture && <div className="rd-briefrow"><dt>Posture</dt><dd>{brief.posture}</dd></div>}
          {brief.whatChanged && <div className="rd-briefrow"><dt>What changed</dt><dd>{brief.whatChanged}</dd></div>}
          {brief.whatMattersTomorrow && <div className="rd-briefrow"><dt>Tomorrow</dt><dd>{brief.whatMattersTomorrow}</dd></div>}
          {brief.watchAtOpen && <div className="rd-briefrow"><dt>At the open</dt><dd>{brief.watchAtOpen}</dd></div>}
          {brief.invalidation && <div className="rd-briefrow"><dt>Invalidation</dt><dd>{brief.invalidation}</dd></div>}
        </dl>}
        {!read60 && (brief.bullCase || brief.bearCase) && (
          <div className="rd-bullbear">
            <div className="rd-bb rd-bb-bull"><div className="rd-bb-h">BULL CASE</div><div className="rd-bb-p">{brief.bullCase || "—"}</div></div>
            <div className="rd-bb rd-bb-bear"><div className="rd-bb-h">BEAR CASE</div><div className="rd-bb-p">{brief.bearCase || "—"}</div></div>
          </div>
        )}
      </div>
      {brief.creatorFavorites.length > 0 && <div className="rd-card"><div className="rd-card-h">Creator Favorites</div>{brief.creatorFavorites.map((i) => <IdeaCard key={i.id} idea={i} favorite onOpenVideo={onOpenVideo} />)}</div>}
      <div className="rd-card"><div className="rd-card-h">Top Trade Ideas</div>{brief.topIdeas.length === 0 ? <div className="rd-state">No ideas extracted yet.</div> : brief.topIdeas.map((i) => <IdeaCard key={i.id} idea={i} onOpenVideo={onOpenVideo} />)}</div>
      {brief.levels.length > 0 && <div className="rd-card"><div className="rd-card-h">Levels &amp; Triggers</div>{brief.levels.slice(0, 24).map((l) => <LevelRow key={l.id} l={l} />)}</div>}
      {brief.catalysts.length > 0 && <div className="rd-card"><div className="rd-card-h">Catalyst Map</div>{brief.catalysts.slice(0, 20).map((c, i) => <CatalystRow key={i} c={c} />)}</div>}
      {brief.consensus.length > 0 && <div className="rd-card"><div className="rd-card-h">Consensus &amp; Conflicts</div>{brief.consensus.slice(0, 20).map((c) => <ConsensusRow key={c.ticker} c={c} />)}</div>}
    </>
  );
}

// ── IntelDashboard (main) ────────────────────────────────────────────────────

export default function IntelDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openVideo, setOpenVideo] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("BOARD");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [historyBrief, setHistoryBrief] = useState<DailyBrief | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [histErr, setHistErr] = useState(false);
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [tape, setTape] = useState<TapeItem[]>([]);
  const [clock, setClock] = useState(etClock());
  // Honest latency: the last successful /api/intel/quotes roundtrip, measured
  // client-side. null until the first fetch completes.
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  // Health facts for the status bar — when the last quote roundtrip actually
  // landed (DATA degrades to STALE, never lies LIVE) and whether the tracker
  // endpoint is reachable (rows silently fall back to derived statuses
  // otherwise; the chrome must say so).
  const [lastQuoteOkAt, setLastQuoteOkAt] = useState<number | null>(null);
  const [trackerOk, setTrackerOk] = useState<boolean | null>(null);
  // Idea Tracker: server-evaluated lifecycle records (page-load pass is
  // server-throttled, so polling this is cheap).
  const [trackedList, setTrackedList] = useState<TrackedIdea[]>([]);
  const [blotterFilter, setBlotterFilter] = useState<BlotterFilter>("ALL");
  // when the overview fetch last failed (ET, with seconds) — the board error
  // state renders this real timestamp, never the design's sample ERR line
  const [errAt, setErrAt] = useState<string | null>(null);
  // fold-ins payload (fng / sectors / earnings) — null until the first desk
  // fetch lands; sections are simply absent until then (no spinners, no CLS
  // reservations — the rail is a vertical stack with a fixed mount order)
  const [desk, setDesk] = useState<DeskData | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/intel/overview", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setData(await r.json());
      setStatus("ready");
    } catch {
      // real ET timestamp for the design's board-error ERR line — never the mock
      setErrAt(etClockSec());
      setStatus((s) => (s === "ready" ? "ready" : "error"));
    }
  }, []);

  const fetchMacroTape = useCallback(async () => {
    try {
      const t0 = performance.now();
      const r = await fetch(`/api/intel/quotes?symbols=${TAPE_MACRO.join(",")}`, { cache: "no-store" });
      const j = await r.json();
      setLatencyMs(Math.round(performance.now() - t0));
      setLastQuoteOkAt(Date.now());
      const q: QuoteMap = j.quotes ?? {};
      setTape((prev) => {
        const watch = prev.filter((t) => t.kind === "watch");
        const macro: TapeItem[] = TAPE_MACRO.filter((s) => q[s]).map((s) => ({
          kind: "macro" as const, sym: s, price: q[s].price, chgPct: q[s].chgPct,
        }));
        return [...macro, ...watch];
      });
    } catch { /* keep existing */ }
  }, []);

  // live tracked list mirrored into a ref so fetchBlotterQuotes can read it
  // without depending on trackedList state (which changes identity every 30s
  // tracker poll and would re-arm the poll interval effect)
  const trackedRef = useRef<TrackedIdea[]>([]);

  const fetchBlotterQuotes = useCallback(async (brief: DailyBrief) => {
    const ideas = [...(brief.creatorFavorites ?? []), ...(brief.topIdeas ?? [])];
    // stage 6: quote the union the US map plots — blotter symbols PLUS live
    // (non-CLOSED) tracked tickers, so map dots carry a REAL chgPct even on
    // days the brief holds no board ideas. Blotter symbols keep priority
    // under the endpoint's 20-symbol cap.
    const live = trackedRef.current.filter((t) => t.status !== "CLOSED").map((t) => t.ticker);
    const syms = [...new Set([...ideas.map((i) => i.ticker), ...live].map((s) => s.toUpperCase()))].slice(0, 20);
    if (!syms.length) return;
    try {
      const t0 = performance.now();
      const r = await fetch(`/api/intel/quotes?symbols=${syms.join(",")}`, { cache: "no-store" });
      const j = await r.json();
      setLatencyMs(Math.round(performance.now() - t0));
      setLastQuoteOkAt(Date.now());
      setQuotes(j.quotes ?? {});
    } catch { /* keep */ }
  }, []);

  const fetchTracker = useCallback(async () => {
    try {
      const r = await fetch("/api/intel/tracker", { cache: "no-store" });
      const j = await r.json();
      if (r.ok && Array.isArray(j.tracked)) {
        setTrackedList(j.tracked);
        trackedRef.current = j.tracked;
        setTrackerOk(true);
      } else {
        setTrackerOk(false);
      }
    } catch { setTrackerOk(false); /* keep the last tracked list */ }
  }, []);

  // initial parallel fetch
  useEffect(() => {
    load();
    fetchMacroTape();
    fetchTracker();
    fetch("/api/intel/briefs", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (Array.isArray(j.dates)) setHistoryDates(j.dates.slice(0, 14)); })
      .catch(() => {});
  }, [load, fetchMacroTape, fetchTracker]);

  // desk fold-ins: once on mount + every 5 min — deliberately SEPARATE from
  // the 30s quotes poll (SPEC-wiring §4: server TTLs — fng 30m, sectors 15m,
  // earnings 6h — absorb even this; a 30s cadence would just burn requests).
  // Failures keep the last payload: a blip never blanks a rendered gauge.
  const fetchDesk = useCallback(async () => {
    try {
      const r = await fetch("/api/intel/desk", { cache: "no-store" });
      if (!r.ok) return;
      const j: DeskData = await r.json();
      setDesk(j);
    } catch { /* keep the last desk payload */ }
  }, []);
  useEffect(() => {
    fetchDesk();
    const t = setInterval(fetchDesk, 5 * 60_000);
    return () => clearInterval(t);
  }, [fetchDesk]);

  // ET clock
  useEffect(() => {
    const t = setInterval(() => setClock(etClock()), 60000);
    return () => clearInterval(t);
  }, []);

  // fetch blotter quotes when the brief changes — and refetch when tracker
  // health flips (its first landing can postdate the brief, and tracked-only
  // map dots should not sit ash/quote-less until the 30s poll)
  useEffect(() => {
    if (data?.brief) fetchBlotterQuotes(data.brief);
  }, [data?.brief, trackerOk, fetchBlotterQuotes]);

  // auto-refresh quotes every 30s (tracker piggybacks — its server pass is
  // throttled to ~2 min, so most polls just return the stored set)
  useEffect(() => {
    if (!data?.brief) return;
    const brief = data.brief;
    const t = setInterval(() => {
      fetchMacroTape();
      fetchBlotterQuotes(brief);
      fetchTracker();
    }, 30000);
    return () => clearInterval(t);
  }, [data?.brief, fetchMacroTape, fetchBlotterQuotes, fetchTracker]);

  const loadDate = useCallback(async (date: string, force = false) => {
    if (!force && date === selectedDate) { setSelectedDate(null); setHistoryBrief(null); setHistErr(false); return; }
    setSelectedDate(date);
    setHistErr(false);
    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/intel/briefs/${encodeURIComponent(date)}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const j = await r.json();
      setHistoryBrief(j.brief ?? null);
    } catch {
      // an error is not "no brief was stored" — keep the two states distinct
      setHistoryBrief(null);
      setHistErr(true);
    }
    finally { setHistoryLoading(false); }
  }, [selectedDate]);

  const removeSource = useCallback(async (id: string) => {
    await fetch(`/api/intel/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }, [load]);

  const sync = useCallback(async () => {
    setBusy("sync"); setMsg(null);
    try {
      const r = await fetch("/api/intel/sync", { method: "POST" });
      const j = await r.json();
      setMsg(j.ok ? `Sync: ${j.discovered} new video(s).` : j.message ?? "Sync needs YOUTUBE_API_KEY.");
      await load();
    } finally { setBusy(null); }
  }, [load]);

  const generateBrief = useCallback(async () => {
    setBusy("brief"); setMsg(null);
    try {
      const r = await fetch("/api/intel/briefs/today", { method: "POST" });
      const j = await r.json();
      if (!j.ok) setMsg(`Brief: ${j.error ?? "failed"}`);
      await load();
    } finally { setBusy(null); }
  }, [load]);

  if (status === "loading") {
    // skeleton shaped to the redesign chrome heights (bar1 33 / bar2 42 /
    // status 25 / tape 30) so ready-state lands where the bars were —
    // loading → ready repaints nothing structurally. Shimmer is the design's
    // augShimmer treatment with its staggered delays (SPEC-desktop §2.6.2).
    return (
      <div>
        {[33, 42, 25, 30].map((h, i) => (
          <div key={i} className="rd-skel-bar" style={{ height: h, animationDelay: `${i * 0.07}s` }} />
        ))}
        <div style={{ padding: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rd-skel-row" style={{ animationDelay: `${0.28 + i * 0.07}s` }} />
          ))}
        </div>
      </div>
    );
  }
  if (!data) {
    // design ERROR treatment (SPEC-wiring §2.12) with the REAL failure + real
    // ET timestamp; RETRY re-runs the real overview load (the failed action)
    return (
      <div className="rd-board-error" role="alert">
        <div className="rd-err-glyph" aria-hidden="true">△</div>
        <div className="rd-err-title">ANALYSIS FAILED</div>
        <p className="rd-err-copy">Could not load the Market Intel overview — the data service did not respond.</p>
        {errAt && <div className="rd-err-line">ERR · OVERVIEW_UNREACHABLE · {errAt} ET</div>}
        <button type="button" className="rd-btn-retry" onClick={load}>RETRY</button>
      </div>
    );
  }

  const { config, sources, videos, brief } = data;
  const displayBrief = selectedDate ? historyBrief : brief;
  const blotter = buildBlotter(brief, quotes);
  const selectedIdea = blotter.find((i) => i.id === selectedId) ?? null;

  // join blotter rows to tracker records through contributed idea ids
  const trackedByIdeaId = new Map<string, TrackedIdea>();
  for (const t of trackedList) for (const iid of t.ideaIds) trackedByIdeaId.set(iid, t);
  const selectedTracked = selectedIdea ? trackedByIdeaId.get(selectedIdea.id) ?? null : null;
  const conflictVariants = selectedTracked?.conflictKey
    ? trackedList.filter((t) => t.conflictKey === selectedTracked.conflictKey && t.id !== selectedTracked.id)
    : [];

  // inspector breadcrumb position — the selected row's 1-based index among the
  // currently visible rows in DISPLAY order (horizon groups), and the derived
  // denominator (SPEC-wiring §2.11: the design's /6 was hardcoded)
  const visibleRows = visibleBlotter(blotter, trackedByIdeaId, blotterFilter);
  const displayRows = BOARD_GROUPS.flatMap((g) =>
    visibleRows.filter((i) => (TF_GROUP[i.timeHorizon] ?? "LONG-TERM") === g.key),
  );
  const selRowIdx = selectedIdea ? displayRows.findIndex((r) => r.id === selectedIdea.id) : -1;

  // compose watchlist tape items from blotter — one chip per symbol. Multiple
  // ideas can share a ticker (e.g. two stated FCEL triggers); the quote is
  // per-symbol, so show the symbol once with its most urgent derived status.
  const URGENCY: Record<IdeaStatus, number> = { TRIG: 4, ARMED: 3, ACTIVE: 2, INVLD: 1, WATCH: 0 };
  const watchBySym = new Map<string, Extract<TapeItem, { kind: "watch" }>>();
  for (const i of blotter) {
    if (!i.quote) continue;
    const item = {
      kind: "watch" as const, sym: i.ticker,
      price: i.quote.price, chgPct: i.quote.chgPct,
      status: deriveStatus(i),
    };
    const cur = watchBySym.get(item.sym);
    if (!cur || URGENCY[item.status] > URGENCY[cur.status]) watchBySym.set(item.sym, item);
  }
  const fullTape: TapeItem[] = [
    ...tape.filter((t) => t.kind === "macro"),
    ...watchBySym.values(),
  ];

  const initialSymbol =
    brief?.options?.bestCreatorPlays[0]?.underlyingSymbol ||
    brief?.options?.directionalOnly[0]?.underlyingSymbol ||
    brief?.topIdeas[0]?.ticker || "SPY";

  return (
    <SymbolProvider initial={initialSymbol}>
      {/* design frame structure (SPEC-desktop §2): ambient illumination layer
          at z-0, content wrapper at z-1 — the ambient glow shows through
          transparent regions below the chrome */}
      <div style={{ position: "relative" }}>
        <div className="rd-ambient" aria-hidden="true" />
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <div className="sr-only" role="status" aria-live="polite">
          {busy === "sync" ? "Syncing channels" : busy === "brief" ? "Generating brief" : ""}
        </div>

        <PageHeader
          data={data}
          clock={clock}
          tab={tab}
          onTab={setTab}
          blotter={blotter}
          busy={busy}
          onSync={sync}
          onGenerateBrief={generateBrief}
          fng={desk?.fng ?? null}
        />
        <StatusBar data={data} clock={clock} latencyMs={latencyMs} lastQuoteOkAt={lastQuoteOkAt} trackerOk={trackerOk} />
        <LiveTape tape={fullTape} />

        {msg && (
          <div className="rd-banner">
            {msg} <button type="button" className="rd-btn rd-btn-sm rd-btn-ghost" onClick={() => setMsg(null)}>✕</button>
          </div>
        )}
        {!config.storage && (
          <div className="rd-banner rd-warn">
            Upstash not configured — UPSTASH_REDIS_REST_URL/TOKEN needed.
          </div>
        )}

        {/* ── BOARD ── */}
        {tab === "BOARD" && (
          <div className="rd-main" style={{ flex: 1 }}>
            <LeftPanel
              brief={brief}
              onReload={load}
              quotes={quotes}
              onSync={sync}
              onGenerateBrief={generateBrief}
              busy={busy}
              lastBriefAt={data.lastBriefAt}
              aiOn={config.ai}
              sourceCount={sources.length}
              videoCount={videos.length}
              onGoSources={() => setTab("SOURCES")}
              blotter={blotter}
              trackedByIdeaId={trackedByIdeaId}
              onSelectIdea={setSelectedId}
              desk={desk}
            />
            <div className="rd-center">
              {/* board header (SPEC-desktop §2.6.2) — real count, real cadence */}
              <div className="rd-bhead">
                <span className="rd-bhead-title">TRADE BLOTTER</span>
                <span className="rd-bhead-meta">{blotter.length} IDEAS · ▾ URGENCY · AUTO-REFRESH 30s</span>
              </div>
              {/* legend — design glyphs; ◇ EXTRACTED is deliberately absent
                  (never emitted, SPEC-wiring §2.2); spark + ° honesty notes */}
              <div className="rd-legend">
                <span className="rd-leg"><span className="rd-leg-g rd-leg-live" aria-hidden="true">◉</span> live market</span>
                <span className="rd-leg"><span className="rd-leg-g rd-leg-quote" aria-hidden="true">❝</span> quoted from transcript</span>
                <span className="rd-leg"><span className="rd-leg-g rd-leg-abs" aria-hidden="true">∅</span> not stated</span>
                <span className="rd-leg-div" aria-hidden="true" />
                <span className="rd-leg"><span className="rd-leg-g rd-leg-quote" aria-hidden="true">▮</span> direct</span>
                <span className="rd-leg"><span className="rd-leg-g rd-leg-inf" aria-hidden="true">~</span> inferred</span>
                <span className="rd-leg-div" aria-hidden="true" />
                <span className="rd-leg">spark · 1M daily closes</span>
                <span className="rd-leg">° price since first mention (not trade P&amp;L)</span>
              </div>
              {/* tracker filter — TRACKED = level-anchored ideas only;
                  semantics + aria-pressed unchanged, design segmented look */}
              <div className="rd-filter-row" role="group" aria-label="Filter ideas by tracker state">
                <div className="rd-filter-seg">
                  {(["ALL", "TRACKED", "TRIGGERED", "ARMED", "ACTIVE", "INVALIDATED"] as BlotterFilter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`rd-fchip${blotterFilter === f ? " on" : ""}`}
                      aria-pressed={blotterFilter === f}
                      onClick={() => setBlotterFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <BlotterTable
                ideas={blotter}
                trackedByIdeaId={trackedByIdeaId}
                filter={blotterFilter}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId((c) => (c === id ? null : id))}
                loading={busy === "sync" || busy === "brief"}
                busy={busy}
                aiOn={config.ai}
                onAddSource={() => setTab("SOURCES")}
                onGenerateBrief={generateBrief}
              />
              <OptionsIntelPanel brief={brief} />
            </div>
            <div className="rd-inspcol">
              <Inspector
                idea={selectedIdea}
                tracked={selectedTracked}
                variants={conflictVariants}
                rowNo={selRowIdx >= 0 ? selRowIdx + 1 : null}
                rowCount={displayRows.length}
              />
            </div>
          </div>
        )}

        {/* ── BRIEF ── */}
        {tab === "BRIEF" && (
          <div className="rd-tabview">
            <div className="rd-hist-bar">
              {selectedDate && (
                <button
                  type="button"
                  className="rd-btn rd-btn-acc rd-hist-today"
                  onClick={() => { setSelectedDate(null); setHistoryBrief(null); }}
                >
                  ← TODAY&apos;S BRIEF
                </button>
              )}
              <span className="rd-hist-label">BRIEF HISTORY</span>
              <div className="rd-hist-pills">
                {historyDates.length === 0
                  ? <span className="rd-hist-empty">No prior briefs stored.</span>
                  : historyDates.map((d) => (
                    <button key={d} type="button" className={`rd-datepill${selectedDate === d ? " on" : ""}`} onClick={() => loadDate(d)}>{d}</button>
                  ))}
              </div>
            </div>
            {historyLoading
              ? <div className="rd-card"><div className="rd-card-h">Loading…</div><div className="rd-shim rd-shim-block" style={{ height: 14 }} /></div>
              : histErr && selectedDate
              ? (
                <div className="rd-state rd-state-err">
                  Couldn&apos;t load the {selectedDate} brief.{" "}
                  <button type="button" className="rd-btn rd-btn-sm" onClick={() => loadDate(selectedDate, true)}>Retry</button>
                </div>
              )
              : <BriefCard brief={displayBrief} ai={config.ai} onOpenVideo={setOpenVideo} historical={!!selectedDate} />}
          </div>
        )}

        {/* ── SOURCES ── */}
        {tab === "SOURCES" && (
          <div className="rd-tabview">
            <div className="rd-card rd-card-acc">
              <div className="rd-card-h">WORKFLOW</div>
              <ol className="rd-steps">
                <li className="rd-step"><span className="rd-step-n" aria-hidden="true">1</span><span>Add a channel or video URL in the box below</span></li>
                <li className="rd-step"><span className="rd-step-n" aria-hidden="true">2</span><span>Click any video → paste its transcript → Analyze</span></li>
                <li className="rd-step"><span className="rd-step-n" aria-hidden="true">3</span><span>Hit Generate Brief to synthesize all sources into today&apos;s brief</span></li>
              </ol>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button type="button" className="rd-btn rd-btn-acc" style={{ flex: 1 }} disabled={busy === "sync"} aria-busy={busy === "sync"} onClick={sync}>
                  {busy === "sync" ? "Syncing…" : "SYNC CHANNELS"}
                </button>
                <button type="button" className="rd-btn rd-btn-acc" style={{ flex: 1 }} disabled={busy === "brief" || !config.ai} aria-busy={busy === "brief"} onClick={generateBrief}>
                  {busy === "brief" ? "Generating…" : "GENERATE BRIEF"}
                </button>
              </div>
              {data.lastBriefAt > 0 && (
                <div className="rd-lp-age" style={{ marginTop: 8 }}>
                  last brief {ago(data.lastBriefAt)}{!config.ai ? " · needs ANTHROPIC_API_KEY" : ""}
                </div>
              )}
              {!config.ai && data.lastBriefAt === 0 && (
                <div className="rd-note rd-warn" style={{ marginTop: 8 }}>needs ANTHROPIC_API_KEY to generate briefs</div>
              )}
              {!config.youtube && (
                <div className="rd-note rd-warn" style={{ marginTop: 8 }}>
                  YOUTUBE_API_KEY unset — channel auto-discovery off; add videos by URL and paste transcripts manually.
                </div>
              )}
            </div>
            <AddSource onReload={load} />
            <SourceMonitor sources={sources} onRemove={removeSource} />
            <VideoLibrary videos={videos} onOpen={setOpenVideo} />
          </div>
        )}

        {/* ── OPTIONS ── */}
        {tab === "OPTIONS" && (
          <div className="rd-tabview">
            <OptionsWorkspace brief={brief} levels={brief?.levels ?? []} />
          </div>
        )}

        {/* ── ASK ── */}
        {tab === "ASK" && (
          <div className="rd-tabview" style={{ paddingBottom: 120 }}>
            <div className="rd-card">
              <div className="rd-card-h">Ask AUGUST</div>
              <p className="rd-note" style={{ margin: 0 }}>Use the bar below — AUGUST answers from your processed video transcripts.</p>
              {!config.ai && <div className="rd-state rd-warn">Needs ANTHROPIC_API_KEY.</div>}
            </div>
          </div>
        )}

        <div className="rd-disc" style={{ paddingBottom: 64 }}>
          AUGUST Market Intel is decision-support over creator commentary. It never trades and never invents prices, levels, or tickers. Not financial advice.
        </div>

        <AskBar ai={config.ai} />

        {openVideo && (
          <VideoDrawer key={openVideo} videoId={openVideo} onClose={() => setOpenVideo(null)} onProcessed={load} aiOn={config.ai} />
        )}
        </div>
      </div>
    </SymbolProvider>
  );
}
