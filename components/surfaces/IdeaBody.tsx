"use client";

// THE IDEA (feat/v4-1-terminal, design frame 04 "IDEA — target before
// stop?"). ONE anatomy for the idea, rendered in two places: the phone's
// full-screen idea page (IdeasFeed) and the desktop band's IDEA DETAIL panel
// (dock/IdeaDetailPanel). Everything here binds to the wire row (PublicIdea
// from GET /api/ideas), a DELAYED last quote (GET /api/intel/quotes) and,
// on the phone, 1M daily bars (GET /api/intel/bars). Every derived value is
// a pure function in lib/idea-card.ts; this file only lays it out.
//
// Honesty contract (DESIGN_LAWS L2, CLAUDE.md):
//   - the % of the way is CALCULATED and tagged so; when it cannot be
//     computed the card says what is missing ("no stop"), never "0%";
//   - the last price carries its provenance chip (DELAYED, or DATA
//     UNAVAILABLE when the quote route failed) — a number never stands
//     alone as if it were the tape;
//   - the chart draws only real bars with stated levels; no bars → the
//     UNAVAILABLE state, never a placeholder line;
//   - the store keeps ONE evaluation record per row (the latest pass), not a
//     history of transitions, so the design's ACTIVITY list does not render.
//     What does exist — the pass's conclusion, its reason, its price and its
//     time — renders verbatim as LAST PASS;
//   - a number printed from a zone / ladder / condition ("$37–$40") wears
//     the parsed mark (~); the verbatim text is in the LEVELS card;
//   - ARM (no backend) and ASK (no command-bar prefill seam) are cut, see
//     docs/design/V4-1-TERMINAL-NOTES.md.

import { useEffect, useState, type ReactNode } from "react";
import type { PublicIdea } from "@/lib/ideas";
import { relativeTime } from "@/lib/ideas";
import {
  chartGeometry,
  entryLevelOf,
  fmtDay,
  fmtLevel,
  fmtPct,
  levelIsParsed,
  numOf,
  progressLabel,
  progressOf,
  progressTone,
  questionOf,
  sideOf,
  statusOf,
  windowBars,
  type Bar,
  type StatusChip,
} from "@/lib/idea-card";
import { chartSymbolFor } from "@/components/surfaces/dock/derive";
import DataTag from "@/components/DataTag";
import { SETTLE_UTC_LABEL } from "@/lib/settle-cron";

/** the last quote for the idea's instrument, with its honest state:
 *  pending (not asked yet / in flight), ok (a price from the last successful
 *  round), stale (a price, but the route has not answered for a while — it
 *  is shown with its as-of time and nothing is computed from it),
 *  unavailable (the route answered without this symbol, or never answered) */
export type LastQuote = {
  price: number | null;
  state: "pending" | "ok" | "stale" | "unavailable";
  /** when the price was fetched (epoch ms) — carried on ok and stale */
  at?: number;
};
export const NO_QUOTE: LastQuote = { price: null, state: "pending" };

const fmtClockET = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });

const RISK_WORD = { low: "low risk", medium: "medium risk", high: "high risk" } as const;

// ── shared atoms ──────────────────────────────────────────────────────────────

/** the status pill — "Triggered · SEP 9": the flag plus the pass date that
 *  concluded it; a row the pass has not seen carries the bare word */
export function StatusPill({ chip, className = "" }: { chip: StatusChip; className?: string }) {
  return (
    <span className={`v4-pill v4-pill-${chip.tone}${className ? ` ${className}` : ""}`}>
      {chip.label}
      {chip.at != null ? ` · ${fmtDay(chip.at)}` : null}
    </span>
  );
}

/** the ticker tile — tinted by the row's STATUS (the one thing the color
 *  can truthfully encode), not by a per-ticker palette */
export function TickerAvatar({ ticker, chip, size = "s" }: { ticker: string; chip: StatusChip; size?: "s" | "l" }) {
  return (
    <span className={`v4-av v4-av-${size} v4-av-${chip.tone}`} aria-hidden="true">
      {ticker.trim().toUpperCase().slice(0, 5)}
    </span>
  );
}

/** the last price with its provenance: DELAYED (a fresh round), STALE with
 *  its as-of time (the route stopped answering), DATA UNAVAILABLE (no price
 *  for this symbol), or the loading skeleton while the first round is out —
 *  a pending dash would be indistinguishable from a stated absence */
export function LastValue({ q }: { q: LastQuote }) {
  if (q.state === "pending") return <span className="if-skel-bar v4-last-skel" aria-label="loading last price" />;
  if (q.state === "unavailable" || q.price == null)
    return (
      <>
        <span className="v4-abs">—</span> <DataTag kind="unavail" title="the quote route did not answer for this symbol" />
      </>
    );
  if (q.state === "stale")
    return (
      <>
        <b className="v4-ink">{fmtLevel(q.price)}</b>{" "}
        <DataTag kind="stale" detail={q.at ? `as of ${fmtClockET(q.at)} ET` : undefined} title="the quote route has not answered since" />
      </>
    );
  return (
    <>
      <b className="v4-ink">{fmtLevel(q.price)}</b> <DataTag kind="delayed" title="Yahoo quote · 60s server cache" />
    </>
  );
}

