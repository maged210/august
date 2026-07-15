"use client";

// The DESK — AUGUST's market surface, hosted on the command deck as a slide.
// BOARD is the working view (today's brief rail, the live trade blotter with
// quotes + status, the inspector, options intel, and the ask bar over the
// processed transcripts); TAPE is the full live market grid; ARCHIVE is past
// briefs; SOURCES + OPTIONS are the workbench. The deck slide is viewport-
// locked on desktop, so every tab body fits the viewport and panels scroll
// internally; on mobile the shell itself scrolls.
//
// Source privacy: overview/brief responses are redacted server-side (no
// channel/video attribution) unless INTEL_OWNER_VIEW is set — every cite in
// this file gates on `videoId`, so a redacted brief simply renders no source
// rows. The TRACE toggle (owner-only) reveals cites on the board.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Markets } from "@/lib/markets";
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
import { etDateKey } from "@/lib/intel/session";
import Gauge from "@/components/markets/Gauge";
import WidgetState from "@/components/WidgetState";
import BriefPanel from "./BriefPanel";
import { SymbolProvider } from "./symbolContext";
import OptionsWorkspace from "./OptionsWorkspace";
// The desk's stylesheet rides with this (lazily loaded) component — /intel is
// a redirect now, so the CSS must be owned by the dashboard itself.
import "@/app/intel/intel.css";

// WebGL/canvas chart components — browser only, loaded only inside the desk.
const PriceChart = dynamic(() => import("@/components/markets/PriceChart"), { ssr: false });
const Sparkline = dynamic(() => import("@/components/markets/Sparkline"), {
  ssr: false,
  loading: () => <div className="spark" />,
});

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
  ownerView?: boolean;
};

type QuoteMap = Record<string, { price: number; prevClose: number; chgPct: number; closes: number[] }>;
// BOARD (blotter + brief rail) is the default working view; TAPE is the live
// grid; ARCHIVE is past briefs only (today never appears there).
type Tab = "BOARD" | "TAPE" | "ARCHIVE" | "SOURCES" | "OPTIONS";
type IdeaStatus = "WATCH" | "TRIG" | "ARMED" | "ACTIVE" | "INVLD";
type BlotterIdea = BriefIdea & { __fav?: boolean; quote: QuoteMap[string] | null };

// ── constants ────────────────────────────────────────────────────────────────

// Tab-gated polling: quotes (tape + blotter) only while BOARD is up; the
// /api/markets snapshot while BOARD (levels rail) or TAPE (the grid); today's
// brief re-checks on a slow cadence while BOARD is up — it changes at most a
// few times a day.
const QUOTES_REFRESH_MS = 30_000;
const MKT_REFRESH_MS = 30_000;
const BRIEF_REFRESH_MS = 60_000;

const TAPE_MACRO = ["SPY", "QQQ", "IWM", "^VIX", "GC=F", "CL=F", "BTC-USD", "ETH-USD"];

// Design-system colors as CSS custom-property references (globals.css :root),
// so the inline-SVG charts + gauges re-theme with [data-theme] — applied via
// `style` (SVG presentation attributes don't resolve var()); the fallbacks are
// the dark-stage values, so dark rendering is unchanged. POS/NEG match the
// --pos/--neg tokens, AMBER is the system's caution accent, ASH the secondary
// ink. GREEN is the one extra scale step the 5-zone fear/greed gauge needs
// between ASH and POS.
const POS = "var(--pos, #7fb0a3)";
const NEG = "var(--neg, #bb7d72)";
const ASH = "var(--ash, #9a9a9f)";
const AMBER = "var(--amber, #c9a24a)";
const GREEN = "var(--gauge-green, #9bbf8a)";

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
const etClock = () =>
  new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const fmtPx = (n: number) =>
  n >= 1000 ? n.toFixed(2) : n >= 10 ? n.toFixed(2) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

// — market tape formatters (the ported deck grid) ——
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const sign = (n: number) => (n >= 0 ? "pos" : "neg");
const fmt = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const lastPx = (n: number) =>
  n >= 1000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Selected = { sym: string; kind: string; label: string };
const DEFAULT_SELECTED: Selected = { sym: "QQQ", kind: "yahoo", label: "QQQ · NQ proxy" };

type BriefFetch = { brief: DailyBrief | null; ownerView: boolean };

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
  const p = ((q.price - ent) / ent) * 100;
  return (p >= 0 ? "+" : "") + p.toFixed(1) + "%";
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
  const p = ((price - l.level) / l.level) * 100;
  if (l.type === "resistance" || l.type === "breakout") {
    if (price > l.level) return { label: "CLEARED", cls: "bl-cleared" };
  }
  if (l.type === "support" || l.type === "breakdown") {
    if (price < l.level) return { label: "BROKEN", cls: "bl-broken" };
  }
  return { label: (p >= 0 ? "+" : "") + p.toFixed(1) + "%", cls: p >= 0 ? "bl-dlt-pos" : "bl-dlt-neg" };
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
      <polyline points={points} fill="none" style={{ stroke: up ? POS : NEG }} strokeWidth="1.2" />
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
          <line x1={0} y1={entY} x2={W} y2={entY} style={{ stroke: AMBER }} strokeWidth="0.8" strokeDasharray="3 3" opacity="0.65" />
        )}
        <polyline points={pts} fill="none" style={{ stroke: up ? POS : NEG }} strokeWidth="1.5" />
        <circle cx={lastX} cy={lastY} r={2.5} style={{ fill: up ? POS : NEG }} />
      </svg>
      <div className="bl-insp-chart-labels">
        <span>{fmtPx(min)}</span>
        {entry != null && <span style={{ color: AMBER }}>entry {fmtPx(entry)}</span>}
        <span>{fmtPx(max)}</span>
      </div>
    </div>
  );
}

