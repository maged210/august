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
// - a LIVE idea's SIDE is only shown when derivable from its stated entry vs
//   target numerals, and is styled as derived (the model stores no direction);
// - sparklines draw only the tracker's real priceHistory ring — fewer than two
//   observations means no line;
// - no demo/sample rows; an empty board shows the empty state.

import { useCallback, useEffect, useState } from "react";
import type { FeedCard } from "@/lib/intel/publish";
import type { PriceSnap, TrackedLevel, TrackedStatus } from "@/lib/intel/tracker";
import type { Direction, TimeHorizon } from "@/lib/intel/types";
import { relativeTime, type IdeaRiskLevel, type PublicIdea } from "@/lib/ideas";
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
const fmtDate = (ms: number) =>
  new Date(ms)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
const fmtDateTime = (ms: number) =>
  new Date(ms)
    .toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    .toUpperCase();

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

const TF_LABEL: Record<TimeHorizon, string> = {
  intraday: "INTRADAY",
  next_session: "NEXT SESSION",
  swing: "SWING",
  long_term: "LONG-TERM",
  unspecified: "TF NOT STATED",
};

const RISK_LABEL: Record<IdeaRiskLevel, string> = {
  low: "LOW RISK",
  medium: "MED RISK",
  high: "HIGH RISK",
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

/** absent-value treatment — the exact .rd-abs recipe, never a dash-as-zero */
function Absent({ text = "not stated" }: { text?: string }) {
  return (
    <span className="if-abs">
      <span className="if-abs-g" aria-hidden="true">
        ∅
      </span>{" "}
      {text}
    </span>
  );
}

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
  // ° marks a price move since first mention — not trade P&L (desk convention)
  return { text: `${pctFmt(pnl.pct)}°`, label: "SINCE FIRST MENTION", cls };
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

// ── LIVE-idea derivations (PublicIdea stores free-form level STRINGS) ──────────

/** first numeral in a free-form level string ("21,450" / "break of 600") */
function numOf(s: string): number | null {
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return Number.isFinite(v) ? v : null;
}

/** SIDE derived from entry vs target numerals — the model stores no direction,
 *  so this renders in the derived style; null when not derivable (∅) */
function liveSide(idea: PublicIdea): "LONG" | "SHORT" | null {
  const e = numOf(idea.entry);
  const t = numOf(idea.target);
  if (e == null || t == null || e === t) return null;
  return t > e ? "LONG" : "SHORT";
}

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

function LiveRow({ idea, open, onToggle }: { idea: PublicIdea; open: boolean; onToggle: () => void }) {
  const side = liveSide(idea);
  return (
    <>
      <div
        className={`if-brow if-brow-live${open ? " open" : ""}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="if-brail" aria-hidden="true" />
        <span className="if-bc if-bc-tkr">{idea.instrument}</span>
        <span className="if-bc">
          {side ? (
            <span
              className={`if-bside ${side === "LONG" ? "if-dir-bull" : "if-dir-bear"} derived`}
              title="derived from entry vs target — the desk did not state a side"
            >
              <span className="if-bside-g" aria-hidden="true">
                {side === "LONG" ? "▲" : "▼"}
              </span>
              {side}
            </span>
          ) : (
            <Dash title="side not derivable from stated levels" />
          )}
        </span>
        <span className="if-bc">
          <span className="if-live-chip">
            <span className="if-life-dot" aria-hidden="true" />
            LIVE
          </span>
        </span>
        <span className="if-bc">
          <span className="if-bval if-lev-entry" title={idea.entry}>
            {idea.entry}
          </span>
        </span>
        <span className="if-bc">
          <span className="if-bval if-lev-target" title={idea.target}>
            {idea.target}
          </span>
        </span>
        <span className="if-bc">
          <Dash title="no stop stated" />
        </span>
        <span className="if-bc">
          <Dash title="not yet tracked — no since-call measurement" />
        </span>
        <span className="if-bc" />
        <span className="if-bc">
          <Dash title="no live quote for this instrument" />
        </span>
        <span className="if-bc if-bc-age">{relativeTime(idea.createdAt)}</span>
      </div>
      {open && (
        <div className="if-xp">
          <div className="if-sh-meta">
            <span className={`if-risk if-risk-${idea.riskLevel}`}>{RISK_LABEL[idea.riskLevel]}</span> · CALLED{" "}
            {fmtDate(idea.createdAt)}
          </div>
          <p className="if-sh-thesis">{idea.thesis}</p>
          <div className="if-sh-foot">AUGUST DESK</div>
        </div>
      )}
    </>
  );
}

// ── TRACKED row (legacy publish pipeline) ──────────────────────────────────────

function TrackedRow({ card, open, onToggle }: { card: FeedCard; open: boolean; onToggle: () => void }) {
  const life = LIFE_META[card.status] ?? LIFE_META.CLOSED;
  const dir = DIR_META[card.direction] ?? DIR_META.watch;
  const perf = perfOf(card);
  const targets = card.statedLevels.targets;
  return (
    <>
      <div
        className={`if-brow ${life.family}${open ? " open" : ""}${card.stale ? " stale" : ""}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
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
        <span className="if-bc if-bc-age" title="since first mention">
          {relativeTime(card.firstMentionAt)}
        </span>
      </div>
      {open && (
        <div className="if-xp">
          <div className="if-sh-meta">
            {TF_LABEL[card.timeframe] ?? card.timeframe} · FIRST MENTION {fmtDate(card.firstMentionAt)} · PUBLISHED{" "}
            {fmtDate(card.publishedAt)}
            {card.stale ? <span className="if-stale if-xp-stale">{card.evicted ? "ARCHIVED" : "STALE"}</span> : null}
          </div>
          <p className="if-sh-thesis">{card.thesis}</p>

          <div className="if-sh-sect">
            <div className="if-sh-sect-h">STATED LEVELS</div>
            <XpLevel label="ENTRY" level={card.statedLevels.trigger} cls="if-lev-entry" />
            {targets.length === 0 ? (
              <XpLevel label="TARGET" level={null} cls="if-lev-target" />
            ) : (
              targets.map((t, i) => (
                <XpLevel
                  key={i}
                  label={targets.length > 1 ? `TARGET ${i + 1}` : "TARGET"}
                  level={t}
                  cls="if-lev-target"
                />
              ))
            )}
            <XpLevel label="STOP" level={card.statedLevels.invalidation} cls="if-lev-stop" />
          </div>

          <div className="if-sh-sect">
            <div className="if-sh-sect-h">PERFORMANCE</div>
            {perf && card.pnl && card.pnl.kind !== "none" ? (
              <>
                <div className="if-sh-perf">
                  <span className={`if-sh-perf-num ${perf.cls}`}>{perf.text}</span>
                  <span className="if-sh-perf-sub">
                    {perf.label} · basis {px(card.pnl.basis)}
                  </span>
                </div>
                {card.mfeMae && (
                  <div className="if-sh-perf" style={{ marginTop: 8 }}>
                    <span className="if-sh-perf-sub">
                      MFE <span className="if-pos">{pctFmt(card.mfeMae.mfePct)}</span> · MAE{" "}
                      <span className="if-neg">{pctFmt(card.mfeMae.maePct)}</span>
                    </span>
                  </div>
                )}
                {card.pnl.kind === "since_first_mention" && (
                  <p className="if-sh-note">° no stated trigger — price move since first mention, not trade P&L</p>
                )}
              </>
            ) : (
              <Absent
                text={
                  card.pnl && card.pnl.kind === "none"
                    ? card.pnl.reason
                    : card.evicted
                      ? "live tracking ended"
                      : "no measurement yet"
                }
              />
            )}
            {card.quote && (
              <div className="if-sh-perf" style={{ marginTop: 10 }}>
                <span className="if-sh-perf-sub">
                  LAST <span className="if-blast" style={{ marginLeft: 0 }}>{px(card.quote.price)}</span> ·{" "}
                  <span className={card.quote.chgPct >= 0 ? "if-pos" : "if-neg"}>{pctFmt(card.quote.chgPct)}</span> TODAY
                </span>
              </div>
            )}
          </div>

          <div className="if-sh-sect">
            <div className="if-sh-sect-h">STATUS HISTORY</div>
            {card.statusHistory.length > 0 ? (
              <ul className="if-sh-hist">
                {card.statusHistory.map((h, i) => (
                  <li key={i}>
                    <span className="if-sh-hist-top">
                      <span>{LIFE_META[h.state]?.label ?? h.state}</span>
                      {h.price != null && <span>@ {px(h.price)}</span>}
                      <span className="if-sh-hist-at">{fmtDateTime(h.at)}</span>
                    </span>
                    <span className="if-sh-hist-reason">{h.reason}</span>
                  </li>
                ))}
              </ul>
            ) : card.evicted ? (
              <Absent text="live tracking ended — last known state shown above" />
            ) : (
              <Absent text="no transitions observed yet" />
            )}
          </div>

          <div className="if-sh-foot">{card.attribution}</div>
        </div>
      )}
    </>
  );
}

function XpLevel({ label, level, cls }: { label: string; level: TrackedLevel | null; cls: string }) {
  return (
    <div className="if-sh-lev">
      <span className="if-sh-lev-lab">{label}</span>
      {level == null ? (
        <Absent />
      ) : (
        <>
          <span className={`if-sh-lev-val ${cls}`}>{level.value != null ? px(level.value) : "—"}</span>
          <span className="if-sh-lev-txt" title={level.text}>
            {level.text}
          </span>
        </>
      )}
    </div>
  );
}

// ── the terminal surface ───────────────────────────────────────────────────────

const BLOT_COLS = [
  "TICKER", "SIDE", "STATUS", "ENTRY", "TARGET", "STOP", "% SINCE CALL", "SPARK", "LAST", "AGE",
] as const;

const SKEL_W = [42, 36, 60, 48, 48, 48, 44, 52, 44, 30];

export default function IdeasFeed() {
  const [feed, setFeed] = useState<FeedPayload | null>(null);
  const [feedErr, setFeedErr] = useState(false);
  const [live, setLive] = useState<PublicIdea[] | null>(null);
  const [liveErr, setLiveErr] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  // one expansion at a time; keys are namespaced so the two sections can't collide
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [clock, setClock] = useState("");

  const load = useCallback(() => {
    // two independent sources — one failing never blanks the other; a refresh
    // blip never blanks already-live data (sticky-live, no cached fakes)
    fetch("/api/intel/feed", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: FeedPayload) => {
        if (!j || j.ok !== true || !Array.isArray(j.ideas)) throw new Error("malformed");
        setFeed(j);
        setFeedErr(false);
      })
      .catch(() => setFeedErr(true));
    fetch("/api/ideas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { ideas?: PublicIdea[] }) => {
        setLive(Array.isArray(j.ideas) ? j.ideas : []);
        setLiveErr(false);
      })
      .catch(() => setLiveErr(true));
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

  const toggle = (key: string) => setOpenKey((k) => (k === key ? null : key));

  const colhead = (
    <div className="if-bhead" aria-hidden="true">
      {BLOT_COLS.map((c) => (
        <span key={c} title={c === "% SINCE CALL" ? "signed vs stated trigger; ° = price since first mention" : undefined}>
          {c}
        </span>
      ))}
    </div>
  );

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

      {loading ? (
        <div className="if-blot-wrap" aria-hidden="true">
          <div className="if-blot-min">
            {colhead}
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
            ∅
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
            ∅
          </div>
          <div className="if-state-title">NO IDEAS ON THE BOARD</div>
          <p className="if-state-copy">
            When the desk publishes an idea, it appears here with its stated levels and live tracking.
          </p>
        </div>
      ) : (
        <div className="if-blot-wrap">
          <div className="if-blot-min">
            {colhead}

            {/* LIVE — the desk's current calls lead the board */}
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
                {liveIdeas.map((idea) => (
                  <LiveRow
                    key={idea.id}
                    idea={idea}
                    open={openKey === `live:${idea.id}`}
                    onToggle={() => toggle(`live:${idea.id}`)}
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
                  open={openKey === `trk:${card.id}`}
                  onToggle={() => toggle(`trk:${card.id}`)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
