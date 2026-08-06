"use client";

// The Trade Ideas rail (CORE V2) — visible beside BOTH views: a fixed right
// sidebar on desktop (≥1100px, always open), an off-canvas drawer below that
// (opened from the view bar's IDEAS button). One component, one data path:
// GET /api/ideas (live, redacted PublicIdea rows), 60s poll with the house
// document.hidden guard. Empty is honest — "NO LIVE IDEAS", never mock rows.

import { useCallback, useEffect, useRef, useState } from "react";
import WidgetState from "@/components/WidgetState";
import { relativeTime, type PublicIdea, type IdeaRiskLevel } from "@/lib/ideas";

const RISK_LABEL: Record<IdeaRiskLevel, string> = {
  low: "LOW RISK",
  medium: "MED RISK",
  high: "HIGH RISK",
};

type Props = {
  /** drawer state — meaningful below 1100px; the desktop sidebar ignores it */
  open: boolean;
  onClose: () => void;
};

export default function IdeasRail({ open, onClose }: Props) {
  const [ideas, setIdeas] = useState<PublicIdea[] | null>(null); // null = loading
  const [failed, setFailed] = useState(false);
  // Re-render minutes-scale timestamps without refetching.
  const [, setTick] = useState(0);
  const railRef = useRef<HTMLElement | null>(null);

  const pull = useCallback(() => {
    fetch("/api/ideas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { ideas?: PublicIdea[] }) => {
        setIdeas(Array.isArray(j.ideas) ? j.ideas : []);
        setFailed(false);
      })
      .catch(() => {
        setFailed(true);
        setIdeas((prev) => prev); // keep any stale rows on a failed refresh
      });
  }, []);

  useEffect(() => {
    pull();
    const id = window.setInterval(() => {
      if (!document.hidden) pull();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [pull]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Drawer mode: Esc closes (the page's Esc handler owns voice/panel; this one
  // only fires while the drawer is open, and stops there).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const count = ideas?.length ?? 0;

  return (
    <>
      {/* drawer scrim — mobile only (CSS hides it ≥1100px) */}
      {open ? <div className="ir-scrim" onClick={onClose} aria-hidden /> : null}
      <aside
        ref={railRef}
        className={`ideas-rail${open ? " open" : ""}`}
        aria-label="Trade ideas"
      >
        <div className="ir-head">
          <span className="ir-title">
            TRADE IDEAS
            {count > 0 ? <span className="ir-count">{count} LIVE</span> : null}
          </span>
          <button
            type="button"
            className="ir-close"
            onClick={onClose}
            aria-label="Close trade ideas"
          >
            ✕
          </button>
        </div>
        <div className="ir-body">
          {ideas === null && !failed ? (
            <WidgetState state="loading" rows={5} />
          ) : failed && (ideas === null || ideas.length === 0) ? (
            <WidgetState state="error" onRetry={pull} />
          ) : count === 0 ? (
            <div className="ir-empty">
              NO LIVE IDEAS
              <span className="ir-empty-sub">the desk publishes here</span>
            </div>
          ) : (
            ideas!.map((idea) => <IdeaCard key={idea.id} idea={idea} />)
          )}
        </div>
      </aside>
    </>
  );
}

function IdeaCard({ idea }: { idea: PublicIdea }) {
  return (
    <article className="ir-card">
      <div className="ir-card-top">
        <span className="ir-sym">{idea.instrument}</span>
        <span className={`ir-risk ir-risk-${idea.riskLevel}`}>{RISK_LABEL[idea.riskLevel]}</span>
      </div>
      <p className="ir-thesis">{idea.thesis}</p>
      <div className="ir-levels">
        <span className="ir-level">
          <span className="ir-level-k">ENTRY</span> {idea.entry}
        </span>
        <span className="ir-level">
          <span className="ir-level-k">TARGET</span> {idea.target}
        </span>
      </div>
      <div className="ir-when">{relativeTime(idea.createdAt)}</div>
    </article>
  );
}
