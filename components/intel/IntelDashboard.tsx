"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type {
  BriefIdea,
  Chapter,
  ChapterCategory,
  ConsensusItem,
  DailyBrief,
  IntelCatalyst,
  IntelLevel,
  IntelSource,
  IntelVideo,
  OptionBriefIdea,
  OptionIdea,
  TradeIdea,
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

// ── constants ────────────────────────────────────────────────────────────────

const TAPE_MACRO = ["SPY", "QQQ", "IWM", "^VIX", "GC=F", "CL=F", "BTC-USD", "ETH-USD"];

const TF_LABEL: Record<string, string> = {
  intraday: "ID", next_session: "NS", swing: "SW", long_term: "LT", unspecified: "—",
};
const TF_FULL: Record<string, string> = {
  intraday: "INTRADAY", next_session: "NEXT SESSION", swing: "SWING", long_term: "LONG TERM", unspecified: "—",
};

const TF_GROUP: Record<string, string> = {
  intraday: "TODAY · TOP IDEAS",
  next_session: "SHORT-TERM · SWING",
  swing: "SHORT-TERM · SWING",
  long_term: "LONG-TERM",
  unspecified: "LONG-TERM",
};

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
const ago = (ms: number) =>
  ms ? `${Math.max(1, Math.round((Date.now() - ms) / 60000))}m ago` : "never";
