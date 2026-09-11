"use client";

// NEXT (feature/density-pass) — ONE LINE: the next high-impact event, when it
// prints, and a live countdown. The state cards (distant / imminent /
// released), the reaction line, the ask buttons, the desk chip and the distant
// strip are gone. This row states the next thing and nothing else.
//
// /api/calendar still computes the released reaction and the FRED actual
// backfill. Nothing renders them now; the route is out of scope for a
// structure pass, so it is left alone rather than half-trimmed.

import { useEffect, useState } from "react";
import DataTag from "@/components/DataTag";
import { fmtEt, type CalEvent, type EventState } from "@/lib/calendar-feed";

type Row = CalEvent & {
  state: EventState;
  reaction15m: number | null;
  reactionWhy: string | null;
  /** the printed value, backfilled from FRED for the mapped majors */
  actual: string | null;
};


function countdown(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((ts - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d > 0 ? `${d}d ${h}h ${String(m).padStart(2, "0")}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}

// feature/density-pass — the cards carried the ASK buttons and the desk chip,
// so `liveIdeas` and `onAsk` have no consumer left here. The per-event ask
// cache in lib/calendar-feed is untouched and still serves the bar's own
// calendar asks; only this component stopped dispatching them.
export default function CountdownRow() {
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
  const distant = rows.filter((e) => eventNow(e) === "distant" && (e.cls !== null || e.impact === "High"));
  function eventNow(e: Row): EventState {
    const dt = e.ts - now;
    if (dt <= 0) return now - e.ts <= 12 * 3600_000 ? "released" : "past";
    return dt < 48 * 3600_000 ? "imminent" : "distant";
  }

  // feature/density-pass — ONE LINE. The cards and the distant strip are gone.
  // The next event is the first one still AHEAD of now: released rows carry a
  // past ts and sort first, so rows[0] would name a print that already
  // happened. imminent then distant is exactly that ordering.
  const next = imminent[0] ?? distant[0] ?? null;
  return (
    <div className="cdr cdr-quiet">
      <span className="hb-label">NEXT</span>
      {next ? (
        <span className="cdr-quietline">
          {next.title.toUpperCase()} · {fmtEt(next.ts)} · in {countdown(next.ts, now)}
        </span>
      ) : (
        <span className="cdr-quietline">nothing high-impact on this week&apos;s tape</span>
      )}
      <DataTag kind="delayed" detail="weekly feed" title="free economic calendar · vetted against known release schedules" />
    </div>
  );
}
