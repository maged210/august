"use client";

// THE DAILY BRIEF — the chat view's HOME STATE (UX2-T2). Not a popup, not a
// card: when no thread is open, this IS the center of the page. Finviz-density
// translated to OUR data, every line real:
//   • date + session line (pre-market / open / after-hours by the ET clock)
//   • PULSE ROW — the existing pulse five off /api/intel/quotes (last · % · spark)
//   • DESK LINE — live/tracked/triggered counts, win rate, avg MFE/MAE, and
//     today's best/worst across the book (T3 folds the old Desk Stats here)
//   • LATEST INGEST — the newest transcript's redacted counts off /api/wire
//   • HEADLINES — top 5 via free public RSS (/api/headlines, server-cached)
// Empty/failed blocks render honest ∅ lines or nothing — never mock rows.

import { useEffect, useMemo, useState } from "react";
import type { FeedCard } from "@/lib/intel/publish";
import type { PublicIdea } from "@/lib/ideas";
import type { PublicIngest } from "@/lib/transcripts";
import type { PublicTapeEntry } from "@/lib/tape";
import type { Headline } from "@/lib/headlines";
import { relativeTime } from "@/lib/ideas";
import { useOwner } from "@/lib/use-owner";
import DataTag from "@/components/DataTag";
import CountdownRow from "@/components/CountdownRow";
import TheCallCard from "@/components/TheCallCard";
import SectorHeatmap from "@/components/SectorHeatmap";
import { computeRegime, parseStatedLevel, sparkTrendPct, sparkTrendPts } from "@/lib/regime";
import type { BiasRead, SessionLevels } from "@/lib/levels";

const PULSE: Array<{ sym: string; label: string }> = [
  { sym: "SPY", label: "SPY" },
  { sym: "QQQ", label: "QQQ" },
  { sym: "NQ=F", label: "NQ" },
  { sym: "BTC-USD", label: "BTC" },
  { sym: "^VIX", label: "VIX" },
];

type Quote = { price: number; chgPct: number; closes: number[] };

const fmtPx = (n: number) =>
  n >= 1000
    ? Math.round(n).toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

// ET session word — the market's clock, not the visitor's.
function sessionNow(): { date: string; session: string } {
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
  return { date, session };
}

