"use client";

// IDEAS TERMINAL — the terminal for every role (chore/terminal-cut). One data
// source, one grid:
//
//   LIVE — the published book (GET /api/ideas): the desk's current calls,
//          redacted PublicIdea rows, evaluated daily at the close by the book
//          pass (INTEGRITY-1). They ARE the board.
//
// The TRACKED lane (the retired desk's publish pipeline, /api/intel/feed) is
// gone with the desk: no sub-nav row, no tracked section, no second store.
//
// Grid columns: TICKER · SIDE · STATUS · ENTRY · TARGET · REASONING · AGE.
// A row click selects the idea for the chart dock and the detail panel.
//
// Honesty rules (the law):
// - absent data renders as absent (∅ / —) — never a dash-as-zero, never a
//   computed placeholder;
// - a LIVE idea's SIDE renders solid only when the desk STATED one (UX4:
//   extraction inference or /admin); otherwise the entry-vs-target derivation
//   shows, styled as derived — never presented as stated;
// - no demo/sample rows; an empty board shows the empty state.
//
// OWNER PARITY (chore/terminal-cut, decision 6): the ONLY owner difference on
// this surface is the ADMIN chip in the header — a link to /admin, nothing
// else. Ingest status lives in /admin.

import { useCallback, useEffect, useMemo, useState } from "react";
import { relativeTime, type PublicIdea } from "@/lib/ideas";
import { useOwner } from "@/lib/use-owner";
import type { PublicTapeEntry } from "@/lib/tape";
import ChartDock, { type ChartSelection } from "@/components/surfaces/dock/ChartDock";
import NqLevelsModule from "@/components/surfaces/dock/NqLevelsModule";
import VixContextModule from "@/components/surfaces/dock/VixContextModule";
import BookHeatmapModule from "@/components/surfaces/dock/BookHeatmapModule";
import DeskWirePanel, { buildWire } from "@/components/surfaces/dock/DeskWirePanel";
import IdeaChartModule from "@/components/surfaces/dock/IdeaChartModule";
import IdeaDetailPanel from "@/components/surfaces/dock/IdeaDetailPanel";
import MarketPulseModule from "@/components/surfaces/dock/MarketPulseModule";
import TapeModule from "@/components/surfaces/dock/TapeModule";
import { selectionFromLive, sideOf } from "@/components/surfaces/dock/derive";
import "@/app/intel/feed.css";
import Disclaimer from "@/components/Disclaimer";
import { SETTLE_UTC_LABEL } from "@/lib/settle-cron";

const REFRESH_MS = 60_000; // the book and the tape poll together

// INTEGRITY-1 — the truth chip for a published idea: the daily book pass's
// conclusion replaces the old blanket LIVE. ARMED (crossable trigger stated,
// fresh, uncrossed) still reads LIVE — it is; the other conclusions say what
// is actually true. A row the pass hasn't seen yet keeps plain LIVE.
function liveStatusChip(idea: PublicIdea): { label: string; cls: string; title?: string } {
  const ev = idea.evaluation;
  if (!ev || ev.state === "ARMED") return { label: "LIVE", cls: "if-live-chip", title: ev?.reason };
  if (ev.state === "TRIGGERED")
    return { label: "TRIGGERED", cls: "if-life if-life-trig", title: ev.reason };
  if (ev.state === "STALE") return { label: "STALE", cls: "if-life if-life-exp", title: ev.reason };
  if (ev.state === "QUOTE_SUSPECT")
    // DESK-INBOX — the quote can't be trusted against the stated level (split/
    // symbol mismatch); saying NEEDS LEVEL would misname the problem
    return { label: "QUOTE SUSPECT", cls: "if-life if-life-exp", title: ev.reason };
  return { label: "NEEDS LEVEL", cls: "if-life if-life-act", title: ev.reason };
}

// LIVE-idea derivations (numOf / liveSide) live in dock/derive.ts — shared
// with the chart dock so SIDE logic can never drift between grid and chart.

