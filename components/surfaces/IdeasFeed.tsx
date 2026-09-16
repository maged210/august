"use client";

// THE TERMINAL (feat/v4-1-terminal — design frames 03 "TERMINAL — the book as
// odds-to-target" and 04 "IDEA"). ONE data source, one card list, for every
// role (chore/terminal-cut):
//
//   LIVE — the published book (GET /api/ideas): the desk's current calls,
//          redacted PublicIdea rows, evaluated daily at the close by the book
//          pass (INTEGRITY-1). They ARE the board.
//   LAST — a DELAYED quote per instrument (GET /api/intel/quotes, the route
//          the dock's heatmap already polls; chunked at its 20-symbol cap so
//          a long book never silently loses its tail).
//   BARS — 1M daily candles for the open idea (GET /api/intel/bars), on the
//          phone's idea page only; the desktop dock charts the selection.
//
// Every derived value (the question, % of the way, the status chip, the
// header stats, the filters) is a pure function in lib/idea-card.ts.
//
// Honesty rules (the law):
// - absent data renders as absent (— / "no stop") — never a dash-as-zero,
//   never a computed placeholder; a computed number carries CALCULATED;
// - a LIVE idea's SIDE renders solid only when the desk STATED one (UX4);
//   otherwise the entry-vs-target derivation shows, marked derived;
// - counts print only once their source has answered;
// - no demo/sample rows; an empty board shows the empty state.
//
// OWNER PARITY (chore/terminal-cut, decision 6): the ONLY owner difference on
// this surface is the ADMIN chip in the header — a link to /admin, nothing
// else. Ingest status lives in /admin.
//
// PHONES (≤700px) render the design: filters, three stat tiles, the card
// list, and a full-screen IDEA page with "‹ Terminal". The M2 segmented
// module strip does not render there any more (the modules are the desktop
// dock's furniture; see docs/design/V4-1-TERMINAL-NOTES.md). Desktop keeps
// its dock modules unchanged; only the cards and the idea detail changed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { relativeTime, type PublicIdea } from "@/lib/ideas";
import { useOwner } from "@/lib/use-owner";
import type { PublicTapeEntry } from "@/lib/tape";
import ChartDock, { type ChartSelection } from "@/components/surfaces/dock/ChartDock";
import DeskWirePanel, { buildWire } from "@/components/surfaces/dock/DeskWirePanel";
import IdeaDetailPanel from "@/components/surfaces/dock/IdeaDetailPanel";
import { chartSymbolFor, selectionFromLive } from "@/components/surfaces/dock/derive";
import IdeaBody, {
  IdeaChartCard,
  LastValue,
  NO_QUOTE,
  StatusPill,
  TickerAvatar,
  type LastQuote,
} from "@/components/surfaces/IdeaBody";
import DataTag from "@/components/DataTag";
import Disclaimer from "@/components/Disclaimer";
import { SETTLE_UTC_LABEL } from "@/lib/settle-cron";
import {
  BOOK_FILTERS,
  bookStats,
  chunkSymbols,
  filterCounts,
  filterIdeas,
  fmtLevel,
  levelIsParsed,
  progressLabel,
  progressOf,
  progressTone,
  questionOf,
  sideOf,
  statusOf,
  type BookFilter,
} from "@/lib/idea-card";
import "@/app/intel/feed.css";

const REFRESH_MS = 60_000; // the book, the tape and the quotes poll together

/** chart symbol → last price, as the quotes route answered */
type QuoteMap = Record<string, number>;
type QuotesState = "pending" | "ok" | "unavailable";

