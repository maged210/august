"use client";

// IDEAS TERMINAL — the public face of the desk (G3 revision: the soft card
// feed became a dense monospace blotter again). Two data sources, one grid:
//
//   LIVE    — the CORE V2 trade-ideas backend (GET /api/ideas): the desk's
//             current calls, redacted PublicIdea rows. They LEAD the board —
//             pinned on top, visually hot.
//   TRACKED — the legacy publish pipeline (GET /api/intel/feed): owner-
//             published FeedCard rows with stated levels, live quotes and
//             since-call performance. They sit below, under the lifecycle
//             filters.
//
// Grid columns: TICKER · SIDE · STATUS · ENTRY · TARGET · STOP · % SINCE
// CALL · SPARK · LAST · AGE. A row click expands INLINE to the full thesis
// and detail (the old card/sheet content); collapsed by default.
//
// Honesty rules (the law, inherited from the tracker/publish pipeline):
// - absent data renders as absent (∅ / —) — never a dash-as-zero, never a
//   computed placeholder;
// - the performance numeral comes exclusively from the feed's pnl view and is
//   labeled by its kind verbatim (SINCE CALLED / SINCE FIRST MENTION°, the °
//   marking a price move that is NOT trade P&L);
// - a LIVE idea's SIDE renders solid only when the desk STATED one (UX4:
//   extraction inference or /admin); otherwise the entry-vs-target derivation
//   shows, styled as derived — never presented as stated;
// - sparklines draw only the tracker's real priceHistory ring — fewer than two
//   observations means no line;
// - no demo/sample rows; an empty board shows the empty state.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FeedCard } from "@/lib/intel/publish";
import type { PriceSnap, TrackedLevel, TrackedStatus } from "@/lib/intel/tracker";
import type { Direction } from "@/lib/intel/types";
import { relativeTime, type PublicIdea } from "@/lib/ideas";
import { publishRainSymbols } from "@/lib/rain-symbols";
import type { PublicTapeEntry } from "@/lib/tape";
import type { PublicIngest } from "@/lib/transcripts";
import ChartDock, { type ChartSelection } from "@/components/surfaces/dock/ChartDock";
import DeskWirePanel, { buildWire } from "@/components/surfaces/dock/DeskWirePanel";
import IdeaDetailPanel from "@/components/surfaces/dock/IdeaDetailPanel";
import {
  selectionFromLive,
  selectionFromTracked,
  sideOf,
} from "@/components/surfaces/dock/derive";
import "@/app/intel/feed.css";

const REFRESH_MS = 60_000; // server caches ~45s; 60s keeps the quote dot honest

type FeedPayload = {
  ok: true;
  attribution: string;
  generatedAt: number;
  count: number;
  ideas: FeedCard[];
};

// ── formatting (mono, tabular; dates are display-only, computed client-side) ──

const px = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctFmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

// ── vocab maps (consumer language; every state computable from real data) ─────

const DIR_META: Record<Direction, { label: string; glyph: string; cls: string; title?: string }> = {
  bullish: { label: "LONG", glyph: "▲", cls: "if-dir-bull" },
  bearish: { label: "SHORT", glyph: "▼", cls: "if-dir-bear" },
  neutral: { label: "NEUT", glyph: "◆", cls: "if-dir-neut" },
  watch: { label: "WATCH", glyph: "◆", cls: "if-dir-neut", title: "watch idea" },
};

const LIFE_META: Record<TrackedStatus, { label: string; chip: string; family: string }> = {
  TRIGGERED: { label: "TRIGGERED", chip: "if-life-trig", family: "if-lc-trig" },
  ARMED: { label: "ARMED", chip: "if-life-arm", family: "if-lc-arm" },
  ACTIVE: { label: "ACTIVE", chip: "if-life-act", family: "if-lc-act" },
  TARGET_HIT: { label: "TARGET HIT", chip: "if-life-tgt", family: "if-lc-tgt" },
  INVALIDATED: { label: "INVALIDATED", chip: "if-life-inval", family: "if-lc-inval" },
  CLOSED: { label: "CLOSED", chip: "if-life-exp", family: "if-lc-exp" },
};

