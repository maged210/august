"use client";

// THE CALL (feature/the-call; reskinned feat/v4-2-today) — the front page's
// subject: AUGUST's daily NQ call (direction is deterministic from the regime
// model, server-side), your one-tap Higher / Lower, and both running records.
// States: OPEN → TAKEN / LOCKED → SETTLED; weekends say NO SESSION; a dead-even
// regime says NO CALL. Records start 0–0 and show from day one — never seeded,
// shown even when AUGUST is losing.
//
// What the v4 frame drew and this card does NOT build: a chance %, a chance
// chart, "% on the buttons", "· small" — no probability or sizing exists
// (DESIGN_LAWS L2). "settles 16:00 ET" is not how the engine settles: the label
// is SETTLE_UTC_LABEL, derived from the cron. An OPEN call shows no reference
// line at all — the call store holds none until settlement; a SETTLED call reads
// the close and the prior close it was actually scored against.

import { useEffect, useRef, useState } from "react";
import DataTag from "@/components/DataTag";
import Disclaimer from "@/components/Disclaimer";
import { SETTLE_UTC_LABEL } from "@/lib/settle-cron";

type Tally = { wins: number; losses: number; pushes: number };
type Side = "HIGHER" | "LOWER";
type CallResp = {
  ok: boolean;
  now: number;
  /** the store read threw — the tallies below are empty, not real */
  readFailed?: boolean;
  record: { august: Tally; you: Tally };
  active: {
    forDate: string;
    side: Side;
    lockTs: number;
    locked: boolean;
    youSide: Side | null;
    thesis: string | null;
    /** fix/failure-visibility (L9): the read could not be generated */
    thesisFailed?: boolean;
  } | null;
  noCall: { reason: "no_session" | "dead_even" | "unavailable" | "not_generated"; nextDate: string } | null;
  settled: {
    forDate: string;
    side: Side;
    result: Side | "FLAT" | "NO_SESSION";
    closePct: number | null;
    close?: number | null;
    prevClose?: number | null;
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
    const s = Math.abs(pct).toFixed(dp);
    if (Number(s) !== 0) return `${pct > 0 ? "+" : "−"}${s}%`;
  }
  return `${pct > 0 ? "+" : "−"}0.0001%`; // sub-tick dust — never a fake flat
}
const weekdayShort = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const sideWord = (side: Side) => (side === "HIGHER" ? "Higher" : "Lower");
/** NQ closes as the settle stored them — both at two decimals, so the close and
 *  the prior close always read as the same kind of number */
