"use client";

// MODULE D — DESK TAPE (G3 round 4). Flow-style rows in the dock stack:
// TIME · SYMBOL · NOTE · EXPIRY? · PREMIUM? · KIND badge, sentiment-colored.
// The density/layout nods to flow tables the desk reads elsewhere — the DATA
// is entirely ours: /admin quick-adds and approved transcript extractions
// (the "desk-sourced" tag is load-bearing — this is commentary, never a
// market data feed). Newest first, ~15 visible, the tail fades.

import type { PublicTapeEntry } from "@/lib/tape";

const VISIBLE = 15;

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    });
  } catch {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}

export default function TapeModule({
  entries,
  failed,
  onRetry,
}: {
  /** null = still loading */
  entries: PublicTapeEntry[] | null;
  failed: boolean;
  onRetry: () => void;
}) {
  const rows = (entries ?? []).slice(0, VISIBLE);

  return (
    <section className="ifm" aria-label="Desk tape">
      <div className="ifm-h">
        <span className="ifm-title">DESK TAPE</span>
        <span className="ifm-tag" title="desk commentary — the desk's own notes, not a market data feed">
          DESK-SOURCED
        </span>
      </div>
      {entries === null && !failed ? (
        <div className="ifm-body" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="if-skel-bar" style={{ width: `${82 - i * 14}%`, marginBottom: 8 }} />
          ))}
        </div>
      ) : entries === null && failed ? (
        <div className="ifm-body">
          <span className="if-abs">
            <span className="if-abs-g" aria-hidden="true">
              ·
            </span>{" "}
            tape unreachable
          </span>
          <button type="button" className="if-bmiss-retry" onClick={onRetry} style={{ marginLeft: 10 }}>
            RETRY
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="ifm-body">
          <span className="if-abs">
            <span className="if-abs-g" aria-hidden="true">
              ·
            </span>{" "}
            the tape is quiet
          </span>
        </div>
      ) : (
        <ul className="ifm-tape">
          {rows.map((e) => (
            <li key={e.id} className={`ifm-trow ifm-t-${e.sentiment}`}>
              <span className="ifm-t-time">{fmtTime(e.ts)}</span>
              <span className="ifm-t-sym">{e.symbol}</span>
              <span className="ifm-t-note" title={e.note}>
                {e.note}
              </span>
              {e.expiry ? <span className="ifm-t-x">{e.expiry}</span> : null}
              {e.premium ? <span className="ifm-t-x ifm-t-prem">{e.premium}</span> : null}
              <span className={`ifm-t-kind ifm-tk-${e.kind}`}>{e.kind.toUpperCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
