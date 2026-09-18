"use client";

// TODAY (feat/v4-2-today) — the front page's modules, one white card each, on
// the paper stage (DESIGN_LAWS L1). Design: frame 01 of docs/design/"August
// Mobile v4 Markets.dc.html", with every module that exists today reskinned
// (none deleted to match the frame) and nothing the frame invents built (no
// chance %, no chance chart, no event contracts, no category chips).
//
//   • the day line — ET date + session word (the market's clock)
//   • MARKET REGIME — calculated from the quote book + the live book; the
//     five-step gauge is the vote sum; WHY lists EVERY input with its own vote
//   • THE CALL (TheCallCard), then the command bar + its one answer card
//   • NEXT high-impact print (CountdownRow)
//   • PULSE — SPY QQQ NQ BTC VIX, one row per symbol, UNAVAILABLE per row
//   • NQ LEVELS — last, pivot, VWAP, the calculated condition
//   • DESK — the live book's count, as of when the store answered
//   • WHAT'S BEING SAID — headlines (or the desk's own tape, env-flagged)
//
// HONESTY (the law, L2): a card with no data renders its UNAVAILABLE state,
// never a blank or a placeholder; loading says so. Those states now fire on
// the ROUTE'S OWN ANSWER (lib/wire), not only on a dead fetch: a store outage
// arrives as a well-formed answer saying ok:false, and reading only the
// transport rendered it as "no calls / no headlines" — the exact lie L11
// forbids. Zero rows and unreachable are different cards. Prices come from the ONE
// quote book (lib/use-quote-book, shared with the terminal): per symbol, a
// failed batch is UNAVAILABLE, never an older round's price. Market data wears
// its provenance chip at every width; August's own stored records (desk, tape)
// wear an as-of time instead. Owner parity: nothing here differs by role
// (LATEST INGEST lives in /admin).

import { useEffect, useMemo, useState } from "react";
import type { PublicIdea } from "@/lib/ideas";
import type { PublicIngest } from "@/lib/transcripts";
import type { PublicTapeEntry } from "@/lib/tape";
import type { Headline } from "@/lib/headlines";
import { relativeTime } from "@/lib/ideas";
import { fmtPct } from "@/lib/idea-card";
import { degradedLine, readWire, type WireFetch } from "@/lib/wire";
import type { QuoteReader } from "@/lib/use-quote-book";
import DataTag from "@/components/DataTag";
import CountdownRow from "@/components/CountdownRow";
import TheCallCard from "@/components/TheCallCard";
import {
  computeRegime,
  parseStatedLevel,
  regimeGauge,
  sparkTrendPct,
  sparkTrendPts,
  type RegimeRead,
} from "@/lib/regime";
import type { BiasRead, SessionLevels } from "@/lib/levels";
import Disclaimer from "@/components/Disclaimer";

export const PULSE: Array<{ sym: string; label: string }> = [
  { sym: "SPY", label: "SPY" },
  { sym: "QQQ", label: "QQQ" },
  { sym: "NQ=F", label: "NQ" },
  { sym: "BTC-USD", label: "BTC" },
  { sym: "^VIX", label: "VIX" },
];
/** the symbols the regime reads from the book (closes ride beside SPY/QQQ/VIX) */
export const REGIME_SYMBOLS = ["SPY", "QQQ", "^VIX", "NQ=F"];

const POLL_MS = 60_000;
/** a levels read older than this is not shown as current (same age-out as the
 *  quote book: three missed polls) */
const LEVELS_MAX_AGE_MS = 3 * POLL_MS;
/** headlines poll every 5 min; a list older than this is no longer shown */
const NEWS_MAX_AGE_MS = 20 * 60_000;

/** the colour of a % move follows what is PRINTED: a move that rounds to 0.0%
 *  is neither up nor down (a red "0.0%" would claim a fall the number denies) */
export const chgTone = (pct: number | null): "" | "up" | "down" => {
  if (pct === null || !Number.isFinite(pct)) return "";
  const r = Number(pct.toFixed(1));
  return r > 0 ? "up" : r < 0 ? "down" : "";
};

export const fmtPx = (n: number) =>
  n >= 1000
    ? Math.round(n).toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtEtClock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }) + " ET";

