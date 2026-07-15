"use client";

// IDEAS FEED — the public, consumer face of the desk. Renders ONLY what
// GET /api/intel/feed serves: owner-published ideas, redacted server-side
// (attribution is the payload's own "AUGUST DESK" string; the payload carries
// zero source identity and this client renders NO source rows, ever).
//
// Honesty rules (the law, inherited from the tracker/publish pipeline):
// - absent data renders as absent (the ∅ "not stated" treatment) — never a
//   dash-as-zero, never a computed placeholder;
// - the performance numeral comes exclusively from the feed's pnl view and is
//   labeled by its kind verbatim (SINCE CALLED / SINCE FIRST MENTION°, the °
//   marking a price move that is NOT trade P&L);
// - sparklines draw only the tracker's real priceHistory ring — fewer than two
//   observations means no line;
// - no demo/sample cards; an empty feed shows the empty state.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedCard } from "@/lib/intel/publish";
import type { PriceSnap, TrackedLevel, TrackedStatus } from "@/lib/intel/tracker";
import type { Direction, TimeHorizon } from "@/lib/intel/types";
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
  neutral: { label: "NEUTRAL", glyph: "◆", cls: "if-dir-neut" },
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

/** one ENTRY/TARGET/STOP column: numeric → level-tinted numeral; stated but
 *  non-numeric → the verbatim condition text; absent → ∅ not stated */
function LevelCol({
  label,
  level,
  cls,
  extra,
}: {
  label: string;
  level: TrackedLevel | null;
  cls: string;
  extra?: number;
}) {
  return (
    <span className="if-lev">
      <span className="if-lev-lab">{label}</span>
      {level == null ? (
        <Absent />
      ) : level.value != null ? (
        <span className={`if-lev-val ${cls}`} title={level.text}>
          {px(level.value)}
          {extra ? <span className="if-lev-more"> +{extra}</span> : null}
        </span>
      ) : (
        <span className={`if-lev-txt ${cls}`} title={level.text}>
          {level.text}
        </span>
      )}
    </span>
  );
}

/** 64×20 sparkline from the tracker's REAL priceHistory ring — never drawn
 *  with fewer than two observations (no flat fake lines) */