const FILTERS = ["ALL", "TRIGGERED", "ARMED", "ACTIVE", "INVALIDATED"] as const;
type Filter = (typeof FILTERS)[number];

function matchesFilter(f: Filter, status: TrackedStatus): boolean {
  switch (f) {
    case "ALL":
      return true;
    case "TRIGGERED":
      // TARGET_HIT is a triggered call that reached its stated target
      return status === "TRIGGERED" || status === "TARGET_HIT";
    case "ARMED":
      return status === "ARMED";
    case "ACTIVE":
      return status === "ACTIVE";
    case "INVALIDATED":
      return status === "INVALIDATED";
  }
}

// ── tiny leaf renderers ────────────────────────────────────────────────────────

/** blotter cell dash — column has no value for this row (title says why) */
function Dash({ title }: { title?: string }) {
  return (
    <span className="if-bdash" title={title} aria-hidden={title ? undefined : true}>
      —
    </span>
  );
}

/** sparkline from the tracker's REAL priceHistory ring — never drawn with
 *  fewer than two observations (no flat fake lines) */
function FeedSpark({ points, tone }: { points: PriceSnap[]; tone: "bull" | "bear" }) {
  if (points.length < 2) return null;
  const W = 60;
  const H = 18;
  const padY = 2;
  const vals = points.map((p) => p.price);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  const pad = (max - min) * 0.1 || Math.abs(vals[vals.length - 1]) * 0.01 || 1;
  min -= pad;
  max += pad;
  const xAt = (i: number) => (i / (vals.length - 1)) * W;
  const yAt = (v: number) => H - padY - ((v - min) / (max - min)) * (H - 2 * padY);
  const d = vals.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  const line = tone === "bull" ? "var(--rd-bull, #6fa085)" : "var(--rd-bear, #cd7e6d)";
  const fill =
    tone === "bull"
      ? "var(--rd-chart-fill-bull, rgba(111, 160, 133, 0.1))"
      : "var(--rd-chart-fill-bear, rgba(205, 126, 109, 0.1))";
  return (
    <svg
      className="if-spark"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label={`tracker price observations, ${points.length} points`}
    >
      <title>tracker price observations</title>
      <path d={`${d} L ${W},${H} L 0,${H} Z`} style={{ fill }} />
      <path
        d={d}
        fill="none"
        style={{ stroke: line }}
        strokeWidth={1.3}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={xAt(vals.length - 1)} cy={yAt(vals[vals.length - 1])} r={1.8} style={{ fill: line }} />
    </svg>
  );
}

/** performance view derived ONLY from the feed's pnl — label kinds verbatim */
function perfOf(card: FeedCard): { text: string; label: string; cls: string } | null {
  const pnl = card.pnl;
  if (!pnl || pnl.kind === "none") return null;
  const cls = pnl.pct >= 0 ? "if-pos" : "if-neg";
  if (pnl.kind === "since_called") return { text: pctFmt(pnl.pct), label: "SINCE CALLED", cls };
  // F3 — no glyph suffix: the kind rides the hover title, the numeral stays clean
  return { text: pctFmt(pnl.pct), label: "SINCE FIRST MENTION — price move, not trade P&L", cls };
}

/** spark tone: the perf sign when a pnl exists, else the real measured drift
 *  of the history itself (last vs first observation) */
function sparkTone(card: FeedCard): "bull" | "bear" {
  const pnl = card.pnl;
  if (pnl && pnl.kind !== "none") return pnl.pct >= 0 ? "bull" : "bear";
  const h = card.priceHistory;
  if (h.length >= 2) return h[h.length - 1].price >= h[0].price ? "bull" : "bear";
  return "bull";
}

// LIVE-idea derivations (numOf / liveSide) live in dock/derive.ts — shared
// with the chart dock so SIDE logic can never drift between grid and chart.