// ET session word — the market's clock, not the visitor's. No exchange
// calendar exists (CLAUDE.md, THE CALL), so a holiday reads by the clock.
function sessionNow(): { date: string; session: string; open: boolean } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const date = `${weekday}, ${get("month")} ${get("day")}`;
  const mins = parseInt(get("hour") || "0", 10) * 60 + parseInt(get("minute") || "0", 10);
  const weekend = weekday === "Saturday" || weekday === "Sunday";
  const session = weekend
    ? "MARKET CLOSED"
    : mins >= 240 && mins < 570
      ? "PRE-MARKET"
      : mins >= 570 && mins < 960
        ? "MARKET OPEN"
        : mins >= 960 && mins < 1200
          ? "AFTER HOURS"
          : "MARKET CLOSED";
  return { date, session, open: session === "MARKET OPEN" };
}

const TICKER_WHITELIST = /\b(AAPL|MSFT|AMZN|GOOGL|NVDA|META|PLTR|CRM|AMD|AVGO|MU|SMCI|JPM|GS|BAC|WFC|XOM|CVX|OXY|SLB|WMT|MCD|NKE|SBUX|LLY|UNH|PFE|MRK|COIN|MSTR|HOOD|RIOT|TSLA|GME|AFRM|UPST|SPY|QQQ|BTC|ETH|NQ|ES|VIX)\b/g;

// The regime's input names are part of THE CALL's fingerprint (lib/call), so
// they are never renamed in lib/regime — sentence case is a RENDER decision.
const INPUT_NAME: Record<string, string> = {
  "INDEX TREND (1mo)": "Index trend · 1mo",
  "VIX LEVEL": "VIX level",
  "VIX TREND (1mo)": "VIX trend · 1mo",
  "DESK BOOK BIAS": "Desk book bias",
  "NQ vs STATED LEVELS": "NQ vs stated levels",
};
const REGIME_WORD: Record<RegimeRead["label"], string> = {
  "RISK ON": "Risk on",
  NEUTRAL: "Neutral",
  "RISK OFF": "Risk off",
  UNAVAILABLE: "Unavailable",
};
const voteTag = (v: -1 | 0 | 1) => (v > 0 ? "Risk on" : v < 0 ? "Risk off" : "Neutral");

/** one polled read that is either fresh or not — the quote book's rule applied
 *  to a single non-quote source: fresh only when the latest attempt answered,
 *  within maxAge; a failed attempt never leaves the older read on screen */
type Slot<T> = { data: T | null; seenAt: number | null; checkedAt: number } | null;
function landSlot<T>(prev: Slot<T>, data: T | null, askedAt: number): Slot<T> {
  if (prev && prev.checkedAt > askedAt) return prev; // an older round landing late
  return data !== null
    ? { data, seenAt: askedAt, checkedAt: askedAt }
    : { data: null, seenAt: prev?.seenAt ?? null, checkedAt: askedAt };
}
function readSlot<T>(slot: Slot<T>, now: number, maxAge: number): { state: "pending" } | { state: "ok"; data: T; at: number } | { state: "unavailable" } {
  if (!slot) return { state: "pending" };
  if (slot.data !== null && slot.seenAt === slot.checkedAt && slot.seenAt !== null && now - slot.seenAt <= maxAge) {
    return { state: "ok", data: slot.data, at: slot.seenAt };
  }
  return { state: "unavailable" };
}

type Levels = { levels: SessionLevels; bias: BiasRead };

/** ONE public-wire GET, read the way lib/wire says every consumer must. The
 *  body is parsed EVEN when the status isn't ok, because that is where the
 *  desk states its cause; a body that won't parse is itself a failure, not an
 *  empty list. The raw body rides along for the one field that isn't rows —
 *  the headlines route's `mode`. Never rejects: the failure IS the answer. */
function pullWire<T>(url: string, key: string): Promise<{ read: WireFetch<T>; body: unknown }> {
  return fetch(url, { cache: "no-store" }).then(
    (res) =>
      res.json().then(
        (body: unknown) => ({ read: readWire<T>(res, body, key), body }),
        () => ({ read: readWire<T>(res, null, key), body: null }),
      ),
    () => ({ read: readWire<T>(null, null, key), body: null }),
  );
}

