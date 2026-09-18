"use client";

// NEXT (feature/density-pass; reskinned feat/v4-2-today) — ONE card: the next
// high-impact print, when it lands, and a live countdown. The countdown is the
// card's one big number; the event is its title.
//
// feat/v4-2-today deleted what nothing rendered: the route no longer computes
// the 15-minute NQ reaction or the FRED actual, and lib/calendar-actuals is
// gone with the daily pass step that warmed it.

import { useEffect, useState } from "react";
import DataTag from "@/components/DataTag";
import { fmtEt, type CalEvent, type EventState } from "@/lib/calendar-feed";

type Row = CalEvent & { state: EventState };

function countdown(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((ts - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d > 0 ? `${d}d ${h}h ${String(m).padStart(2, "0")}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}

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

  const head = (chip: React.ReactNode) => (
    <div className="td-head">
      <h2 className="td-label">Next high-impact print</h2>
      {chip}
    </div>
  );

  if (!rows) {
    return (
      <section className="td-card td-next" aria-label="Next high-impact print">
        {head(err ? <DataTag kind="unavail" title="the calendar feed is unreachable" /> : null)}
        <p className="td-meta">{err ? "The calendar feed can't be reached right now." : "loading…"}</p>
      </section>
    );
  }

  function eventNow(e: Row): EventState {
    const dt = e.ts - now;
    if (dt <= 0) return now - e.ts <= 12 * 3600_000 ? "released" : "past";
    return dt < 48 * 3600_000 ? "imminent" : "distant";
  }
  const imminent = rows.filter((e) => eventNow(e) === "imminent" && (e.cls !== null || e.impact === "High"));
  const distant = rows.filter((e) => eventNow(e) === "distant" && (e.cls !== null || e.impact === "High"));
  // The next event is the first one still AHEAD of now: released rows carry a
  // past ts and sort first, so rows[0] would name a print that already
  // happened. imminent then distant is exactly that ordering.
  const next = imminent[0] ?? distant[0] ?? null;

  return (
    <section className="td-card td-next" aria-label="Next high-impact print">
      {head(<DataTag kind="delayed" detail="weekly feed" title="free economic calendar · vetted against known release schedules" />)}
      {next ? (
        <>
          <span className="td-figure td-countdown">{countdown(next.ts, now)}</span>
          <span className="td-next-event">
            <span className="td-title">{next.title}</span>
            <span className="td-meta">{fmtEt(next.ts)}</span>
          </span>
        </>
      ) : (
        <p className="td-meta">Nothing high-impact left on this week&apos;s feed.</p>
      )}
    </section>
  );
}