const ageStr = (since: number) => {
  const m = Math.max(1, Math.round((Date.now() - since) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};
const etClock = () =>
  new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const fmtPx = (n: number) =>
  n >= 1000 ? n.toFixed(2) : n >= 10 ? n.toFixed(2) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

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

function deltaTrig(idea: BlotterIdea): string {
  const q = idea.quote;
  const ent = idea.entry?.value;
  if (!q || ent == null || ent <= 0) return "—";
  const pct = ((q.price - ent) / ent) * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
}

function buildBlotter(brief: DailyBrief | null, quotes: QuoteMap): BlotterIdea[] {
  if (!brief) return [];
  const seen = new Set<string>();
  const favIds = new Set(brief.creatorFavorites.map((f) => f.id));
  return [...brief.creatorFavorites, ...brief.topIdeas]
    .filter((idea) => { if (seen.has(idea.id)) return false; seen.add(idea.id); return true; })
    .map((idea) => ({ ...idea, __fav: favIds.has(idea.id), quote: quotes[idea.ticker.toUpperCase()] ?? null }));
}

function atOpenState(l: IntelLevel, quotes: QuoteMap): { label: string; cls: string } {
  const q = quotes[l.instrument.toUpperCase()];
  if (!q || l.level == null) return { label: "—", cls: "" };
  const { price } = q;
  const pct = ((price - l.level) / l.level) * 100;
  if (l.type === "resistance" || l.type === "breakout") {
    if (price > l.level) return { label: "CLEARED", cls: "bl-cleared" };
  }
  if (l.type === "support" || l.type === "breakdown") {
    if (price < l.level) return { label: "BROKEN", cls: "bl-broken" };
  }
  return { label: (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%", cls: pct >= 0 ? "bl-dlt-pos" : "bl-dlt-neg" };
}

function val(v: { value: number | null; text: string }) {
  if (v.value === null && (!v.text || /not specified/i.test(v.text)))
    return <span className="notspec">⌀ n/s</span>;
  return <b>{v.text || (v.value !== null ? String(v.value) : "—")}</b>;
}

// ── micro components ─────────────────────────────────────────────────────────

function DirBadge({ d }: { d: TradeIdea["direction"] }) {
  const cls = d === "bullish" ? "b-bull" : d === "bearish" ? "b-bear" : d === "watch" ? "b-watch" : "b-neutral";
  return <span className={`badge ${cls}`}>{d}</span>;
}

function ExpBadge({ e }: { e: "explicit" | "inferred" }) {
  return (
    <span className={`badge ${e === "explicit" ? "b-explicit" : "b-inferred"}`}>
      {e === "explicit" ? "Direct source" : "Inference"}
    </span>
  );
}

function StatusBadge({ s }: { s: IdeaStatus }) {
  const cls: Record<IdeaStatus, string> = {
    TRIG: "bl-st-trig", ARMED: "bl-st-arm", ACTIVE: "bl-st-active",
    WATCH: "bl-st-watch", INVLD: "bl-st-invld",
  };
  return <span className={`bl-st ${cls[s]}`}>{s}</span>;
}

/** Tracker-driven badge — states come from the lifecycle engine, never derived
 * client-side. Falls back to StatusBadge for untracked rows. */
const TRACKED_BADGE: Record<TrackedStatus, { label: string; cls: string }> = {
  ARMED: { label: "ARMED", cls: "bl-st-arm" },
  TRIGGERED: { label: "TRIG", cls: "bl-st-trig" },
  TARGET_HIT: { label: "TGT ✓", cls: "bl-st-tgt" },
  INVALIDATED: { label: "INVLD", cls: "bl-st-invld" },
  ACTIVE: { label: "ACTIVE", cls: "bl-st-active" },
  CLOSED: { label: "CLOSED", cls: "bl-st-closed" },
};
function TrackedBadge({ t }: { t: TrackedIdea }) {
  const b = TRACKED_BADGE[t.status];
  return (
    <span className={`bl-st ${b.cls}`} title={t.statusHistory.at(-1)?.reason}>
      {b.label}
      {t.conflictKey && <span className="bl-st-conflict" title="conflicting stated triggers from this source">!</span>}
    </span>
  );
}

function MiniSpark({ closes, up }: { closes: number[]; up: boolean }) {
  if (!closes || closes.length < 2) return <span className="bl-spark-empty">—</span>;
  const pts = closes.slice(-20);
  const min = Math.min(...pts), max = Math.max(...pts), W = 52, H = 18;
  const range = max - min || 1;
  const points = pts.map((v, i) =>
    `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`
  ).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="bl-spark">
      <polyline points={points} fill="none" stroke={up ? "#7fb88a" : "#d98b8b"} strokeWidth="1.2" />
    </svg>
  );
}

function InspChart({ closes, entry, up }: { closes: number[]; entry: number | null; up: boolean }) {
  if (!closes || closes.length < 2) return null;
  const W = 240, H = 64;
  const all = entry != null ? [...closes, entry] : closes;
  const min = Math.min(...all), max = Math.max(...all), range = max - min || 1;
  const toY = (v: number) => H - ((v - min) / range) * (H - 4) - 2;
  const pts = closes.map((v, i) =>
    `${((i / (closes.length - 1)) * W).toFixed(1)},${toY(v).toFixed(1)}`
  ).join(" ");
  const lastX = W, lastY = toY(closes[closes.length - 1]);
  const entY = entry != null ? toY(entry) : null;
  return (
    <div className="bl-insp-chart">
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {entY != null && (
          <line x1={0} y1={entY} x2={W} y2={entY} stroke="#cbb274" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.65" />
        )}
        <polyline points={pts} fill="none" stroke={up ? "#7fb88a" : "#d98b8b"} strokeWidth="1.5" />
        <circle cx={lastX} cy={lastY} r={2.5} fill={up ? "#7fb88a" : "#d98b8b"} />
      </svg>
      <div className="bl-insp-chart-labels">
        <span>{fmtPx(min)}</span>
        {entry != null && <span style={{ color: "#cbb274" }}>entry {fmtPx(entry)}</span>}
        <span>{fmtPx(max)}</span>
      </div>
    </div>
  );
}

// ── PageHeader ───────────────────────────────────────────────────────────────

function PageHeader({
  data, clock, tab, onTab, blotter, busy, onSync, onGenerateBrief,
}: {
  data: Overview;
  clock: string;
  tab: Tab;
  onTab: (t: Tab) => void;
  blotter: BlotterIdea[];
  busy: string | null;
  onSync: () => void;
  onGenerateBrief: () => void;
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

  const briefAge = data.lastBriefAt
    ? `${Math.round((Date.now() - data.lastBriefAt) / 60000)}m`
    : null;

  return (
    <div className="bl-head">
      <div className="bl-head-row1">
        <span className="bl-head-title">MARKET INTEL</span>
        <span className="bl-head-live" />
        <span className="bl-head-livebadge">LIVE</span>
        <span className="bl-head-date">{data.clock.nice.toUpperCase()}</span>
        <span className="bl-head-session">
          DESK: {data.clock.sessionLabel.toUpperCase()} · {blotter.length} TRACKED
        </span>
        <div className="bl-head-tabs">
          {tabs.map((t) => (
            <button key={t.key} className={`bl-head-tab${tab === t.key ? " on" : ""}`} onClick={() => onTab(t.key)}>
              <span className="bl-tab-fkey">{t.fkey}</span>{t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="bl-head-row2">
        {counts.TRIG > 0 && (
          <div className="bl-sp bl-sp-trig">
            <span className="bl-sp-dot" />
            {counts.TRIG} TRIGGERED
          </div>
        )}
        {counts.ARMED > 0 && <div className="bl-sp bl-sp-arm">{counts.ARMED} ARMED</div>}
        {counts.ACTIVE > 0 && <div className="bl-sp bl-sp-active">{counts.ACTIVE} ACTIVE</div>}
        {briefAge && (
          <span className="bl-brief-age-pill">{briefAge}</span>
        )}
        <div className="bl-head-row2-right">
          <button className="ibtn ibtn-sm" disabled={busy === "sync"} aria-busy={busy === "sync"} onClick={onSync}>
            {busy === "sync" ? "Syncing…" : "SYNC"}
          </button>
          <button className="ibtn ibtn-sm ibtn-primary" disabled={busy === "brief" || !data.config.ai} aria-busy={busy === "brief"} onClick={onGenerateBrief}>
            {busy === "brief" ? "…" : "BRIEF"}
          </button>
          <button className="ibtn ibtn-sm ibtn-ghost" onClick={() => onTab("BRIEF")}>HISTORY</button>
          <a className="ibtn ibtn-sm ibtn-ghost" href="/api/intel/export/today">EXPORT</a>
          <a className="ibtn ibtn-sm ibtn-ghost" href="/">← AUGUST</a>
        </div>
      </div>
    </div>
  );
}

// ── StatusBar ────────────────────────────────────────────────────────────────

function StatusBar({ data, clock, latencyMs }: { data: Overview; clock: string; latencyMs: number | null }) {
  const { config, lastSync, lastBriefAt } = data;
  // Honest chrome: quotes arrive via 30s HTTP polling (no websocket exists),
  // DATA reflects whether a quote roundtrip has actually succeeded, and
  // LATENCY is the measured last roundtrip — never a placeholder.
  const items = [
    { label: "SESSION", val: data.clock.sessionLabel.toUpperCase(), cls: "" },
    { label: "DATA", val: latencyMs !== null ? "LIVE" : "WAITING", cls: latencyMs !== null ? "bl-sb-ok" : "" },
    { label: "FEED", val: "POLL 30s", cls: latencyMs !== null ? "bl-sb-ok" : "" },
    { label: "LATENCY", val: latencyMs !== null ? `${latencyMs}ms` : "—", cls: latencyMs !== null && latencyMs > 2000 ? "bl-sb-warn" : "" },
    { label: "KEY", val: config.youtube ? "YT_API SET" : "YT_API UNSET", cls: config.youtube ? "bl-sb-ok" : "bl-sb-warn" },
    { label: "LAST SYNC", val: lastSync ? `${Math.round((Date.now() - lastSync) / 60000)}m` : "—", cls: "" },
    { label: "BRIEF", val: lastBriefAt ? `${Math.round((Date.now() - lastBriefAt) / 60000)}m` : "—", cls: "" },
  ];
  return (
    <div className="bl-statusbar">
      {items.map((it) => (
        <div key={it.label} className="bl-sb-item">
          <span className="bl-sb-label">{it.label}</span>
          <span className={`bl-sb-val ${it.cls}`}>{it.val}</span>
        </div>
      ))}
      <div className="bl-sb-item bl-sb-clock">
        <span className="bl-sb-label">ET</span>
        <span className="bl-sb-val">{clock}</span>
      </div>
    </div>
  );
}

// ── LiveTape ─────────────────────────────────────────────────────────────────

type TapeItem =
  | { kind: "macro"; sym: string; price: number; chgPct: number }
  | { kind: "watch"; sym: string; price: number; chgPct: number; status: IdeaStatus };

function LiveTape({ tape }: { tape: TapeItem[] }) {
  const macro = tape.filter((t) => t.kind === "macro") as Extract<TapeItem, { kind: "macro" }>[];
  const watch = tape.filter((t) => t.kind === "watch") as Extract<TapeItem, { kind: "watch" }>[];
  const stCls: Record<IdeaStatus, string> = {
    TRIG: "bl-st-trig", ARMED: "bl-st-arm", ACTIVE: "bl-st-active", WATCH: "bl-st-watch", INVLD: "bl-st-invld",
  };
  return (
    <div className="bl-tape">
      {macro.map((t) => (
        <div key={t.sym} className="bl-tape-item">
          <span className="bl-tape-sym">{t.sym.replace(/^\^/, "")}</span>
          <span className="bl-tape-px">{fmtPx(t.price)}</span>
          <span className={`bl-tape-chg ${t.chgPct >= 0 ? "bl-tape-up" : "bl-tape-dn"}`}>{fmtPct(t.chgPct)}</span>
        </div>
      ))}
      {watch.length > 0 && (
        <>
          <div className="bl-tape-sep">WATCHLIST</div>
          {watch.map((t) => (
            <div key={t.sym} className="bl-tape-item">
              <span className="bl-tape-sym">{t.sym}</span>
              <span className="bl-tape-px">${fmtPx(t.price)}</span>
              <span className={`bl-st ${stCls[t.status]}`} style={{ fontSize: 7.5, padding: "1px 4px" }}>{t.status}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── BlotterRow ───────────────────────────────────────────────────────────────

function BlotterRow({
  idea, tracked, selected, onSelect,
}: {
  idea: BlotterIdea;
  tracked: TrackedIdea | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const up = idea.direction === "bullish";
  const closes = idea.quote?.closes ?? [];
  const ns = <span className="bl-ns">⌀ n/s</span>;

  // Δ-TRIG: distance from live price to the stated trigger. Tracked ideas use
  // the tracker's (possibly restated) trigger; untracked fall back to entry.
  const trigVal = tracked ? tracked.statedLevels.trigger?.value ?? null : idea.entry?.value ?? null;
  const live = idea.quote?.price ?? null;
  const dt = trigVal != null && trigVal > 0 && live != null
    ? `${((live - trigVal) / trigVal) * 100 >= 0 ? "+" : ""}${(((live - trigVal) / trigVal) * 100).toFixed(1)}%`
    : "—";
  const dtCls = dt === "—" ? "" : dt.startsWith("+") ? "bl-dlt-pos" : "bl-dlt-neg";

  // P&L — engine rules: signed % since the STATED trigger only when it fired;
  // thesis-only ideas show price-since-mention (marked with °); ARMED shows none.
  const pnl = tracked ? pnlView(tracked) : { kind: "none" as const, reason: "untracked" };
  const pnlText =
    pnl.kind === "since_called" ? fmtPct(pnl.pct)
    : pnl.kind === "since_first_mention" ? `${fmtPct(pnl.pct)}°`
    : "—";
  const pnlCls = pnl.kind === "none" ? "" : pnl.pct >= 0 ? "bl-dlt-pos" : "bl-dlt-neg";
  const pnlTitle =
    pnl.kind === "since_called" ? `since called — vs stated trigger $${fmtPx(pnl.basis)}`
    : pnl.kind === "since_first_mention" ? `° price since first mention (no stated trigger — not trade P&L)`
    : pnl.kind === "none" ? pnl.reason : undefined;

  const entText = idea.entry?.value != null ? `$${fmtPx(idea.entry.value)}` : ns;
  const invText = idea.invalidation?.value != null ? `$${fmtPx(idea.invalidation.value)}` : ns;
  const tgtText = idea.targets[0]?.value != null ? `$${fmtPx(idea.targets[0].value)}` : ns;
  const liveText = live != null ? `$${fmtPx(live)}` : ns;

  return (
    <tr className={`bl-row${selected ? " selected" : ""}`} onClick={onSelect}>
      <td className="bl-c-status">{tracked ? <TrackedBadge t={tracked} /> : <StatusBadge s={deriveStatus(idea)} />}</td>
      <td className="bl-c-ticker">{idea.ticker}</td>
      <td className="bl-c-dir">
        {idea.direction === "bullish" ? <span className="bl-bull-glyph">▲</span>
          : idea.direction === "bearish" ? <span className="bl-bear-glyph">▼</span>
          : <span className="bl-neut-glyph">—</span>}
      </td>
      <td className="bl-c-tf">{TF_LABEL[idea.timeHorizon] ?? "—"}</td>
      <td className="bl-c-setup" title={idea.thesis}><span className="bl-setup-clip">{idea.thesis}</span></td>
      <td className="bl-c-num">{entText}</td>
      <td className="bl-c-num">{invText}</td>
      <td className="bl-c-num">{tgtText}</td>
      <td className="bl-c-live">{liveText}</td>
      <td className={`bl-c-delta ${dtCls}`}>{dt}</td>
      <td className={`bl-c-delta ${pnlCls}`} title={pnlTitle}>{pnlText}</td>
      <td className="bl-c-tf" title={tracked ? "tracked since first mention" : "not tracked"}>
        {tracked ? ageStr(tracked.createdAt) : "—"}
      </td>
      <td className="bl-c-spark"><MiniSpark closes={closes} up={up} /></td>
      <td className="bl-c-conf">{(idea.confidence * 100).toFixed(0)}%</td>
      <td className="bl-c-evid">
        <span className={`bl-ev ${idea.explicitness === "explicit" ? "bl-ev-direct" : "bl-ev-inferred"}`}>
          {idea.explicitness === "explicit" ? "SRC" : "INF"}
        </span>
      </td>
    </tr>
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

function BlotterTable({
  ideas, trackedByIdeaId, filter, selectedId, onSelect,
}: {
  ideas: BlotterIdea[];
  trackedByIdeaId: Map<string, TrackedIdea>;
  filter: BlotterFilter;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (ideas.length === 0) {
    return (
      <div className="bl-empty">
        <div className="bl-empty-title">BLOTTER EMPTY</div>
        <div>Add sources → process transcripts → generate brief.</div>
      </div>
    );
  }

  const visible = ideas.filter((idea) => {
    const t = trackedByIdeaId.get(idea.id) ?? null;
    if (filter === "ALL") return true;
    if (filter === "TRACKED") return t !== null && t.statedLevels.trigger?.value != null; // level-anchored only
    return effectiveStatus(idea, t) === filter;
  });

  if (visible.length === 0) {
    return (
      <div className="bl-empty">
        <div className="bl-empty-title">NO IDEAS MATCH</div>
        <div>No ideas in the {filter.toLowerCase()} state right now.</div>
      </div>
    );
  }

  const GROUP_ORDER = ["TODAY · TOP IDEAS", "SHORT-TERM · SWING", "LONG-TERM"];
  const groups: Record<string, BlotterIdea[]> = {};
  for (const idea of visible) {
    const g = TF_GROUP[idea.timeHorizon] ?? "LONG-TERM";
    if (!groups[g]) groups[g] = [];
    groups[g].push(idea);
  }

  return (
    <div className="bl-blotter-wrap">
      <table className="bl-table">
        <thead className="bl-thead">
          <tr>
            <th>STATUS</th><th>TICKER</th><th>DIR</th><th>TF</th><th>SETUP</th>
            <th>TRIGGER</th><th>INVALID</th><th>TARGET</th><th>LIVE</th>
            <th>Δ-TRIG</th><th title="signed vs stated trigger; ° = price since first mention">P&amp;L</th><th>AGE</th>
            <th>SPARK</th><th>CONF</th><th>EVID</th>
          </tr>
        </thead>
        <tbody>
          {GROUP_ORDER.map((g) => {
            const rows = groups[g];
            if (!rows?.length) return null;
            return (
              <Fragment key={g}>
                <tr>
                  <td colSpan={15} className="bl-section-head">{g.toLowerCase()}</td>
                </tr>
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
        </tbody>
      </table>
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
 * real transition history, real snapshot ring, MFE/MAE from the engine. */
function LifecyclePanel({ t, variants }: { t: TrackedIdea; variants: TrackedIdea[] }) {
  const pnl = pnlView(t);
  const mm = mfeMaeView(t);
  const snaps = t.priceHistory;
  const fmtT = (ms: number) =>
    new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div className="bl-life">
      <div className="bl-lev-section-head">
        LIFECYCLE · TRACKED {ageStr(t.createdAt)}
        {t.stale && <span className="bl-life-stale">STALE</span>}
      </div>

      {/* state timeline — times + prices, honest reasons on hover */}
      <div className="bl-life-timeline">
        {t.statusHistory.map((h, i) => (
          <div key={i} className="bl-life-step" title={h.reason}>
            <span className={`bl-st ${TRACKED_BADGE[h.state].cls}`} style={{ fontSize: 7 }}>{TRACKED_BADGE[h.state].label}</span>
            <span className="bl-life-when">{fmtT(h.at)}</span>
            {h.price != null && <span className="bl-life-px">${fmtPx(h.price)}</span>}
          </div>
        ))}
      </div>

      {/* P&L + MFE/MAE — labeled by basis, per the law */}
      <div className="bl-life-nums">
        <div className="bl-insp-meta-cell">
          <div className="bl-insp-meta-label">{pnl.kind === "since_first_mention" ? "SINCE 1st MENTION" : "P&L SINCE CALLED"}</div>
          <div className={`bl-insp-meta-val ${pnl.kind !== "none" && pnl.pct >= 0 ? "bl-dlt-pos" : pnl.kind !== "none" ? "bl-dlt-neg" : ""}`}>
            {pnl.kind === "none" ? "—" : fmtPct(pnl.pct)}
          </div>
        </div>
        <div className="bl-insp-meta-cell">
          <div className="bl-insp-meta-label">MFE / MAE</div>
          <div className="bl-insp-meta-val">
            {mm ? <><span className="bl-dlt-pos">{fmtPct(mm.mfePct)}</span> / <span className="bl-dlt-neg">{fmtPct(mm.maePct)}</span></> : "—"}
          </div>
        </div>
      </div>
      {pnl.kind === "since_first_mention" && (
        <div className="bl-life-note">° no stated trigger — price move since first mention, not trade P&amp;L</div>
      )}

      {/* snapshot sparkline from the recorded ring buffer */}
      {snaps.length >= 2 && (
        <div className="bl-life-spark">
          <MiniSparkWide snaps={snaps} basis={t.basisPrice} up={t.direction !== "bearish"} />
          <div className="bl-life-sparklabel">{snaps.length} snapshots · cap {128}</div>
        </div>
      )}

      {/* conflict variants — both stated triggers stay visible, never merged */}
      {variants.length > 0 && (
        <div className="bl-life-variants">
          <div className="bl-insp-meta-label" style={{ marginBottom: 3 }}>⚠ CONFLICTING STATED TRIGGERS (SAME SOURCE)</div>
          {variants.map((v) => (
            <div key={v.id} className="bl-life-variant">
              <span className={`bl-st ${TRACKED_BADGE[v.status].cls}`} style={{ fontSize: 7 }}>{TRACKED_BADGE[v.status].label}</span>
              <span>trigger {v.statedLevels.trigger?.value != null ? `$${fmtPx(v.statedLevels.trigger.value)}` : v.statedLevels.trigger?.text ?? "⌀"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** wider sparkline over the tracker's own snapshots (not Yahoo closes) */
function MiniSparkWide({ snaps, basis, up }: { snaps: { at: number; price: number }[]; basis: number | null; up: boolean }) {
  const W = 240, H = 40;
  const px = snaps.map((s) => s.price);
  const all = basis != null ? [...px, basis] : px;
  const min = Math.min(...all), max = Math.max(...all), range = max - min || 1;
  const toY = (v: number) => H - ((v - min) / range) * (H - 4) - 2;
  const pts = px.map((v, i) => `${((i / (px.length - 1)) * W).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {basis != null && (
        <line x1={0} y1={toY(basis)} x2={W} y2={toY(basis)} stroke="#cbb274" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.65" />
      )}
      <polyline points={pts} fill="none" stroke={up ? "#7fb88a" : "#d98b8b"} strokeWidth="1.3" />
    </svg>
  );
}

function Inspector({ idea, tracked, variants }: { idea: BlotterIdea | null; tracked: TrackedIdea | null; variants: TrackedIdea[] }) {
  if (!idea) {
    return (
      <div className="bl-insp-empty">
        <div>SELECT A ROW</div>
        <div style={{ fontSize: 9.5 }}>to inspect the trade setup</div>
      </div>
    );
  }

  const status = deriveStatus(idea);
  const up = idea.direction === "bullish";
  const entVal = idea.entry?.value ?? null;
  const invVal = idea.invalidation?.value ?? null;
  const tgt = idea.targets[0];
  const conf = (idea.confidence * 100).toFixed(0);

  const hasEntry = entVal != null && entVal > 0;
  const priceActionNote = !hasEntry
    ? "← NO PRICE TRIGGER · THESIS-DRIVEN — read catalyst + invalidation"
    : status === "TRIG" ? `← TRIGGERED at $${fmtPx(entVal!)}`
    : status === "ARMED" ? `← APPROACHING ENTRY $${fmtPx(entVal!)} (${deltaTrig(idea)})`
    : `← ENTRY $${fmtPx(entVal!)} · ${deltaTrig(idea)} from trigger`;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div className="bl-insp-ticker">{idea.ticker}</div>
        {tracked ? <TrackedBadge t={tracked} /> : <StatusBadge s={status} />}
        {idea.__fav && <span className="badge b-fav" style={{ fontSize: 8 }}>FAV</span>}
      </div>
      {idea.assetName && (
        <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: 10, color: "var(--ash)", opacity: 0.6, marginBottom: 6 }}>
          {idea.assetName}
        </div>
      )}

      {/* Live price block */}
      {idea.quote && (
        <div className="bl-insp-price-block">
          <div className="bl-insp-price-live">LIVE · REAL-TIME</div>
          <span className="bl-insp-price">${fmtPx(idea.quote.price)}</span>
          <span className={`bl-insp-price-chg ${idea.quote.chgPct >= 0 ? "bl-dlt-pos" : "bl-dlt-neg"}`}>
            {fmtPct(idea.quote.chgPct)}
          </span>
        </div>
      )}

      {/* Meta grid: DIR / TF / CONF / RANK */}
      <div className="bl-insp-meta-grid">
        <div className="bl-insp-meta-cell">
          <div className="bl-insp-meta-label">DIR</div>
          <div className={`bl-insp-meta-val ${up ? "bl-dlt-pos" : idea.direction === "bearish" ? "bl-dlt-neg" : ""}`}>
            {up ? "BULL" : idea.direction === "bearish" ? "BEAR" : "NEUT"}
          </div>
        </div>
        <div className="bl-insp-meta-cell">
          <div className="bl-insp-meta-label">TIMEFRAME</div>
          <div className="bl-insp-meta-val">{TF_FULL[idea.timeHorizon] ?? idea.timeHorizon}</div>
        </div>
        <div className="bl-insp-meta-cell">
          <div className="bl-insp-meta-label">CONF</div>
          <div className="bl-insp-meta-val">{conf}%</div>
        </div>
        <div className="bl-insp-meta-cell">
          <div className="bl-insp-meta-label">RANK</div>
          <div className="bl-insp-meta-val">{idea.rankScore.toFixed(2)}</div>
        </div>
      </div>

      {/* Direction + evidence badges */}
      <div className="bl-insp-badges">
        <DirBadge d={idea.direction} />
        <ExpBadge e={idea.explicitness} />
        {idea.creatorDesignation.isPrediction && <span className="badge b-pred">Prediction</span>}
      </div>

      {/* Thesis */}
      <p className="bl-insp-thesis">{idea.thesis}</p>

      {/* Sparkline chart */}
      {idea.quote && (
        <InspChart closes={idea.quote.closes} entry={entVal} up={up} />
      )}

      {/* Price action note */}
      <div className="bl-pa-section">
        <div className="bl-pa-label">PRICE ACTION</div>
        <div className="bl-pa-note">{priceActionNote}</div>
      </div>

      {/* Tracker lifecycle — real transition history + excursions */}
      {tracked && (
        <>
          <hr className="bl-insp-sep" />
          <LifecyclePanel t={tracked} variants={variants} />
        </>
      )}

      <hr className="bl-insp-sep" />

      {/* Levels */}
      <div className="bl-lev-section">
        <div className="bl-lev-section-head">LEVELS · EACH TAGGED BY EVIDENCE</div>
        <div className="bl-lev-grid2">
          <div className="bl-lev-cell">
            <div className="bl-lev-cell-label">ENTRY</div>
            <div className="bl-lev-cell-val">
              {entVal != null ? <b>${fmtPx(entVal)}</b> : <span className="bl-lev-cell-ns">⌀ Not stated by source</span>}
            </div>
          </div>
          <div className="bl-lev-cell">
            <div className="bl-lev-cell-label">TRIGGER</div>
            <div className="bl-lev-cell-val">
              {idea.entry?.text && !/not specified/i.test(idea.entry.text)
                ? <b>{idea.entry.text}</b>
                : <span className="bl-lev-cell-ns">⌀ Not stated by source</span>}
            </div>
          </div>
          <div className="bl-lev-cell">
            <div className="bl-lev-cell-label">
              INVALIDATION
              {invVal != null && <span className="bl-ev bl-ev-direct" style={{ marginLeft: 5 }}>DIRECT</span>}
            </div>
            <div className="bl-lev-cell-val">
              {invVal != null
                ? <b>${fmtPx(invVal)}</b>
                : idea.invalidation?.text && !/not specified/i.test(idea.invalidation.text)
                ? <span style={{ color: "var(--bone)", fontSize: 11 }}>{idea.invalidation.text}</span>
                : <span className="bl-lev-cell-ns">⌀ Not stated by source</span>}
            </div>
          </div>
          <div className="bl-lev-cell">
            <div className="bl-lev-cell-label">TARGET</div>
            <div className="bl-lev-cell-val">
              {tgt?.value != null
                ? <b>${fmtPx(tgt.value)}</b>
                : tgt?.text && !/not specified/i.test(tgt.text)
                ? <span style={{ color: "var(--bone)", fontSize: 11 }}>{tgt.text}</span>
                : <span className="bl-lev-cell-ns">⌀ Not stated by source</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Catalyst */}
      {idea.catalysts.length > 0 && (
        <>
          <hr className="bl-insp-sep" />
          <div className="bl-lev-cell-label" style={{ marginBottom: 4 }}>
            CATALYST
            <span className={`bl-ev ${idea.explicitness === "explicit" ? "bl-ev-direct" : "bl-ev-inferred"}`} style={{ marginLeft: 6 }}>
              {idea.explicitness === "explicit" ? "DIRECT" : "INFERRED"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--bone)", lineHeight: 1.4 }}>{idea.catalysts[0]}</div>
        </>
      )}

      {/* Confidence bar */}
      <div className="bl-conf-row">
        <span className="bl-conf-pct">CONF</span>
        <div className="bl-conf-bar-wrap">
          <div className="bl-conf-bar-fill" style={{ width: `${conf}%` }} />
        </div>
        <span className="bl-conf-pct">{conf}%</span>
      </div>

      {/* Cite */}
      {idea.videoId && (
        <div className="bl-insp-cite2">
          · {idea.channelTitle} @ {mmss(idea.sourceStartSeconds)}
          {idea.rankScore !== undefined ? ` · rank ${idea.rankScore.toFixed(2)}` : ""}
        </div>
      )}
      {idea.videoId && (
        <a className="bl-insp-cite" href={watchUrl(idea.videoId, idea.sourceStartSeconds)} target="_blank" rel="noreferrer">
          ▸ open source
        </a>
      )}
    </div>
  );
}

// ── LeftPanel ────────────────────────────────────────────────────────────────

function LeftPanel({
  brief, quotes, onReload,
  onSync, onGenerateBrief, busy, lastBriefAt, aiOn,
  sourceCount, videoCount, onGoSources,
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
}) {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <div className="bl-left">
      <div className="bl-lp-actions">
        <button className="ibtn ibtn-primary bl-lp-btn" disabled={!!busy} aria-busy={busy === "sync"} onClick={onSync}>
          {busy === "sync" ? "Syncing…" : "SYNC"}
        </button>
        <button className="ibtn ibtn-primary bl-lp-btn" disabled={!!busy || !aiOn} aria-busy={busy === "brief"} onClick={onGenerateBrief}>
          {busy === "brief" ? "Generating…" : "BRIEF"}
        </button>
      </div>
      {lastBriefAt > 0 && (
        <div className="bl-lp-age">brief {ago(lastBriefAt)}{!aiOn ? " · needs ANTHROPIC_API_KEY" : ""}</div>
      )}
      {brief && (
        <>
          <div className="bl-ph">Tonight&apos;s Brief</div>
          {brief.posture && <p className="bl-brief-posture">{brief.posture}</p>}
          <dl style={{ margin: 0 }}>
            {brief.watchAtOpen && (
              <div className="bl-brief-field"><dt>At open</dt><dd>{brief.watchAtOpen}</dd></div>
            )}
            {brief.whatMattersTomorrow && (
              <div className="bl-brief-field"><dt>Tomorrow</dt><dd>{brief.whatMattersTomorrow}</dd></div>
            )}
            {brief.invalidation && (
              <div className="bl-brief-field"><dt>Invalidation</dt><dd>{brief.invalidation}</dd></div>
            )}
          </dl>
          {(brief.bullCase || brief.bearCase) && (
            <div className="bl-bullbear" style={{ marginTop: 8 }}>
              <div className="bl-bull"><div className="bl-bull-h">BULL</div><p>{brief.bullCase || "—"}</p></div>
              <div className="bl-bear"><div className="bl-bear-h">BEAR</div><p>{brief.bearCase || "—"}</p></div>
            </div>
          )}
        </>
      )}

      {/* AT THE OPEN */}
      {brief && brief.levels.length > 0 && (
        <>
          <div className="bl-ph">AT THE OPEN</div>
          {brief.levels.slice(0, 10).map((l) => {
            const { label, cls } = atOpenState(l, quotes);
            return (
              <div key={l.id} className="bl-atopen-row">
                <span className="bl-atopen-inst">{l.instrument}</span>
                <span style={{ fontSize: 10, color: "var(--ash)", opacity: 0.7 }}>
                  {l.type === "resistance" ? "clears" : l.type === "support" ? "holds" : l.type}
                  {l.level != null && <b style={{ marginLeft: 4, color: "var(--bone)", fontFamily: "var(--font-mono), monospace" }}>${l.level}</b>}
                </span>
                <span className={cls || "bl-ns"}>{label}</span>
              </div>
            );
          })}
        </>
      )}

      {/* CAPTURE — one lightweight add action; management lives in SOURCES (F3) */}
      <div className="bl-ph">Capture</div>
      <button className="ibtn ibtn-sm bl-lp-addbtn" onClick={() => setAddOpen((o) => !o)}>
        {addOpen ? "− CLOSE" : "+ ADD SOURCE"}
      </button>
      {addOpen && (
        <div style={{ marginTop: 8 }}>
          <AddSource onReload={onReload} compact />
          <div className="bl-lp-hint" style={{ display: "block", marginTop: 6 }}>
            processing continues in SOURCES
          </div>
        </div>
      )}
      <button className="bl-lp-srcline" onClick={onGoSources}>
        {sourceCount} SOURCE{sourceCount !== 1 ? "S" : ""} · {videoCount} VIDEO{videoCount !== 1 ? "S" : ""} → F3 SOURCES
      </button>
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

  const ask = async () => {
    if (q.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await fetch("/api/intel/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      setRes(await r.json());
    } finally { setBusy(false); }
  };

  return (
    <div className="bl-askbar">
      {res && (
        <div className="bl-askbar-ans">
          <div style={{ marginBottom: 8 }}>{res.answer}</div>
          {res.citations.map((c, i) => (
            <a key={i} className="idea-cite" style={{ display: "block" }} href={watchUrl(c.videoId, c.startSeconds)} target="_blank" rel="noreferrer">
              ▸ {c.channelTitle || c.videoTitle} @ {mmss(c.startSeconds)} — {c.note}
            </a>
          ))}
          <button className="ibtn ibtn-sm ibtn-ghost" style={{ marginTop: 8 }} onClick={() => setRes(null)}>Dismiss</button>
        </div>
      )}
      <input
        className="bl-askbar-input"
        placeholder={ai ? "> what did the source say about QQQ, and which ideas have no stated invalidation?" : "> ask AUGUST (needs ANTHROPIC_API_KEY)"}
        value={q}
        disabled={!ai}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
      />
      <button className="ibtn ibtn-primary" disabled={busy || !ai || q.trim().length < 3} onClick={ask}>
        {busy ? "…" : "ASK"}
      </button>
    </div>
  );
}

// ── preserved sub-components ─────────────────────────────────────────────────

function IdeaCard({ idea, favorite, onOpenVideo }: { idea: BriefIdea | TradeIdea; favorite?: boolean; onOpenVideo?: (id: string) => void }) {
  const b = idea as BriefIdea;
  return (
    <div className="idea">
      <div className="idea-top">
        <span className="idea-tkr">{idea.ticker}</span>
        {idea.assetName && <span className="idea-name">{idea.assetName}</span>}
        <DirBadge d={idea.direction} />
        <span className="badge b-neutral">{idea.timeHorizon.replace("_", " ")}</span>
        <ExpBadge e={idea.explicitness} />
        {favorite && <span className="badge b-fav">Creator favorite</span>}
        {idea.creatorDesignation.isPrediction && <span className="badge b-pred">Prediction</span>}
        {idea.enriched?.triggered && <span className="badge b-triggered">Triggered</span>}
        {idea.enriched?.invalidated && <span className="badge b-invalid">Invalidated</span>}
      </div>
      <div className="idea-thesis">{idea.thesis}</div>
      <div className="idea-grid">
        <div className="idea-f"><span>Entry</span>{val(idea.entry)}</div>
        <div className="idea-f"><span>Invalidation</span>{val(idea.invalidation)}</div>
        <div className="idea-f"><span>Target</span>{idea.targets[0] ? val(idea.targets[0]) : <span className="notspec">⌀ n/s</span>}</div>
        <div className="idea-f"><span>Catalyst</span><b>{idea.catalysts[0] ?? "—"}</b></div>
        {idea.enriched?.price != null && <div className="idea-f"><span>Live price</span><b>${idea.enriched.price.toFixed(2)}</b></div>}
        <div className="idea-f"><span>Confidence</span><b>{(idea.confidence * 100).toFixed(0)}%</b></div>
      </div>
      {idea.videoId && (
        <a className="idea-cite" href={watchUrl(idea.videoId, idea.sourceStartSeconds)} target="_blank" rel="noreferrer">
          ▸ {b.channelTitle ?? "source"} @ {mmss(idea.sourceStartSeconds)}
          {b.rankScore !== undefined ? ` · rank ${b.rankScore}` : ""}
        </a>
      )}
    </div>
  );
}

function LevelRow({ l }: { l: IntelLevel }) {
  return (
    <div className="lvl-row">
      <span className="intel-mono" style={{ color: "var(--bone)" }}>{l.instrument}</span>
      <span className="badge b-neutral">{l.type}</span>
      <span style={{ color: "var(--ash)", fontSize: 11 }}>
        {l.level !== null ? l.level : <span className="notspec">{l.levelText || "⌀ n/s"}</span>}
        {l.crossed ? <span className="badge b-triggered">crossed</span> : null}
      </span>
      {l.videoId
        ? <a className="idea-cite" href={watchUrl(l.videoId, l.sourceStartSeconds)} target="_blank" rel="noreferrer">@{mmss(l.sourceStartSeconds)}</a>
        : <span className="idea-cite">@{mmss(l.sourceStartSeconds)}</span>}
    </div>
  );
}

function CatalystRow({ c }: { c: IntelCatalyst }) {
  return (
    <div className="cat-row">
      <b style={{ color: "var(--bone)" }}>{c.name}</b>{" "}
      <span className={`badge ${c.importance === "high" ? "b-bear" : c.importance === "medium" ? "b-watch" : "b-neutral"}`}>{c.importance}</span>{" "}
      <span className={`badge ${c.externallyVerified ? "b-verified" : "b-inferred"}`}>{c.externallyVerified ? "Verified" : "Creator claim"}</span>
      {c.eventTime && <span className="intel-mono" style={{ color: "var(--ash)", fontSize: 10, marginLeft: 6 }}>{c.eventTime}</span>}
      {c.affectedTickers.length > 0 && <span style={{ color: "var(--steel)", fontSize: 11 }}> · {c.affectedTickers.join(" ")}</span>}
    </div>
  );
}

function DrawerOptionRow({ o }: { o: OptionIdea }) {
  const origin =
    o.origin === "creator_explicit" ? <span className="badge b-explicit">Creator play</span>
    : o.origin === "august_candidate" ? <span className="badge b-inferred">AUGUST candidate</span>
    : <span className="badge b-watch">Directional only</span>;
  const contract = o.legs.length
    ? o.legs.map((l) => `${l.action} ${l.strike ?? "?"}${l.optionType === "call" ? "C" : "P"}${l.expiration ? ` ${l.expiration}` : ""}`).join(" / ")
    : "no contract specified";
  return (
    <div className="optidea">
      <div className="optidea-top">
        <span className="idea-tkr">{o.underlyingSymbol}</span>
        <span className={`badge ${o.direction === "bullish" ? "b-bull" : o.direction === "bearish" ? "b-bear" : "b-neutral"}`}>{o.direction}</span>
        <span className="badge b-neutral">{o.strategyType.replace(/_/g, " ")}</span>
        {origin}
      </div>
      <div className="optidea-contract">{contract}</div>
      <div className="idea-grid">
        <div className="idea-f"><span>Expiration</span>{o.expirationText?.resolved ? <b>{o.expirationText.resolved}</b> : o.expirationText?.text ? <span className="notspec">{o.expirationText.text}</span> : <span className="notspec">⌀ n/s</span>}</div>
        <div className="idea-f"><span>Creator premium</span>{o.quotedPremium !== null ? <b>${o.quotedPremium}</b> : <span className="notspec">⌀ n/s</span>}</div>
        <div className="idea-f"><span>Breakeven</span>{o.breakevens.length ? <b>{o.breakevens.join(", ")}</b> : <span className="notspec">Not computable</span>}</div>
      </div>
      {o.videoId && <a className="idea-cite" href={watchUrl(o.videoId, o.sourceStartSeconds)} target="_blank" rel="noreferrer">▸ source @ {mmss(o.sourceStartSeconds)}</a>}
    </div>
  );
}

function ConsensusRow({ c }: { c: ConsensusItem }) {
  const cls = c.agreement === "conflict" ? "b-conflict" : c.agreement === "agree" ? "b-triggered" : "b-neutral";
  return (
    <div className="consensus-row">
      <span className="intel-mono" style={{ color: "var(--bone)" }}>{c.ticker}</span>
      <span style={{ fontSize: 11, color: "var(--ash)" }}>{c.sources.map((s) => s.channelTitle).join(" · ")}</span>
      <span className={`badge ${cls}`}>{c.agreement}</span>
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
          className="iinput iadd-ta"
          style={{ fontSize: 10.5, minHeight: 48 }}
          placeholder={"Paste URL · @handle · video\n(newline or comma-separated)"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); }}
        />
        <div style={{ marginTop: 5, display: "flex", gap: 6, alignItems: "center" }}>
          <button className="ibtn ibtn-sm ibtn-primary" disabled={busy || !text.trim()} onClick={submit}>
            {busy ? "Adding…" : "Add"}
          </button>
          <span className="inote" style={{ fontSize: 9 }}>Ctrl+Enter</span>
        </div>
        {results.length > 0 && (
          <div className="iadd-results">
            {results.map((r, i) => (
              <div key={i} className={`iadd-result ${r.status === "ok" ? "iadd-ok" : r.status === "exists" ? "iadd-exist" : "iadd-err"}`} style={{ fontSize: 9.5 }}>
                {r.status === "ok" ? "✓" : r.status === "exists" ? "=" : "✗"} {r.label}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="icard">
      <div className="icard-h">Add sources</div>
      <textarea
        className="iinput iadd-ta"
        placeholder={"Paste one or more URLs (newline- or comma-separated):\nchannel URL · @handle · video URL"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); }}
      />
      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <button className="ibtn ibtn-primary" disabled={busy || !text.trim()} onClick={submit}>
          {busy ? "Adding…" : "Add"}
        </button>
        <span className="inote">Ctrl+Enter to submit</span>
      </div>
      {results.length > 0 && (
        <div className="iadd-results">
          {results.map((r, i) => (
            <div key={i} className={`iadd-result ${r.status === "ok" ? "iadd-ok" : r.status === "exists" ? "iadd-exist" : "iadd-err"}`}>
              {r.status === "ok" ? "✓" : r.status === "exists" ? "=" : "✗"} {r.label}
            </div>
          ))}
        </div>
      )}
      <div className="inote">Seeds: paste a Stock Market Live or StockedUp video URL to start, or a channel to monitor.</div>
    </div>
  );
}

function SourceMonitor({ sources, onRemove }: { sources: IntelSource[]; onRemove: (id: string) => void }) {
  return (
    <div className="icard">
      <div className="icard-h">Source Monitor · {sources.length}</div>
      {sources.length === 0 ? <div className="istate">No sources yet.</div> : sources.map((s) => (
        <div key={s.id} className="irow">
          {s.thumbnail ? <img className="irow-thumb" src={s.thumbnail} alt="" /> : <span className="irow-thumb" />}
          <div className="irow-main">
            <div className="irow-title">{s.title}</div>
            <div className="irow-meta">
              <span>{s.type}</span>
              <span className={`badge ${s.status === "active" ? "b-verified" : "b-stale"}`}>{s.status}</span>
              <span>checked {ago(s.lastChecked)}</span>
              {s.error && <span className="iwarn">{s.error}</span>}
            </div>
          </div>
          <div className="irow-actions">
            <a className="ibtn ibtn-sm ibtn-ghost" href={s.url} target="_blank" rel="noreferrer">View</a>
            <button className="ibtn ibtn-sm ibtn-ghost" onClick={() => onRemove(s.id)}>Remove</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function statusBadge(v: IntelVideo) {
  if (v.liveState === "live") return <span className="badge b-live">Live</span>;
  if (v.status === "analyzing") return <span className="badge b-proc">Processing</span>;
  if (v.status === "preliminary") return <span className="badge b-proc">Preliminary</span>;
  if (v.status === "analyzed") return <span className="badge b-verified">Analyzed</span>;
  if (v.transcriptStatus === "pending" || v.transcriptStatus === "unavailable")
    return <span className="badge b-pending">Transcript {v.transcriptStatus}</span>;
  return <span className="badge b-pending">{v.status}</span>;
}

function VideoLibrary({ videos, onOpen }: { videos: IntelVideo[]; onOpen: (id: string) => void }) {
  return (
    <div className="icard">
      <div className="icard-h">Video Library · {videos.length}</div>
      {videos.length === 0 ? <div className="istate">No videos yet — add a video source above.</div> : videos.slice(0, 20).map((v) => (
        <div key={v.videoId} className="irow clickable" onClick={() => onOpen(v.videoId)}>
          {v.thumbnail ? <img className="irow-thumb" src={v.thumbnail} alt="" /> : <span className="irow-thumb" />}
          <div className="irow-main">
            <div className="irow-title">{v.title}</div>
            <div className="irow-meta">
              <span>{v.channelTitle ?? ""}</span>
              {statusBadge(v)}
              {v.stale && <span className="badge b-stale">Stale</span>}
              {typeof v.ideaCount === "number" && <span>{v.ideaCount} ideas{v.optionCount ? ` · ${v.optionCount} options` : ""} · {v.levelCount ?? 0} levels</span>}
            </div>
          </div>
          <div className="irow-actions"><span className="ibtn ibtn-sm ibtn-ghost">Open</span></div>
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
  const [selectedChapterSec, setSelectedChapterSec] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/intel/videos/${encodeURIComponent(videoId)}`, { cache: "no-store" });
    if (r.ok) setBundle(await r.json());
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
      <div className="idrawer-scrim" onClick={onClose} />
      <div className="idrawer">
        <button className="idrawer-x" onClick={onClose} aria-label="Close">✕</button>
        {!bundle ? <div className="iskel" /> : (
          <>
            <div className="intel-mono" style={{ fontSize: 10, color: "var(--ash)" }}>VIDEO</div>
            <h3 style={{ margin: "4px 0 6px", fontSize: 16 }}>{v?.title}</h3>
            <div className="irow-meta" style={{ marginBottom: 12 }}>
              <span>{v?.channelTitle}</span>
              {v && statusBadge(v)}
              {v?.stale && <span className="badge b-stale">Stale</span>}
              <a className="idea-cite" href={watchUrl(videoId)} target="_blank" rel="noreferrer">▸ open on YouTube</a>
            </div>
            {v?.status !== "analyzed" && (
              <div className="icard bl-txcard" style={{ marginTop: 12 }}>
                <div className="bl-txcard-step">
                  {a?.pass === "preliminary" ? "STEP 1 CONT. · PASTE FULL TRANSCRIPT" : "STEP 1 · PASTE TRANSCRIPT"}
                </div>
                {a?.pass === "preliminary" && (
                  <div className="inote" style={{ marginBottom: 10, fontSize: 10.5 }}>
                    Preliminary pass done — paste the full transcript for the complete analysis.
                  </div>
                )}
                <div className="bl-txcard-how">
                  YouTube → ··· (below video) → Show transcript → copy all → paste here
                </div>
                <textarea
                  className="iinput bl-txcard-ta"
                  aria-label="Paste video transcript"
                  placeholder={"Paste transcript here. Timestamps included when present.\n\n(YouTube → below video → ··· → Show transcript → copy)"}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
                <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="ibtn ibtn-primary bl-txcard-btn" disabled={busy || !aiOn || transcript.trim().length < 40} onClick={process}>
                    {busy ? "Analyzing…" : "Analyze →"}
                  </button>
                  {!aiOn && <span className="inote iwarn">Needs ANTHROPIC_API_KEY.</span>}
                  {err && <span className="inote istate-err">{err}</span>}
                </div>
              </div>
            )}
            {a?.warnings?.length ? <div className="inote iwarn" style={{ marginBottom: 8 }}>{a.warnings.join(" · ")}</div> : null}
            {chapters.length > 0 && (
              <div className="icard">
                <div className="icard-h">Chapters {selectedChapter && <button className="ibtn ibtn-sm ibtn-ghost" onClick={() => setSelectedChapterSec(null)}>Clear filter</button>}</div>
                {chapters.map((ch) => (
                  <div key={ch.startSeconds} className={`chap${selectedChapterSec === ch.startSeconds ? " active" : ""}`} role="button" tabIndex={0}
                    onClick={() => setSelectedChapterSec(selectedChapterSec === ch.startSeconds ? null : ch.startSeconds)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedChapterSec(selectedChapterSec === ch.startSeconds ? null : ch.startSeconds); }}>
                    <a className="chap-t" href={watchUrl(videoId, ch.startSeconds)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{mmss(ch.startSeconds)}</a>
                    <span className={ch.priority === "high" ? "chap-hi" : ""}>{ch.title}</span>
                    {!ch.creatorDefined && <span className="badge b-inferred" style={{ fontSize: 8.5 }}>AUGUST</span>}
                    <span className="chap-cat">{CAT_LABEL[ch.normalizedCategory] ?? ch.normalizedCategory}</span>
                  </div>
                ))}
              </div>
            )}
            {a && (
              <>
                {a.overallSummary && <div className="icard"><div className="icard-h">Summary {a.pass === "preliminary" && <span className="badge b-proc">Preliminary</span>}</div><p style={{ fontSize: 13, lineHeight: 1.55 }}>{a.overallSummary}</p></div>}
                {selectedChapter && <div className="chap-filter-bar"><span>Filtering:</span><b style={{ color: "var(--bone)" }}>{selectedChapter.title}</b><button className="ibtn ibtn-sm ibtn-ghost" onClick={() => setSelectedChapterSec(null)}>Clear</button></div>}
                {visibleIdeas.length > 0 && <div className="icard"><div className="icard-h">Trade Ideas · {visibleIdeas.length}{selectedChapter ? " (in chapter)" : ""}</div>{visibleIdeas.map((i) => <IdeaCard key={i.id} idea={i} favorite={i.creatorDesignation.isFavoriteSetup} />)}</div>}
                {visibleOptions.length > 0 && <div className="icard"><div className="icard-h">Option Ideas · {visibleOptions.length}{selectedChapter ? " (in chapter)" : ""}</div>{visibleOptions.map((o) => <DrawerOptionRow key={o.id} o={o} />)}</div>}
                {visibleLevels.length > 0 && <div className="icard"><div className="icard-h">Levels · {visibleLevels.length}{selectedChapter ? " (in chapter)" : ""}</div>{visibleLevels.map((l) => <LevelRow key={l.id} l={l} />)}</div>}
                {a.catalysts.length > 0 && <div className="icard"><div className="icard-h">Catalysts</div>{a.catalysts.map((c, i) => <CatalystRow key={i} c={c} />)}</div>}
                <button className="ibtn ibtn-sm ibtn-ghost" onClick={async () => { setBusy(true); await fetch(`/api/intel/videos/${encodeURIComponent(videoId)}/reprocess`, { method: "POST" }); await load(); onProcessed(); setBusy(false); }}>Reprocess</button>
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
      <div className="icard">
        <div className="icard-h">{historical ? "No brief for this date" : "Tonight's Brief"}</div>
        <div className="istate">{historical ? "No brief was stored for this date." : <>No brief generated yet. Add a source, process a transcript, then press <b>Generate Brief</b>{!ai ? " (needs ANTHROPIC_API_KEY)" : ""}.</>}</div>
      </div>
    );
  }
  return (
    <>
      <div className="icard">
        <div className="icard-h">
          {historical ? `Brief · ${brief.date}` : `Tonight's Brief · ${brief.date}`}
          <button className="ibtn ibtn-sm ibtn-ghost" onClick={() => setRead60((r) => !r)}>{read60 ? "Full" : "Read in 60s"}</button>
        </div>
        {brief.read60 && read60 && <p className="brief-read60">{brief.read60}</p>}
        {!brief.grounded && <div className="inote iwarn">AI narrative offline — structured intel only.</div>}
        {!read60 && <dl style={{ margin: 0 }}>
          {brief.posture && <div className="brief-row"><dt>Posture</dt><dd>{brief.posture}</dd></div>}
          {brief.whatChanged && <div className="brief-row"><dt>What changed</dt><dd>{brief.whatChanged}</dd></div>}
          {brief.whatMattersTomorrow && <div className="brief-row"><dt>Tomorrow</dt><dd>{brief.whatMattersTomorrow}</dd></div>}
          {brief.watchAtOpen && <div className="brief-row"><dt>At the open</dt><dd>{brief.watchAtOpen}</dd></div>}
          {brief.invalidation && <div className="brief-row"><dt>Invalidation</dt><dd>{brief.invalidation}</dd></div>}
        </dl>}
        {!read60 && (brief.bullCase || brief.bearCase) && (
          <div className="bullbear">
            <div className="bull"><h4>BULL CASE</h4><div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{brief.bullCase || "—"}</div></div>
            <div className="bear"><h4>BEAR CASE</h4><div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{brief.bearCase || "—"}</div></div>
          </div>
        )}
      </div>
      {brief.creatorFavorites.length > 0 && <div className="icard"><div className="icard-h">Creator Favorites</div>{brief.creatorFavorites.map((i) => <IdeaCard key={i.id} idea={i} favorite onOpenVideo={onOpenVideo} />)}</div>}
      <div className="icard"><div className="icard-h">Top Trade Ideas</div>{brief.topIdeas.length === 0 ? <div className="istate">No ideas extracted yet.</div> : brief.topIdeas.map((i) => <IdeaCard key={i.id} idea={i} onOpenVideo={onOpenVideo} />)}</div>
      {brief.levels.length > 0 && <div className="icard"><div className="icard-h">Levels &amp; Triggers</div>{brief.levels.slice(0, 24).map((l) => <LevelRow key={l.id} l={l} />)}</div>}
      {brief.catalysts.length > 0 && <div className="icard"><div className="icard-h">Catalyst Map</div>{brief.catalysts.slice(0, 20).map((c, i) => <CatalystRow key={i} c={c} />)}</div>}
      {brief.consensus.length > 0 && <div className="icard"><div className="icard-h">Consensus &amp; Conflicts</div>{brief.consensus.slice(0, 20).map((c) => <ConsensusRow key={c.ticker} c={c} />)}</div>}
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
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [tape, setTape] = useState<TapeItem[]>([]);
  const [clock, setClock] = useState(etClock());
  // Honest latency: the last successful /api/intel/quotes roundtrip, measured
  // client-side. null until the first fetch completes.
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  // Idea Tracker: server-evaluated lifecycle records (page-load pass is
  // server-throttled, so polling this is cheap).
  const [trackedList, setTrackedList] = useState<TrackedIdea[]>([]);
  const [blotterFilter, setBlotterFilter] = useState<BlotterFilter>("ALL");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/intel/overview", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setData(await r.json());
      setStatus("ready");
    } catch {
      setStatus((s) => (s === "ready" ? "ready" : "error"));
    }
  }, []);

  const fetchMacroTape = useCallback(async () => {
    try {
      const t0 = performance.now();
      const r = await fetch(`/api/intel/quotes?symbols=${TAPE_MACRO.join(",")}`, { cache: "no-store" });
      const j = await r.json();
      setLatencyMs(Math.round(performance.now() - t0));
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

  const fetchBlotterQuotes = useCallback(async (brief: DailyBrief) => {
    const ideas = [...(brief.creatorFavorites ?? []), ...(brief.topIdeas ?? [])];
    const syms = [...new Set(ideas.map((i) => i.ticker.toUpperCase()))].slice(0, 20);
    if (!syms.length) return;
    try {
      const t0 = performance.now();
      const r = await fetch(`/api/intel/quotes?symbols=${syms.join(",")}`, { cache: "no-store" });
      const j = await r.json();
      setLatencyMs(Math.round(performance.now() - t0));
      setQuotes(j.quotes ?? {});
    } catch { /* keep */ }
  }, []);

  const fetchTracker = useCallback(async () => {
    try {
      const r = await fetch("/api/intel/tracker", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j.tracked)) setTrackedList(j.tracked);
    } catch { /* keep existing */ }
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

  // ET clock
  useEffect(() => {
    const t = setInterval(() => setClock(etClock()), 60000);
    return () => clearInterval(t);
  }, []);

  // fetch blotter quotes when brief changes
  useEffect(() => {
    if (data?.brief) fetchBlotterQuotes(data.brief);
  }, [data?.brief, fetchBlotterQuotes]);

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

  const loadDate = useCallback(async (date: string) => {
    if (date === selectedDate) { setSelectedDate(null); setHistoryBrief(null); return; }
    setSelectedDate(date);
    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/intel/briefs/${encodeURIComponent(date)}`, { cache: "no-store" });
      const j = await r.json();
      setHistoryBrief(j.brief ?? null);
    } catch { setHistoryBrief(null); }
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
    return <div style={{ padding: 24 }}>{[1, 2, 3, 4].map((i) => <div key={i} className="bl-skel" style={{ marginBottom: 6 }} />)}</div>;
  }
  if (!data) {
    return (
      <div style={{ padding: 24 }}>
        <div className="istate istate-err">Couldn&apos;t load Market Intel. <button className="ibtn ibtn-sm" onClick={load}>Retry</button></div>
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
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
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
        />
        <StatusBar data={data} clock={clock} latencyMs={latencyMs} />
        <LiveTape tape={fullTape} />

        {msg && (
          <div className="istate" style={{ margin: "6px 16px", color: "var(--steel)", fontSize: 11.5 }}>
            {msg} <button className="ibtn ibtn-sm ibtn-ghost" onClick={() => setMsg(null)}>✕</button>
          </div>
        )}
        {!config.storage && (
          <div className="istate iwarn" style={{ margin: "4px 16px", fontSize: 11.5 }}>
            Upstash not configured — UPSTASH_REDIS_REST_URL/TOKEN needed.
          </div>
        )}

        {/* ── BOARD ── */}
        {tab === "BOARD" && (
          <div className="bl-layout" style={{ flex: 1 }}>
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
            />
            <div className="bl-center">
              {/* blotter sub-header */}
              <div className="bl-center-head">
                <span className="bl-ch-title">TRADE BLOTTER</span>
                <span className="bl-ch-sep">·</span>
                <span>{blotter.length} IDEAS</span>
                <span className="bl-ch-sep">·</span>
                <span>URGENCY</span>
                <span className="bl-ch-sep">·</span>
                <span>AUTO-REFRESH 30s</span>
              </div>
              {/* legend */}
              <div className="bl-legend">
                <span className="bl-leg"><span className="bl-leg-dot" style={{ background: "#7fb88a" }} /> live market</span>
                <span className="bl-leg"><span style={{ fontSize: 9 }}>★</span> quoted from transcript</span>
                <span className="bl-leg"><span className="bl-leg-ring" /> not stated</span>
                <span className="bl-leg"><span className="bl-leg-sq" /> direct</span>
                <span className="bl-leg"><span className="bl-leg-dsq" /> inferred</span>
                <span className="bl-leg">° price since first mention (not trade P&amp;L)</span>
              </div>
              {/* tracker filter — TRACKED = level-anchored ideas only */}
              <div className="bl-filter-row" role="group" aria-label="Filter ideas by tracker state">
                {(["ALL", "TRACKED", "TRIGGERED", "ARMED", "ACTIVE", "INVALIDATED"] as BlotterFilter[]).map((f) => (
                  <button
                    key={f}
                    className={`bl-filter-chip${blotterFilter === f ? " on" : ""}`}
                    aria-pressed={blotterFilter === f}
                    onClick={() => setBlotterFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <BlotterTable
                ideas={blotter}
                trackedByIdeaId={trackedByIdeaId}
                filter={blotterFilter}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId((c) => (c === id ? null : id))}
              />
              <OptionsIntelPanel brief={brief} />
            </div>
            <div className="bl-right">
              <Inspector idea={selectedIdea} tracked={selectedTracked} variants={conflictVariants} />
            </div>
          </div>
        )}

        {/* ── BRIEF ── */}
        {tab === "BRIEF" && (
          <div className="bl-tabview">
            <div className="bl-hist-bar">
              {selectedDate && (
                <button
                  className="ibtn ibtn-primary bl-hist-today"
                  onClick={() => { setSelectedDate(null); setHistoryBrief(null); }}
                >
                  ← TODAY&apos;S BRIEF
                </button>
              )}
              <span className="bl-hist-label">BRIEF HISTORY</span>
              <div className="bl-hist-pills">
                {historyDates.length === 0
                  ? <span className="bl-hist-empty">No prior briefs stored.</span>
                  : historyDates.map((d) => (
                    <button key={d} className={`idate-pill${selectedDate === d ? " on" : ""}`} onClick={() => loadDate(d)}>{d}</button>
                  ))}
              </div>
            </div>
            {historyLoading
              ? <div className="icard"><div className="icard-h">Loading…</div><div className="iskel" /></div>
              : <BriefCard brief={displayBrief} ai={config.ai} onOpenVideo={setOpenVideo} historical={!!selectedDate} />}
          </div>
        )}

        {/* ── SOURCES ── */}
        {tab === "SOURCES" && (
          <div className="bl-tabview">
            <div className="icard bl-src-hub">
              <div className="icard-h">WORKFLOW</div>
              <ol className="bl-src-steps">
                <li className="bl-src-step"><span className="bl-src-stepn" aria-hidden="true">1</span><span>Add a channel or video URL in the box below</span></li>
                <li className="bl-src-step"><span className="bl-src-stepn" aria-hidden="true">2</span><span>Click any video → paste its transcript → Analyze</span></li>
                <li className="bl-src-step"><span className="bl-src-stepn" aria-hidden="true">3</span><span>Hit Generate Brief to synthesize all sources into today&apos;s brief</span></li>
              </ol>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button className="ibtn ibtn-primary" style={{ flex: 1 }} disabled={busy === "sync"} aria-busy={busy === "sync"} onClick={sync}>
                  {busy === "sync" ? "Syncing…" : "SYNC CHANNELS"}
                </button>
                <button className="ibtn ibtn-primary" style={{ flex: 1 }} disabled={busy === "brief" || !config.ai} aria-busy={busy === "brief"} onClick={generateBrief}>
                  {busy === "brief" ? "Generating…" : "GENERATE BRIEF"}
                </button>
              </div>
              {data.lastBriefAt > 0 && (
                <div className="bl-lp-age" style={{ marginTop: 8 }}>
                  last brief {ago(data.lastBriefAt)}{!config.ai ? " · needs ANTHROPIC_API_KEY" : ""}
                </div>
              )}
              {!config.ai && data.lastBriefAt === 0 && (
                <div className="inote iwarn" style={{ marginTop: 8, fontSize: 10 }}>needs ANTHROPIC_API_KEY to generate briefs</div>
              )}
            </div>
            <AddSource onReload={load} />
            <SourceMonitor sources={sources} onRemove={removeSource} />
            <VideoLibrary videos={videos} onOpen={setOpenVideo} />
          </div>
        )}

        {/* ── OPTIONS ── */}
        {tab === "OPTIONS" && (
          <div className="bl-tabview">
            <OptionsWorkspace brief={brief} levels={brief?.levels ?? []} />
          </div>
        )}

        {/* ── ASK ── */}
        {tab === "ASK" && (
          <div className="bl-tabview" style={{ paddingBottom: 120 }}>
            <div className="icard">
              <div className="icard-h">Ask AUGUST</div>
              <p className="inote">Use the bar below — AUGUST answers from your processed video transcripts.</p>
              {!config.ai && <div className="istate iwarn">Needs ANTHROPIC_API_KEY.</div>}
            </div>
          </div>
        )}

        <div className="idisc" style={{ paddingBottom: 64 }}>
          AUGUST Market Intel is decision-support over creator commentary. It never trades and never invents prices, levels, or tickers. Not financial advice.
        </div>

        <AskBar ai={config.ai} />

        {openVideo && (
          <VideoDrawer key={openVideo} videoId={openVideo} onClose={() => setOpenVideo(null)} onProcessed={load} aiOn={config.ai} />
        )}
      </div>
    </SymbolProvider>
  );
}