// ── PageHeader ───────────────────────────────────────────────────────────────

function PageHeader({
  data, tab, onTab, blotter, busy, onSync, onGenerateBrief,
}: {
  data: Overview;
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

  // No decorative F-key chips — nothing here is wired to a function key.
  const tabs: Tab[] = ["BOARD", "TAPE", "ARCHIVE", "SOURCES", "OPTIONS"];

  const briefAge = data.lastBriefAt
    ? `${Math.round((Date.now() - data.lastBriefAt) / 60000)}m`
    : null;

  return (
    <div className="bl-head">
      <div className="bl-head-row1">
        <span className="bl-head-title">DESK</span>
        <span className="bl-head-live" />
        <span className="bl-head-livebadge">LIVE</span>
        <span className="bl-head-date">{data.clock.nice.toUpperCase()}</span>
        <span className="bl-head-session">
          {data.clock.sessionLabel.toUpperCase()} · {blotter.length} TRACKED
        </span>
        <div className="bl-head-tabs">
          {tabs.map((t) => (
            <button key={t} className={`bl-head-tab${tab === t ? " on" : ""}`} onClick={() => onTab(t)}>
              {t}
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
          <a className="ibtn ibtn-sm ibtn-ghost" href="/api/intel/export/today">EXPORT</a>
        </div>
      </div>
    </div>
  );
}

// ── StatusBar ────────────────────────────────────────────────────────────────

// DATA reflects the real /api/markets poll — no fake WS/latency theater.
function StatusBar({ data, clock, mktStatus }: { data: Overview; clock: string; mktStatus: "loading" | "live" | "error" }) {
  const { config, lastSync, lastBriefAt } = data;
  const items = [
    { label: "SESSION", val: data.clock.sessionLabel.toUpperCase(), cls: "" },
    {
      label: "DATA",
      val: mktStatus === "live" ? "LIVE" : mktStatus === "error" ? "OFFLINE" : "CONNECTING",
      cls: mktStatus === "live" ? "bl-sb-ok" : mktStatus === "error" ? "bl-sb-err" : "",
    },
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
  if (macro.length === 0 && watch.length === 0) return null;
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
  idea, selected, onSelect,
}: {
  idea: BlotterIdea;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = deriveStatus(idea);
  const dt = deltaTrig(idea);
  const up = idea.direction === "bullish";
  const closes = idea.quote?.closes ?? [];
  const ns = <span className="bl-ns">⌀ n/s</span>;

  const entText = idea.entry?.value != null ? `$${fmtPx(idea.entry.value)}` : ns;
  const invText = idea.invalidation?.value != null ? `$${fmtPx(idea.invalidation.value)}` : ns;
  const tgtText = idea.targets[0]?.value != null ? `$${fmtPx(idea.targets[0].value)}` : ns;
  const liveText = idea.quote?.price != null ? `$${fmtPx(idea.quote.price)}` : ns;
  const dtCls = dt === "—" ? "" : dt.startsWith("+") ? "bl-dlt-pos" : "bl-dlt-neg";

  return (
    <tr className={`bl-row${selected ? " selected" : ""}`} onClick={onSelect}>
      <td className="bl-c-status"><StatusBadge s={status} /></td>
      <td className="bl-c-ticker">{idea.ticker}</td>
      <td className="bl-c-dir">
        {idea.direction === "bullish" ? <span className="bl-bull-glyph">▲</span>
          : idea.direction === "bearish" ? <span className="bl-bear-glyph">▼</span>
          : <span className="bl-neut-glyph">—</span>}
      </td>
      <td className="bl-c-tf">{TF_LABEL[idea.timeHorizon] ?? "—"}</td>
      <td className="bl-c-setup" title={idea.thesis}>{idea.thesis.slice(0, 38)}</td>
      <td className="bl-c-num">{entText}</td>
      <td className="bl-c-num">{invText}</td>
      <td className="bl-c-num">{tgtText}</td>
      <td className="bl-c-live">{liveText}</td>
      <td className={`bl-c-delta ${dtCls}`}>{dt}</td>
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

function BlotterTable({
  ideas, selectedId, onSelect,
}: {
  ideas: BlotterIdea[];
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

  const GROUP_ORDER = ["TODAY · TOP IDEAS", "SHORT-TERM · SWING", "LONG-TERM"];
  const groups: Record<string, BlotterIdea[]> = {};
  for (const idea of ideas) {
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
            <th>Δ-TRIG</th><th>SPARK</th><th>CONF</th><th>EVID</th>
          </tr>
        </thead>
        <tbody>
          {GROUP_ORDER.map((g) => {
            const rows = groups[g];
            if (!rows?.length) return null;
            return (
              <Fragment key={g}>
                <tr>
                  <td colSpan={13} className="bl-section-head">{g.toLowerCase()}</td>
                </tr>
                {rows.map((idea) => (
                  <BlotterRow
                    key={idea.id}
                    idea={idea}
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
    o.direction === "bullish" ? <span className="bl-bull-glyph" style={{ fontSize: 10.5 }}>▲ BULL</span>
    : o.direction === "bearish" ? <span className="bl-bear-glyph" style={{ fontSize: 10.5 }}>▼ BEAR</span>
    : <span className="bl-neut-glyph" style={{ fontSize: 10.5 }}>— NEUT</span>;

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
                      <td className="bl-optx-td" style={{ fontSize: 10.5, opacity: 0.7 }}>
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

// `trace` is the owner-only provenance reveal: cites render only when the
// server sent attribution (ownerView; a redacted idea has no videoId at all)
// AND the owner flipped the board's TRACE toggle on.
function Inspector({ idea, trace }: { idea: BlotterIdea | null; trace: boolean }) {
  if (!idea) {
    return (
      <div className="bl-insp-empty">
        <div>SELECT A ROW</div>
        <div style={{ fontSize: 10.5 }}>to inspect the trade setup</div>
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
        <StatusBadge s={status} />
        {idea.__fav && <span className="badge b-fav" style={{ fontSize: 8 }}>FAV</span>}
      </div>
      {idea.assetName && (
        <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11, color: "var(--ash)", opacity: 0.6, marginBottom: 6 }}>
          {idea.assetName}
        </div>
      )}

      {/* Live price block */}
      {idea.quote && (
        <div className="bl-insp-price-block">
          <div className="bl-insp-price-live">LIVE · DELAYED FREE PROXY</div>
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

      {/* Cite — owner-only (redacted ideas carry no videoId) + trace toggle */}
      {trace && idea.videoId && (
        <>
          <div className="bl-insp-cite2">
            · {idea.channelTitle ?? "source"} @ {mmss(idea.sourceStartSeconds)}
            {idea.rankScore !== undefined ? ` · rank ${idea.rankScore.toFixed(2)}` : ""}
          </div>
          <a className="bl-insp-cite" href={watchUrl(idea.videoId, idea.sourceStartSeconds)} target="_blank" rel="noreferrer">
            ▸ open source
          </a>
        </>
      )}
    </div>
  );
}

// ── ConsensusStrip — cross-channel agree/conflict on the brief rail ─────────
// Main's ConsensusRow resurrected, redaction-aware: a redacted brief keeps each
// item's source COUNT + explicitness but no channel names, so the strip falls
// back to an honest count — never "undefined".
function ConsensusStrip({ items }: { items: ConsensusItem[] }) {
  if (!items.length) return null;
  return (
    <>
      <div className="bl-ph">Consensus &amp; Conflicts</div>
      {items.slice(0, 8).map((c) => {
        const names = c.sources.map((s) => s.channelTitle).filter(Boolean);
        const agreeCls =
          c.agreement === "conflict" ? "b-conflict" : c.agreement === "agree" ? "b-triggered" : "b-neutral";
        return (
          <div key={`${c.ticker}:${c.direction}`} className="consensus-row" style={{ padding: "5px 0" }}>
            <span className="intel-mono" style={{ color: "var(--bone)" }}>
              {c.ticker}{" "}
              {c.direction === "bullish" ? <span className="bl-bull-glyph">▲</span>
                : c.direction === "bearish" ? <span className="bl-bear-glyph">▼</span>
                : <span className="bl-neut-glyph">—</span>}
            </span>
            <span style={{ fontSize: 10.5, color: "var(--ash)" }}>
              {names.length ? names.join(" · ") : `${c.sources.length} source${c.sources.length === 1 ? "" : "s"}`}
            </span>
            <span className={`badge ${agreeCls}`}>{c.agreement}</span>
          </div>
        );
      })}
    </>
  );
}

// ── LeftPanel — the board's brief rail ───────────────────────────────────────
// ONE brief presentation on the board: main's condensed read (posture rows,
// bull/bear, AT THE OPEN) merged with the newer brief work — the read-60 lead,
// the owner-only TRACE toggle, the honest compile affordance. BriefPanel
// remains the ARCHIVE renderer.

function LeftPanel({
  brief, ownerView, trace, onTrace, sources, videos, onOpenVideo, onReload, removeSource, quotes,
  busy, lastBriefAt, aiOn, compileMsg, onGenerateBrief,
}: {
  brief: DailyBrief | null;
  ownerView: boolean;
  trace: boolean;
  onTrace: () => void;
  sources: IntelSource[];
  videos: IntelVideo[];
  onOpenVideo: (id: string) => void;
  onReload: () => Promise<void>;
  removeSource: (id: string) => Promise<void>;
  quotes: QuoteMap;
  busy: string | null;
  lastBriefAt: number;
  aiOn: boolean;
  compileMsg: string | null;
  onGenerateBrief: () => void;
}) {
  return (
    <div className="bl-left">
      <div className="bl-ph" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Today&apos;s Brief{brief ? ` · ${brief.date}` : ""}</span>
        {ownerView && brief ? (
          <button
            type="button"
            className={`desk-trace-toggle${trace ? " on" : ""}`}
            onClick={onTrace}
            aria-pressed={trace}
            title="Reveal source attribution (owner only)"
          >
            trace
          </button>
        ) : null}
      </div>
      {brief ? (
        <>
          <p className="bl-brief-posture">{brief.read60 || brief.posture || "No narrative for this brief."}</p>
          {!brief.grounded && (
            <div className="inote iwarn" style={{ marginBottom: 8 }}>AI narrative offline — structured intel only.</div>
          )}
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
      ) : (
        // No brief yet — the compile affordance (wired to the intel pipeline,
        // honest about 501/429).
        <div style={{ padding: "4px 0 6px" }}>
          <p className="desk-compile-lead" style={{ fontSize: 12 }}>No brief compiled for {etDateKey()}.</p>
          <button
            type="button"
            className="desk-compile-btn"
            disabled={busy === "brief" || !aiOn}
            aria-busy={busy === "brief"}
            onClick={onGenerateBrief}
          >
            {busy === "brief" ? "COMPILING…" : "COMPILE TODAY'S BRIEF →"}
          </button>
          {!aiOn ? (
            <div className="desk-note">needs ANTHROPIC_API_KEY on the server</div>
          ) : compileMsg ? (
            <div className="desk-note">{compileMsg}</div>
          ) : null}
        </div>
      )}
      {lastBriefAt > 0 && (
        <div className="bl-lp-age" style={{ marginTop: 8 }}>brief {ago(lastBriefAt)}{!aiOn ? " · needs ANTHROPIC_API_KEY" : ""}</div>
      )}

      {/* Trade-idea consensus — sources render as names only when present */}
      {brief && <ConsensusStrip items={brief.consensus} />}

      {/* AT THE OPEN — the brief's levels checked against live quotes */}
      {brief && brief.levels.length > 0 && (
        <>
          <div className="bl-ph">AT THE OPEN</div>
          {brief.levels.slice(0, 10).map((l) => {
            const { label, cls } = atOpenState(l, quotes);
            return (
              <div key={l.id} className="bl-atopen-row">
                <span className="bl-atopen-inst">{l.instrument}</span>
                <span style={{ fontSize: 10.5, color: "var(--ash)", opacity: 0.7 }}>
                  {l.type === "resistance" ? "clears" : l.type === "support" ? "holds" : l.type}
                  {l.level != null && <b style={{ marginLeft: 4, color: "var(--bone)", fontFamily: "var(--font-mono), monospace" }}>${l.level}</b>}
                </span>
                <span className={cls || "bl-ns"}>{label}</span>
              </div>
            );
          })}
        </>
      )}

      {/* Roster is owner-only — non-owners get an honest quiet state, not an
          empty shell (the API withholds the lists without INTEL_OWNER_VIEW). */}
      {!ownerView ? (
        <>
          <div className="bl-ph">Sources &amp; Videos</div>
          <div className="bl-lp-age">owner only — the source roster stays private (set INTEL_OWNER_VIEW=true in .env.local)</div>
        </>
      ) : (
        <>
          <div className="bl-ph">Sources · {sources.length}</div>
          {sources.length === 0
            ? <div className="istate" style={{ fontSize: 11 }}>No sources.</div>
            : sources.map((s) => (
              <div key={s.id} className="irow" style={{ padding: "4px 0" }}>
                {s.thumbnail ? <img className="irow-thumb" src={s.thumbnail} alt="" /> : <span className="irow-thumb" />}
                <div className="irow-main">
                  <div className="irow-title" style={{ fontSize: 11 }}>{s.title}</div>
                  <div className="irow-meta">
                    <span className={`badge ${s.status === "active" ? "b-verified" : "b-stale"}`} style={{ fontSize: 7.5 }}>{s.status}</span>
                    <span style={{ fontSize: 10.5, opacity: 0.55 }}>{ago(s.lastChecked)}</span>
                  </div>
                </div>
                <button className="ibtn ibtn-sm ibtn-ghost" style={{ fontSize: 10.5 }} onClick={() => removeSource(s.id)}>✕</button>
              </div>
            ))}

          <div className="bl-ph">Videos · {videos.length}</div>
          {videos.length === 0
            ? <div className="istate" style={{ fontSize: 11 }}>No videos yet.</div>
            : videos.slice(0, 8).map((v) => (
              <div key={v.videoId} className="irow clickable" style={{ padding: "4px 0" }} onClick={() => onOpenVideo(v.videoId)}>
                {v.thumbnail ? <img className="irow-thumb" src={v.thumbnail} alt="" /> : <span className="irow-thumb" />}
                <div className="irow-main">
                  <div className="irow-title" style={{ fontSize: 10.5 }}>{v.title}</div>
                  <div className="irow-meta">
                    {v.status === "analyzed" && <span className="badge b-verified" style={{ fontSize: 7 }}>Analyzed</span>}
                    {v.status === "analyzing" && <span className="badge b-proc" style={{ fontSize: 7 }}>Processing</span>}
                    {v.liveState === "live" && <span className="badge b-live" style={{ fontSize: 7 }}>Live</span>}
                    {v.status !== "analyzed" && v.status !== "analyzing" && (
                      <span className="bl-lp-hint">→ tap · paste transcript</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
        </>
      )}

      <div className="bl-ph">Add Sources</div>
      <AddSource onReload={onReload} compact />

      <div className="idisc" style={{ textAlign: "left", marginTop: 18 }}>
        The desk is decision-support over creator commentary. It never trades and never invents prices, levels, or tickers. Not financial advice.
      </div>
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
  const [err, setErr] = useState<string | null>(null);

  // Honest failure states, same voice as the brief compile path: rate limits
  // say so, server errors say so, and a dead connection never renders as JSON.
  const ask = async () => {
    if (q.trim().length < 3) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/intel/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (r.status === 429) {
        setRes(null);
        setErr("rate limited — try again in a moment");
      } else if (!r.ok) {
        setRes(null);
        setErr("Ask failed — try again.");
      } else {
        setRes(await r.json());
      }
    } catch {
      setRes(null);
      setErr("ask failed — connection");
    } finally { setBusy(false); }
  };

  return (
    <div className="bl-askbar">
      {err && (
        <div className="bl-askbar-ans">
          <div className="inote iwarn">{err}</div>
          <button className="ibtn ibtn-sm ibtn-ghost" style={{ marginTop: 8 }} onClick={() => setErr(null)}>Dismiss</button>
        </div>
      )}
      {res && (
        <div className="bl-askbar-ans">
          <div style={{ marginBottom: 8 }}>{res.answer}</div>
          {(res.citations ?? []).filter((c) => c.videoId).map((c, i) => (
            <a key={i} className="idea-cite" style={{ display: "block" }} href={watchUrl(c.videoId, c.startSeconds)} target="_blank" rel="noreferrer">
              ▸ {c.channelTitle || c.videoTitle} @ {mmss(c.startSeconds)} — {c.note}
            </a>
          ))}
          <button className="ibtn ibtn-sm ibtn-ghost" style={{ marginTop: 8 }} onClick={() => setRes(null)}>Dismiss</button>
        </div>
      )}
      <input
        className="bl-askbar-input"
        placeholder={ai ? "> ask the desk — what did the source say about QQQ?" : "> ask the desk (needs ANTHROPIC_API_KEY)"}
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

function IdeaCard({ idea, favorite }: { idea: BriefIdea | TradeIdea; favorite?: boolean }) {
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
      {/* Redacted briefs delete sourceStartSeconds — only render a timestamp
          that actually exists (never NaN:NaN). */}
      {!Number.isFinite(l.sourceStartSeconds)
        ? null
        : l.videoId
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
      {c.eventTime && <span className="intel-mono" style={{ color: "var(--ash)", fontSize: 11, marginLeft: 6 }}>{c.eventTime}</span>}
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
          <span className="inote" style={{ fontSize: 10.5 }}>Ctrl+Enter</span>
        </div>
        {results.length > 0 && (
          <div className="iadd-results">
            {results.map((r, i) => (
              <div key={i} className={`iadd-result ${r.status === "ok" ? "iadd-ok" : r.status === "exists" ? "iadd-exist" : "iadd-err"}`} style={{ fontSize: 10.5 }}>
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
            <div className="intel-mono" style={{ fontSize: 11, color: "var(--ash)" }}>VIDEO</div>
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

// ── IntelDashboard (main) ────────────────────────────────────────────────────

export default function IntelDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openVideo, setOpenVideo] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("BOARD");
  const [clock, setClock] = useState(etClock());

  // Board: blotter selection, live quotes, the macro tape, owner trace toggle.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [tape, setTape] = useState<TapeItem[]>([]);
  const [trace, setTrace] = useState(false);
  const [compileMsg, setCompileMsg] = useState<string | null>(null);

  // Market tape (the deck grid): /api/markets snapshot, polled only while a
  // market tab (BOARD levels rail / TAPE grid) is on screen.
  const [mkt, setMkt] = useState<Markets | null>(null);
  const [mktStatus, setMktStatus] = useState<"loading" | "live" | "error">("loading");
  const [mktUpdated, setMktUpdated] = useState("");
  const [selected, setSelected] = useState<Selected>(DEFAULT_SELECTED);

  // Archive: past brief dates; expanded rows lazy-fetch their brief once.
  const [archDates, setArchDates] = useState<string[] | null>(null);
  const [archOpen, setArchOpen] = useState<string | null>(null);
  const [archBriefs, setArchBriefs] = useState<Record<string, BriefFetch | "loading" | "error">>({});

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

  // initial fetch
  useEffect(() => { load(); }, [load]);

  // ET clock
  useEffect(() => {
    const t = setInterval(() => setClock(etClock()), 60000);
    return () => clearInterval(t);
  }, []);

  // Macro tape quotes (SPY/QQQ/VIX/gold/oil/crypto) — merged into the strip.
  const fetchMacroTape = useCallback(async () => {
    try {
      const r = await fetch(`/api/intel/quotes?symbols=${TAPE_MACRO.join(",")}`, { cache: "no-store" });
      const j = await r.json();
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

  // Blotter quotes for the brief's tickers (live price / spark / status).
  const fetchBlotterQuotes = useCallback(async (brief: DailyBrief) => {
    const ideas = [...(brief.creatorFavorites ?? []), ...(brief.topIdeas ?? [])];
    const syms = [...new Set(ideas.map((i) => i.ticker.toUpperCase()))].slice(0, 20);
    if (!syms.length) return;
    try {
      const r = await fetch(`/api/intel/quotes?symbols=${syms.join(",")}`, { cache: "no-store" });
      const j = await r.json();
      setQuotes(j.quotes ?? {});
    } catch { /* keep */ }
  }, []);

  // Quotes poll — only while the BOARD is on screen (tab-gated). Keyed on the
  // brief's stable identity, NOT the object: the 60s brief re-poll swaps in a
  // fresh object every time, which must not restart this 30s interval. The ref
  // hands each tick the latest brief without joining the dependency list.
  const briefRef = useRef<DailyBrief | null>(null);
  useEffect(() => { briefRef.current = data?.brief ?? null; }, [data]);
  const briefKey = data?.brief?.date ?? data?.brief?.generatedAt ?? null;
  useEffect(() => {
    if (tab !== "BOARD") return;
    const tick = () => {
      if (document.hidden) return; // hidden tab — go quiet (same as PresenceTelemetry)
      fetchMacroTape();
      if (briefRef.current) fetchBlotterQuotes(briefRef.current);
    };
    tick();
    const id = window.setInterval(tick, QUOTES_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [tab, briefKey, fetchMacroTape, fetchBlotterQuotes]);

  // /api/markets snapshot — exposed so the shared error state's RETRY refetches.
  const loadMarkets = useCallback(async () => {
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const j: Markets = await res.json();
      setMkt(j);
      setMktStatus("live");
      setMktUpdated(new Date().toLocaleTimeString("en-US", { hour12: false }));
    } catch {
      setMktStatus((s) => (s === "live" ? "live" : "error"));
    }
  }, []);

  // Poll the market snapshot only while it's visible: BOARD (levels rail) or
  // TAPE (the full grid).
  const marketTabActive = tab === "BOARD" || tab === "TAPE";
  useEffect(() => {
    if (!marketTabActive) return;
    const tick = () => {
      if (document.hidden) return; // hidden tab — go quiet (same as PresenceTelemetry)
      loadMarkets();
    };
    tick();
    const id = window.setInterval(tick, MKT_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [marketTabActive, loadMarkets]);

  // Today's brief re-checks on a modest cadence while BOARD is on screen —
  // through the redacting briefs route (GET is unlimited; overview is not).
  useEffect(() => {
    if (tab !== "BOARD") return;
    const id = window.setInterval(() => {
      if (document.hidden) return; // hidden tab — go quiet (same as PresenceTelemetry)
      fetch(`/api/intel/briefs/${etDateKey()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: BriefFetch) => {
          setData((prev) =>
            prev ? { ...prev, brief: j.brief ?? prev.brief, ownerView: j.ownerView } : prev,
          );
        })
        .catch(() => {});
    }, BRIEF_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [tab]);

  // Archive dates refetch on every visit to the tab — the list is cheap, and a
  // once-only fetch goes stale across the ET midnight rollover. Today is
  // excluded by contract: today's brief stands alone on the BOARD.
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

  // One compile path for the header BRIEF button and the board's empty-state
  // CTA — runs the pipeline route with honest 501/429 errors, then refreshes.
  const generateBrief = useCallback(async () => {
    setBusy("brief"); setMsg(null); setCompileMsg(null);
    try {
      const r = await fetch("/api/intel/briefs/today", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Partial<BriefFetch>;
      if (r.ok && j.ok && j.brief) {
        setData((prev) => (prev ? { ...prev, brief: j.brief ?? null, ownerView: j.ownerView } : prev));
      } else if (r.status === 501) {
        setCompileMsg("needs ANTHROPIC_API_KEY on the server");
        setMsg("Brief: needs ANTHROPIC_API_KEY on the server");
      } else if (r.status === 429) {
        setCompileMsg("rate limited — try again in a moment");
        setMsg("Brief: rate limited — try again in a moment");
      } else if (!j.ok) {
        setCompileMsg(j.error ? `compile failed: ${j.error}` : "compile failed");
        setMsg(`Brief: ${j.error ?? "failed"}`);
      }
      await load();
    } catch {
      setCompileMsg("compile failed — connection");
    } finally { setBusy(null); }
  }, [load]);

  if (status === "loading") {
    return <div style={{ padding: 24 }}>{[1, 2, 3, 4].map((i) => <div key={i} className="bl-skel" style={{ marginBottom: 6 }} />)}</div>;
  }
  if (!data) {
    return (
      <div style={{ padding: 24 }}>
        <div className="istate istate-err">Couldn&apos;t load the desk. <button className="ibtn ibtn-sm" onClick={load}>Retry</button></div>
      </div>
    );
  }

  const { config, sources, videos, brief } = data;
  const ownerView = !!data.ownerView;
  const blotter = buildBlotter(brief, quotes);
  const selectedIdea = blotter.find((i) => i.id === selectedId) ?? null;

  // compose watchlist tape items from blotter
  const watchTape: TapeItem[] = blotter
    .filter((i) => i.quote)
    .map((i) => ({
      kind: "watch" as const, sym: i.ticker,
      price: i.quote!.price, chgPct: i.quote!.chgPct,
      status: deriveStatus(i),
    }));
  const fullTape: TapeItem[] = [
    ...tape.filter((t) => t.kind === "macro"),
    ...watchTape,
  ];

  const initialSymbol =
    brief?.options?.bestCreatorPlays[0]?.underlyingSymbol ||
    brief?.options?.directionalOnly[0]?.underlyingSymbol ||
    brief?.topIdeas[0]?.ticker || "SPY";

  const levels = mkt?.levels ?? null;
  const fredMissing = !!mkt && !mkt.macro.fredAvailable;
  // Shared non-data state for every tape panel: skeleton while connecting, FEED
  // OFFLINE · RETRY if the first load failed. Stale data keeps rendering as data.
  const fallback = (rows: number) => (
    <WidgetState state={mktStatus === "error" ? "error" : "loading"} rows={rows} onRetry={loadMarkets} />
  );

  // The NQ levels panel renders in two places (TAPE grid + BOARD right rail) —
  // one definition so the markup can't drift.
  const levelsPanel = (!mkt || levels) && (
    <section className="panel mk-levels">
      <div className="panel-head">{mkt?.levels?.proxy ?? "NQ"} · Levels</div>
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

  // Honest feed status for the tape (live · updated · delayed proxies).
  const feedline = (
    <div className="mkt-feedline">
      <div className="mkt-status">
        <span className={`mkt-dot ${mktStatus}`} />
        <span className="mkt-status-text">
          {mktStatus === "live"
            ? `LIVE · ${mktUpdated} · delayed free proxies`
            : mktStatus === "error"
              ? "feed unavailable — retrying"
              : "connecting to feeds…"}
        </span>
      </div>
    </div>
  );

  const disclaimer = (
    <div className="idisc">
      The desk is decision-support over creator commentary. It never trades and never invents prices, levels, or tickers. Not financial advice.
    </div>
  );

  return (
    <SymbolProvider initial={initialSymbol}>
      <div className="desk-shell">
        <div className="sr-only" role="status" aria-live="polite">
          {busy === "sync" ? "Syncing channels" : busy === "brief" ? "Generating brief" : ""}
        </div>

        <PageHeader
          data={data}
          tab={tab}
          onTab={setTab}
          blotter={blotter}
          busy={busy}
          onSync={sync}
          onGenerateBrief={generateBrief}
        />
        <StatusBar data={data} clock={clock} mktStatus={mktStatus} />
        <LiveTape tape={fullTape} />

        {msg && (
          <div className="istate desk-msg">
            {msg} <button className="ibtn ibtn-sm ibtn-ghost" onClick={() => setMsg(null)}>✕</button>
          </div>
        )}
        {!config.storage && (
          <div className="istate iwarn desk-msg">
            Upstash not configured — UPSTASH_REDIS_REST_URL/TOKEN needed.
          </div>
        )}

        <div className="desk-body">
          {/* ── BOARD — brief rail | live blotter | inspector + levels ── */}
          {tab === "BOARD" && (
            <div className="bl-layout">
              <LeftPanel
                brief={brief}
                ownerView={ownerView}
                trace={trace}
                onTrace={() => setTrace((t) => !t)}
                sources={sources}
                videos={videos}
                onOpenVideo={setOpenVideo}
                onReload={load}
                removeSource={removeSource}
                quotes={quotes}
                busy={busy}
                lastBriefAt={data.lastBriefAt}
                aiOn={config.ai}
                compileMsg={compileMsg}
                onGenerateBrief={generateBrief}
              />
              <div className="bl-center">
                <div className="bl-center-head">
                  <span className="bl-ch-title">TRADE BLOTTER</span>
                  <span className="bl-ch-sep">·</span>
                  <span>{blotter.length} IDEAS</span>
                  <span className="bl-ch-sep">·</span>
                  <span>URGENCY</span>
                  <span className="bl-ch-sep">·</span>
                  <span>AUTO-REFRESH 30s</span>
                </div>
                <div className="bl-legend">
                  <span className="bl-leg"><span className="bl-leg-dot" style={{ background: "var(--pos)" }} /> live market</span>
                  <span className="bl-leg"><span style={{ fontSize: 9 }}>★</span> quoted from transcript</span>
                  <span className="bl-leg"><span className="bl-leg-ring" /> not stated</span>
                  <span className="bl-leg"><span className="bl-leg-sq" /> direct</span>
                  <span className="bl-leg"><span className="bl-leg-dsq" /> inferred</span>
                </div>
                <BlotterTable
                  ideas={blotter}
                  selectedId={selectedId}
                  onSelect={(id) => setSelectedId((c) => (c === id ? null : id))}
                />
                <OptionsIntelPanel brief={brief} />
                <AskBar ai={config.ai} />
              </div>
              <div className="bl-right">
                <Inspector idea={selectedIdea} trace={trace} />
                <div style={{ marginTop: 14 }}>{levelsPanel}</div>
              </div>
            </div>
          )}

          {/* ── TAPE — the full live market grid, viewport-fit on desktop ── */}
          {tab === "TAPE" && (
            <div className="desk-tapeview">
              {feedline}
              <div className="markets-grid">
                {/* sector strip — hidden when loaded-but-empty (no inert shell) */}
                {(!mkt || mkt.sectors.length > 0) && (
                  <section className="panel mk-sectors">
                    <div className="panel-head">Sectors</div>
                    {mkt ? (
                      <div className="sector-strip">
                        {mkt.sectors.map((s) => (
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
                {(!mkt || mkt.watchlist.length > 0) && (
                  <section className="panel mk-watch">
                    <div className="panel-head">Watchlist · click to chart</div>
                    {mkt ? (
                      <table className="term-table watch-table">
                        <tbody>
                          {mkt.watchlist.map((q) => (
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
                              <td className="t-last">{lastPx(q.last)}</td>
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
                      value={mkt?.fng?.value ?? null}
                      min={0}
                      max={100}
                      display={(v) => String(Math.round(v))}
                      note={mkt?.fng?.label}
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
                      value={mkt?.vix ?? null}
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
                      value={mkt?.macro.t10y2y ?? null}
                      min={-1}
                      max={3}
                      display={(v) => `${v.toFixed(2)}%`}
                      note={mkt?.macro.t10y2y != null && mkt.macro.t10y2y < 0 ? "inverted" : undefined}
                      unavailable={fredMissing ? "needs FRED key" : undefined}
                      zones={[
                        { upTo: 0, color: NEG },
                        { upTo: 3, color: POS },
                      ]}
                    />
                    <Gauge
                      label="Fin. Stress"
                      value={mkt?.macro.stress ?? null}
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
                {(!mkt ||
                  mkt.movers.gainers.length > 0 ||
                  mkt.movers.losers.length > 0 ||
                  mkt.movers.actives.length > 0) && (
                  <section className="panel mk-movers">
                    <div className="panel-head">Movers</div>
                    {mkt ? (
                      <div className="movers-cols">
                        <div>
                          <div className="movers-h pos">Gainers</div>
                          {mkt.movers.gainers.map((m) => (
                            <div key={m.sym} className="mover">
                              <span className="mover-sym">{m.sym}</span>
                              <span className="pos">{pct(m.chgPct)}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div className="movers-h neg">Losers</div>
                          {mkt.movers.losers.map((m) => (
                            <div key={m.sym} className="mover">
                              <span className="mover-sym">{m.sym}</span>
                              <span className="neg">{pct(m.chgPct)}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div className="movers-h">Active</div>
                          {mkt.movers.actives.map((m) => (
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
                  {mkt ? (
                    <ul className="econ-list">
                      {mkt.econ.length ? (
                        mkt.econ.map((e, i) => (
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
                {(!mkt || mkt.flow.length > 0) && (
                  <section className="panel mk-flow">
                    <div className="panel-head">
                      Flow · Lite <span className="todo">proxy</span>
                    </div>
                    {mkt ? (
                      <ul className="flow-list">
                        {mkt.flow.map((f) => (
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
            </div>
          )}

          {/* ── ARCHIVE — past briefs only; a single-open accordion that
              scrolls inside the slide. ── */}
          {tab === "ARCHIVE" && (
            <div className="desk-scrollview">
              <div className="bl-tabview bl-tabview-wide">
                <div className="arch-wrap">
                  {archDates === null ? (
                    <WidgetState state="loading" rows={4} />
                  ) : archDates.length === 0 ? (
                    <div className="muted">No archived briefs yet.</div>
                  ) : (
                    <div className="arch-list">
                      {archDates.map((d) => {
                        const entry = archBriefs[d];
                        const open = archOpen === d;
                        return (
                          <div key={d} className={`arch-row${open ? " open" : ""}`}>
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
                              <div className="arch-body">
                                {!entry || entry === "loading" ? (
                                  <WidgetState state="loading" rows={4} />
                                ) : entry === "error" ? (
                                  <WidgetState state="error" onRetry={() => fetchArchive(d)} />
                                ) : entry.brief ? (
                                  <BriefPanel brief={entry.brief} ownerView={entry.ownerView} />
                                ) : (
                                  <div className="muted">No brief stored for this date.</div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {disclaimer}
              </div>
            </div>
          )}

          {/* ── SOURCES ── */}
          {tab === "SOURCES" && (
            <div className="desk-scrollview">
              <div className="bl-tabview">
                <div className="icard bl-src-hub">
                  <div className="icard-h">WORKFLOW</div>
                  <ol className="bl-src-steps">
                    <li className="bl-src-step"><span className="bl-src-stepn" aria-hidden="true">1</span><span>Add a channel or video URL in the box below</span></li>
                    <li className="bl-src-step"><span className="bl-src-stepn" aria-hidden="true">2</span><span>Click any video → paste its transcript → Analyze</span></li>
                    <li className="bl-src-step"><span className="bl-src-stepn" aria-hidden="true">3</span><span>Hit Generate Brief — read it on the BOARD tab</span></li>
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
                    <div className="inote iwarn" style={{ marginTop: 8, fontSize: 11 }}>needs ANTHROPIC_API_KEY to generate briefs</div>
                  )}
                </div>
                <AddSource onReload={load} />
                {/* Roster + library are owner-only — an honest quiet state
                    beats empty shells (the API withholds both lists). */}
                {ownerView ? (
                  <>
                    <SourceMonitor sources={sources} onRemove={removeSource} />
                    <VideoLibrary videos={videos} onOpen={setOpenVideo} />
                  </>
                ) : (
                  <div className="inote" style={{ marginTop: 12 }}>owner only — the source roster and video library stay private (set INTEL_OWNER_VIEW=true in .env.local)</div>
                )}
                {disclaimer}
              </div>
            </div>
          )}

          {/* ── OPTIONS ── */}
          {tab === "OPTIONS" && (
            <div className="desk-scrollview">
              <div className="bl-tabview">
                <OptionsWorkspace brief={brief} levels={brief?.levels ?? []} />
                {disclaimer}
              </div>
            </div>
          )}
        </div>

        {openVideo && (
          <VideoDrawer key={openVideo} videoId={openVideo} onClose={() => setOpenVideo(null)} onProcessed={load} aiOn={config.ai} />
        )}
      </div>
    </SymbolProvider>
  );
}
