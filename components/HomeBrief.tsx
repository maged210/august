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
import type { Headline } from "@/lib/headlines";
import { relativeTime } from "@/lib/ideas";
import DataTag from "@/components/DataTag";
import { computeRegime, parseStatedLevel, sparkTrendPct, sparkTrendPts } from "@/lib/regime";

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

export default function HomeBrief() {
  const [now, setNow] = useState(() => sessionNow());
  const [quotes, setQuotes] = useState<Record<string, Quote> | null>(null);
  const [quotesErr, setQuotesErr] = useState(false);
  const [quotesAt, setQuotesAt] = useState<number | null>(null);
  const [live, setLive] = useState<PublicIdea[] | null>(null);
  const [liveErr, setLiveErr] = useState(false);
  const [cards, setCards] = useState<FeedCard[] | null>(null);
  const [cardsErr, setCardsErr] = useState(false);
  const [why, setWhy] = useState(false);
  const [ingest, setIngest] = useState<PublicIngest | null | undefined>(undefined); // undefined = pending
  const [news, setNews] = useState<Headline[] | null>(null);
  const [newsErr, setNewsErr] = useState(false);
  const [, setTick] = useState(0);

  // the session line follows the ET clock
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(sessionNow());
      setTick((t) => t + 1); // refreshes the relative times too
    }, 30_000);
    return () => window.clearInterval(id);
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

  // headlines — server caches ~15 min; a gentle 5 min client poll is plenty
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      fetch("/api/headlines", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { headlines?: Headline[] }) => {
          if (cancelled) return;
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

      {/* latest ingest */}
      {ingest !== undefined ? (
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
      ) : null}

      {/* headlines */}
      <div className="hb-news">
        <span className="hb-label">HEADLINES</span>
        {news === null ? (
          <span className="hb-absent">loading…</span>
        ) : news.length === 0 ? (
          <span className="hb-absent">{newsErr ? "headlines unreachable" : "no headlines right now"}</span>
        ) : (
          <ul className="hb-news-list">
            {news.slice(0, 5).map((h) => (
              <li key={h.link}>
                <a href={h.link} target="_blank" rel="noopener noreferrer" className="hb-news-title">
                  {h.title}
                </a>
                <span className="hb-news-meta">
                  {h.publisher}
                  {h.publishedAt > 0 ? ` · ${relativeTime(h.publishedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
