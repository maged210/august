"use client";

// WHAT'S COMING (R4 F2) — the state-aware countdown row. Three states per
// card (F2-A): DISTANT = one slim muted line, never a hero; IMMINENT = the
// full countdown card with expected/prior + impact; RELEASED = the print
// flips live with the honest reaction line (omitted when the bars don't
// cover it) and an explicit note that the free feed carries no actuals.
// BRIDGE RULE (F2-B): every card carries ask-August; when the live book
// holds an index call, the "desk is positioned" chip links the Terminal.
// QUIET-DAY RULE (F2-C): with nothing inside 48h the whole row collapses
// to one quiet line — the page leads with regime/heatmap/feed/desk.

import { useEffect, useState } from "react";
import DataTag from "@/components/DataTag";
import type { PublicIdea } from "@/lib/ideas";
import type { CalEvent, EventState } from "@/lib/calendar-feed";

type Row = CalEvent & { state: EventState; reaction15m: number | null };

const INDEX_RE = /^(NQ|ES|SPY|QQQ|YM|RTY)\b/i;

function fmtEt(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }) + " ET";
}
function countdown(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((ts - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d > 0 ? `${d}d ${h}h ${String(m).padStart(2, "0")}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}

export default function CountdownRow({ liveIdeas, onAsk }: {
  liveIdeas: PublicIdea[] | null;
  onAsk?: (text: string) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      fetch("/api/calendar", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { ok?: boolean; events?: Row[] }) => {
          if (!cancelled && j.ok && Array.isArray(j.events)) { setRows(j.events); setErr(false); }
          else if (!cancelled) setErr(true);
        })
        .catch(() => { if (!cancelled) setErr(true); });
    };
    pull();
    const id = window.setInterval(() => { if (!document.hidden) pull(); }, 5 * 60_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { cancelled = true; window.clearInterval(id); window.clearInterval(tick); };
  }, []);

  const deskChip = (() => {
    const idx = (liveIdeas ?? []).find((i) => INDEX_RE.test(i.instrument.trim()) && i.side);
    return idx ? { label: `${idx.instrument.toUpperCase()} ${idx.side!.toUpperCase()}` } : null;
  })();

  if (err && !rows) {
    return (
      <div className="cdr cdr-quiet">
        <span className="hb-label">CALENDAR</span>
        <DataTag kind="unavail" title="the calendar feed is unreachable" />
      </div>
    );
  }
  if (!rows) return null;

  const imminent = rows.filter((e) => eventNow(e) === "imminent" && (e.cls !== null || e.impact === "High"));
  const released = rows.filter((e) => eventNow(e) === "released" && (e.cls !== null || e.impact === "High"));
  const distant = rows.filter((e) => eventNow(e) === "distant" && (e.cls !== null || e.impact === "High"));
  function eventNow(e: Row): EventState {
    const dt = e.ts - now;
    if (dt <= 0) return now - e.ts <= 12 * 3600_000 ? "released" : "past";
    return dt < 48 * 3600_000 ? "imminent" : "distant";
  }

  // F2-C — the quiet collapse: nothing hot, one muted line
  if (imminent.length === 0 && released.length === 0) {
    const next = distant[0];
    return (
      <div className="cdr cdr-quiet">
        <span className="hb-label">CALENDAR</span>
        {next ? (
          <span className="cdr-quietline">
            next: {next.cls ?? next.title.toUpperCase()} · {fmtEt(next.ts)} · in {countdown(next.ts, now)}
          </span>
        ) : (
          <span className="cdr-quietline">nothing high-impact on this week&apos;s tape</span>
        )}
        <DataTag kind="delayed" detail="weekly feed" title="free economic calendar · vetted against known release schedules" />
      </div>
    );
  }

  return (
    <div className="cdr">
      <div className="hb-row cdr-head">
        <span className="hb-label">WHAT&apos;S COMING</span>
        <DataTag kind="delayed" detail="weekly feed" title="free economic calendar · vetted against known release schedules" />
      </div>
      <div className="cdr-cards">
        {released.map((e) => (
          <div key={e.ts} className="cdr-card cdr-released">
            <span className="cdr-name">{e.cls ?? e.title.toUpperCase()}</span>
            <span className="cdr-printed">PRINTED · {fmtEt(e.ts)}</span>
            <span className="cdr-exp">
              {e.forecast ? `expected ${e.forecast}` : null}
              {e.forecast && e.previous ? " · " : null}
              {e.previous ? `prior ${e.previous}` : null}
            </span>
            {e.reaction15m !== null ? (
              <span className={`cdr-react ${e.reaction15m >= 0 ? "hl-up" : "hl-down"}`}>
                NQ {e.reaction15m >= 0 ? "+" : ""}{e.reaction15m.toFixed(1)}% in the 15m after the print
              </span>
            ) : null}
            <span className="cdr-noact">actuals aren&apos;t carried by the free feed</span>
            {onAsk ? (
              <button type="button" className="cdr-ask" onClick={() => onAsk(`The ${e.cls ?? e.title} just printed (${fmtEt(e.ts)}). What could it mean for the tape?`)}>
                ASK AUGUST →
              </button>
            ) : null}
          </div>
        ))}
        {imminent.map((e) => (
          <div key={e.ts} className="cdr-card">
            <span className="cdr-name">{e.cls ?? e.title.toUpperCase()}</span>
            <span className="cdr-count">{countdown(e.ts, now)}</span>
            <span className="cdr-when">{fmtEt(e.ts)}</span>
            <span className="cdr-exp">
              {e.forecast ? `expected ${e.forecast}` : null}
              {e.forecast && e.previous ? " · " : null}
              {e.previous ? `prior ${e.previous}` : null}
            </span>
            <span className={`cdr-impact im-${String(e.impact).toLowerCase()}`}>{String(e.impact).toUpperCase()} IMPACT</span>
            <span className="cdr-acts">
              {onAsk ? (
                <button type="button" className="cdr-ask" onClick={() => onAsk(`${e.title} prints ${fmtEt(e.ts)} (expected ${e.forecast ?? "n/a"}, prior ${e.previous ?? "n/a"}). What could this move?`)}>
                  ASK AUGUST →
                </button>
              ) : null}
              {deskChip ? (
                <a className="cdr-desk" href="/?view=terminal" title="the live book holds an index call — see the desk">
                  desk is positioned: {deskChip.label}
                </a>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      {distant.length > 0 ? (
        <div className="cdr-strip">
          {distant.slice(0, 4).map((e) => (
            <span key={e.ts} className="cdr-stripitem">
              {e.cls ?? e.title.toUpperCase()} · {fmtEt(e.ts)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