function FeedSpark({ points, tone }: { points: PriceSnap[]; tone: "bull" | "bear" }) {
  if (points.length < 2) return null;
  const W = 64;
  const H = 20;
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

// ── the idea card (map-design §2.3 anatomy, top→bottom) ────────────────────────

function IdeaCard({ card, onOpen }: { card: FeedCard; onOpen: () => void }) {
  const life = LIFE_META[card.status] ?? LIFE_META.CLOSED;
  const dir = DIR_META[card.direction] ?? DIR_META.watch;
  const perf = perfOf(card);
  const targets = card.statedLevels.targets;
  return (
    <button type="button" className={`if-card ${life.family}`} onClick={onOpen}>
      <span className="if-rail" aria-hidden="true" />
      <span className="if-r1">
        <span className="if-tkr">{card.ticker}</span>
        <span className={`if-dir ${dir.cls}`} title={dir.title}>
          <span className="if-dir-g" aria-hidden="true">
            {dir.glyph}
          </span>
          {dir.label}
        </span>
        {card.stale && (
          <span
            className="if-stale"
            title={card.evicted ? "live tracking ended — showing last known state" : "quotes not refreshed recently"}
          >
            {card.evicted ? "ARCHIVED" : "STALE"}
          </span>
        )}
        <span className={`if-life ${life.chip}`}>
          <span className="if-life-dot" aria-hidden="true" />
          {life.label}
          {card.conflict && (
            <span className="if-life-conflict" title="conflicting stated triggers exist for this idea">
              !
            </span>
          )}
        </span>
      </span>
      <span className="if-thesis">{card.thesis}</span>
      <span className="if-levels">
        <LevelCol label="ENTRY" level={card.statedLevels.trigger} cls="if-lev-entry" />
        <LevelCol
          label="TARGET"
          level={targets[0] ?? null}
          cls="if-lev-target"
          extra={targets.length > 1 ? targets.length - 1 : undefined}
        />
        <LevelCol label="STOP" level={card.statedLevels.invalidation} cls="if-lev-stop" />
      </span>
      <span className="if-perf">
        <span className="if-perf-main">
          {perf ? (
            <>
              <span className={`if-perf-num ${perf.cls}`}>{perf.text}</span>
              <span className="if-perf-lab">{perf.label}</span>
            </>
          ) : (
            <>
              <span className="if-perf-num">
                {/* an evicted card has no live pnl — "yet" would promise one */}
                <Absent
                  text={
                    card.pnl && card.pnl.kind === "none"
                      ? card.pnl.reason
                      : card.evicted
                        ? "live tracking ended"
                        : "no measurement yet"
                  }
                />
              </span>
              <span className="if-perf-lab">PERFORMANCE</span>
            </>
          )}
        </span>
        <FeedSpark points={card.priceHistory} tone={sparkTone(card)} />
      </span>
      <span className="if-foot">
        <span>
          {card.attribution} · {fmtDate(card.publishedAt)}
        </span>
        {card.quote && (
          <span className="if-foot-live">
            <span className="if-live-dot" aria-hidden="true">
              ◉
            </span>
            {px(card.quote.price)}
          </span>
        )}
      </span>
    </button>
  );
}

// ── bottom-sheet detail (scrim + drag handle; NO source rows, ever) ────────────

function IdeaSheet({ card, onClose }: { card: FeedCard; onClose: () => void }) {
  const life = LIFE_META[card.status] ?? LIFE_META.CLOSED;
  const dir = DIR_META[card.direction] ?? DIR_META.watch;
  const perf = perfOf(card);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragY = useRef<{ start: number; delta: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // drag-to-dismiss on the handle (pointer events cover touch + mouse)
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    dragY.current = { start: e.clientY, delta: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragY.current || !sheetRef.current) return;
    const delta = Math.max(0, e.clientY - dragY.current.start);
    dragY.current.delta = delta;
    sheetRef.current.style.transform = `translateY(${delta}px)`;
  };
  const onPointerEnd = () => {
    const d = dragY.current;
    dragY.current = null;
    if (!sheetRef.current) return;
    if (d && d.delta > 70) {
      onClose();
    } else {
      sheetRef.current.style.transform = "";
    }
  };

  return (
    <>
      <button type="button" className="if-scrim" aria-label="Close detail" onClick={onClose} />
      <div className="if-sheet" role="dialog" aria-modal="true" aria-label={`${card.ticker} idea detail`} ref={sheetRef}>
        <button
          type="button"
          className="if-sheet-handle"
          aria-label="Close detail"
          onClick={onClose}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <span className="if-sheet-grip" aria-hidden="true" />
        </button>
        <div className="if-sheet-body">
          <div className="if-sh-head">
            <span className="if-sh-tkr">{card.ticker}</span>
            <span className={`if-dir ${dir.cls}`} title={dir.title}>
              <span className="if-dir-g" aria-hidden="true">
                {dir.glyph}
              </span>
              {dir.label}
            </span>
            <span className={`if-life ${life.chip}`}>
              <span className="if-life-dot" aria-hidden="true" />
              {life.label}
              {card.conflict && (
                <span className="if-life-conflict" title="conflicting stated triggers exist for this idea">
                  !
                </span>
              )}
            </span>
            {card.stale && (
              <span className="if-stale">{card.evicted ? "ARCHIVED" : "STALE"}</span>
            )}
          </div>
          <div className="if-sh-meta">
            {TF_LABEL[card.timeframe] ?? card.timeframe} · FIRST MENTION {fmtDate(card.firstMentionAt)} · PUBLISHED{" "}
            {fmtDate(card.publishedAt)}
          </div>
          <p className="if-sh-thesis">{card.thesis}</p>

          <div className="if-sh-sect">
            <div className="if-sh-sect-h">STATED LEVELS</div>
            <SheetLevel label="ENTRY" level={card.statedLevels.trigger} cls="if-lev-entry" />
            {card.statedLevels.targets.length === 0 ? (
              <SheetLevel label="TARGET" level={null} cls="if-lev-target" />
            ) : (
              card.statedLevels.targets.map((t, i) => (
                <SheetLevel
                  key={i}
                  label={card.statedLevels.targets.length > 1 ? `TARGET ${i + 1}` : "TARGET"}
                  level={t}
                  cls="if-lev-target"
                />
              ))
            )}
            <SheetLevel label="STOP" level={card.statedLevels.invalidation} cls="if-lev-stop" />
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
                  LAST <span className="if-foot-live" style={{ marginLeft: 0 }}>{px(card.quote.price)}</span> ·{" "}
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
      </div>
    </>
  );
}

function SheetLevel({ label, level, cls }: { label: string; level: TrackedLevel | null; cls: string }) {
  return (
    <div className="if-sh-lev">
      <span className="if-sh-lev-lab">{label}</span>
      {level == null ? (
        <Absent />
      ) : (
        <>
          {level.value != null ? (
            <span className={`if-sh-lev-val ${cls}`}>{px(level.value)}</span>
          ) : (
            <span className={`if-sh-lev-val ${cls}`}>—</span>
          )}
          <span className="if-sh-lev-txt" title={level.text}>
            {level.text}
          </span>
        </>
      )}
    </div>
  );
}

// ── the feed surface ───────────────────────────────────────────────────────────

export default function IdeasFeed({ showDeskLink = false }: { showDeskLink?: boolean }) {
  const [feed, setFeed] = useState<FeedPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/intel/feed", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const j = (await res.json()) as FeedPayload;
      if (!j || j.ok !== true || !Array.isArray(j.ideas)) throw new Error();
      setFeed(j);
      setStatus("live");
    } catch {
      // sticky-live: a refresh blip never blanks an already-live feed; with no
      // data yet we show the honest error state (no cached fakes)
      setStatus((s) => (s === "live" ? "live" : "error"));
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const ideas = feed?.ideas ?? [];
  const trig = ideas.filter((i) => i.status === "TRIGGERED").length;
  const arm = ideas.filter((i) => i.status === "ARMED").length;
  const visible = ideas.filter((i) => matchesFilter(filter, i.status));
  const openCard = openId != null ? ideas.find((i) => i.id === openId) ?? null : null;
  const close = useCallback(() => setOpenId(null), []);

  return (
    <div className="if-feed">
      <div className="if-chrome">
        <div className="if-head">
          <span className="if-brand-dot" aria-hidden="true" />
          <span className="if-wordmark">IDEAS</span>
          <span className="if-head-right">
            {/* zero-count chips dim but stay mounted — no CLS when counts land */}
            <span className={`if-count if-count-trig${trig === 0 ? " if-count-zero" : ""}`}>
              {trig > 0 && <span className="if-count-dot" aria-hidden="true" />}
              {trig} TRIG
            </span>
            <span className={`if-count if-count-arm${arm === 0 ? " if-count-zero" : ""}`}>{arm} ARM</span>
            {showDeskLink && (
              <a className="if-desk-link" href="/intel">
                OPEN DESK →
              </a>
            )}
          </span>
        </div>
        <div className="if-pills" role="tablist" aria-label="Filter ideas by lifecycle">
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

      {status === "loading" && !feed ? (
        <div className="if-list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="if-skel">
              <div className="if-skel-bar hi" style={{ width: "38%" }} />
              <div className="if-skel-bar" style={{ width: "86%" }} />
              <div className="if-skel-bar" style={{ width: "72%" }} />
              <div className="if-skel-bar hi" style={{ width: "30%", height: 18 }} />
            </div>
          ))}
        </div>
      ) : status === "error" && !feed ? (
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
      ) : ideas.length === 0 ? (
        <div className="if-state">
          <div className="if-state-glyph" aria-hidden="true">
            ∅
          </div>
          <div className="if-state-title">NO IDEAS ON THE BOARD</div>
          <p className="if-state-copy">
            When the desk publishes an idea, it appears here with its stated levels and live tracking.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="if-state">
          <div className="if-state-glyph" aria-hidden="true">
            ∅
          </div>
          <div className="if-state-title">NO {filter} IDEAS</div>
          <p className="if-state-copy">Nothing on the board is in this state right now.</p>
        </div>
      ) : (
        <div className="if-list">
          {visible.map((card) => (
            <IdeaCard key={card.id} card={card} onOpen={() => setOpenId(card.id)} />
          ))}
        </div>
      )}

      {openCard && <IdeaSheet card={openCard} onClose={close} />}
    </div>
  );
}