export default function HomeBrief({
  askBar,
  onAsk,
  quotes,
}: {
  askBar?: React.ReactNode;
  onAsk?: (text: string) => void;
  /** the page's ONE quote book (HomeLanding owns it; closes kept for the regime) */
  quotes: QuoteReader;
}) {
  const [now, setNow] = useState(() => sessionNow());
  const [clock, setClock] = useState(() => Date.now());
  const [live, setLive] = useState<PublicIdea[] | null>(null);
  // the three *Err states hold the desk's STATED cause, not a flag: the chip
  // that fires from them can then name why the source is missing instead of
  // only that it is. null = the last read answered.
  const [liveErr, setLiveErr] = useState<string | null>(null);
  /** the book answered, but short: which source didn't hand over its rows.
   *  A count of "live calls" taken from a partial read is a wrong number
   *  stated as the desk's own record (L11). */
  const [liveGap, setLiveGap] = useState<string | null>(null);
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const [why, setWhy] = useState(false);
  const [levels, setLevels] = useState<Slot<Levels>>(null);
  // undefined = not read yet; null = the wire answered with nothing. A failed
  // wire read never lands here: it leaves a known ingest standing and simply
  // adds no timestamp to the desk line.
  const [ingest, setIngest] = useState<PublicIngest | null | undefined>(undefined);
  const [news, setNews] = useState<Headline[] | null>(null);
  const [newsAt, setNewsAt] = useState<number | null>(null);
  const [newsErr, setNewsErr] = useState<string | null>(null);
  // a PARTIAL headlines read: rows exist and some feeds are missing from them.
  // The list is served AND the gap is named — a short list that looks whole is
  // the failure L11 forbids. null = every feed answered.
  const [newsGap, setNewsGap] = useState<string | null>(null);
  // P2 — the env-flagged desk-only feed (the desk's tape instead of headlines)
  const [deskFeed, setDeskFeed] = useState(false);
  const [tapeNotes, setTapeNotes] = useState<PublicTapeEntry[] | null>(null);
  const [tapeErr, setTapeErr] = useState<string | null>(null);
  /** same for the tape: a short tape must never read as the whole tape */
  const [tapeGap, setTapeGap] = useState<string | null>(null);

  // the session line + every relative time follow the clock
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(sessionNow());
      setClock(Date.now());
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // COMMAND-BAR "why" — open the regime read and bring it on screen. The
  // command lane dispatches this event; no model involved.
  useEffect(() => {
    const onWhy = () => {
      setWhy(true);
      window.setTimeout(() => {
        document.querySelector(".td-regime")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
    };
    window.addEventListener("aug:open-why", onWhy);
    return () => window.removeEventListener("aug:open-why", onWhy);
  }, []);

  // book + levels + wire — one 60s loop over the existing public routes
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      const askedAt = Date.now();
      // `live` stays null on a failed read so the DESK card can never print a
      // count of 0 live calls that the store never actually answered.
      pullWire<PublicIdea>("/api/ideas", "ideas").then(({ read }) => {
        if (cancelled) return;
        if (read.state === "ok") {
          setLive(read.rows);
          setLiveErr(null);
          // null when every row answered, so a recovered round clears itself
          setLiveGap(degradedLine(read.failed));
          setLiveAt(Date.now());
        } else {
          setLiveErr(read.reason);
        }
      });
      fetch("/api/intel/levels", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then(
          (j: { ok?: boolean; levels?: SessionLevels; bias?: BiasRead }): Levels | null =>
            j.ok && j.levels && j.bias && j.levels.price !== null ? { levels: j.levels, bias: j.bias } : null,
          () => null,
        )
        .then((data) => {
          if (!cancelled) setLevels((prev) => landSlot(prev, data, askedAt));
        });
      pullWire<PublicIngest>("/api/wire", "ingests").then(({ read }) => {
        if (cancelled) return;
        // an ANSWER of no ingests is a fact about the wire and lands; a failed
        // read is not that fact, so it never clears a known ingest — it only
        // leaves the desk's "updated" time to the book alone.
        if (read.state === "ok") setIngest(read.rows.length > 0 ? read.rows[0] : null);
        else setIngest((prev) => (prev === undefined ? null : prev));
      });
    };
    pull();
    const id = window.setInterval(() => {
      if (!document.hidden) pull();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // headlines — the server caches ~15 min; a 5 min client poll is plenty.
  // mode "desk" (env-flagged, OFF by default) swaps in the desk's own tape.
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      pullWire<Headline>("/api/headlines", "headlines").then(({ read, body }) => {
        if (cancelled) return;
        // the mode rides beside the rows, so it is read from the body itself.
        // A failed headlines read can't state a mode at all — the headlines
        // card then says it is unreachable rather than silently staying on a
        // feed it never confirmed.
        const mode = body && typeof body === "object" ? (body as { mode?: unknown }).mode : undefined;
        if (mode === "desk") {
          setDeskFeed(true);
          pullWire<PublicTapeEntry>("/api/tape", "entries").then(({ read: tape }) => {
            if (cancelled) return;
            if (tape.state === "ok") {
              setTapeNotes(tape.rows);
              setTapeErr(null);
              setTapeGap(degradedLine(tape.failed));
            } else {
              setTapeErr(tape.reason);
            }
          });
          return;
        }
        if (read.state === "ok") {
          setNews(read.rows);
          setNewsAt(Date.now());
          setNewsErr(null);
          // degradedLine is null when every feed answered, so a recovered
          // round clears the gap line by itself
          setNewsGap(degradedLine(read.failed));
        } else {
          setNewsErr(read.reason);
        }
      });
    };
    pull();
    const id = window.setInterval(() => {
      if (!document.hidden) pull();
    }, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ── MARKET REGIME ─────────────────────────────────────────────────────────
  // Held inputs only, from the quote book (fresh prices + the closes that came
  // with them) and the live book. A stale or failed symbol drops exactly its
  // own input. Pure math in lib/regime.
  const { quoteFor, closesFor } = quotes;
  const regimePending =
    REGIME_SYMBOLS.some((s) => quoteFor(s).state === "pending") || (live === null && liveErr === null);
  const regime = useMemo(() => {
    if (regimePending) return null;
    const px = (s: string) => {
      const q = quoteFor(s);
      return q.state === "ok" ? q.price : null;
    };
    const book = live ?? [];
    const longs = book.filter((i) => i.side === "long").length;
    const shorts = book.filter((i) => i.side === "short").length;
    const nq = px("NQ=F");
    const nqLevels = book
      .filter((i) => /^NQ\b/i.test(i.instrument.trim()))
      .map((i) => parseStatedLevel(i.entry) ?? parseStatedLevel(i.target) ?? parseStatedLevel(i.stop))
      .filter((n): n is number => n !== null);
    const mean = nqLevels.length > 0 ? nqLevels.reduce((a, b) => a + b, 0) / nqLevels.length : null;
    return computeRegime({
      spyTrendPct: sparkTrendPct(closesFor("SPY")),
      qqqTrendPct: sparkTrendPct(closesFor("QQQ")),
      vix: px("^VIX"),
      vixTrendPts: sparkTrendPts(closesFor("^VIX")),
      bookLongs: longs,
      bookShorts: shorts,
      nqVsLevelPct: nq !== null && mean !== null ? ((nq - mean) / mean) * 100 : null,
    });
  }, [regimePending, quoteFor, closesFor, live]);
  const gauge = regime ? regimeGauge(regime) : null;

  // ── the rest ──────────────────────────────────────────────────────────────
  const lv = readSlot(levels, clock, LEVELS_MAX_AGE_MS);
  const pulseReads = PULSE.map((p) => ({ ...p, q: quoteFor(p.sym) }));
  const pulseOk = pulseReads.some((r) => r.q.state === "ok");
  const pulseSettled = pulseReads.every((r) => r.q.state !== "pending");
  const newsFresh = news !== null && newsAt !== null && clock - newsAt <= NEWS_MAX_AGE_MS;

  return (
    <div className="td" aria-label="Today">
      {/* the day line — date + the ET session word */}
      <div className="td-dayline">
        <span className="td-date">{now.date}</span>
        <span className={`td-market${now.open ? " on" : ""}`}>
          <span className="td-market-dot" aria-hidden="true" />
          {now.session}
        </span>
      </div>

      {/* MARKET REGIME — calculated, explainable, never advice */}
      <section className="td-card td-regime" aria-label="Market regime">
        <div className="td-head">
          <h2 className="td-label">Market regime</h2>
          {regime === null ? null : regime.label === "UNAVAILABLE" ? (
            <DataTag kind="unavail" title="needs at least 2 live inputs (index trend, VIX, book bias, NQ vs levels)" />
          ) : (
            <DataTag kind="calc" title="deterministic read from the inputs below — a market condition, not a recommendation" />
          )}
        </div>
        {regime === null ? (
          <p className="td-meta">Reading the inputs…</p>
        ) : regime.label === "UNAVAILABLE" ? (
          <p className="td-meta">
            Needs at least two live inputs — {regime.because.length === 0 ? "none" : regime.because.length === 1 ? "one" : regime.because.length} answered.
          </p>
        ) : (
          <div className="td-regime-body">
            <div className="td-regime-read">
              <span className="td-headline">{REGIME_WORD[regime.label]}</span>
              <span className="td-meta">
                {regime.agreement
                  ? `${regime.agreement.agree} of ${regime.agreement.voting} voting input${regime.agreement.voting === 1 ? "" : "s"} ${regime.agreement.agree === 1 ? "leans" : "lean"} ${gauge !== null && gauge > 0 ? "risk-on" : "risk-off"}`
                  : "The inputs are dead even"}
              </span>
            </div>
            <Gauge step={gauge} />
          </div>
        )}
        {regime !== null && regime.because.length > 0 ? (
          <>
            <button type="button" className="td-textbtn td-why" onClick={() => setWhy((v) => !v)} aria-expanded={why}>
              {why ? "Hide the inputs" : `Why · ${regime.because.length} input${regime.because.length === 1 ? "" : "s"}`}
            </button>
            {why ? (
              // EVERY input, each with its OWN vote — never a count that
              // assumes the unlisted ones agree (the old WHY hid Book bias)
              <ul className="td-rows td-inputs">
                {regime.because.map((b) => (
                  <li key={b.input} className="td-row">
                    <span className="td-row-k">{INPUT_NAME[b.input] ?? b.input}</span>
                    <span className="td-row-v">
                      <span>{b.value}</span>
                      <span className={`td-vote ${b.vote > 0 ? "on" : b.vote < 0 ? "off" : "even"}`}>{voteTag(b.vote)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>

      {/* THE CALL — the page's subject */}
      <TheCallCard />

      {/* THE COMMAND BAR — under THE CALL; its one answer card rides with it */}
      {askBar}

      {/* NEXT — the next high-impact print, counting down */}
      <CountdownRow />

      {/* PULSE — one row per symbol, always; a symbol with no fresh price says so */}
      <section className="td-card" aria-label="Pulse">
        <div className="td-head">
          <h2 className="td-label">Pulse</h2>
          {pulseOk ? (
            <DataTag kind="delayed" detail="60s" title="Yahoo quotes · 60s server cache · 60s poll" />
          ) : pulseSettled ? (
            <DataTag kind="unavail" title="no symbol answered the latest quotes round" />
          ) : null}
        </div>
        <ul className="td-rows">
          {pulseReads.map(({ sym, label, q }) => (
            <li key={sym} className="td-row">
              <span className="td-tkr">{label}</span>
              {q.state === "ok" ? (
                <span className="td-row-v">
                  <span className="td-num">{fmtPx(q.price)}</span>
                  <span className={`td-num td-chg ${chgTone(q.chgPct)}`}>
                    {q.chgPct === null ? "—" : fmtPct(q.chgPct)}
                  </span>
                </span>
              ) : q.state === "pending" ? (
                <span className="td-meta">loading…</span>
              ) : (
                <DataTag kind="unavail" compact title={`${label}: no fresh price from the latest quotes round`} />
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* NQ LEVELS — last against today's pivot and VWAP */}
      <section className="td-card" aria-label="NQ levels">
        <div className="td-head">
          <h2 className="td-label">NQ levels</h2>
          {lv.state === "ok" ? (
            <DataTag kind="delayed" detail="60s" title="NQ=F · Yahoo daily + 5m bars" />
          ) : lv.state === "unavailable" ? (
            <DataTag kind="unavail" title="the levels read failed or is older than three polls" />
          ) : null}
        </div>
        {lv.state === "pending" ? (
          <p className="td-meta">loading…</p>
        ) : lv.state === "unavailable" ? (
          <p className="td-meta">NQ levels can&apos;t be read right now.</p>
        ) : (
          <>
            <div className="td-figure-row">
              <span className="td-figure">{fmtPx(lv.data.levels.price as number)}</span>
              {lv.data.levels.asOf ? (
                <span className="td-meta">last bar {fmtEtClock(lv.data.levels.asOf * 1000)}</span>
              ) : null}
            </div>
            <ul className="td-rows">
              <li className="td-row">
                <span className="td-row-k">Pivot</span>
                <span className="td-num">
                  {lv.data.levels.pivot !== null ? fmtPx(lv.data.levels.pivot) : "—"}
                </span>
              </li>
              <li className="td-row">
                <span className="td-row-k">VWAP</span>
                <span className="td-num">{lv.data.levels.vwap !== null ? fmtPx(lv.data.levels.vwap) : "—"}</span>
              </li>
              <li className="td-row">
                <span className="td-row-k">
                  Condition <DataTag kind="calc" compact title={`calculated from ${lv.data.bias.votes.map((v) => `${v.input} ${v.value}`).join(" · ") || "the session levels"}`} />
                </span>
                <span className={`td-condition b-${lv.data.bias.label.toLowerCase()}`}>
                  {lv.data.bias.label === "UNAVAILABLE"
                    ? "Unavailable"
                    : lv.data.bias.label.charAt(0) + lv.data.bias.label.slice(1).toLowerCase()}
                </span>
              </li>
            </ul>
          </>
        )}
      </section>

      {/* DESK — August's own stored record: an as-of time, not a market chip */}
      <section className="td-card" aria-label="Desk">
        <div className="td-head">
          <h2 className="td-label">Desk</h2>
          {liveErr !== null ? (
            <DataTag kind="unavail" title={`the ideas board is unreachable — ${liveErr}`} />
          ) : liveGap !== null ? (
            <DataTag kind="unavail" title={liveGap} />
          ) : null}
        </div>
        {live === null ? (
          <p className="td-meta">{liveErr !== null ? "The desk can't be reached right now." : "loading…"}</p>
        ) : (
          (() => {
            const etDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
            const today = etDay(clock);
            const fresh = live.filter((i) => etDay(i.createdAt) === today).length;
            const newest = Math.max(ingest ? ingest.ts : 0, ...live.map((i) => i.updatedAt));
            return (
              <>
                <div className="td-figure-row">
                  <span className="td-figure">{live.length}</span>
                  <span className="td-title">live call{live.length === 1 ? "" : "s"}</span>
                </div>
                <p className="td-meta">
                  {fresh} new today{newest > 0 ? ` · updated ${relativeTime(newest, clock)}` : ""}
                </p>
                {liveGap !== null ? <p className="td-meta">{liveGap}</p> : null}
              </>
            );
          })()
        )}
        <div className="td-foot">
          {liveAt !== null ? <span>as of {fmtEtClock(liveAt)}</span> : <span />}
          <a className="td-link" href="/?view=terminal">
            Open the terminal →
          </a>
        </div>
      </section>

      {deskFeed ? (
        /* P2 ALTERNATIVE (env-flagged, OFF by default) — the desk's own tape
           instead of third-party headlines: stored records, as-of per row */
        <section className="td-card" aria-label="From the desk">
          <div className="td-head">
            <h2 className="td-label">From the desk</h2>
            {tapeErr !== null ? (
              <DataTag kind="unavail" title={`the desk tape is unreachable — ${tapeErr}`} />
            ) : tapeGap !== null ? (
              <DataTag kind="unavail" title={tapeGap} />
            ) : null}
          </div>
          {tapeNotes === null ? (
            <p className="td-meta">{tapeErr !== null ? "The tape can't be reached right now." : "loading…"}</p>
          ) : tapeNotes.length === 0 ? (
            <p className="td-meta">Nothing on the tape yet.</p>
          ) : (
            <ul className="td-rows td-news">
              {tapeNotes.slice(0, 5).map((t) => (
                <li key={t.id} className="td-news-row">
                  <span className="td-title">{t.note}</span>
                  <span className="td-news-meta">
                    <b className="td-tkr">{t.symbol}</b>
                    {t.ts > 0 ? <span>{relativeTime(t.ts, clock)}</span> : null}
                    {onAsk ? (
                      <button
                        type="button"
                        className="td-textbtn"
                        onClick={() => onAsk(`The desk tape says: "${t.note}" (${t.symbol}). What should I watch?`)}
                      >
                        Ask August →
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        /* WHAT'S BEING SAID — third-party headlines: attribution + link stay */
        <section className="td-card" aria-label="What's being said">
          <div className="td-head">
            <h2 className="td-label">What&apos;s being said</h2>
            {newsFresh && news !== null && news.length > 0 ? (
              // a partial list keeps its provenance chip — the rows on screen
              // ARE 15m-cached RSS — and wears the gap next to it; compact so
              // both chips fit the head at 390
              <span className="td-chips">
                <DataTag kind="delayed" detail="15m" title="free RSS · 15m server cache" />
                {newsGap !== null ? <DataTag kind="unavail" compact title={newsGap} /> : null}
              </span>
            ) : newsFresh && newsGap !== null ? (
              <DataTag kind="unavail" title={newsGap} />
            ) : !newsFresh && newsErr !== null ? (
              <DataTag kind="unavail" title={`headlines unreachable — ${newsErr}`} />
            ) : null}
          </div>
          {/* the rows below are only the feeds that ANSWERED — the ones that
              didn't are named here, where a reader counting five headlines can
              see that the list is short by something */}
          {newsFresh && newsGap !== null && news !== null && news.length > 0 ? (
            <p className="td-meta">{newsGap}</p>
          ) : null}
          {!newsFresh ? (
            <p className="td-meta">{newsErr !== null ? "Headlines can't be reached right now." : "loading…"}</p>
          ) : news === null || news.length === 0 ? (
            // "no headlines right now" is a claim about the feeds. When some of
            // them never answered, the desk names them instead of making it.
            <p className="td-meta">{newsGap ?? "No headlines right now."}</p>
          ) : (
            <ul className="td-rows td-news">
              {news.slice(0, 5).map((h) => {
                const tickers = [...new Set(h.title.match(TICKER_WHITELIST) ?? [])].slice(0, 3);
                return (
                  <li key={h.link} className="td-news-row">
                    <a href={h.link} target="_blank" rel="noopener noreferrer" className="td-title td-news-title">
                      {h.title}
                    </a>
                    <span className="td-news-meta">
                      <span className="td-news-src">{h.publisher}</span>
                      {h.publishedAt > 0 ? <span>{relativeTime(h.publishedAt, clock)}</span> : null}
                      {tickers.map((t) => (
                        <b key={t} className="td-tkr">
                          {t}
                        </b>
                      ))}
                      {onAsk ? (
                        <button
                          type="button"
                          className="td-textbtn"
                          onClick={() => onAsk(`What does this headline mean for the market: "${h.title}" (${h.publisher})?`)}
                        >
                          Ask August →
                        </button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* the floor publishes the regime read, the NQ levels and the desk
          record. THE CALL card mounted above carries its own line. */}
      <Disclaimer />
    </div>
  );
}

/** the regime's five-step gauge: which way the vote sum leans (lib/regime
 *  regimeGauge). No step lit when the read is unavailable. */
function Gauge({ step }: { step: -2 | -1 | 0 | 1 | 2 | null }) {
  const words = ["risk off", "leaning risk off", "dead even", "leaning risk on", "risk on"];
  return (
    <span className="td-gauge" role="img" aria-label={step === null ? "Regime gauge: no reading" : `Regime gauge: ${words[step + 2]}`}>
      <span className="td-gauge-steps">
        {([-2, -1, 0, 1, 2] as const).map((s) => (
          <span key={s} className={`td-gauge-step ${s < 0 ? "off" : s > 0 ? "on" : "even"}${step === s ? " lit" : ""}`} />
        ))}
      </span>
      <span className="td-gauge-cap" aria-hidden="true">
        RISK OFF · ON
      </span>
    </span>
  );
}