// ── LIVE row ───────────────────────────────────────────────────────────────────

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
          {(() => {
            const chip = liveStatusChip(idea);
            return (
              <span className={chip.cls} title={chip.title}>
                {chip.label === "LIVE" ? <span className="if-life-dot" aria-hidden="true" /> : null}
                {chip.label}
              </span>
            );
          })()}
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
        {/* R3 polish — absent TARGET matches absent ENTRY's treatment (audit:
            two different absences in adjacent cells) */}
        <span className="if-bc">
          {idea.target ? (
            <span className="if-bval if-lev-target" title={idea.target}>
              {idea.target}
            </span>
          ) : (
            <span className="if-abs-g" title="no target stated">
              ·
            </span>
          )}
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

// ── the terminal surface ───────────────────────────────────────────────────────

// R6/R7 — a live call has no measurement columns; the surplus width goes to a
// one-line REASONING preview (muted; row click = full).
const LIVE_COLS = ["TICKER", "SIDE", "STATUS", "ENTRY", "TARGET", "REASONING", "AGE"] as const;

const SKEL_W = [42, 36, 60, 48, 48, 90, 30];

function ColHead({ cols }: { cols: readonly string[] }) {
  return (
    <div className="if-bhead if-bhead-live" aria-hidden="true">
      {cols.map((c) => (
        <span key={c}>{c}</span>
      ))}
    </div>
  );
}

