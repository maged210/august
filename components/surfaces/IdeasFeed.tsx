"use client";

// THE TERMINAL (feat/v4-1-terminal — design frames 03 "TERMINAL — the book as
// odds-to-target" and 04 "IDEA"). ONE data source, one card list, for every
// role (chore/terminal-cut):
//
//   LIVE — the published book (GET /api/ideas): the desk's current calls,
//          redacted PublicIdea rows, evaluated daily at the close by the book
//          pass (INTEGRITY-1). They ARE the board.
//   LAST — a DELAYED quote per instrument (GET /api/intel/quotes), chunked at
//          the route's 20-symbol cap, merged into ONE quote book with a
//          per-symbol freshness policy (lib/idea-card mergeQuoteRound /
//          readQuote). The dock's heatmap reads the same book — one fetch,
//          one policy, so a failed batch is UNAVAILABLE in both places.
//   BARS — 1M daily candles for the open idea (GET /api/intel/bars), on the
//          phone's idea page only; the desktop dock charts the selection.
//
// Every derived value (the question, the headline metric — distance to
// trigger / % of the way — the status chip, the header stats, the filters)
// is a pure function in lib/idea-card.ts.
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
  headlineOf,
  headlineTone,
  levelIsParsed,
  mergeQuoteRound,
  progressOf,
  questionOf,
  readQuote,
  sideOf,
  statusOf,
  statusText,
  type BookFilter,
  type QuoteBatch,
  type QuoteBook,
  type QuoteRead,
} from "@/lib/idea-card";
import "@/app/intel/feed.css";

const REFRESH_MS = 60_000; // the book, the tape and the quotes poll together
/** a symbol answered longer ago than this reads UNAVAILABLE even if no newer
 *  round has failed — a stalled poll (a hidden tab) must not keep a price
 *  standing as DELAYED */
const QUOTE_MAX_AGE_MS = 3 * REFRESH_MS;
/** a quotes batch still out after this is a failed batch — its symbols read
 *  UNAVAILABLE instead of sitting on "loading" until the platform times out */
