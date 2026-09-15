"use client";

// PANEL 1 — IDEA DETAIL (G3 round 5). The blotter's ONE detail surface:
// selection-driven (row click / ?idea= deep link), replacing the old inline
// row expansion. Renders entirely from data already on the wire — full
// thesis and the stated levels with honest ∅ states. A fixed min-height
// keeps selection changes from shifting the layout.
//
// chore/terminal-cut: the tracked-card branch (the retired desk's publish
// pipeline: measured performance, status history) is gone with the lane.

import type { IdeaRiskLevel, PublicIdea } from "@/lib/ideas";
import { sideOf } from "./derive";

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();

const RISK_LABEL: Record<IdeaRiskLevel, string> = {
  low: "LOW RISK",
  medium: "MED RISK",
  high: "HIGH RISK",
};

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

/** R8 — an empty section is ONE compact muted line, not a header + absent row */
function QuietLine({ label, text }: { label: string; text: string }) {
  return (
    <div className="if-dt-quiet">
      <span className="if-dt-quiet-k">{label}</span>
      <span className="if-dt-quiet-t">{text}</span>
    </div>
  );
}

/** free-form level string (LIVE ideas) — verbatim, ∅ when empty */
function TextLevelRow({ label, text, cls }: { label: string; text: string; cls: string }) {
  return (
    <div className="if-sh-lev">
      <span className="if-sh-lev-lab">{label}</span>
      {text ? (
        <span className={`if-sh-lev-txt ${cls}`} title={text} style={{ whiteSpace: "normal" }}>
          {text}
        </span>
      ) : (
        <Absent />
      )}
    </div>
  );
}

export default function IdeaDetailPanel({
  live,
}: {
  /** the selected LIVE idea, when a row is selected */
  live: PublicIdea | null;
}) {
  const title = live ? `${live.instrument} · LIVE` : null;

  // UX4 — the LIVE idea's side: stated renders solid, derived stays marked
  const liveSideR = live ? sideOf(live) : null;

  return (
    <section className="ifm if-detail" aria-label="Idea detail">
      <div className="ifm-h">
        <span className="ifm-title">IDEA DETAIL</span>
        {title ? <span className="ifm-sub">{title}</span> : null}
      </div>
      <div className="ifm-body if-detail-body">
        {!live ? (
          <Absent text="select a blotter row" />
        ) : (
          <div className="if-detail-grid">
            {/* UX2 — reading order: TICKER (header) → ENTRY → REASONING → the rest */}
            <div className="if-detail-col">
              <div className="if-entry-hero">
                <span className="if-entry-hero-k">ENTRY</span>
                {live.entry ? <span className="if-entry-hero-v">{live.entry}</span> : <Absent />}
              </div>
              <p className="if-sh-thesis">{live.thesis}</p>
              <div className="if-sh-meta">
                {liveSideR ? (
                  <>
                    <span
                      className={`if-bside ${
                        liveSideR.side === "LONG"
                          ? "if-dir-bull"
                          : liveSideR.side === "SHORT"
                            ? "if-dir-bear"
                            : "if-dir-neut"
                      }${liveSideR.derived ? " derived" : ""}`}
                      title={
                        liveSideR.derived
                          ? "derived from entry vs target — the desk did not state a side"
                          : undefined
                      }
                    >
                      <span className="if-bside-g" aria-hidden="true">
                        {liveSideR.side === "LONG" ? "▲" : liveSideR.side === "SHORT" ? "▼" : "◆"}
                      </span>
                      {liveSideR.side}
                    </span>{" "}
                    ·{" "}
                  </>
                ) : null}
                <span className={`if-risk if-risk-${live.riskLevel}`}>{RISK_LABEL[live.riskLevel]}</span> · CALLED{" "}
                {fmtDate(live.createdAt)}
              </div>
            </div>
            <div className="if-detail-col">
              {/* R8 — the ENTRY chip (left) is the single source of entry;
                  levels here are only TARGET and STOP */}
              <div className="if-sh-sect-h">STATED LEVELS</div>
              <TextLevelRow label="TARGET" text={live.target} cls="if-lev-target" />
              <TextLevelRow label="STOP" text={live.stop ?? ""} cls="if-lev-stop" />
              <QuietLine label="PERFORMANCE" text="live — no measurement yet" />
              <QuietLine label="STATUS" text="no transitions — the call stands as posted" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