// ── the 1M daily chart card (phone) ───────────────────────────────────────────

type BarsPayload = { bars?: Bar[]; freshness?: "live" | "delayed" };

/** bars for one instrument off the existing route; the card owns its own
 *  loading / ready / unavailable state so a failed fetch can never leave a
 *  stale chart standing under a different ticker */
export function IdeaChartCard({ idea }: { idea: PublicIdea }) {
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [bars, setBars] = useState<Bar[]>([]);
  const [freshness, setFreshness] = useState<"live" | "delayed" | null>(null);
  const symbol = chartSymbolFor(idea.instrument);

  useEffect(() => {
    let disposed = false;
    setState("loading");
    setBars([]);
    fetch(`/api/intel/bars?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<BarsPayload>) : null))
      .then((j) => {
        if (disposed) return;
        const all = Array.isArray(j?.bars) ? j!.bars! : [];
        const w = windowBars(all, 31);
        if (w.length < 2) {
          setState("unavailable");
          return;
        }
        setBars(w);
        setFreshness(j?.freshness === "live" ? "live" : "delayed");
        setState("ready");
      })
      .catch(() => {
        if (!disposed) setState("unavailable");
      });
    return () => {
      disposed = true;
    };
  }, [symbol]);

  // the same three numbers the desktop dock chart draws (dock/derive.ts):
  // ENTRY = the pass's parsed trigger when it read one, else the entry text's
  // first price-like numeral; a level off the month's scale is left off the
  // chart by chartGeometry (the LEVELS card still states it verbatim)
  const levels = {
    entry: entryLevelOf(idea) ?? undefined,
    target: numOf(idea.target) ?? undefined,
    stop: numOf(idea.stop) ?? undefined,
  };
  const geom = state === "ready" ? chartGeometry(bars, levels, 338, 160, 8) : null;
  // a level printed from a zone / ladder / condition wears the parsed mark
  const parsed = {
    entry: idea.evaluation?.level != null && idea.evaluation.dir ? false : levelIsParsed(idea.entry, levels.entry ?? null),
    target: levelIsParsed(idea.target, levels.target ?? null),
    stop: levelIsParsed(idea.stop, levels.stop ?? null),
  };

  return (
    <div className="v4-chart">
      {state === "loading" ? (
        <div className="v4-chart-veil" aria-hidden="true">
          <span className="if-skel-bar hi" style={{ width: 120 }} />
        </div>
      ) : null}
      {state === "unavailable" ? (
        <div className="v4-chart-veil v4-chart-unavail" role="status">
          <DataTag kind="unavail" />
          <span className="v4-chart-unavail-t">no daily bars for {idea.instrument.toUpperCase()}</span>
        </div>
      ) : null}
      {geom ? <IdeaLineChart geom={geom} parsed={parsed} dir={chartDirection(idea)} /> : null}
      <div className="v4-chart-foot">
        <span>{geom ? fmtDay(geom.first.t * 1000) : "—"}</span>
        <span className="v4-chart-foot-mid">
          1M · DAILY
          {geom && freshness ? <DataTag kind={freshness} title="Yahoo daily bars · 5m server cache" /> : null}
        </span>
        <span>{geom ? fmtDay(geom.last.t * 1000) : "—"}</span>
      </div>
    </div>
  );
}

/** which way the trade wins — the zones are painted in THAT direction (a
 *  short's win zone is below its target, its loss zone above its stop): the
 *  stated / derived side, else the level ordering, else no zones at all */
function chartDirection(idea: PublicIdea): "long" | "short" | null {
  const s = sideOf(idea);
  if (s?.side === "LONG") return "long";
  if (s?.side === "SHORT") return "short";
  const t = numOf(idea.target);
  const st = numOf(idea.stop);
  if (t != null && st != null && t !== st) return t > st ? "long" : "short";
  return null;
}

/** the design's line + dashed levels + zones, from geometry only */
function IdeaLineChart({
  geom,
  parsed,
  dir,
}: {
  geom: NonNullable<ReturnType<typeof chartGeometry>>;
  parsed: { entry: boolean; target: boolean; stop: boolean };
  dir: "long" | "short" | null;
}) {
  const { width: w, height: h, ys } = geom;
  // win zone = beyond the target in the trade's direction; loss zone = beyond
  // the stop the other way. Without a direction no zone is painted — a tint
  // would be a claim about which way is "good".
  const zones: Array<{ y: number; hgt: number; cls: string }> = [];
  if (dir === "long") {
    if (ys.target != null) zones.push({ y: 0, hgt: Math.max(0, ys.target), cls: "v4-zone-up" });
    if (ys.stop != null) zones.push({ y: ys.stop, hgt: Math.max(0, h - ys.stop), cls: "v4-zone-dn" });
  } else if (dir === "short") {
    if (ys.target != null) zones.push({ y: ys.target, hgt: Math.max(0, h - ys.target), cls: "v4-zone-up" });
    if (ys.stop != null) zones.push({ y: 0, hgt: Math.max(0, ys.stop), cls: "v4-zone-dn" });
  }
  // right-edge labels: one per stated level, pushed apart when two levels
  // sit within a label's height of each other (a range target beside the
  // entry) so neither overprints the other
  const LABEL_H = 13;
  const raw = (["target", "entry", "stop"] as const)
    .filter((k) => ys[k] != null)
    .map((k) => ({ k, y: Math.min(Math.max(ys[k]! - LABEL_H, 0), h - 12) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].y - raw[i - 1].y < LABEL_H) raw[i].y = raw[i - 1].y + LABEL_H;
  }
  for (let i = raw.length - 2; i >= 0; i--) {
    if (raw[i + 1].y > h - 12) raw[i + 1].y = h - 12;
    if (raw[i + 1].y - raw[i].y < LABEL_H) raw[i].y = raw[i + 1].y - LABEL_H;
  }
  return (
    <div className="v4-chart-box">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" className="v4-chart-svg" aria-hidden="true">
        {zones.map((z) => (
          <rect key={z.cls} x="0" y={z.y} width={w} height={z.hgt} className={z.cls} />
        ))}
        {ys.target != null ? <line x1="0" y1={ys.target} x2={w} y2={ys.target} className="v4-lv v4-lv-target" /> : null}
        {ys.entry != null ? <line x1="0" y1={ys.entry} x2={w} y2={ys.entry} className="v4-lv v4-lv-entry" /> : null}
        {ys.stop != null ? <line x1="0" y1={ys.stop} x2={w} y2={ys.stop} className="v4-lv v4-lv-stop" /> : null}
        <polyline points={geom.points} className="v4-line" />
      </svg>
      {raw.map((l) => (
        <span key={l.k} className={`v4-lvl v4-lvl-${l.k}`} style={{ top: `${(l.y / h) * 100}%` }}>
          {parsed[l.k] ? "~" : ""}
          {fmtLevel(numY(geom, ys[l.k]!))}
        </span>
      ))}
    </div>
  );
}

/** invert the y-map to print the level's price beside its line */
function numY(geom: NonNullable<ReturnType<typeof chartGeometry>>, y: number): number {
  const pad = 8;
  const frac = 1 - (y - pad) / (geom.height - pad * 2);
  return geom.min + frac * (geom.max - geom.min);
}

// ── the idea body ─────────────────────────────────────────────────────────────

export default function IdeaBody({
  idea,
  last,
  chart = null,
  compact = false,
}: {
  idea: PublicIdea;
  last: LastQuote;
  /** the phone passes its chart card here; the desktop dock already charts
   *  the selection, so the detail panel passes nothing */
  chart?: ReactNode;
  /** desktop band: tighter type, two-column facts */
  compact?: boolean;
}) {
  const chip = statusOf(idea);
  const q = questionOf(idea);
  const side = sideOf(idea);
  // only a fresh price computes; a stale one is shown, tagged, never used
  const prog = progressOf(idea, last.state === "ok" ? last.price : null);
  const tone = progressTone(prog);
  const ev = idea.evaluation;
  // the meta line prints the entry as the design does — a number; the
  // verbatim entry text lives in the LEVELS card (no double print)
  const entryN = entryLevelOf(idea);
  const entryParsed = ev && ev.level != null && ev.dir ? false : levelIsParsed(idea.entry, entryN);

  return (
    <div className={`v4-idea${compact ? " v4-idea-compact" : ""}`}>
      {/* 1 · avatar + question + meta */}
      <div className="v4-idea-head">
        <TickerAvatar ticker={idea.instrument} chip={chip} size={compact ? "s" : "l"} />
        <div className="v4-idea-headtext">
          <h2 className="v4-idea-q">{q.text}</h2>
          {q.excerpt ? <p className="v4-idea-excerpt">{q.excerpt}</p> : null}
          <p className="v4-idea-meta">
            {side ? (
              <span className={`v4-side v4-side-${side.side.toLowerCase()}${side.derived ? " derived" : ""}`}>
                {side.side === "LONG" ? "Long" : side.side === "SHORT" ? "Short" : "Watch"}
                {/* a derived side says so in words here — the card's tilde is
                    the short form of this line */}
                {side.derived ? <span className="v4-derived-mark"> ~ derived from entry vs target</span> : null}
              </span>
            ) : (
              <span className="v4-abs">no side</span>
            )}
            {" · "}
            {entryN != null ? (
              <>
                entry{" "}
                <b className="v4-ink">
                  {entryParsed ? "~" : ""}
                  {fmtLevel(entryN)}
                </b>
              </>
            ) : idea.entry ? (
              <>
                entry <b className="v4-ink">{idea.entry}</b>
              </>
            ) : (
              <span className="v4-abs">no entry</span>
            )}
            {" · "}
            last <LastValue q={last} />
            {" · "}
            {RISK_WORD[idea.riskLevel]}
          </p>
        </div>
      </div>

      {/* 2 · the odds card: % of the way (CALCULATED) + the phone's chart */}
      <div className="v4-card v4-odds">
        <div className="v4-odds-row">
          <span className={`v4-odds-pct${tone ? ` v4-${tone}` : " v4-mute"}`}>{prog.pct != null ? `${prog.pct}%` : "—"}</span>
          <span className="v4-odds-sub">
            {prog.pct != null && prog.toTargetPct != null && prog.toStopPct != null ? (
              <>
                of the way · {fmtPct(prog.toTargetPct)} to target · {fmtPct(prog.toStopPct)} to stop{" "}
                <DataTag kind="calc" title="(last − stop) / (target − stop), clamped 0–100" />
              </>
            ) : prog.why === "no_last" ? (
              // levels exist; a usable quote is what is missing — the meta
              // line above carries the chip that says why
              last.state === "pending"
                ? "no last price yet"
                : last.state === "stale"
                  ? "last price is stale — nothing computed from it"
                  : "last price unavailable"
            ) : (
              // the odds need both ends of the range; say which is missing in
              // the visitor's language (the owner states levels in the inbox)
              `${progressLabel(prog)} · the odds need a stated target and stop`
            )}
          </span>
        </div>
        {prog.pct != null ? (
          <span className="v4-bar" aria-hidden="true">
            <span className={`v4-bar-fill v4-bar-${tone}`} style={{ width: `${prog.pct}%` }} />
          </span>
        ) : null}
        {chart}
      </div>

      {/* 3 · thesis */}
      <div className="v4-card v4-thesis">
        <span className="v4-card-h">Thesis</span>
        <p className="v4-thesis-p">{idea.thesis}</p>
        <span className="v4-card-foot">
          From the desk · {fmtDay(idea.createdAt)} · evaluated daily at close · next pass {SETTLE_UTC_LABEL}
        </span>
      </div>

      {/* 4 · stated levels — verbatim, absent stays absent */}
      <div className="v4-card v4-levels">
        <span className="v4-card-h">Levels</span>
        <LevelRow k="Entry" v={idea.entry} cls="v4-lv-k-entry" />
        {ev && ev.level != null && ev.dir ? (
          <LevelRow
            k="Trigger"
            v={`${ev.dir} ${fmtLevel(ev.level)}`}
            cls="v4-lv-k-trigger"
            note="parsed from the entry by the daily pass"
          />
        ) : null}
        <LevelRow k="Target" v={idea.target} cls="v4-lv-k-target" />
        <LevelRow k="Stop" v={idea.stop ?? ""} cls="v4-lv-k-stop" />
      </div>

      {/* 5 · the verdict — the one evaluation record the store keeps. Its
          timestamp is when the pass CONCLUDED this (the record is rewritten
          only when the conclusion changes; a sticky TRIGGERED keeps its
          crossing date), so it is dated "concluded", never "last pass". */}
      <div className="v4-card v4-pass">
        <span className="v4-card-h">Verdict</span>
        {ev ? (
          <>
            <div className="v4-pass-row">
              <span className={`v4-status v4-status-${chip.tone}`}>{chip.label}</span>
              <span className="v4-pass-when">
                concluded {fmtDay(ev.at)} · {relativeTime(ev.at)}
              </span>
            </div>
            <p className="v4-pass-reason">{ev.reason}</p>
            <span className="v4-card-foot">
              pass price {ev.price != null ? fmtLevel(ev.price) : <span className="v4-abs">none resolved</span>}
            </span>
          </>
        ) : (
          <span className="v4-card-foot">not yet evaluated — the first pass runs at {SETTLE_UTC_LABEL}</span>
        )}
      </div>
    </div>
  );
}

function LevelRow({ k, v, cls, note }: { k: string; v: string; cls: string; note?: string }) {
  return (
    <div className="v4-lvrow">
      <span className={`v4-lvrow-k ${cls}`}>{k}</span>
      {v ? (
        <span className="v4-lvrow-v">
          {v}
          {note ? <span className="v4-lvrow-note"> · {note}</span> : null}
        </span>
      ) : (
        <span className="v4-abs">not stated</span>
      )}
    </div>
  );
}