// ── blotter cells ──────────────────────────────────────────────────────────────

/** one tracked-level cell: numeric → tinted numeral; stated text → verbatim
 *  (ellipsized, title = full); absent → dash */
function LevelCell({ level, cls }: { level: TrackedLevel | null; cls: string }) {
  if (level == null) return <Dash title="not stated" />;
  if (level.value != null)
    return (
      <span className={`if-bval ${cls}`} title={level.text}>
        {px(level.value)}
      </span>
    );
  return (
    <span className={`if-bval if-bval-txt ${cls}`} title={level.text}>
      {level.text}
    </span>
  );
}

// ── LIVE row (new backend) ─────────────────────────────────────────────────────

function LiveRow({
  idea,
  selected,
  onSelect,
}: {
  idea: PublicIdea;
  /** the selection drives the dock chart AND the idea-detail panel (G3 r5) */
  selected: boolean;
  onSelect: () => void;
}) {
  // UX4 — a stated side (extraction/admin) renders solid; the entry-vs-target
  // derivation remains the clearly-marked fallback
  const side = sideOf(idea);
  return (
    <>
      <div
        className={`if-brow if-brow-live${selected ? " sel" : ""}`}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <span className="if-brail" aria-hidden="true" />
        <span className="if-bc if-bc-tkr">{idea.instrument}</span>
        <span className="if-bc">
          {side ? (
            <span
              className={`if-bside ${
                side.side === "LONG" ? "if-dir-bull" : side.side === "SHORT" ? "if-dir-bear" : "if-dir-neut"
              }${side.derived ? " derived" : ""}`}
              title={
                side.derived
                  ? "derived from entry vs target — the desk did not state a side"
                  : undefined
              }
            >
              <span className="if-bside-g" aria-hidden="true">
                {side.side === "LONG" ? "▲" : side.side === "SHORT" ? "▼" : "◆"}
              </span>
              {side.side}
            </span>
          ) : (
            <span className="if-abs-g" title="side not stated and not derivable from levels">
              ·
            </span>
          )}
        </span>
        <span className="if-bc">
          <span className="if-live-chip">
            <span className="if-life-dot" aria-hidden="true" />
            LIVE
          </span>
        </span>
        {/* R6 — ENTRY gets real width; full text rides the hover title */}
        <span className="if-bc">
          {idea.entry ? (
            <span className="if-bval if-lev-entry if-bentry" title={idea.entry}>
              {idea.entry}
            </span>
          ) : (
            <span className="if-abs-g" title="no entry stated">
              ·
            </span>
          )}
        </span>
        {/* R6 — TARGET renders only when stated; an unstated one is just empty */}
        <span className="if-bc">
          {idea.target ? (
            <span className="if-bval if-lev-target" title={idea.target}>
              {idea.target}
            </span>
          ) : null}
        </span>
        {/* R7 — one-line reasoning preview; the row click opens the full thesis */}
        <span className="if-bc">
          <span className="if-breason" title="click the row for the full thesis">
            {idea.thesis.slice(0, 120)}
          </span>
        </span>
        <span className="if-bc if-bc-age">{relativeTime(idea.createdAt)}</span>
      </div>
    </>
  );
}

// ── TRACKED row (legacy publish pipeline) ──────────────────────────────────────

