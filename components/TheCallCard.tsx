"use client";

// THE CALL (feature/the-call) — ONE card on the floor, directly under the
// regime line. AUGUST's daily NQ call (direction is deterministic from the
// regime model, server-side), the owner's one-tap agree/disagree, and both
// running records. States: OPEN → TAKEN/LOCKED → SETTLED; weekends say
// NO SESSION; a dead-even regime says NO CALL. The thesis line is the serif-
// italic register; every data line is mono caps. Records start 0–0 and show
// from day one — never seeded, shown even when AUGUST is losing.

import { useEffect, useRef, useState } from "react";
import DataTag from "@/components/DataTag";

type Tally = { wins: number; losses: number; pushes: number };
type Side = "HIGHER" | "LOWER";
type CallResp = {
  ok: boolean;
  now: number;
  record: { august: Tally; you: Tally };
  active: {
    forDate: string;
    side: Side;
    lockTs: number;
    locked: boolean;
    youSide: Side | null;
    thesis: string | null;
  } | null;
  noCall: { reason: "no_session" | "dead_even" | "unavailable" | "not_generated"; nextDate: string } | null;
  settled: {
    forDate: string;
    side: Side;
    result: Side | "FLAT" | "NO_SESSION";
    closePct: number | null;
    augustWin: boolean | null;
    youSide: Side | null;
    youWin: boolean | null;
    disagree: string | null;
  } | null;
};

// display copies of the engine's pure formatters (lib/call is server-only)
const fmtRec = (t: Tally) => `${t.wins}–${t.losses}`;
function fmtPct(pct: number): string {
  if (pct === 0) return "0.0%";
  for (const dp of [1, 2, 4]) {
    const s = pct.toFixed(dp);
    if (Number(s) !== 0) return `${pct > 0 ? "+" : ""}${s}%`;
  }
  return `${pct > 0 ? "+" : "-"}0.0001%`; // sub-tick dust — never a fake flat
}
const weekdayShort = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const etToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export default function TheCallCard() {
  const [st, setSt] = useState<CallResp | null>(null);
  const [busy, setBusy] = useState(false);
  // consecutive failed reads — two misses flag the card STALE (R1 honesty)
  const [misses, setMisses] = useState(0);
  // monotonic request generation: an older in-flight GET must never overwrite
  // the state a just-resolved take rendered
  const genRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      const gen = ++genRef.current;
      fetch("/api/call", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: CallResp) => {
          if (cancelled || gen !== genRef.current) return;
          if (j.ok) {
            setSt(j);
            setMisses(0);
          } else setMisses((n) => n + 1);
        })
        .catch(() => {
          if (!cancelled) setMisses((n) => n + 1);
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

  if (!st) return null; // loading or unreachable — the floor simply doesn't show it

  const refetch = () => {
    const gen = ++genRef.current;
    fetch("/api/call", { cache: "no-store" })
      .then((r) => r.json())
      .then((k: CallResp) => {
        if (gen === genRef.current && k.ok) {
          setSt(k);
          setMisses(0);
        }
      })
      .catch(() => setMisses((n) => n + 1));
  };

  const take = (side: Side) => {
    if (busy) return;
    setBusy(true);
    const gen = ++genRef.current;
    fetch("/api/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side }),
    })
      .then((r) => r.json())
      .then((j: CallResp) => {
        if (gen !== genRef.current) return;
        if (j.ok) {
          setSt(j);
          setMisses(0);
        } else refetch(); // rejected (locked/taken/full) — show the truth
      })
      .catch(() => refetch())
      .finally(() => setBusy(false));
  };

  const a = st.active;
  const s = st.settled;
  const other: Side | null = a ? (a.side === "HIGHER" ? "LOWER" : "HIGHER") : null;
  // an unsettled call whose date already passed (settle lag) is named by its
  // day, never mislabeled "TODAY"
  const dayWord = a
    ? a.forDate > etToday()
      ? "TOMORROW"
      : a.forDate === etToday()
        ? "TODAY"
        : weekdayShort(a.forDate).toUpperCase()
    : "";
  // a lag-settled result carries its date — yesterday's close must never read
  // as today's
  const settledDay = s && s.forDate !== etToday() ? ` (${weekdayShort(s.forDate)})` : "";

  return (
    <div className="callcard" aria-label="THE CALL — AUGUST's daily NQ call">
      {/* the settled result stays on the card through its own ET day */}
      {s && s.result !== "NO_SESSION" ? (
        <div className="call-block">
          <span className="call-line">
            {s.result === "FLAT" ? (
              <>NQ CLOSED FLAT{settledDay} · PUSH — counted for neither side</>
            ) : (
              <>
                NQ CLOSED {s.closePct !== null ? fmtPct(s.closePct) : s.result}
                {settledDay} · AUGUST {s.augustWin ? "✓" : "✗"}
                {s.youWin !== null ? <> · YOU {s.youWin ? "✓" : "✗"}</> : null}
              </>
            )}
          </span>
          {s.disagree ? <span className="call-why">{s.disagree}</span> : null}
        </div>
      ) : s ? (
        <div className="call-block">
          <span className="call-line">NO SESSION · {weekdayShort(s.forDate)}&apos;s call is void — no bar printed</span>
        </div>
      ) : null}

      {a ? (
        <div className="call-block">
          {a.thesis ? <p className="call-thesis">{a.thesis}</p> : null}
          <span className="call-head">
            THE CALL · NQ {dayWord}
            <DataTag
              kind="calc"
              title="direction was derived deterministically from the regime model at the pass that opened this call — the sign of its vote sum; dead even = no call. The thesis above is AUGUST's current read. Not advice."
            />
            {misses >= 2 ? <DataTag kind="stale" title="the card can't reach the server — showing the last good state" /> : null}
          </span>
          {a.youSide ? (
            <span className="call-line">
              YOU: {a.youSide} · AUGUST: {a.side} · settles at the close
            </span>
          ) : a.locked ? (
            <span className="call-line">
              AUGUST: {a.side} · you didn&apos;t call · settles at the close
            </span>
          ) : (
            <>
              <span className="call-line">AUGUST: {a.side}</span>
              <span className="call-actions">
                <button type="button" className="call-btn" disabled={busy} onClick={() => take(a.side)}>
                  AGREE
                </button>
                <button type="button" className="call-btn" disabled={busy} onClick={() => other && take(other)}>
                  {other}
                </button>
                <span className="call-note">locks 09:30 ET</span>
              </span>
            </>
          )}
        </div>
      ) : st.noCall ? (
        <div className="call-block">
          <span className="call-line call-quiet">
            {st.noCall.reason === "no_session"
              ? `NO SESSION · next call ${weekdayShort(st.noCall.nextDate)}`
              : st.noCall.reason === "dead_even"
                ? `NO CALL · the regime is dead even · next call ${weekdayShort(st.noCall.nextDate)}`
                : st.noCall.reason === "unavailable"
                  ? `NO CALL · the regime is unavailable · next call ${weekdayShort(st.noCall.nextDate)}`
                  : `NO CALL ON THE BOARD · next call ${weekdayShort(st.noCall.nextDate)}`}
          </span>
        </div>
      ) : null}

      {/* the record — from day one, from 0–0, win or lose */}
      <span className="call-record" title="settled calls only; pushes and void days count for nobody">
        YOU {fmtRec(st.record.you)} · AUGUST {fmtRec(st.record.august)}
      </span>
    </div>
  );
}
