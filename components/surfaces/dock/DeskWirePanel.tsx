"use client";

// PANEL 2 — DESK WIRE (G3 round 5). Reverse-chronological pipeline activity,
// assembled ENTIRELY from stores that already exist: transcript ingests
// (redacted /api/wire — counts + owner label only), ideas going live
// (/api/ideas), TRIGGERED transitions (the tracked feed's own status
// history), tape posts (/api/tape). Public-safe wording by construction —
// every fact here is already on a public wire or reduced to counts. ~12
// visible, capped, tail fades (the Desk Tape density contract).

import type { FeedCard } from "@/lib/intel/publish";
import type { PublicIdea } from "@/lib/ideas";
import type { PublicTapeEntry } from "@/lib/tape";
import type { PublicIngest } from "@/lib/transcripts";

const VISIBLE = 12;

export type WireEvent = {
  ts: number;
  kind: "INGEST" | "LIVE" | "TRIG" | "TAPE";
  sym?: string;
  text: string;
};

const px = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** PURE. Merge the four public sources into one reverse-chron wire. */
export function buildWire(
  ingests: PublicIngest[],
  liveIdeas: PublicIdea[],
  cards: FeedCard[],
  tape: PublicTapeEntry[],
): WireEvent[] {
  const out: WireEvent[] = [];
  for (const g of ingests) {
    out.push({
      ts: g.ts,
      kind: "INGEST",
      text: `${g.source || "transcript"} → ${g.ideaDrafts} idea draft${g.ideaDrafts === 1 ? "" : "s"} · ${g.tapeDrafts} tape draft${g.tapeDrafts === 1 ? "" : "s"}`,
    });
  }
  for (const i of liveIdeas) {
    // updatedAt is the approval moment for a live idea (drafts flip there)
    out.push({ ts: i.updatedAt, kind: "LIVE", sym: i.instrument, text: "idea live on the rail" });
  }
  for (const c of cards) {
    for (const h of c.statusHistory) {
      if (h.state !== "TRIGGERED") continue;
      out.push({
        ts: h.at,
        kind: "TRIG",
        sym: c.ticker,
        text: h.price != null ? `triggered @ ${px(h.price)}` : "triggered",
      });
    }
  }
  for (const t of tape) {
    out.push({ ts: t.ts, kind: "TAPE", sym: t.symbol, text: t.note });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, VISIBLE);
}

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    }).toUpperCase();
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export default function DeskWirePanel({
  events,
}: {
  /** null = still loading (all sources pending) */
  events: WireEvent[] | null;
}) {
  return (
    <section className="ifm if-wire" aria-label="Desk wire">
      <div className="ifm-h">
        <span className="ifm-title">DESK WIRE</span>
        <span className="ifm-tag" title="pipeline activity from the desk's own stores — counts, titles, statuses only">
          PIPELINE ACTIVITY
        </span>
      </div>
      {events === null ? (
        <div className="ifm-body" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="if-skel-bar" style={{ width: `${80 - i * 16}%`, marginBottom: 8 }} />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="ifm-body">
          <span className="if-abs">
            <span className="if-abs-g" aria-hidden="true">
              ∅
            </span>{" "}
            no pipeline activity yet
          </span>
        </div>
      ) : (
        <ul className="if-wire-list">
          {events.map((e, i) => (
            <li key={`${e.kind}-${e.ts}-${i}`} className="if-wire-row">
              <span className="ifm-t-time">{fmtTime(e.ts)}</span>
              <span className={`if-wire-kind if-wk-${e.kind.toLowerCase()}`}>{e.kind}</span>
              {e.sym ? <span className="ifm-t-sym">{e.sym}</span> : null}
              <span className="if-wire-text" title={e.text}>
                {e.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
