"use client";

// NQ LEVELS (COMMAND CENTER R2) — first-class session levels for the real
// contract: prev H/L/C + pivot (daily bars), VWAP + overnight H/L only when
// the intraday series honestly supports them (omitted otherwise, per the
// standing law), S/R chips parsed from stated levels on live NQ ideas, and
// a BULLISH/NEUTRAL/BEARISH readout that is a CALCULATED market condition —
// never advice. Every number carries its integrity tag.

import { useEffect, useState } from "react";
import DataTag from "@/components/DataTag";
import type { BiasRead, SessionLevels } from "@/lib/levels";
import { parseStatedLevel } from "@/lib/regime";
import type { PublicIdea } from "@/lib/ideas";

const px = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2));

export default function NqLevelsModule({ liveIdeas }: { liveIdeas: PublicIdea[] | null }) {
  const [data, setData] = useState<{ levels: SessionLevels; bias: BiasRead } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      fetch("/api/intel/levels", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { ok?: boolean; levels?: SessionLevels; bias?: BiasRead }) => {
          if (cancelled) return;
          if (j.ok && j.levels && j.bias) { setData({ levels: j.levels, bias: j.bias }); setErr(false); }
          else setErr(true);
        })
        .catch(() => { if (!cancelled) setErr(true); });
    };
    pull();
    const id = window.setInterval(() => { if (!document.hidden) pull(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // S/R from the live book's stated NQ levels (verbatim source, parsed)
  const bookLevels = (liveIdeas ?? [])
    .filter((i) => /^NQ\b/i.test(i.instrument.trim()))
    .flatMap((i) => [
      { kind: "entry", v: parseStatedLevel(i.entry) },
      { kind: "target", v: parseStatedLevel(i.target) },
      { kind: "stop", v: parseStatedLevel(i.stop) },
    ])
    .filter((x): x is { kind: string; v: number } => x.v !== null)
    .slice(0, 4);

  const l = data?.levels;
  const rows: Array<[string, number | null]> = l
    ? [
        ["PREV HIGH", l.prevHigh],
        ["PREV LOW", l.prevLow],
        ["PREV CLOSE", l.prevClose],
        ["PIVOT", l.pivot],
        ["VWAP", l.vwap],
        ["O/N HIGH", l.onHigh],
        ["O/N LOW", l.onLow],
      ]
    : [];

  return (
    <section className="ifm" aria-label="NQ session levels">
      <div className="ifm-h">
        <span className="ifm-title">NQ LEVELS</span>
        {data ? (
          <DataTag kind="delayed" detail="60s" title="NQ=F · Yahoo daily + 5m bars · 60s poll" />
        ) : err ? (
          <DataTag kind="unavail" title="levels feed unreachable" />
        ) : (
          <span className="hb-pending">loading…</span>
        )}
      </div>
      {data && l ? (
        <div className="ifm-body nql">
          <div className="nql-head">
            <span className="nql-px">{l.price !== null ? px(l.price) : null}</span>
            {data.bias.label === "UNAVAILABLE" ? (
              <DataTag kind="unavail" title="needs 2+ reference levels" />
            ) : (
              <span
                className={`nql-bias b-${data.bias.label.toLowerCase()}`}
                title={`calculated condition — ${data.bias.votes.map((v) => `${v.input} ${v.value}`).join(" · ")}`}
              >
                {data.bias.label}
              </span>
            )}
            <DataTag kind="calc" title="condition calculated from price vs prev close / pivot / VWAP — not advice" />
          </div>
          <div className="nql-grid">
            {rows.map(([k, v]) =>
              v !== null ? (
                <span key={k} className="nql-cell">
                  <i>{k}</i>
                  <b>{px(v)}</b>
                </span>
              ) : (
                <span key={k} className="nql-cell nql-off" title={k === "VWAP" ? "no volume on the intraday series — omitted, never approximated" : "insufficient overnight bars — omitted, never approximated"}>
                  <i>{k}</i>
                  <b>—×</b>
                </span>
              ),
            )}
          </div>
          {bookLevels.length > 0 ? (
            <div className="nql-book">
              <i>BOOK LEVELS</i>
              {bookLevels.map((b, ix) => (
                <span key={ix} className={`nql-bl nql-bl-${b.kind}`} title={`stated ${b.kind} on a live NQ idea`}>
                  {px(b.v)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : err ? (
        <div className="ifm-body nql-empty">NQ LEVELS · DATA UNAVAILABLE — the levels feed is unreachable</div>
      ) : null}
    </section>
  );
}