const fmtClose = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    // the command bar takes a side through the same route (app/page.tsx
    // runCallSide) — without this the card sits on OPEN buttons it can no
    // longer honour until the next poll
    const onTaken = () => pull();
    window.addEventListener("aug:call-taken", onTaken);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("aug:call-taken", onTaken);
    };
  }, []);

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

  // loading, or never reached: the card still stands, saying which
  if (!st) {
    return (
      <section className="td-card td-call" aria-label="THE CALL — AUGUST's daily NQ call">
        <div className="td-head">
          <h2 className="td-label">The call</h2>
          {misses > 0 ? <DataTag kind="unavail" title="the call can't be reached — retrying every minute" /> : null}
        </div>
        <p className="td-meta">{misses > 0 ? "The call can't be reached right now." : "loading…"}</p>
      </section>
    );
  }

  const a = st.active;
  const s = st.settled;
  // an unsettled call whose date already passed (settle lag) is named by its
  // day, never mislabeled "today"
  const dayWord = a
    ? a.forDate > etToday()
      ? "tomorrow"
      : a.forDate === etToday()
        ? "today"
        : weekdayShort(a.forDate)
    : "";
  // a lag-settled result carries its date — yesterday's close must never read
  // as today's
  const settledDay = s && s.forDate !== etToday() ? ` (${weekdayShort(s.forDate)})` : "";
  const hasRef = !!s && typeof s.close === "number" && typeof s.prevClose === "number";

  return (
    <section className="td-card td-call" aria-label="THE CALL — AUGUST's daily NQ call">
      <div className="td-head">
        <h2 className="td-label">The call</h2>
        <span className="td-chips">
          {/* the tooltip keeps the PROVENANCE note (how the direction was
              derived) — supplementary; the "not advice" half is the rendered
              Disclaimer at the foot of this card */}
          <DataTag
            kind="calc"
            title="direction was derived deterministically from the regime model at the pass that opened this call — the sign of its vote sum; dead even = no call. The current read below is AUGUST's live read."
          />
          {st.readFailed ? <DataTag kind="unavail" title="the call store didn't answer — the record and today's call are not shown" /> : null}
          {misses >= 2 ? <DataTag kind="stale" title="the card can't reach the server — showing the last good state" /> : null}
        </span>
      </div>

      {st.readFailed && !a && !s ? (
        <p className="td-meta">The call and the record can&apos;t be read right now.</p>
      ) : null}

      {a ? (
        <>
          <div className="td-call-q">
            <span className="td-tile" aria-hidden="true">
              NQ
            </span>
            <span className="td-call-qtext">
              {/* the call reads as a QUESTION; the day word stays bound to
                  dayWord (a settle-lag day names the weekday) */}
              <span className="td-headline">NQ closes higher {dayWord}?</span>
              <span className="td-meta">
                Locks 09:30 ET · settles on the {SETTLE_UTC_LABEL} pass
              </span>
            </span>
          </div>
          {/* the question is fixed ("closes higher?"), so AUGUST's side is
              stated as a DIRECTION word — never a bare yes/no that could
              invert once the card scrolls */}
          <p className="td-call-side">
            August says <b className={a.side === "HIGHER" ? "up" : "down"}>{sideWord(a.side)}</b>
          </p>
          {/* L9 — the read is a STATE. A generation that failed says so with
              its chip; only a desk that deliberately didn't spend (no regime,
              or a generation already in flight) shows no read block at all. */}
          {a.thesis ? (
            <div className="td-call-read">
              <span className="td-sublabel">Current read</span>
              <p className="td-body">{a.thesis}</p>
            </div>
          ) : a.thesisFailed ? (
            <div className="td-call-read">
              <span className="td-sublabel">
                Current read
                <DataTag
                  kind="unavail"
                  title="the read couldn't be generated — the call and the record above are unaffected"
                />
              </span>
              <p className="td-body td-unavail">
                August&apos;s read of the tape couldn&apos;t be generated right now. The call
                itself stands — it is derived from the regime model, not written by one.
              </p>
            </div>
          ) : null}
          {a.youSide ? (
            <div className="td-strip">
              <span className="td-title">You: {sideWord(a.youSide)}</span>
              <span className="td-meta">settles on the {SETTLE_UTC_LABEL} pass</span>
            </div>
          ) : a.locked ? (
            <div className="td-strip">
              <span className="td-title">Locked at 09:30 ET</span>
              <span className="td-meta">you didn&apos;t call</span>
            </div>
          ) : (
            <div className="td-call-acts">
              <button type="button" className="td-take up" disabled={busy} onClick={() => take("HIGHER")}>
                Higher
              </button>
              <button type="button" className="td-take down" disabled={busy} onClick={() => take("LOWER")}>
                Lower
              </button>
            </div>
          )}
        </>
      ) : st.noCall ? (
        <div className="td-call-q td-call-none">
          <span className="td-headline">
            {st.noCall.reason === "no_session" ? "No session" : "No call"}
          </span>
          <span className="td-meta">
            {st.noCall.reason === "no_session"
              ? `next call ${weekdayShort(st.noCall.nextDate)}`
              : st.noCall.reason === "dead_even"
                ? `the regime is dead even · next call ${weekdayShort(st.noCall.nextDate)}`
                : st.noCall.reason === "unavailable"
                  ? `the regime is unavailable · next call ${weekdayShort(st.noCall.nextDate)}`
                  : `no call on the board · next call ${weekdayShort(st.noCall.nextDate)}`}
          </span>
        </div>
      ) : null}

      {/* the settled result stays on the card through its own ET day */}
      {s && s.result !== "NO_SESSION" ? (
        <div className="td-strip td-settled">
          <span className="td-title">
            {hasRef ? (
              // the two values the settle actually scored, read back from the
              // stored record — the reference is never re-fetched or estimated
              <>
                NQ closed <span className="td-num">{fmtClose(s.close as number)}</span> · prev close{" "}
                <span className="td-num">{fmtClose(s.prevClose as number)}</span>
                {settledDay}
              </>
            ) : s.result === "FLAT" ? (
              <>NQ closed flat{settledDay}</>
            ) : (
              <>
                NQ closed {s.closePct !== null ? fmtPct(s.closePct) : sideWord(s.result).toLowerCase()}
                {settledDay}
              </>
            )}
          </span>
          <span className="td-meta">
            {s.result === "FLAT" ? (
              "Flat — a push, counted for neither side"
            ) : (
              <>
                {hasRef && s.closePct !== null ? (
                  <>
                    <b className={s.closePct >= 0 ? "up" : "down"}>{fmtPct(s.closePct)}</b>
                    {" · "}
                  </>
                ) : null}
                August {s.augustWin ? "✓" : "✗"}
                {s.youWin !== null ? ` · You ${s.youWin ? "✓" : "✗"}` : ""}
              </>
            )}
          </span>
          {s.disagree ? <span className="td-meta">{s.disagree}</span> : null}
        </div>
      ) : s ? (
        <div className="td-strip td-settled">
          <span className="td-title">No session · {weekdayShort(s.forDate)}</span>
          <span className="td-meta">the call is void — no bar printed</span>
        </div>
      ) : null}

      {/* the record — from day one, from 0–0, win or lose. A store read that
          THREW carries empty tallies, not real ones: the record says so rather
          than printing a 0–0 nobody earned. */}
      <div className="td-foot">
        {st.readFailed ? (
          <span className="td-record">
            YOU — · AUG — <DataTag kind="unavail" compact title="the record store didn't answer — this is not a 0–0" />
          </span>
        ) : (
          <span className="td-record" title="settled calls only; pushes and void days count for nobody">
            YOU {fmtRec(st.record.you)} · AUG {fmtRec(st.record.august)}
          </span>
        )}
      </div>

      {/* THE CALL publishes a dated directional call. It carries the line. */}
      <Disclaimer className="aug-disc-card" block={false} />
    </section>
  );
}