function TrackedRow({
  card,
  selected,
  onSelect,
}: {
  card: FeedCard;
  /** the selection drives the dock chart AND the idea-detail panel (G3 r5) */
  selected: boolean;
  onSelect: () => void;
}) {
  const life = LIFE_META[card.status] ?? LIFE_META.CLOSED;
  const dir = DIR_META[card.direction] ?? DIR_META.watch;
  const perf = perfOf(card);
  const targets = card.statedLevels.targets;
  return (
    <>
      <div
        className={`if-brow ${life.family}${card.stale ? " stale" : ""}${selected ? " sel" : ""}`}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <span className="if-brail" aria-hidden="true" />
        <span className="if-bc if-bc-tkr">{card.ticker}</span>
        <span className="if-bc">
          <span className={`if-bside ${dir.cls}`} title={dir.title}>
            <span className="if-bside-g" aria-hidden="true">
              {dir.glyph}
            </span>
            {dir.label}
          </span>
        </span>
        <span className="if-bc">
          <span className={`if-life ${life.chip}`} title={card.stale ? (card.evicted ? "archived — live tracking ended" : "stale — quotes not refreshed recently") : undefined}>
            <span className="if-life-dot" aria-hidden="true" />
            {life.label}
            {card.conflict && (
              <span className="if-life-conflict" title="conflicting stated triggers exist for this idea">
                !
              </span>
            )}
          </span>
        </span>
        <span className="if-bc">
          <LevelCell level={card.statedLevels.trigger} cls="if-lev-entry" />
        </span>
        <span className="if-bc">
          {targets.length > 0 ? (
            <span className="if-bval if-lev-target" title={targets[0].text}>
              {targets[0].value != null ? px(targets[0].value) : targets[0].text}
              {targets.length > 1 ? <span className="if-bmore"> +{targets.length - 1}</span> : null}
            </span>
          ) : (
            <Dash title="not stated" />
          )}
        </span>
        <span className="if-bc">
          <LevelCell level={card.statedLevels.invalidation} cls="if-lev-stop" />
        </span>
        <span className="if-bc">
          {perf ? (
            <span className={`if-bpct ${perf.cls}`} title={perf.label}>
              {perf.text}
            </span>
          ) : (
            <Dash
              title={
                card.pnl && card.pnl.kind === "none"
                  ? card.pnl.reason
                  : card.evicted
                    ? "live tracking ended"
                    : "no measurement yet"
              }
            />
          )}
        </span>
        <span className="if-bc if-bc-spark">
          <FeedSpark points={card.priceHistory} tone={sparkTone(card)} />
        </span>
        <span className="if-bc">
          {card.quote ? (
            <span className="if-blast">
              <span className="if-live-dot" aria-hidden="true">
                ◉
              </span>
              {px(card.quote.price)}
            </span>
          ) : (
            <Dash title="no live quote" />
          )}
        </span>
        {/* R7 — one-line reasoning preview; the row click opens the full thesis */}
        <span className="if-bc">
          <span className="if-breason" title="click the row for the full thesis">
            {card.thesis.slice(0, 120)}
          </span>
        </span>
        <span className="if-bc if-bc-age" title="since first mention">
          {relativeTime(card.firstMentionAt)}
        </span>
      </div>
    </>
  );
}

// Chart-dock selection constructors moved to dock/derive.ts (UX2-T4) — the
// blotter rows and the heatmap tiles must build byte-identical selections.

// ── the terminal surface ───────────────────────────────────────────────────────

// R6 — LIVE and TRACKED are different animals and carry different column
// sets: a live call has no measurement, so the measurement columns simply
// don't exist there (no em-dash walls). R7 — both sections spend their
// surplus width on a one-line REASONING preview (muted; row click = full).
const LIVE_COLS = ["TICKER", "SIDE", "STATUS", "ENTRY", "TARGET", "REASONING", "AGE"] as const;
const TRACKED_COLS = [
  "TICKER", "SIDE", "STATUS", "ENTRY", "TARGET", "STOP", "% SINCE CALL", "SPARK", "LAST", "REASONING", "AGE",
] as const;

const SKEL_W = [42, 36, 60, 48, 48, 48, 44, 52, 44, 90, 30];

function ColHead({ cols, live }: { cols: readonly string[]; live?: boolean }) {
  return (
    <div className={`if-bhead${live ? " if-bhead-live" : ""}`} aria-hidden="true">
      {cols.map((c) => (
        <span
          key={c}
          title={
            c === "% SINCE CALL"
              ? "signed vs stated trigger; watch-type rows show price since first mention"
              : undefined
          }
        >
          {c}
        </span>
      ))}
    </div>
  );
}

