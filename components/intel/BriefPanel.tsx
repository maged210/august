"use client";

import { useState, type ReactNode } from "react";
import type { DailyBrief, OptionBriefIdea, ValueField } from "@/lib/intel/types";

// The read-only brief renderer — the desk's ARCHIVE expansions draw past
// briefs through this one component (the BOARD carries its own live brief
// rail). Deliberately lightweight: types + React only (no extra import
// chains) and styled from globals.css.
//
// Source privacy: cards carry no attribution by default. `ownerView` (the
// server-side INTEL_OWNER_VIEW flag, relayed by the briefs API) is the ONLY
// thing that lets the TRACE toggle exist; a redacted brief has no source
// fields to reveal even if this flag were forged client-side.

const watchUrl = (v: string, t?: number) =>
  `https://www.youtube.com/watch?v=${v}${t ? `&t=${Math.floor(t)}s` : ""}`;
const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ValueField → display text, honest about gaps (same ⌀ convention as /intel).
const vf = (v: ValueField | undefined): string => {
  if (!v) return "⌀ n/s";
  if (v.text && !/not specified/i.test(v.text)) return v.text;
  if (v.value !== null) return String(v.value);
  return "⌀ n/s";
};

const glyph = (d: string) =>
  d === "bullish" ? <span className="desk-glyph pos">▲</span>
  : d === "bearish" ? <span className="desk-glyph neg">▼</span>
  : <span className="desk-glyph">—</span>;

// One compact card shape for both trade ideas and option candidates.
type CardData = {
  key: string;
  ticker: string;
  direction: string;
  thesis: string;
  entry: string;
  invalidation: string;
  targets: string;
  stat: string; // conviction (options) or confidence (ideas)
  channelTitle?: string;
  videoId?: string;
  startSeconds?: number;
};

function candidateCard(o: OptionBriefIdea, i: number): CardData {
  return {
    key: o.id || `cand-${i}`,
    ticker: o.underlyingSymbol,
    direction: o.direction,
    // OptionIdea has no thesis field — strategy + first catalyst is the honest line.
    thesis: `${o.strategyType.replace(/_/g, " ")}${o.catalysts[0] ? ` — ${o.catalysts[0]}` : ""}`,
    entry: o.underlyingTrigger != null
      ? String(o.underlyingTrigger)
      : o.entryCondition?.text && o.entryCondition.type !== "unspecified"
        ? o.entryCondition.text
        : "⌀ n/s",
    invalidation: o.underlyingInvalidation != null ? String(o.underlyingInvalidation) : "⌀ n/s",
    targets: o.underlyingTargets.length ? o.underlyingTargets.join(" / ") : "⌀ n/s",
    stat: o.conviction === "unspecified" ? "—" : o.conviction,
    channelTitle: o.channelTitle,
    videoId: o.videoId,
    startSeconds: o.sourceStartSeconds,
  };
}

function IdeaCardRow({ c, trace }: { c: CardData; trace: boolean }) {
  return (
    <div className="desk-idea">
      <div className="desk-idea-top">
        {glyph(c.direction)}
        <span className="desk-tkr">{c.ticker}</span>
        <span className="desk-stat">{c.stat}</span>
      </div>
      <div className="desk-thesis" title={c.thesis}>{c.thesis}</div>
      <div className="desk-vals">
        <span>ENT <b>{c.entry}</b></span>
        <span>INV <b>{c.invalidation}</b></span>
        <span>TGT <b>{c.targets}</b></span>
      </div>
      {trace && c.videoId ? (
        <a
          className="desk-trace"
          href={watchUrl(c.videoId, c.startSeconds)}
          target="_blank"
          rel="noreferrer"
        >
          ▸ {c.channelTitle || "source"} @ {mmss(c.startSeconds ?? 0)}
        </a>
      ) : null}
    </div>
  );
}

export default function BriefPanel({
  brief,
  ownerView,
  aside,
}: {
  brief: DailyBrief;
  ownerView: boolean;
  aside?: ReactNode; // Desk slots the live NQ levels panel here; Archive passes nothing
}) {
  const [trace, setTrace] = useState(false);

  const ideas: CardData[] = brief.topIdeas.slice(0, 3).map((i) => ({
    key: i.id,
    ticker: i.ticker,
    direction: i.direction,
    thesis: i.thesis,
    entry: vf(i.entry),
    invalidation: vf(i.invalidation),
    targets: i.targets[0] ? vf(i.targets[0]) : "⌀ n/s",
    stat: `${(i.confidence * 100).toFixed(0)}%`,
    channelTitle: i.channelTitle,
    videoId: i.videoId,
    startSeconds: i.sourceStartSeconds,
  }));
  const candidates = (brief.options?.augustCandidates ?? []).slice(0, 3).map(candidateCard);
  const catalysts = brief.catalysts.slice(0, 6);

  return (
    <div className="desk-grid">
      {/* Hero keeps its natural height; ideas and the side column flow with
          the content — the ARCHIVE view scrolls internally, so no viewport-fit
          gymnastics are needed here. */}
      <section className="panel desk-hero">
        <div className="panel-head">
          Brief · {brief.date}
          {ownerView ? (
            <button
              type="button"
              className={`desk-trace-toggle${trace ? " on" : ""}`}
              onClick={() => setTrace((t) => !t)}
              aria-pressed={trace}
            >
              trace
            </button>
          ) : null}
        </div>
        <p className="desk-read60">{brief.read60 || brief.posture || "No narrative for this brief."}</p>
        {!brief.grounded ? (
          <div className="desk-note">AI narrative offline — structured intel only.</div>
        ) : null}
      </section>

      <div className="desk-ideas">
        {ideas.length > 0 && (
          <section className="panel">
            <div className="panel-head">Top ideas</div>
            {ideas.map((c) => <IdeaCardRow key={c.key} c={c} trace={trace} />)}
          </section>
        )}

        {candidates.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              Options candidates <span className="todo">AUGUST-generated</span>
            </div>
            {candidates.map((c) => <IdeaCardRow key={c.key} c={c} trace={trace} />)}
          </section>
        )}
      </div>

      <div className="desk-side">
        {aside}
        {catalysts.length > 0 && (
          <section className="panel desk-catalysts">
            <div className="panel-head">Catalysts · {brief.date}</div>
            <ul className="econ-list">
              {catalysts.map((c, i) => (
                <li key={i}>
                  <span className="econ-t">
                    {c.eventTime
                      ? new Date(c.eventTime).toLocaleTimeString("en-US", {
                          timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
                        })
                      : "—"}
                  </span>
                  <span className="econ-e">{c.name}</span>
                  <span className="econ-i">{c.importance}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
