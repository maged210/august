"use client";

// PANEL 2 — DESK WIRE (G3 round 5; v2 in UX2-T6). Reverse-chronological
// pipeline activity, assembled ENTIRELY from stores that already exist:
// transcript ingests (redacted /api/wire — counts + owner label only), ideas
// going live (/api/ideas), TRIGGERED transitions (the tracked feed's own
// status history), tape posts (/api/tape). Public-safe wording by
// construction — every fact here is already on a public wire or reduced to
// counts.
//
// v2 (T6): digest tone. Same-minute LIVE approvals collapse into ONE
// expandable batch row ("11 ideas → LIVE") instead of eleven identical
// lines; individual rows remain only for distinct events (TRIGGERED @ price,
// ingests, tape posts). ~10 rows visible; the rest sit behind SHOW ALL.

import { useState } from "react";
import type { FeedCard } from "@/lib/intel/publish";
import type { PublicIdea } from "@/lib/ideas";
import type { PublicTapeEntry } from "@/lib/tape";
import type { PublicIngest } from "@/lib/transcripts";

const VISIBLE = 10;

export type WireEvent = {
  ts: number;
  kind: "INGEST" | "LIVE" | "TRIG" | "TAPE";
  sym?: string;
  text: string;
  /** batch members — present only on collapsed batch rows (T6) */
  batch?: string[];
};

const px = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** PURE. Merge the four public sources into one reverse-chron wire; bulk
 *  approvals (same-minute LIVE flips) fold into one batch event each. */
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
  // LIVE approvals — updatedAt is the approval moment; a bulk approval sweep
  // lands in the same minute and reads as ONE digest row (T6)
  const byMinute = new Map<number, { ts: number; syms: string[] }>();
  for (const i of liveIdeas) {
    const m = Math.floor(i.updatedAt / 60_000);
    const g = byMinute.get(m);
    if (g) {
      g.ts = Math.max(g.ts, i.updatedAt);
      g.syms.push(i.instrument);
    } else {
      byMinute.set(m, { ts: i.updatedAt, syms: [i.instrument] });
    }
  }
  for (const g of byMinute.values()) {
    if (g.syms.length === 1) {
      out.push({ ts: g.ts, kind: "LIVE", sym: g.syms[0], text: "idea live on the rail" });
    } else {
      out.push({ ts: g.ts, kind: "LIVE", text: `${g.syms.length} ideas → LIVE`, batch: g.syms });
    }
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
  return out;
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
  const [showAll, setShowAll] = useState(false);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  // F5 — long tape text clamps to one line; a click unfolds THAT row only
  const [openRow, setOpenRow] = useState<string | null>(null);

  const rows = events === null ? null : showAll ? events : events.slice(0, VISIBLE);
  const hidden = events === null ? 0 : events.length - VISIBLE;

  return (
    <section className="ifm if-wire" aria-label="Desk wire">
      <div className="ifm-h">
        <span className="ifm-title">DESK WIRE</span>
        {/* P3 — public copy speaks desk, not internals */}
        <span className="ifm-tag" title="activity from the desk's own stores — counts, titles, statuses only">
          DESK ACTIVITY
        </span>
      </div>
      {rows === null ? (
        <div className="ifm-body" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="if-skel-bar" style={{ width: `${80 - i * 16}%`, marginBottom: 8 }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="ifm-body">
          <span className="if-abs">
            <span className="if-abs-g" aria-hidden="true">
              ·
            </span>{" "}
            quiet desk — nothing on the wire yet
          </span>
        </div>
      ) : (
        <>
          <ul className="if-wire-list">
            {rows.map((e, i) => {
              const bkey = `${e.ts}-${i}`;
              const open = openBatch === bkey;
              return (
                <li key={bkey} className="if-wire-row">
                  <span className="ifm-t-time">{fmtTime(e.ts)}</span>
                  <span className={`if-wire-kind if-wk-${e.kind.toLowerCase()}`}>{e.kind}</span>
                  {e.sym ? <span className="ifm-t-sym">{e.sym}</span> : null}
                  {e.batch ? (
                    // T6 — the digest row: one line for the whole sweep,
                    // members behind the caret
                    <button
                      type="button"
                      className="if-wire-batchbtn"
                      aria-expanded={open}
                      onClick={() => setOpenBatch(open ? null : bkey)}
                    >
                      <span className="if-wire-text">{e.text}</span>
                      <span className="if-wire-caret" aria-hidden="true">
                        {open ? "▾" : "▸"}
                      </span>
                    </button>
                  ) : e.kind === "TAPE" ? (
                    // F5 — tape notes are the long ones: one-line clamp,
                    // click to unfold in place (never wraps the column grid)
                    <button
                      type="button"
                      className={`if-wire-textbtn${openRow === bkey ? " open" : ""}`}
                      aria-expanded={openRow === bkey}
                      onClick={() => setOpenRow(openRow === bkey ? null : bkey)}
                    >
                      <span className="if-wire-text">{e.text}</span>
                    </button>
                  ) : (
                    <span className="if-wire-text" title={e.text}>
                      {e.text}
                    </span>
                  )}
                  {e.batch && open ? (
                    <span className="if-wire-batch">
                      {e.batch.map((s, j) => (
                        <span key={`${s}${j}`} className="if-wire-bsym">
                          {s.toUpperCase()}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {hidden > 0 || showAll ? (
            <button
              type="button"
              className="if-wire-more"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "SHOW LESS" : `SHOW ALL · ${events!.length}`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