export default function IdeasFeed() {
  const [live, setLive] = useState<PublicIdea[] | null>(null);
  const [liveErr, setLiveErr] = useState(false);
  const [clock, setClock] = useState("");
  // chart-dock selection (G3) — a row click charts that ticker; defaults to
  // the top LIVE idea once data lands
  const [selection, setSelection] = useState<ChartSelection | null>(null);
  // desk tape (G3 round 4) — fetched here, rendered by the dock's TapeModule
  const [tapeRows, setTapeRows] = useState<PublicTapeEntry[] | null>(null);
  const [tapeErr, setTapeErr] = useState(false);
  // the ONE owner truth on this surface: the ADMIN chip (decision 5)
  const isOwner = useOwner();
  // ≤700px: the dock hides behind a toggle (tablet band 701–1179 keeps it)
  const [dockOpen, setDockOpen] = useState(false);
  // M2 — the PHONE redesign: at ≤700px the blotter does not render; the desk
  // becomes a segmented module strip + stacked cards + a full-screen sheet.
  const [phone, setPhone] = useState(false);
  const [seg, setSeg] = useState<"chart" | "book" | "levels" | "pulse" | "tape" | "wire">("chart");
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const apply = () => setPhone(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const load = useCallback(() => {
    // two independent sources — one failing never blanks the other; a refresh
    // blip never blanks already-live data (sticky-live, no cached fakes)
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
  }, []);

  useEffect(() => {
    load();
    // fix/p0-live-trust — the poll pauses while the tab is hidden. The
    // terminal latches mounted after its first visit and is only
    // display:none'd after, so an unconditional interval would keep every
    // visitor tab that ever touched TERMINAL polling forever.
    const id = window.setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
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

  const liveIdeas = live ?? [];

  const loading = live === null && !liveErr;
  const unreachable = live === null && liveErr;
  // EMPTY is a factual claim about the product, so it requires that the book
  // actually answered — never derived from a failed request.
  const empty = live !== null && liveIdeas.length === 0;

  // Initial selection (G3 r5): honor a shared ?idea= deep link first — waiting
  // for the book if it hasn't answered yet — then default to the top LIVE
  // idea. Set once; every later change is a user click.
  useEffect(() => {
    if (selection !== null) return;
    if (live === null) return; // the book hasn't answered yet
    let want: string | null = null;
    try {
      want = new URL(window.location.href).searchParams.get("idea");
    } catch {
      /* no-op */
    }
    if (want?.startsWith("live:")) {
      const i = liveIdeas.find((x) => `live:${x.id}` === want);
      if (i) {
        setSelection(selectionFromLive(i));
        return;
      }
    }
    if (liveIdeas.length > 0) setSelection(selectionFromLive(liveIdeas[0]));
  }, [selection, liveIdeas, live]);

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

  // COMMAND-BAR ticker jump — the initial-selection effect above runs ONCE, so
  // a later `<TICKER>` command re-selects via this event (chart + row), same
  // as a row click. Every role gets this seam (decision 6).
  useEffect(() => {
    const onSelect = (e: Event) => {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key;
      if (typeof key !== "string" || !key.startsWith("live:")) return;
      const i = liveIdeas.find((x) => `live:${x.id}` === key);
      if (i) setSelection(selectionFromLive(i));
    };
    window.addEventListener("aug:select-idea", onSelect);
    return () => window.removeEventListener("aug:select-idea", onSelect);
  }, [liveIdeas]);

  // the wire — merged reverse-chron from the two public sources; null while
  // both are still pending (skeleton)
  const wireEvents = useMemo(() => {
    if (tapeRows === null && live === null) return null;
    return buildWire(liveIdeas, tapeRows ?? []);
  }, [liveIdeas, tapeRows, live]);

  // the selected row's full object for the detail panel
  const selLive =
    selection?.key.startsWith("live:") === true
      ? liveIdeas.find((i) => `live:${i.id}` === selection.key) ?? null
      : null;

  // M2 — the phone sheet exists only while its idea does. If the poll drops
  // the selected idea (closed/denied in /admin, evicted), the sheet closes
  // and the body comes back — never a hidden body under an unmounted sheet
  // (review finding).
  const sheetShown = phone && sheetOpen && selection !== null && selLive !== null;
  useEffect(() => {
    if (sheetOpen && selLive === null) setSheetOpen(false);
  }, [sheetOpen, selLive]);

  return (
    <div className="if-feed">
      <div className="if-chrome">
        <div className="if-head">
          <span className="if-brand-dot" aria-hidden="true" />
          <span className="if-wordmark">IDEAS TERMINAL</span>
          <span className="if-head-right">
            {/* decision 5 — the one owner difference on the terminal: a link
                to /admin, no controls. FIRST child of the right-anchored
                cluster, so its presence grows into the free space on the left
                and never moves the statline or the DOCK toggle: owner and
                visitor render pixel-identical except for this chip. Below
                340px feed.css hides it rather than squeeze the statline. */}
            {isOwner ? (
              <a className="if-admin-chip" href="/admin">
                ADMIN
              </a>
            ) : null}
            {/* a count only prints once its source has actually answered */}
            <span className="if-statline" role="status">
              {clock ? `${clock} · ` : ""}
              {live !== null ? `${liveIdeas.length} LIVE` : "— LIVE"}
            </span>
            {/* tablets only — phones get the segmented strip instead (M2) */}
            {!phone ? (
              <button
                type="button"
                className={`if-dock-toggle${dockOpen ? " on" : ""}`}
                aria-expanded={dockOpen}
                onClick={() => setDockOpen((v) => !v)}
              >
                DOCK
              </button>
            ) : null}
          </span>
        </div>
      </div>

      {/* M2 — PHONE: segmented modules + stacked cards + full-screen sheet.
          The desktop/tablet desk below does not render at all here. */}
      {phone ? (
        // hidden (not unmounted) under the sheet: no double-rendered chart
        // behind it, no scroll, state preserved for the return
        <div className="if-mobile" style={sheetShown ? { visibility: "hidden" } : undefined}>
          <div className="if-seg" role="tablist" aria-label="Desk modules">
            {(
              [
                ["chart", "CHART"],
                ["book", "BOOK"],
                ["levels", "LEVELS"],
                ["pulse", "PULSE"],
                ["tape", "TAPE"],
                ["wire", "WIRE"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={seg === id}
                className={`if-seg-btn${seg === id ? " on" : ""}`}
                onClick={() => setSeg(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="if-seg-body">
            {seg === "chart" ? <IdeaChartModule selection={selection} /> : null}
            {seg === "book" ? (
              <BookHeatmapModule
                liveIdeas={liveIdeas}
                sourcesAnswered={live !== null}
                selection={selection}
                onSelect={applySelect}
              />
            ) : null}
            {seg === "levels" ? (<><NqLevelsModule liveIdeas={liveIdeas} /><VixContextModule /></>) : null}
            {seg === "pulse" ? <MarketPulseModule /> : null}
            {seg === "tape" ? (
              <TapeModule entries={tapeRows} failed={tapeErr} onRetry={load} />
            ) : null}
            {seg === "wire" ? <DeskWirePanel events={wireEvents} /> : null}
          </div>

          {loading ? (
            <div className="if-mcards" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="if-mcard">
                  <span className="if-skel-bar hi" style={{ width: 90 }} />
                  <span className="if-skel-bar" style={{ width: "80%" }} />
                </div>
              ))}
            </div>
          ) : unreachable ? (
            <div className="if-state">
              <div className="if-state-glyph" aria-hidden="true">
                ·
              </div>
              <div className="if-state-title">BOOK UNREACHABLE</div>
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
            </div>
          ) : (
            <div className="if-mcards">
              <div className="if-mgroup" title={`evaluated daily at close · next pass ${SETTLE_UTC_LABEL}`}>
                {`LIVE — EVALUATED DAILY AT CLOSE · ${SETTLE_UTC_LABEL}`}
              </div>
              {liveIdeas.map((idea) => (
                <MobileCard
                  key={idea.id}
                  selected={selection?.key === `live:${idea.id}`}
                  onOpen={() => {
                    applySelect(selectionFromLive(idea));
                    setSheetOpen(true);
                  }}
                  ticker={idea.instrument}
                  side={sideOf(idea)}
                  statusChip={liveStatusChip(idea)}
                  entry={idea.entry}
                  reason={idea.thesis}
                  age={relativeTime(idea.createdAt)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
      <div className="if-desk">
        <aside className={`if-dock${dockOpen ? " open" : ""}`} aria-label="Chart dock">
          <ChartDock
            selection={selection}
            onSelect={applySelect}
            liveIdeas={liveIdeas}
            sourcesAnswered={live !== null}
            tape={tapeRows}
            tapeFailed={tapeErr}
            onTapeRetry={load}
          />
        </aside>

        <section className="if-main">
          {loading ? (
            <div className="if-blot-wrap" aria-hidden="true">
              <div className="if-blot-min">
                <ColHead cols={LIVE_COLS} />
                {[0, 1, 2, 3].map((r) => (
                  <div key={r} className="if-brow if-brow-live if-brow-skel">
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
              <div className="if-state-title">BOOK UNREACHABLE</div>
              <p className="if-state-copy">The ideas book could not be loaded.</p>
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
                When the desk publishes an idea, it appears here with its stated levels, evaluated
                daily at the close.
              </p>
            </div>
          ) : (
            <div className="if-blot-wrap">
              <div className="if-blot-min">
                <div className="if-bgroup hot">
                  <span className="if-bgroup-tick" aria-hidden="true" />
                  <span className="if-bgroup-label">LIVE</span>
                  {/* the honest Hobby cadence — one evaluation pass, post-close */}
                  <span className="if-bgroup-sub">
                    {`DESK CALLS — EVALUATED DAILY AT CLOSE · NEXT PASS ${SETTLE_UTC_LABEL}`}
                  </span>
                  <span className="if-bgroup-hair" aria-hidden="true" />
                  <span className="if-bgroup-count">
                    {liveIdeas.length} IDEA{liveIdeas.length !== 1 ? "S" : ""}
                  </span>
                </div>
                <ColHead cols={LIVE_COLS} />
                {liveIdeas.map((idea) => (
                  <LiveRow
                    key={idea.id}
                    idea={idea}
                    selected={selection?.key === `live:${idea.id}`}
                    onSelect={() => applySelect(selectionFromLive(idea))}
                  />
                ))}
              </div>
            </div>
          )}

          {/* G3 r5 — the bottom band fills the center column under the
              blotter: IDEA DETAIL (selection-driven, the one detail surface)
              · DESK WIRE (desk activity). Hidden only while the whole board
              is in its empty/unreachable state. */}
          {!loading && !unreachable && !empty ? (
            <div className="if-band">
              <IdeaDetailPanel live={selLive} />
              <DeskWirePanel events={wireEvents} />
            </div>
          ) : null}
        </section>
      </div>
      )}

      {/* M2 — the full-screen idea detail sheet (phone) */}
      {sheetShown && selection && selLive ? (
        <MobileIdeaSheet selection={selection} live={selLive} onClose={() => setSheetOpen(false)} />
      ) : null}

      {/* THE PUBLIC TERMINAL carries the line. This is the surface that
          publishes side / entry / target / stop to every viewer, and it
          closes the whole dock (chart, book heatmap, NQ levels, VIX context,
          tape, wire), so the one row covers the modules inside it as well as
          the blotter above it. */}
      <Disclaimer />
    </div>
  );
}

// ── M2 · the phone card (rail-card pattern) ───────────────────────────────────

function MobileCard({
  ticker,
  side,
  statusChip,
  entry,
  reason,
  age,
  selected,
  onOpen,
}: {
  ticker: string;
  side: { side: "LONG" | "SHORT" | "WATCH" | "NEUT"; derived: boolean } | null;
  /** title carries the evaluation's honest reason (INTEGRITY-1) when present */
  statusChip: { label: string; cls: string; title?: string };
  entry: string;
  reason: string;
  age: string;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={`if-mcard${selected ? " sel" : ""}`} onClick={onOpen}>
      <span className="if-mcard-top">
        <span className="if-mcard-tkr">{ticker}</span>
        {side ? (
          <span
            className={`if-bside ${
              side.side === "LONG" ? "if-dir-bull" : side.side === "SHORT" ? "if-dir-bear" : "if-dir-neut"
            }${side.derived ? " derived" : ""}`}
          >
            <span className="if-bside-g" aria-hidden="true">
              {side.side === "LONG" ? "▲" : side.side === "SHORT" ? "▼" : "◆"}
            </span>
            {side.side}
          </span>
        ) : null}
        <span className={statusChip.cls} title={statusChip.title}>
          <span className="if-life-dot" aria-hidden="true" />
          {statusChip.label}
        </span>
        <span className="if-mcard-age">{age}</span>
      </span>
      {entry ? (
        <span className="if-mcard-entry">
          <span className="if-mcard-entry-k">ENTRY</span> {entry}
        </span>
      ) : null}
      <span className="if-mcard-reason">{reason.slice(0, 110)}</span>
    </button>
  );
}

// ── M2 · the full-screen idea detail sheet ────────────────────────────────────

function MobileIdeaSheet({
  selection,
  live,
  onClose,
}: {
  selection: ChartSelection;
  live: PublicIdea;
  onClose: () => void;
}) {
  // page scroll locks under the sheet; Esc closes (hardware keyboards exist)
  useEffect(() => {
    document.documentElement.classList.add("sheet-open");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("sheet-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const side = sideOf(live);

  return (
    <div className="im-sheet intel-embed-frame" role="dialog" aria-modal="true" aria-label={`${selection.ticker} detail`}>
      <button type="button" className="im-close" onClick={onClose} aria-label="Close idea detail">
        ✕
      </button>
      <div className="im-scroll">
        {/* 1 · the chart — entry/target lines ride the existing module; ~40dvh via CSS */}
        <div className="im-chart">
          <IdeaChartModule selection={selection} />
        </div>

        {/* 2 · entry chip · side · risk · age */}
        <div className="im-meta">
          {live.entry ? (
            <span className="if-entry-hero">
              <span className="if-entry-hero-k">ENTRY</span>
              <span className="if-entry-hero-v">{live.entry}</span>
            </span>
          ) : null}
          <span className="im-meta-row">
            {side ? (
              <span
                className={`if-bside ${
                  side.side === "LONG" ? "if-dir-bull" : side.side === "SHORT" ? "if-dir-bear" : "if-dir-neut"
                }${side.derived ? " derived" : ""}`}
              >
                {side.side}
              </span>
            ) : null}
            <span className="if-risk">{live.riskLevel.toUpperCase()} RISK</span>
            <span className="im-age">{relativeTime(live.createdAt)}</span>
          </span>
        </div>

        {/* 3 · the full thesis */}
        <p className="im-thesis">{live.thesis}</p>

        {/* 4 · compact facts — only what exists */}
        <div className="im-facts">
          {live.target ? <FactRow k="TARGET" v={live.target} cls="if-lev-target" /> : null}
          {live.stop ? <FactRow k="STOP" v={live.stop} cls="if-lev-stop" /> : null}
        </div>
      </div>
    </div>
  );
}

function FactRow({ k, v, cls }: { k: string; v: string; cls: string }) {
  return (
    <span className="im-fact">
      <span className="im-fact-k">{k}</span>
      <span className={`im-fact-v ${cls}`}>{v}</span>
    </span>
  );
}