export default function IdeasFeed({
  active = true,
}: {
  /** false while another view is showing — the phone idea page closes so
   *  its scroll lock never outlives the terminal tab */
  active?: boolean;
}) {
  const [live, setLive] = useState<PublicIdea[] | null>(null);
  const [liveErr, setLiveErr] = useState(false);
  // the desk's ONE selection — drives the dock chart AND the detail panel on
  // desktop, and names the open idea page on phones
  const [selection, setSelection] = useState<ChartSelection | null>(null);
  // desk tape — fetched here, rendered by the dock's TapeModule / the wire
  const [tapeRows, setTapeRows] = useState<PublicTapeEntry[] | null>(null);
  const [tapeErr, setTapeErr] = useState(false);
  // the ONE owner truth on this surface: the ADMIN chip (decision 5)
  const isOwner = useOwner();
  // (the tablet DOCK toggle is gone: 701–1179px stacks the dock above the
  // cards and never hid it, so the toggle had nothing to toggle)
  // ≤700px: the phone layout (cards + the full-screen idea page). null until
  // measured — neither layout mounts on the first commit, so a phone never
  // mounts the desktop dock (and its module fetches) for one frame.
  const [phone, setPhone] = useState<boolean | null>(null);
  const phoneRef = useRef(false);
  const [pageOpen, setPageOpen] = useState(false);
  // the element to hand focus back to when the idea page closes (the tapped
  // card sits under visibility:hidden while the page is up)
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [filter, setFilter] = useState<BookFilter>("all");
  // last quotes — DELAYED, chunked at the route's cap; quotesAt is the last
  // SUCCESSFUL round, and a tick each poll lets a price age into STALE when
  // the route stops answering (a price never stands as fresh forever)
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [quotesState, setQuotesState] = useState<QuotesState>("pending");
  const [quotesAt, setQuotesAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const apply = () => {
      phoneRef.current = mq.matches;
      setPhone(mq.matches);
    };
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
    // the poll pauses while the tab is hidden: the terminal latches mounted
    // after its first visit and is only display:none'd after.
    const id = window.setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const liveIdeas = live ?? [];

  const loading = live === null && !liveErr;
  const unreachable = live === null && liveErr;
  // EMPTY is a factual claim about the product, so it requires that the book
  // actually answered — never derived from a failed request.
  const empty = live !== null && liveIdeas.length === 0;

  // ── last quotes ─────────────────────────────────────────────────────────────
  // one DELAYED price per instrument, in ≤20-symbol chunks (the route slices
  // anything longer — the old heatmap call lost its tail past twenty).
  const symChunks = useMemo(() => chunkSymbols(liveIdeas.map((i) => chartSymbolFor(i.instrument))), [liveIdeas]);
  const symKey = symChunks.map((c) => c.join(",")).join("|");
  useEffect(() => {
    if (!symKey) return;
    const chunks = symKey.split("|");
    let cancelled = false;
    const pull = () => {
      Promise.allSettled(
        chunks.map((c) =>
          fetch(`/api/intel/quotes?symbols=${encodeURIComponent(c)}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((j: { quotes?: Record<string, { price?: number }> }) => j.quotes ?? {}),
        ),
      ).then((results) => {
        if (cancelled) return;
        const merged: QuoteMap = {};
        let answered = false;
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          answered = true;
          for (const [sym, q] of Object.entries(r.value)) {
            if (q && Number.isFinite(q.price) && (q.price as number) > 0) merged[sym] = q.price as number;
          }
        }
        if (answered) {
          // sticky-live: a chunk that failed this round keeps its last prices
          // (they age into STALE below); a symbol the route never returns
          // stays absent → DATA UNAVAILABLE on its card
          setQuotes((prev) => ({ ...prev, ...merged }));
          setQuotesState("ok");
          setQuotesAt(Date.now());
        } else {
          setQuotesState((prev) => (prev === "ok" ? "ok" : "unavailable"));
        }
      });
    };
    pull();
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      if (!document.hidden) pull();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symKey]);

  const lastFor = useCallback(
    (idea: PublicIdea): LastQuote => {
      if (quotesState === "pending") return NO_QUOTE;
      const p = quotes[chartSymbolFor(idea.instrument)];
      if (p == null) return { price: null, state: "unavailable" };
      // three missed rounds without an answer: the price is shown with its
      // as-of time and nothing is computed from it
      const stale = quotesAt != null && Date.now() - quotesAt > 3 * REFRESH_MS;
      return { price: p, state: stale ? "stale" : "ok", at: quotesAt ?? undefined };
    },
    // tick re-evaluates staleness every poll even when nothing else changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quotes, quotesState, quotesAt, tick],
  );

  // ── the phone idea page ─────────────────────────────────────────────────────
  // It opens from a tap or a deep-select and closes from its back control /
  // Esc / the OS back gesture / leaving the tab (declared before the effects
  // that reference it). Opening PUSHES a history entry so the browser/OS back
  // gesture closes the page instead of leaving the terminal (L8); the shell's
  // own popstate handler re-derives the view from the URL, which stays
  // ?view=terminal, so the two never fight.
  const pageOpenRef = useRef(false);
  const openPage = useCallback(() => {
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    pageOpenRef.current = true;
    setPageOpen(true);
    try {
      window.history.pushState({ ...(window.history.state ?? {}), v4idea: true }, "", window.location.href);
    } catch {
      /* no-op */
    }
  }, []);
  const finishClose = useCallback(() => {
    pageOpenRef.current = false;
    setPageOpen(false);
    // a tap is not a share: drop the ?idea= the tap wrote so a reload or PWA
    // resume lands on the list, not back inside the page (a real deep link
    // still opens it — it arrives with the page closed)
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("idea")) {
        u.searchParams.delete("idea");
        window.history.replaceState({ ...(window.history.state ?? {}), v4idea: false }, "", u.toString());
      }
    } catch {
      /* no-op */
    }
    const el = returnFocusRef.current;
    returnFocusRef.current = null;
    if (el && typeof el.focus === "function") {
      window.requestAnimationFrame(() => el.focus({ preventScroll: true }));
    }
  }, []);
  const closePage = useCallback(() => {
    // our entry is on top: going back pops it and the popstate handler
    // finishes the close; otherwise close in place
    if (window.history.state?.v4idea) {
      window.history.back();
      return;
    }
    finishClose();
  }, [finishClose]);
  useEffect(() => {
    const onPop = () => {
      if (pageOpenRef.current && !window.history.state?.v4idea) finishClose();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [finishClose]);

  // ── selection ───────────────────────────────────────────────────────────────
  // Initial selection: honor a shared ?idea= deep link first — waiting for
  // the book if it hasn't answered yet — then default to the top idea. Set
  // once; every later change is a user tap. On a phone a deep link also
  // opens the idea page (that is what the link points at); the default
  // selection never does.
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
        if (phoneRef.current) openPage();
        return;
      }
    }
    if (liveIdeas.length > 0) setSelection(selectionFromLive(liveIdeas[0]));
  }, [selection, liveIdeas, live, openPage]);

  // A user selection also lands in the URL (?idea=) so the exact view is
  // shareable — replaceState, not push: card taps must not stack history.
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
  // a later `<TICKER>` command re-selects via this event (chart + card), same
  // as a tap. On a phone that deep-select IS the idea page.
  useEffect(() => {
    const onSelect = (e: Event) => {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key;
      if (typeof key !== "string" || !key.startsWith("live:")) return;
      const i = liveIdeas.find((x) => `live:${x.id}` === key);
      if (i) {
        setSelection(selectionFromLive(i));
        if (phoneRef.current) openPage();
      }
    };
    window.addEventListener("aug:select-idea", onSelect);
    return () => window.removeEventListener("aug:select-idea", onSelect);
  }, [liveIdeas, openPage]);

  // the wire — merged reverse-chron from the two public sources; null while
  // both are still pending (skeleton)
  const wireEvents = useMemo(() => {
    if (tapeRows === null && live === null) return null;
    return buildWire(liveIdeas, tapeRows ?? []);
  }, [liveIdeas, tapeRows, live]);

  // the selected row's full object
  const selLive =
    selection?.key.startsWith("live:") === true
      ? liveIdeas.find((i) => `live:${i.id}` === selection.key) ?? null
      : null;

  // The phone idea page exists only while its idea does. If the poll drops
  // the selected idea (closed/denied in /admin, evicted), the page closes and
  // the list comes back — never a hidden list under an unmounted page.
  const pageShown = phone === true && pageOpen && selection !== null && selLive !== null;
  useEffect(() => {
    if (pageOpen && selLive === null) {
      pageOpenRef.current = false;
      setPageOpen(false);
    }
  }, [pageOpen, selLive]);
  // leaving the terminal tab closes the page: it stays mounted under
  // display:none otherwise, and its html.sheet-open lock would freeze the
  // floor (review finding)
  useEffect(() => {
    if (!active && pageOpenRef.current) {
      pageOpenRef.current = false;
      setPageOpen(false);
    }
  }, [active]);
  const visible = useMemo(() => filterIdeas(liveIdeas, filter), [liveIdeas, filter]);

  const cards =
    visible.length === 0 ? (
      <FilterMiss filter={filter} onAll={() => setFilter("all")} />
    ) : (
      <div className="v4-cards">
        {visible.map((idea) => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            last={lastFor(idea)}
            // the selection ring means "charted in the dock / shown in the
            // detail" — desktop only; on a phone the auto-selection selects
            // nothing visible, so no ring
            selected={phone === false && selection?.key === `live:${idea.id}`}
            onOpen={() => {
              applySelect(selectionFromLive(idea));
              if (phoneRef.current) openPage();
            }}
          />
        ))}
      </div>
    );

  const body = loading ? (
    <SkeletonCards />
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
        When the desk publishes an idea, it appears here with its stated levels, evaluated daily at
        the close.
      </p>
    </div>
  ) : (
    cards
  );

  return (
    <div className="if-feed v4-feed">
      <div className="if-chrome">
        <div className="if-head">
          <span className="if-brand-dot" aria-hidden="true" />
          <span className="if-wordmark">Terminal</span>
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
            {/* a count only prints once its source has actually answered;
                the design's title row carries the count and nothing else
                (the old ET clock decided nothing here — L4) */}
            <span className="if-statline" role="status">
              {live !== null ? `${liveIdeas.length} live` : "— live"}
            </span>
          </span>
        </div>
      </div>

      {phone === null ? (
        // the breakpoint is measured in the first effect — one frame of
        // header only, never the wrong layout's fetches
        <div className="v4-mobile" aria-hidden="true">
          <SkeletonCards />
        </div>
      ) : phone ? (
        // hidden (not unmounted) under the idea page: no scroll, state
        // preserved for the return
        <div className="v4-mobile" style={pageShown ? { visibility: "hidden" } : undefined}>
          <BookHeader ideas={liveIdeas} answered={live !== null} filter={filter} onFilter={setFilter} />
          {body}
        </div>
      ) : (
        <div className="if-desk">
          <aside className="if-dock" aria-label="Chart dock">
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

          <section className="if-main v4-main">
            <BookHeader ideas={liveIdeas} answered={live !== null} filter={filter} onFilter={setFilter} />
            {body}

            {/* the bottom band under the cards: IDEA DETAIL (selection-driven,
                the one detail surface) · DESK WIRE (desk activity). Hidden only
                while the whole board is in its empty/unreachable state. */}
            {!loading && !unreachable && !empty ? (
              <div className="if-band">
                <IdeaDetailPanel live={selLive} last={selLive ? lastFor(selLive) : NO_QUOTE} />
                <DeskWirePanel events={wireEvents} />
              </div>
            ) : null}
          </section>
        </div>
      )}

      {/* the phone's full-screen idea page (design frame 04) */}
      {pageShown && selLive ? <IdeaPage idea={selLive} last={lastFor(selLive)} onBack={closePage} /> : null}

      {/* THE PUBLIC TERMINAL carries the line. This is the surface that
          publishes side / entry / target / stop to every viewer, and it
          closes the whole dock (chart, book heatmap, NQ levels, VIX context,
          tape, wire), so the one row covers the modules inside it as well as
          the cards above it. */}
      <Disclaimer />
    </div>
  );
}

// ── the book header: filters + stat tiles (frame 03) ─────────────────────────

function BookHeader({
  ideas,
  answered,
  filter,
  onFilter,
}: {
  ideas: PublicIdea[];
  /** false while the book is unread — counts print "—", never 0 */
  answered: boolean;
  filter: BookFilter;
  onFilter: (f: BookFilter) => void;
}) {
  const stats = useMemo(() => bookStats(ideas), [ideas]);
  const counts = useMemo(() => filterCounts(ideas), [ideas]);
  return (
    <div className="v4-book-head">
      {/* a toggle group, not tabs: no panel switches, the list re-filters */}
      <div className="v4-filters" role="group" aria-label="Book filters">
        {BOOK_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            className={`v4-filter${filter === f.key ? " on" : ""}${answered && counts[f.key] === 0 ? " zero" : ""}`}
            onClick={() => onFilter(f.key)}
          >
            {f.label}
            {answered ? <span className="v4-filter-n">{counts[f.key]}</span> : null}
          </button>
        ))}
      </div>
      <div className="v4-stats">
        <Stat
          label="Triggered today"
          value={answered ? String(stats.triggeredToday) : "—"}
          tone={answered && stats.triggeredToday > 0 ? "up" : undefined}
          title="sticky TRIGGERED conclusions the daily pass reached on today's ET date"
        />
        <Stat
          label="Book bias"
          value={answered ? `${stats.long} L · ${stats.short} S` : "—"}
          sub={
            answered && (stats.watch > 0 || stats.unsided > 0)
              ? [stats.watch > 0 ? `${stats.watch} watch` : null, stats.unsided > 0 ? `${stats.unsided} without a side` : null]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
        />
        {/* the honest Hobby cadence — one evaluation pass, post-close;
            derived from vercel.json's cron, never restated. "22:10 UTC"
            splits into value + unit so the tile never truncates at 390. */}
        <Stat label="Next eval" value={nextEval.value} sub={nextEval.sub} />
      </div>
    </div>
  );
}

/** "22:10 UTC" → { value: "22:10", sub: "UTC" }; any other label stays whole */
const nextEval = (() => {
  const m = SETTLE_UTC_LABEL.match(/^(\d\d:\d\d) (UTC)$/);
  return m ? { value: m[1], sub: m[2] } : { value: SETTLE_UTC_LABEL, sub: undefined };
})();

function Stat({ label, value, sub, tone, title }: { label: string; value: string; sub?: string; tone?: "up"; title?: string }) {
  return (
    <span className="v4-stat" title={title}>
      <span className="v4-stat-l">{label}</span>
      <span className={`v4-stat-v${tone ? ` v4-${tone}` : ""}`}>{value}</span>
      {sub ? <span className="v4-stat-sub">{sub}</span> : null}
    </span>
  );
}

// ── the idea card (frame 03) ───────────────────────────────────────────────────

function IdeaCard({
  idea,
  last,
  selected,
  onOpen,
}: {
  idea: PublicIdea;
  last: LastQuote;
  selected: boolean;
  onOpen: () => void;
}) {
  const chip = statusOf(idea);
  const q = questionOf(idea);
  const side = sideOf(idea);
  const prog = progressOf(idea, last.state === "ok" ? last.price : null);
  const tone = progressTone(prog);
  return (
    // aria-current, not aria-pressed: the card is the current selection (it
    // drives the dock chart / detail on desktop and opens the page on phones),
    // never a toggle
    <button
      type="button"
      className={`v4-idea-card${selected ? " sel" : ""}`}
      aria-current={selected ? "true" : undefined}
      onClick={onOpen}
    >
      <span className="v4-ic-top">
        <TickerAvatar ticker={idea.instrument} chip={chip} />
        <span className="v4-ic-text">
          <span className="v4-ic-q">{q.text}</span>
          {q.excerpt ? <span className="v4-ic-excerpt">{q.excerpt}</span> : null}
          <span className="v4-ic-meta">
            {side ? (
              <span className={`v4-side v4-side-${side.side.toLowerCase()}${side.derived ? " derived" : ""}`}>
                {side.side === "LONG" ? "Long" : side.side === "SHORT" ? "Short" : "Watch"}
                {side.derived ? <span className="v4-derived-mark"> ~</span> : null}
              </span>
            ) : (
              <span className="v4-abs">no side</span>
            )}
            {" · "}
            <span className={`v4-status v4-status-${chip.tone}`}>{chip.label}</span>
            {" · "}
            {relativeTime(idea.createdAt)}
          </span>
        </span>
        <span className="v4-ic-right">
          <span className={`v4-ic-pct ${tone ? `v4-${tone}` : "v4-mute"}`}>{prog.pct != null ? `${prog.pct}%` : "—"}</span>
          <span className="v4-ic-pl">{progressLabel(prog)}</span>
          {prog.pct != null ? <DataTag kind="calc" title="(last − stop) / (target − stop), clamped 0–100" /> : null}
        </span>
      </span>
      <span className="v4-ic-bottom">
        {/* the track exists only when there is progress to show — an empty
            track under "—" would read as 0% (L2: absent stays absent) */}
        {prog.pct != null ? (
          <span className="v4-bar" aria-hidden="true">
            <span className={`v4-bar-fill v4-bar-${tone}`} style={{ width: `${prog.pct}%` }} />
          </span>
        ) : null}
        <span className="v4-ic-mono">
          {/* a number printed from a zone / ladder wears the parsed mark (~);
              the idea page prints the verbatim text */}
          <span>stop {prog.stop != null ? `${levelIsParsed(idea.stop, prog.stop) ? "~" : ""}${fmtLevel(prog.stop)}` : "—"}</span>
          <span className="v4-ic-last">
            last <LastValue q={last} />
          </span>
          <span>target {prog.target != null ? `${levelIsParsed(idea.target, prog.target) ? "~" : ""}${fmtLevel(prog.target)}` : "—"}</span>
        </span>
      </span>
    </button>
  );
}

function SkeletonCards() {
  return (
    <div className="v4-cards" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="v4-idea-card v4-skel">
          <span className="if-skel-bar hi" style={{ width: 160 }} />
          <span className="if-skel-bar" style={{ width: "70%" }} />
          <span className="if-skel-bar" style={{ width: "100%", height: 6 }} />
        </div>
      ))}
    </div>
  );
}

function FilterMiss({ filter, onAll }: { filter: BookFilter; onAll: () => void }) {
  const label = BOOK_FILTERS.find((f) => f.key === filter)?.label ?? "";
  return (
    <div className="if-state">
      <div className="if-state-glyph" aria-hidden="true">
        ·
      </div>
      <div className="if-state-title">NO {label.toUpperCase()} IDEAS</div>
      <button type="button" className="if-retry" onClick={onAll}>
        SHOW ALL
      </button>
    </div>
  );
}

// ── the phone's idea page (frame 04) ─────────────────────────────────────────

function IdeaPage({ idea, last, onBack }: { idea: PublicIdea; last: LastQuote; onBack: () => void }) {
  const backRef = useRef<HTMLButtonElement | null>(null);
  // page scroll locks under the page; Esc goes back (hardware keyboards exist)
  useEffect(() => {
    document.documentElement.classList.add("sheet-open");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("sheet-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [onBack]);
  // a dialog takes focus: the back control is its first, and the way out
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, [idea.id]);

  const chip = statusOf(idea);
  return (
    <div className="v4-page" role="dialog" aria-modal="true" aria-label={`${idea.instrument} idea`}>
      <div className="v4-page-scroll">
        <div className="v4-page-top">
          <button ref={backRef} type="button" className="v4-back" onClick={onBack}>
            ‹ Terminal
          </button>
          <StatusPill chip={chip} />
        </div>
        <IdeaBody idea={idea} last={last} chart={<IdeaChartCard idea={idea} />} />
        {/* the page publishes a call on its own and covers the feed's row —
            it carries the full line, Terms · Privacy links included */}
        <Disclaimer className="v4-page-disc" />
      </div>
    </div>
  );
}
