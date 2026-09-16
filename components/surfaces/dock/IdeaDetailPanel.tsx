"use client";

// PANEL 1 — IDEA DETAIL (G3 round 5; reskinned feat/v4-1-terminal). The
// desktop band's ONE detail surface: selection-driven (card tap / ?idea=
// deep link / the <TICKER> command). Renders the shared idea anatomy
// (components/surfaces/IdeaBody.tsx — the same body the phone's idea page
// shows) without a chart: the dock already charts the selection above.
// A fixed min-height keeps selection changes from shifting the layout.

import type { PublicIdea } from "@/lib/ideas";
import { statusOf } from "@/lib/idea-card";
import IdeaBody, { StatusPill, type LastQuote } from "@/components/surfaces/IdeaBody";

function Absent({ text = "not stated" }: { text?: string }) {
  return (
    <span className="if-abs">
      <span className="if-abs-g" aria-hidden="true">
        ·
      </span>{" "}
      {text}
    </span>
  );
}

export default function IdeaDetailPanel({
  live,
  last,
}: {
  /** the selected LIVE idea, when a card is selected */
  live: PublicIdea | null;
  /** its DELAYED last quote (or the honest pending/unavailable state) */
  last: LastQuote;
}) {
  return (
    <section className="ifm if-detail" aria-label="Idea detail">
      <div className="ifm-h">
        <span className="ifm-title">IDEA DETAIL</span>
        {live ? (
          <span className="ifm-sub v4-detail-sub">
            {live.instrument.toUpperCase()} <StatusPill chip={statusOf(live)} className="v4-pill-xs" />
          </span>
        ) : null}
      </div>
      <div className="ifm-body if-detail-body">
        {!live ? <Absent text="select an idea card" /> : <IdeaBody idea={live} last={last} compact />}
      </div>
    </section>
  );
}