export default function IdeasFeed() {
  const [feed, setFeed] = useState<FeedPayload | null>(null);
  const [feedErr, setFeedErr] = useState(false);
  const [live, setLive] = useState<PublicIdea[] | null>(null);
  const [liveErr, setLiveErr] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [clock, setClock] = useState("");
  // chart-dock selection (G3) — a row click charts that ticker; defaults to
  // the top LIVE idea once data lands
  const [selection, setSelection] = useState<ChartSelection | null>(null);
  // desk tape (G3 round 4) — fetched here, rendered by the dock's TapeModule
  const [tapeRows, setTapeRows] = useState<PublicTapeEntry[] | null>(null);
  const [tapeErr, setTapeErr] = useState(false);
  // desk wire ingest events (G3 round 5) — redacted counts off /api/wire
  const [ingests, setIngests] = useState<PublicIngest[] | null>(null);
  // ≤700px: the dock hides behind a toggle
  const [dockOpen, setDockOpen] = useState(false);

  const load = useCallback(() => {
    // two independent sources — one failing never blanks the other; a refresh
    // blip never blanks already-live data (sticky-live, no cached fakes)
    fetch("/api/intel/feed", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: FeedPayload) => {
        if (!j || j.ok !== true || !Array.isArray(j.ideas)) throw new Error("malformed");
        setFeed(j);
        setFeedErr(false);
        // UX5 — tracked tickers feed the rain's symbol pool (data already here)
        publishRainSymbols("tracked", j.ideas.map((c) => c.ticker));
      })
      .catch(() => setFeedErr(true));
    fetch("/api/ideas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { ideas?: PublicIdea[] }) => {
        setLive(Array.isArray(j.ideas) ? j.ideas : []);
        setLiveErr(false);
      })
      .catch(() => setLiveErr(true));
    fetch("/api/tape", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { entries?: PublicTapeEntry[] }) => {
        setTapeRows(Array.isArray(j.entries) ? j.entries : []);
        setTapeErr(false);
      })
      .catch(() => setTapeErr(true));
    fetch("/api/wire", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { ingests?: PublicIngest[] }) => {
        setIngests(Array.isArray(j.ingests) ? j.ingests : []);
      })
      .catch(() => {
        // the wire degrades to the three sources the client already holds
        setIngests((prev) => prev ?? []);
      });
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // header clock — live ET, the terminal's heartbeat
  useEffect(() => {
    const fmt = () => {
      try {
        setClock(
          new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "America/New_York",
          }) + " ET",
        );
      } catch {
        setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      }
    };
    fmt();
    const id = window.setInterval(fmt, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const tracked = feed?.ideas ?? [];
  const liveIdeas = live ?? [];
  const trig = tracked.filter((i) => i.status === "TRIGGERED").length;
  const arm = tracked.filter((i) => i.status === "ARMED").length;
  const visible = tracked.filter((i) => matchesFilter(filter, i.status));

  const loading = feed === null && !feedErr && live === null && !liveErr;
  const unreachable = feed === null && feedErr && live === null && liveErr;
  const empty = !loading && !unreachable && liveIdeas.length === 0 && tracked.length === 0;

  // Initial selection (G3 r5): honor a shared ?idea= deep link first — waiting
  // for the store that owns the key if it hasn't answered yet — then default
  // to the top LIVE idea, else the first tracked row. Set once; every later
  // change is a user click.
  useEffect(() => {
    if (selection !== null) return;
    let want: string | null = null;
    try {
      want = new URL(window.location.href).searchParams.get("idea");
    } catch {
      /* no-op */
    }
    if (want?.startsWith("live:")) {
      if (live === null && !liveErr) return; // that store hasn't answered yet
      const i = liveIdeas.find((x) => `live:${x.id}` === want);
      if (i) {
        setSelection(selectionFromLive(i));
        return;
      }
    } else if (want?.startsWith("trk:")) {
      if (feed === null && !feedErr) return;
      const c = tracked.find((x) => `trk:${x.id}` === want);
      if (c) {
        setSelection(selectionFromTracked(c));
        return;
      }
    }
    if (liveIdeas.length > 0) setSelection(selectionFromLive(liveIdeas[0]));
    else if (tracked.length > 0) setSelection(selectionFromTracked(tracked[0]));
  }, [selection, liveIdeas, tracked, live, liveErr, feed, feedErr]);

  // A user selection also lands in the URL (?idea=) so the exact view is
  // shareable — replaceState, not push: row clicks must not stack history.
  const applySelect = useCallback((sel: ChartSelection) => {
    setSelection(sel);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("idea", sel.key);
      window.history.replaceState({}, "", u.toString());
    } catch {
      /* no-op */
    }
  }, []);

  // the wire — merged reverse-chron from the four public sources; null while
  // every source is still pending (skeleton)
  const wireEvents = useMemo(() => {
    if (ingests === null && tapeRows === null && feed === null && live === null) return null;
    return buildWire(ingests ?? [], liveIdeas, tracked, tapeRows ?? []);
  }, [ingests, liveIdeas, tracked, tapeRows, feed, live]);

  // the selected row's full objects for the detail panel
  const selLive =
    selection?.key.startsWith("live:") === true
      ? liveIdeas.find((i) => `live:${i.id}` === selection.key) ?? null
      : null;
  const selCard =
    selection?.key.startsWith("trk:") === true
      ? tracked.find((c) => `trk:${c.id}` === selection.key) ?? null
      : null;

  return (
    <div className="if-feed">
      <div className="if-chrome">
        <div className="if-head">
          <span className="if-brand-dot" aria-hidden="true" />
          <span className="if-wordmark">IDEAS TERMINAL</span>
          <span className="if-head-right">
            <span className="if-statline" role="status">
              {clock ? `${clock} · ` : ""}
              {liveIdeas.length} LIVE · {tracked.length} TRACKED
            </span>
            {/* zero-count chips dim but stay mounted — no CLS when counts land */}
            <span className={`if-count if-count-trig${trig === 0 ? " if-count-zero" : ""}`}>
              {trig > 0 && <span className="if-count-dot" aria-hidden="true" />}
              {trig} TRIG
            </span>
            <span className={`if-count if-count-arm${arm === 0 ? " if-count-zero" : ""}`}>{arm} ARM</span>
            {/* phones only (CSS): the chart dock hides behind this toggle */}
            <button
              type="button"
              className={`if-dock-toggle${dockOpen ? " on" : ""}`}
              aria-expanded={dockOpen}
              onClick={() => setDockOpen((v) => !v)}
            >
              DOCK
            </button>
          </span>
        </div>
        <div className="if-pills" role="tablist" aria-label="Filter tracked ideas by lifecycle">
          <div className="if-pillseg">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={`if-pill${filter === f ? " on" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* G3 — the full-bleed three-zone desk: LEFT chart dock · CENTER
          blotter · RIGHT the page-level Trade Ideas rail (outside this
          surface, untouched). Tablet stacks the dock above the blotter;
          phones hide it behind the DOCK toggle. */}
      <div className="if-desk">
        <aside className={`if-dock${dockOpen ? " open" : ""}`} aria-label="Chart dock">
          <ChartDock
            selection={selection}
            onSelect={applySelect}
            cards={tracked}
            liveIdeas={liveIdeas}
            tape={tapeRows}
            tapeFailed={tapeErr}
            onTapeRetry={load}
          />
        </aside>

        <section className="if-main">
          {loading ? (
            <div className="if-blot-wrap" aria-hidden="true">
              <div className="if-blot-min">
                <ColHead cols={TRACKED_COLS} />
                {[0, 1, 2, 3].map((r) => (
                  <div key={r} className="if-brow if-brow-skel">
                    <span className="if-brail" aria-hidden="true" />
                    {SKEL_W.map((w, i) => (
                      <span key={i} className="if-bc">
                        <span
                          className={`if-skel-bar${i < 2 ? " hi" : ""}`}
                          style={{ width: w, animationDelay: `${i * 0.06}s` }}
                        />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : unreachable ? (
            <div className="if-state">
              <div className="if-state-glyph" aria-hidden="true">
                ·
              </div>
              <div className="if-state-title">FEED UNREACHABLE</div>
              <p className="if-state-copy">The ideas feed could not be loaded.</p>
              <button type="button" className="if-retry" onClick={load}>
                RETRY
              </button>
            </div>
          ) : empty ? (
            <div className="if-state">
              <div className="if-state-glyph" aria-hidden="true">
                ·
              </div>
              <div className="if-state-title">NO IDEAS ON THE BOARD</div>
              <p className="if-state-copy">
                When the desk publishes an idea, it appears here with its stated levels and live
                tracking.
              </p>
            </div>
          ) : (
            <div className="if-blot-wrap">
              <div className="if-blot-min">
                {/* LIVE — the desk's current calls lead the board, on their
                    OWN column set (R6) */}
                {liveIdeas.length > 0 && (
                  <>
                    <div className="if-bgroup hot">
                      <span className="if-bgroup-tick" aria-hidden="true" />
                      <span className="if-bgroup-label">LIVE</span>
                      <span className="if-bgroup-sub">DESK CALLS — CURRENT</span>
                      <span className="if-bgroup-hair" aria-hidden="true" />
                      <span className="if-bgroup-count">
                        {liveIdeas.length} IDEA{liveIdeas.length !== 1 ? "S" : ""}
                      </span>
                    </div>
                    <ColHead cols={LIVE_COLS} live />
                    {liveIdeas.map((idea) => (
                      <LiveRow
                        key={idea.id}
                        idea={idea}
                        selected={selection?.key === `live:${idea.id}`}
                        onSelect={() => applySelect(selectionFromLive(idea))}
                      />
                    ))}
                  </>
                )}
                {liveErr && live === null && (
                  <div className="if-bmiss">
                    LIVE CALLS UNREACHABLE
                    <button type="button" className="if-bmiss-retry" onClick={load}>
                      RETRY
                    </button>
                  </div>
                )}

                {/* TRACKED — the legacy publish pipeline, under the lifecycle filter */}
                <div className="if-bgroup">
                  <span className="if-bgroup-tick dim" aria-hidden="true" />
                  <span className="if-bgroup-label">TRACKED</span>
                  <span className="if-bgroup-sub">SINCE-CALL PERFORMANCE</span>
                  <span className="if-bgroup-hair" aria-hidden="true" />
                  <span className="if-bgroup-count">
                    {visible.length} OF {tracked.length}
                  </span>
                </div>
                {tracked.length > 0 && visible.length > 0 ? <ColHead cols={TRACKED_COLS} /> : null}
                {feed === null && feedErr ? (
                  <div className="if-bmiss">
                    TRACKED FEED UNREACHABLE
                    <button type="button" className="if-bmiss-retry" onClick={load}>
                      RETRY
                    </button>
                  </div>
                ) : tracked.length === 0 ? (
                  <div className="if-bmiss">NOTHING TRACKED YET</div>
                ) : visible.length === 0 ? (
                  <div className="if-bmiss">NO {filter} IDEAS RIGHT NOW</div>
                ) : (
                  visible.map((card) => (
                    <TrackedRow
                      key={card.id}
                      card={card}
                      selected={selection?.key === `trk:${card.id}`}
                      onSelect={() => applySelect(selectionFromTracked(card))}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          {/* G3 r5 — the bottom band fills the center column under the
              blotter: IDEA DETAIL (selection-driven, the one detail surface)
              · DESK WIRE (pipeline activity). Hidden only while the whole
              board is in its empty/unreachable state. */}
          {!loading && !unreachable && !empty ? (
            <div className="if-band">
              <IdeaDetailPanel live={selLive} card={selCard} />
              <DeskWirePanel events={wireEvents} />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