const QUOTE_TIMEOUT_MS = 20_000;

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
  // the quote book — per-symbol slots (price, last seen, last asked); a tick
  // each poll re-reads freshness even when no round has landed
  const [quotes, setQuotes] = useState<QuoteBook>({});
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
    const inflight = new Set<AbortController>();
    const pull = () => {
      // feat/v4-1b-integrity — every batch merges ON ITS OWN, stamped with
      // the time its round was ASKED: a slow batch never holds the rest of
      // the book at "loading", a batch that hangs past the timeout is a
      // failed batch (UNAVAILABLE on its own symbols), and a batch from an
      // older round that lands after a newer one is dropped by
      // mergeQuoteRound rather than stamped fresh
      const askedAt = Date.now();
      for (const c of chunks) {
        const ctl = new AbortController();
        inflight.add(ctl);
        const timer = window.setTimeout(() => ctl.abort(), QUOTE_TIMEOUT_MS);
        fetch(`/api/intel/quotes?symbols=${encodeURIComponent(c)}`, { cache: "no-store", signal: ctl.signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then(
            (j: { quotes?: Record<string, { price?: number; chgPct?: number }> }): QuoteBatch => ({
              symbols: c.split(","),
              ok: true,
              quotes: j.quotes ?? {},
            }),
            (): QuoteBatch => ({ symbols: c.split(","), ok: false }),
          )
          .then((batch) => {
            window.clearTimeout(timer);
            inflight.delete(ctl);
            if (cancelled) return;
            // a failed batch nulls exactly its symbols (UNAVAILABLE), an
            // answered one refreshes exactly its own
            setQuotes((prev) => mergeQuoteRound(prev, [batch], askedAt));
          });
      }
    };
    pull();
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      if (!document.hidden) pull();
    }, REFRESH_MS);
    // a tab coming back re-asks at once, so a price that aged out while the
    // poll was paused is replaced within a round-trip instead of a minute
    const onVisible = () => {
      if (!document.hidden) {
        setTick((t) => t + 1);
        pull();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      for (const ctl of inflight) ctl.abort();
    };
  }, [symKey]);

  // ONE reader for every surface that shows a price from the book
  const quoteFor = useCallback(
    (symbol: string): QuoteRead => readQuote(quotes, symbol, Date.now(), QUOTE_MAX_AGE_MS),
    // tick re-reads freshness every poll even when no round has landed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quotes, tick],
  );
  const lastFor = useCallback(
    (idea: PublicIdea): LastQuote => {
      const q = quoteFor(chartSymbolFor(idea.instrument));
      if (q.state === "pending") return NO_QUOTE;
      if (q.state === "ok") return { price: q.price, state: "ok" };
      return { price: null, state: "unavailable" };
    },
    [quoteFor],
  );

  // ── the phone idea page ─────────────────────────────────────────────────────
  // It opens from a tap or a deep-select and closes from its back control /
  // Esc / the OS back gesture / leaving the tab (declared before the effects
  // that reference it).
  //
  // THE HISTORY CONTRACT: the ?idea= parameter lives ONLY on the page's own
  // history entry. Opening strips it from the entry underneath (a deep link
  // or a command-bar jump arrives carrying it) and PUSHES the page entry
  // with it, marked { v4idea: true } — so the OS back gesture closes the page
  // (L8) and lands on a clean list entry. Switching tabs while the page is
  // open REPLACES the page entry instead of stacking a view on top of it
  // (app/page.tsx switchView honours the marker and drops the parameter), so
  // back never lands on a closed page and a reload never reopens one.
  const pageOpenRef = useRef(false);
  const liveIdeasRef = useRef<PublicIdea[]>([]);
  const openPage = useCallback((key: string) => {
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    pageOpenRef.current = true;
    setPageOpen(true);
    try {
      const under = new URL(window.location.href);
      if (under.searchParams.has("idea")) {
        under.searchParams.delete("idea");
        window.history.replaceState({ ...(window.history.state ?? {}), v4idea: false }, "", under.toString());
      }
      const page = new URL(window.location.href);
      page.searchParams.set("idea", key);
      window.history.pushState({ ...(window.history.state ?? {}), v4idea: true }, "", page.toString());
    } catch {
      /* no-op */
    }
  }, []);
  const finishClose = useCallback(() => {
    pageOpenRef.current = false;
    setPageOpen(false);
    // the entry we land on is clean by construction; strip defensively in
    // case the page was opened in a way that never pushed (history API off)
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
      const onPageEntry = window.history.state?.v4idea === true;
      if (pageOpenRef.current && !onPageEntry) {
        finishClose();
        return;
      }
      // FORWARD onto a page entry (after closing it with back) reopens that
      // page — the browser's own semantics; no push, the entry exists
      if (!pageOpenRef.current && onPageEntry && phoneRef.current) {
        let key: string | null = null;
        try {
          key = new URL(window.location.href).searchParams.get("idea");
        } catch {
          /* no-op */
        }
        const i = key ? liveIdeasRef.current.find((x) => `live:${x.id}` === key) : undefined;
        if (i) {
          setSelection(selectionFromLive(i));
          returnFocusRef.current = null;
          pageOpenRef.current = true;
          setPageOpen(true);
        }
      }
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
        if (phoneRef.current) openPage(want);
        return;
      }
    }
    if (liveIdeas.length > 0) setSelection(selectionFromLive(liveIdeas[0]));
  }, [selection, liveIdeas, live, openPage]);
  useEffect(() => {
    liveIdeasRef.current = liveIdeas;
  }, [liveIdeas]);

  // DESKTOP: a user selection lands in the URL (?idea=) so the exact view is
  // shareable — replaceState, not push: card taps must not stack history.
  // (Phones never write it here: the parameter lives only on the idea page's
  // own history entry — see openPage.)
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
        if (phoneRef.current && !pageOpenRef.current) openPage(key);
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
  // floor. The shell's switchView has already REPLACED the page's history
  // entry and dropped ?idea= (the history contract above); the strip here is
  // the belt to that brace, for a view change that did not go through it.
  useEffect(() => {
    if (!active && pageOpenRef.current) {
      pageOpenRef.current = false;
      returnFocusRef.current = null;
      setPageOpen(false);
      try {
        const u = new URL(window.location.href);
        if (u.searchParams.has("idea")) {
          u.searchParams.delete("idea");
          window.history.replaceState({ ...(window.history.state ?? {}), v4idea: false }, "", u.toString());
        }
      } catch {
        /* no-op */
      }
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
              if (phoneRef.current) {
                setSelection(selectionFromLive(idea));
                openPage(`live:${idea.id}`);
              } else {
                applySelect(selectionFromLive(idea));
              }
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
      {/* while the phone idea page is up, everything behind it is inert: not
          focusable, not clickable, out of the accessibility tree (the page
          also traps Tab — see IdeaPage) */}
      <div className="if-chrome" inert={pageShown || undefined}>
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
        <div className="v4-mobile" style={pageShown ? { visibility: "hidden" } : undefined} inert={pageShown || undefined}>
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
              quoteFor={quoteFor}
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
          the cards above it. Inert under the phone idea page, which carries
          its own. */}
      <div className="v4-feed-disc" inert={pageShown || undefined}>
        <Disclaimer />
      </div>
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
          // the L / S counts include DERIVED sides; the sub-line marks how
          // many with the same tilde the cards use, and the legend below
          // explains it
          sub={
            answered && (stats.derived > 0 || stats.watch > 0 || stats.unsided > 0)
              ? [
                  stats.derived > 0 ? `incl. ~${stats.derived} derived` : null,
                  stats.watch > 0 ? `${stats.watch} watch` : null,
                  stats.unsided > 0 ? `${stats.unsided} without a side` : null,
                ]
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
      {/* the one legend for the tilde — on the cards' side word and in the
          Book bias tile — in the idea page's own words. Rendered only while
          a derived side is on the board (L4: a legend for a mark nobody can
          see earns nothing). */}
      {answered && stats.derived > 0 ? (
        <p className="v4-legend">
          <span className="v4-legend-mark">~</span> derived from entry vs target
        </p>
      ) : null}
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
  // the ONE headline metric (lib/idea-card headlineOf) — the idea page and the
  // desktop detail read the same resolver; only a price answered by the
  // latest round computes
  const head = headlineOf(idea, last.state === "ok" ? last.price : null);
  const tone = headlineTone(head);
  const prog = progressOf(idea, last.state === "ok" ? last.price : null);
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
            {/* the status in words — a triggered row names its crossing
                ("Triggered below 768") beside the tint that grades it */}
            <span className={`v4-status v4-status-${chip.tone}`}>{statusText(chip)}</span>
            {" · "}
            {relativeTime(idea.createdAt)}
          </span>
        </span>
        <span className="v4-ic-right">
          <span className={`v4-ic-pct v4-${tone}`}>{head.big}</span>
          <span className={`v4-ic-pl${head.kind === "beyond" ? " v4-ic-pl-wrap" : ""}`}>{head.label}</span>
          {head.calc ? <DataTag kind="calc" title={head.calc} /> : null}
        </span>
      </span>
      <span className="v4-ic-bottom">
        {/* the track exists only for % of the way — a distance is not a
            fraction of anything, and an empty track under "—" would read as
            0% (L2: absent stays absent) */}
        {head.kind === "progress" && head.pct != null ? (
          <span className="v4-bar" aria-hidden="true">
            <span className={`v4-bar-fill v4-bar-${tone}`} style={{ width: `${head.pct}%` }} />
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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function IdeaPage({ idea, last, onBack }: { idea: PublicIdea; last: LastQuote; onBack: () => void }) {
  const backRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // page scroll locks under the page; Esc goes back (hardware keyboards
  // exist); Tab and Shift+Tab cycle inside the page and never reach what is
  // behind it (the feed's own Terms / Privacy links are also inert)
  useEffect(() => {
    document.documentElement.classList.add("sheet-open");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onBack();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const lastItem = items[items.length - 1];
      const at = document.activeElement as HTMLElement | null;
      const inside = !!at && root.contains(at);
      if (e.shiftKey && (!inside || at === first)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (!inside || at === lastItem)) {
        e.preventDefault();
        first.focus();
      }
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
    <div ref={dialogRef} className="v4-page" role="dialog" aria-modal="true" aria-label={`${idea.instrument} idea`}>
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