function Spark({ closes, up }: { closes: number[]; up: boolean }) {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  const W = 52;
  const H = 15;
  let min = Math.min(...closes);
  let max = Math.max(...closes);
  const pad = (max - min) * 0.1 || 1;
  min -= pad;
  max += pad;
  const d = closes
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${((i / (closes.length - 1)) * W).toFixed(1)},${(
          H - 2 - ((v - min) / (max - min)) * (H - 4)
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg className="hb-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <path
        d={d}
        fill="none"
        style={{ stroke: up ? "var(--up)" : "var(--down)" }}
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const TICKER_WHITELIST = /(AAPL|MSFT|AMZN|GOOGL|NVDA|META|PLTR|CRM|AMD|AVGO|MU|SMCI|JPM|GS|BAC|WFC|XOM|CVX|OXY|SLB|WMT|MCD|NKE|SBUX|LLY|UNH|PFE|MRK|COIN|MSTR|HOOD|RIOT|TSLA|GME|AFRM|UPST|SPY|QQQ|BTC|ETH|NQ|ES|VIX)/g;

export default function HomeBrief({ askBar, onAsk }: { askBar?: React.ReactNode; onAsk?: (text: string, calendarAskId?: string) => void } = {}) {
  const [now, setNow] = useState(() => sessionNow());
  const [quotes, setQuotes] = useState<Record<string, Quote> | null>(null);
  const [quotesErr, setQuotesErr] = useState(false);
  const [quotesAt, setQuotesAt] = useState<number | null>(null);
  const [live, setLive] = useState<PublicIdea[] | null>(null);
  const [liveErr, setLiveErr] = useState(false);
  const [cards, setCards] = useState<FeedCard[] | null>(null);
  const [cardsErr, setCardsErr] = useState(false);
  const [why, setWhy] = useState(false);
  const [nql, setNql] = useState<{ levels: SessionLevels; bias: BiasRead } | null>(null);
  const [ingest, setIngest] = useState<PublicIngest | null | undefined>(undefined); // undefined = pending
  const [news, setNews] = useState<Headline[] | null>(null);
  const [newsErr, setNewsErr] = useState(false);
  // P2 — the env-flagged desk-only feed (tape instead of third-party headlines)
  const [deskFeed, setDeskFeed] = useState(false);
  const [tapeNotes, setTapeNotes] = useState<PublicTapeEntry[] | null>(null);
  const [, setTick] = useState(0);
  // P3 — visitors get desk language; the owner keeps the full detail
  const isOwner = useOwner();

  // the session line follows the ET clock
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(sessionNow());
      setTick((t) => t + 1); // refreshes the relative times too
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // COMMAND-BAR "why" — open the regime read and bring it on screen. The
  // command lane dispatches this event; no model involved.
  useEffect(() => {
    const onWhy = () => {
      setWhy(true);
      window.setTimeout(() => {
        document.querySelector(".hb-regime")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
    };
    window.addEventListener("aug:open-why", onWhy);
    return () => window.removeEventListener("aug:open-why", onWhy);
  }, []);

  // pulse + desk + ingest — one 60s loop over the existing public routes
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      fetch(`/api/intel/quotes?symbols=${encodeURIComponent(PULSE.map((p) => p.sym).join(","))}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { quotes?: Record<string, Quote> }) => {
          if (cancelled || !j.quotes) return;
          setQuotes(j.quotes);
          setQuotesErr(false);
          setQuotesAt(Date.now());
        })
        .catch(() => {
          // R1 — failure is a STATE, not a silent nothing: existing numbers
          // get a STALE tag, an empty pulse says DATA UNAVAILABLE
          if (!cancelled) setQuotesErr(true);
        });
      fetch("/api/ideas", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { ideas?: PublicIdea[] }) => {
          if (!cancelled) { setLive(Array.isArray(j.ideas) ? j.ideas : []); setLiveErr(false); }
        })
        .catch(() => {
          if (!cancelled) setLiveErr(true);
        });
      fetch("/api/intel/feed", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { ok?: boolean; ideas?: FeedCard[] }) => {
          if (!cancelled && j.ok && Array.isArray(j.ideas)) { setCards(j.ideas); setCardsErr(false); }
        })
        .catch(() => {
          if (!cancelled) setCardsErr(true);
        });
      fetch("/api/intel/levels", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { ok?: boolean; levels?: SessionLevels; bias?: BiasRead }) => {
          if (!cancelled && j.ok && j.levels && j.bias) setNql({ levels: j.levels, bias: j.bias });
        })
        .catch(() => {}); // the chip simply doesn't render — the module carries the honest states
      fetch("/api/wire", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { ingests?: PublicIngest[] }) => {
          if (!cancelled) setIngest(Array.isArray(j.ingests) && j.ingests.length > 0 ? j.ingests[0] : null);
        })
        .catch(() => {
          if (!cancelled) setIngest((prev) => (prev === undefined ? null : prev));
        });
    };
    pull();
    const id = window.setInterval(() => {
      if (!document.hidden) pull();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // headlines — server caches ~15 min; a gentle 5 min client poll is plenty.
  // P2: mode "desk" (env-flagged, OFF by default) swaps this module for the
  // desk's own tape — zero third-party brands on the front page.
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      fetch("/api/headlines", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { headlines?: Headline[]; mode?: string }) => {
          if (cancelled) return;
          if (j.mode === "desk") {
            setDeskFeed(true);
            fetch("/api/tape", { cache: "no-store" })
              .then((r) => (r.ok ? r.json() : Promise.reject(r)))
              .then((t: { entries?: PublicTapeEntry[] }) => {
                if (!cancelled) setTapeNotes(Array.isArray(t.entries) ? t.entries : []);
              })
              .catch(() => { if (!cancelled) setTapeNotes((prev) => prev ?? []); });
            return;
          }
          setNews(Array.isArray(j.headlines) ? j.headlines : []);
          setNewsErr(false);
        })
        .catch(() => {
          if (!cancelled) {
            setNewsErr(true);
            setNews((prev) => prev ?? []);
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

  // — derived desk line (DeskStats semantics, folded here per T3) —
  const tracked = cards ?? [];
  const triggered = tracked.filter((c) => c.status === "TRIGGERED" || c.status === "TARGET_HIT").length;
  const called = tracked.filter(
    (c): c is FeedCard & { pnl: { kind: "since_called"; pct: number } } =>
      !!c.pnl && c.pnl.kind === "since_called",
  );
  const wins = called.filter((c) => c.pnl.pct > 0).length;
  const winRate = called.length > 0 ? Math.round((wins / called.length) * 100) : null;
  const mfes = tracked.filter((c) => c.mfeMae);
  const avgMfe = mfes.length > 0 ? mfes.reduce((s, c) => s + c.mfeMae!.mfePct, 0) / mfes.length : null;
  const avgMae = mfes.length > 0 ? mfes.reduce((s, c) => s + c.mfeMae!.maePct, 0) / mfes.length : null;
  // today across the book — tracked rows carry the live quote
  const quoted = tracked.filter((c) => c.quote && Number.isFinite(c.quote.chgPct));
  const best = quoted.length > 0 ? quoted.reduce((a, b) => (a.quote!.chgPct >= b.quote!.chgPct ? a : b)) : null;
  const worst = quoted.length > 0 ? quoted.reduce((a, b) => (a.quote!.chgPct <= b.quote!.chgPct ? a : b)) : null;

  const tiles = PULSE.map((p) => ({ ...p, q: quotes?.[p.sym] })).filter(
    (t) => t.q && Number.isFinite(t.q.price) && t.q.price > 0,
  );

  // — MARKET REGIME (R1 apex): held inputs only, computed client-side from
  //   the fetches this component already makes; pure math in lib/regime —
  const regime = useMemo(() => {
    if (!quotes) {
      // hard quote failure: the apex says DATA UNAVAILABLE, it never vanishes
      return quotesErr
        ? computeRegime({ spyTrendPct: null, qqqTrendPct: null, vix: null, vixTrendPts: null, bookLongs: 0, bookShorts: 0, nqVsLevelPct: null })
        : null;
    }
    const longs = (live ?? []).filter((i) => i.side === "long").length;
    const shorts = (live ?? []).filter((i) => i.side === "short").length;
    const nq = quotes["NQ=F"];
    const nqLevels = (live ?? [])
      .filter((i) => /^NQ\b/i.test(i.instrument.trim()))
      .map((i) => parseStatedLevel(i.entry) ?? parseStatedLevel(i.target) ?? parseStatedLevel(i.stop))
      .filter((n): n is number => n !== null);
    const nqVsLevelPct =
      nq && Number.isFinite(nq.price) && nqLevels.length > 0
        ? ((nq.price - nqLevels.reduce((a, b) => a + b, 0) / nqLevels.length) /
            (nqLevels.reduce((a, b) => a + b, 0) / nqLevels.length)) * 100
        : null;
    return computeRegime({
      spyTrendPct: sparkTrendPct(quotes["SPY"]?.closes),
      qqqTrendPct: sparkTrendPct(quotes["QQQ"]?.closes),
      vix: Number.isFinite(quotes["^VIX"]?.price) ? quotes["^VIX"]!.price : null,
      vixTrendPts: sparkTrendPts(quotes["^VIX"]?.closes),
      bookLongs: longs,
      bookShorts: shorts,
      nqVsLevelPct,
    });
  }, [quotes, live, quotesErr]);

  const chip = (k: string, v: React.ReactNode) => (
    <span className="hb-chip">
      <span className="hb-chip-k">{k}</span> {v}
    </span>
  );

  return (
    <div className="hb" aria-label="Daily brief">
      {/* date + session */}
      <div className="hb-top">
        <span className="hb-date">{now.date}</span>
        <span className={`hb-session${now.session === "MARKET OPEN" ? " live" : ""}`}>
          <span className="hb-session-dot" aria-hidden="true" />
          {now.session}
        </span>
      </div>

      {/* MARKET REGIME — the apex (R1): calculated, explainable, never advice */}
      {regime ? (
        <div className="hb-regime" aria-label="Market regime, calculated">
          <div className="hb-regime-top">
            <span className="hb-label">MARKET REGIME</span>
            {regime.label === "UNAVAILABLE" ? (
              <DataTag kind="unavail" title="needs at least 2 live inputs (index trend, VIX, book bias, NQ vs levels)" />
            ) : (
              <>
                <span className={`hb-regime-read r-${regime.label.toLowerCase().replace(" ", "")}`}>
                  {regime.label}
                </span>
                <DataTag kind="calc" title="deterministic read from the inputs below — a market condition, not advice" />
                {regime.agreement ? (
                  <span className="hb-regime-agree">
                    {regime.agreement.agree} of {regime.agreement.voting} inputs agree
                  </span>
                ) : null}
                <button type="button" className="hb-why" onClick={() => setWhy((v) => !v)} aria-expanded={why}>
                  {why ? "HIDE" : "WHY"}
                </button>
              </>
            )}
          </div>
          {why && regime.because.length > 0 ? (
            <ul className="hb-because">
              {regime.because.map((b) => (
                <li key={b.input} className={b.vote > 0 ? "up" : b.vote < 0 ? "down" : ""}>
                  <i aria-hidden>{b.vote > 0 ? "▲" : b.vote < 0 ? "▼" : "◆"}</i>
                  <span className="hb-because-k">{b.input}</span>
                  <span>{b.value}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* THE CALL (feature/the-call) — one card, directly under the regime
          line; replaces the retired Morning Brief. Direction is deterministic
          from the regime model; the thesis line is its only model use. */}
      <TheCallCard />

      {/* R4 F1 — the ask bar rides directly under the apex; chat is the
          ambient analyst, one engage away */}
      {askBar}

      {/* R4 F2 — WHAT'S COMING: the state-aware countdown row */}
      <CountdownRow liveIdeas={live} onAsk={onAsk} />

      {/* pulse row — labeled, with honest failure states (R1) */}
      <div className="hb-pulsewrap">
        <div className="hb-row hb-pulsehead">
          <span className="hb-label">PULSE</span>
          {tiles.length > 0 ? (
            quotesErr ? (
              <DataTag kind="stale" detail={quotesAt ? relativeTime(quotesAt) : undefined} title="quotes unreachable — showing the last good read" />
            ) : (
              <DataTag kind="delayed" detail="60s" title="Yahoo quotes · 60s server cache · 60s poll" />
            )
          ) : quotesErr ? (
            <DataTag kind="unavail" title="quotes unreachable" />
          ) : (
            <span className="hb-pending">loading…</span>
          )}
        </div>
        {tiles.length > 0 ? (
          <div className="hb-pulse">
            {tiles.map((t) => (
              <span key={t.sym} className="hb-tile">
                <span className="hb-tile-l">{t.label}</span>
                <span className="hb-tile-px">{fmtPx(t.q!.price)}</span>
                <span className={`hb-tile-chg ${t.q!.chgPct >= 0 ? "hl-up" : "hl-down"}`}>
                  {fmtPct(t.q!.chgPct)}
                </span>
                <Spark closes={t.q!.closes} up={t.q!.chgPct >= 0} />
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* NQ LEVELS chip (R2) — the terminal module's teaser; the full read
          lives in the dock. Renders only when the feed answers. */}
      {nql && nql.levels.price !== null ? (
        <div className="hb-row hb-nql">
          <span className="hb-label">NQ LEVELS</span>
          <span className="hb-chips">
            {chip("NQ", <>{Math.round(nql.levels.price).toLocaleString("en-US")}</>)}
            {nql.bias.label !== "UNAVAILABLE" ? (
              <span className={`hb-chip nql-bias b-${nql.bias.label.toLowerCase()}`}
                title={`calculated condition — ${nql.bias.votes.map((v) => `${v.input} ${v.value}`).join(" · ")}`}>
                {nql.bias.label}
              </span>
            ) : null}
            {nql.levels.pivot !== null ? chip("PIVOT", <>{Math.round(nql.levels.pivot).toLocaleString("en-US")}</>) : null}
            {nql.levels.vwap !== null ? chip("VWAP", <>{Math.round(nql.levels.vwap).toLocaleString("en-US")}</>) : null}
            <DataTag kind="delayed" detail="60s" title="NQ=F · Yahoo daily + 5m bars" />
          </span>
        </div>
      ) : null}

      {/* R4 F3 — WHAT'S MOVING: the sector heatmap */}
      <SectorHeatmap onAsk={onAsk} />

      {/* desk line — null-aware: a failed source says so instead of printing
          a fabricated zero (R1 audit fix) */}
      {live !== null || cards !== null || liveErr || cardsErr ? (
        <div className="hb-row">
          <span className="hb-label">DESK</span>
          <span className="hb-chips">
            {live !== null
              ? chip("LIVE", <>{live.length}</>)
              : liveErr
                ? chip("LIVE", <DataTag kind="unavail" title="the ideas board is unreachable" />)
                : null}
            {cards !== null
              ? chip("TRACKED", <>{tracked.length}</>)
              : cardsErr
                ? chip("TRACKED", <DataTag kind="unavail" title="the tracked feed is unreachable" />)
                : null}
            {cards !== null ? chip("TRIGGERED", <>{triggered}</>) : null}
            {winRate != null
              ? chip(
                  "WIN",
                  <>
                    {winRate}% <span className="hb-dim">{wins}/{called.length}</span>
                  </>,
                )
              : null}
            {avgMfe != null && avgMae != null
              ? chip(
                  "MFE/MAE",
                  <>
                    <span className="hl-up">{fmtPct(avgMfe)}</span> /{" "}
                    <span className="hl-down">{fmtPct(avgMae)}</span>
                  </>,
                )
              : null}
            {best?.quote
              ? chip(
                  "TODAY",
                  <>
                    <span className="hl-up">
                      {best.ticker} {fmtPct(best.quote.chgPct)}
                    </span>
                    {worst && worst !== best && worst.quote ? (
                      <>
                        {" · "}
                        <span className="hl-down">
                          {worst.ticker} {fmtPct(worst.quote.chgPct)}
                        </span>
                      </>
                    ) : null}
                  </>,
                )
              : null}
          </span>
        </div>
      ) : null}

      {/* R4 F6 — DESK REPORT: ingest + earnings condensed, teaser depth only,
          one path into the Terminal */}
      <div className="hb-deskreport">
        {/* P3 — visitors hear desk language ("updated · new calls today");
            the owner session keeps the full LATEST INGEST detail */}
        {isOwner && ingest !== undefined ? (
          <div className="hb-row">
            <span className="hb-label">LATEST INGEST</span>
            {ingest === null ? (
              <span className="hb-absent">nothing ingested yet</span>
            ) : (
              <span className="hb-ingest">
                {ingest.source || "transcript"} → {ingest.ideaDrafts} idea draft
                {ingest.ideaDrafts !== 1 ? "s" : ""} · {ingest.tapeDrafts} tape draft
                {ingest.tapeDrafts !== 1 ? "s" : ""}
                <span className="hb-dim"> · {relativeTime(ingest.ts)}</span>
              </span>
            )}
          </div>
        ) : !isOwner ? (
          <div className="hb-row">
            <span className="hb-label">DESK</span>
            {(() => {
              const newest = Math.max(
                ingest ? ingest.ts : 0,
                ...(live ?? []).map((i) => i.updatedAt),
              );
              const etDay = (ms: number) =>
                new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
              const today = etDay(Date.now());
              const fresh = (live ?? []).filter((i) => etDay(i.createdAt) === today).length;
              return newest > 0 ? (
                <span className="hb-ingest">
                  updated {relativeTime(newest)}
                  <span className="hb-dim"> · {fresh} new call{fresh === 1 ? "" : "s"} today</span>
                </span>
              ) : (
                <span className="hb-absent">quiet — nothing on the desk yet</span>
              );
            })()}
          </div>
        ) : null}
        <div className="hb-row">
          <span className="hb-label">EARNINGS</span>
          <DataTag kind="unavail" title="the earnings calendar needs a keyed provider tier — recorded under data still required" />
        </div>
        <a className="hb-terminal-link" href="/?view=terminal">OPEN THE TERMINAL →</a>
      </div>

      {/* R4 F4 — WHAT'S BEING SAID: headlines as cards (source · age ·
          ticker chips · ask-August); existing RSS set only */}
      {deskFeed ? (
        /* P2 ALTERNATIVE (env-flagged, OFF by default) — the desk's own tape
           instead of third-party headlines: zero outside brands render */
        <div className="hb-news">
          <div className="hb-row">
            <span className="hb-label">FROM THE DESK</span>
          </div>
          {tapeNotes === null ? (
            <span className="hb-absent">loading…</span>
          ) : tapeNotes.length === 0 ? (
            <span className="hb-absent">quiet — nothing on the tape yet</span>
          ) : (
            <ul className="hb-news-list hb-news-cards">
              {tapeNotes.slice(0, 5).map((t) => (
                <li key={t.id} className="hb-news-card">
                  <span className="hb-news-title">{t.note}</span>
                  <span className="hb-news-meta">
                    <b className="hb-news-tkr">{t.symbol}</b>
                    {t.ts > 0 ? ` · ${relativeTime(t.ts)}` : ""}
                    {onAsk ? (
                      <button type="button" className="hb-news-ask"
                        onClick={() => onAsk(`The desk tape says: "${t.note}" (${t.symbol}). What should I watch?`)}>
                        ASK AUGUST →
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
      <div className="hb-news">
        <div className="hb-row">
          <span className="hb-label">WHAT&apos;S BEING SAID</span>
          {news !== null && news.length > 0 ? (
            <DataTag kind="delayed" detail="15m" title="free RSS · 15m server cache" />
          ) : null}
        </div>
        {news === null ? (
          <span className="hb-absent">loading…</span>
        ) : news.length === 0 ? (
          <span className="hb-absent">{newsErr ? "headlines unreachable" : "no headlines right now"}</span>
        ) : (
          <ul className="hb-news-list hb-news-cards">
            {news.slice(0, 5).map((h) => {
              const tickers = [...new Set(h.title.match(TICKER_WHITELIST) ?? [])].slice(0, 3);
              return (
                <li key={h.link} className="hb-news-card">
                  {/* P2 — attribution stays (third-party headline), but in the
                      label voice: smallest muted mono, card corner */}
                  <i className="hb-news-src">{h.publisher}</i>
                  <a href={h.link} target="_blank" rel="noopener noreferrer" className="hb-news-title">
                    {h.title}
                  </a>
                  <span className="hb-news-meta">
                    {h.publishedAt > 0 ? relativeTime(h.publishedAt) : ""}
                    {tickers.map((t) => (
                      <b key={t} className="hb-news-tkr">{t}</b>
                    ))}
                    {onAsk ? (
                      <button
                        type="button"
                        className="hb-news-ask"
                        onClick={() => onAsk(`What does this headline mean for the market: "${h.title}" (${h.publisher})?`)}
                      >
                        ASK AUGUST →
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      )}
    </div>
  );
}
