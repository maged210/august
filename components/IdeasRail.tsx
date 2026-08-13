"use client";

// The Trade Ideas rail (CORE V2) — visible beside BOTH views: a fixed right
// sidebar on desktop (≥1100px, always open), an off-canvas drawer below that
// (opened from the view bar's IDEAS button). One component, one data path:
// GET /api/ideas (live, redacted PublicIdea rows), 60s poll with the house
// document.hidden guard. Empty is honest — "NO LIVE IDEAS", never mock rows.

import { useCallback, useEffect, useRef, useState } from "react";
import WidgetState from "@/components/WidgetState";
import { relativeTime, type PublicIdea, type IdeaRiskLevel } from "@/lib/ideas";
import { publishRainSymbols } from "@/lib/rain-symbols";

const RISK_LABEL: Record<IdeaRiskLevel, string> = {
  low: "LOW RISK",
  medium: "MED RISK",
  high: "HIGH RISK",
};

type Props = {
  /** drawer state — meaningful below 1100px; the desktop sidebar ignores it */
  open: boolean;
  onClose: () => void;
  /** UX1 — desktop sidebar collapse (folds to the "IDEAS · N LIVE" edge tab);
      meaningless below 1100px, where the drawer owns the rail */
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

export default function IdeasRail({ open, onClose, collapsed, onToggleCollapsed }: Props) {
  const [ideas, setIdeas] = useState<PublicIdea[] | null>(null); // null = loading
  const [failed, setFailed] = useState(false);
  // Re-render minutes-scale timestamps without refetching.
  const [, setTick] = useState(0);
  // UX3 — per-card density overrides. Absent id = the count-driven default
  // (compact when the rail holds more than 5 live ideas, expanded otherwise);
  // a tap flips one card in place, the header control flips them all.
  const [cardMode, setCardMode] = useState<Record<string, boolean>>({});
  const railRef = useRef<HTMLElement | null>(null);

  const pull = useCallback(() => {
    fetch("/api/ideas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { ideas?: PublicIdea[] }) => {
        const rows = Array.isArray(j.ideas) ? j.ideas : [];
        setIdeas(rows);
        setFailed(false);
        // UX5 — the rail is the always-mounted /api/ideas reader, so it feeds
        // the rain's symbol pool (no extra network anywhere)
        publishRainSymbols("ideas", rows.map((i) => i.instrument));
      })
      .catch(() => setFailed(true)); // rows (if any) stay — marked stale below
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

  // Esc handling lives in the page's single Esc stack (voice mode → drawer →
  // reply panel) — a listener here could shadow the voice-mode kill switch.

  const count = ideas?.length ?? 0;

  // UX3 — density: compact by default only when the rail is crowded.
  const defaultExpanded = count <= 5;
  const isExpanded = (id: string) => cardMode[id] ?? defaultExpanded;
  const allExpanded = count > 0 && ideas!.every((i) => isExpanded(i.id));
  const toggleAll = () => {
    const target = !allExpanded;
    const next: Record<string, boolean> = {};
    for (const i of ideas ?? []) next[i.id] = target;
    setCardMode(next);
  };
  const toggleCard = (id: string) =>
    setCardMode((m) => ({ ...m, [id]: !(m[id] ?? defaultExpanded) }));

  return (
    <>
      {/* drawer scrim — mobile only (CSS hides it ≥1100px) */}
      {open ? <div className="ir-scrim" onClick={onClose} aria-hidden /> : null}
      {/* UX1 — the collapsed sidebar's edge tab (desktop only, CSS-gated):
          the rail folds away and this thin vertical strip is the way back */}
      {collapsed ? (
        <button
          type="button"
          className="ir-tab"
          onClick={onToggleCollapsed}
          aria-label={`Open the trade ideas rail — ${count} live`}
        >
          IDEAS <span className="ir-tab-count">· {count} LIVE</span>
        </button>
      ) : null}
      <aside
        ref={railRef}
        className={`ideas-rail${open ? " open" : ""}`}
        aria-label="Trade ideas"
        // M3 — swipe the right-hand sheet rightwards to dismiss (phone/tablet)
        onTouchStart={(e) => {
          (railRef.current as HTMLElement & { _sx?: number })._sx = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          const el = railRef.current as (HTMLElement & { _sx?: number }) | null;
          if (el?._sx != null && e.changedTouches[0].clientX - el._sx > 70) onClose();
          if (el) el._sx = undefined;
        }}
      >
        <div className="ir-head">
          <span className="ir-title">
            TRADE IDEAS
            {count > 0 ? <span className="ir-count">{count} LIVE</span> : null}
          </span>
          <span className="ir-head-acts">
            {/* UX3 — flip every card's density at once */}
            {count > 0 ? (
              <button type="button" className="ir-headctl" onClick={toggleAll}>
                {allExpanded ? "COLLAPSE ALL" : "EXPAND ALL"}
              </button>
            ) : null}
            {/* desktop only (CSS): fold the sidebar to its edge tab */}
            <button
              type="button"
              className="ir-collapse"
              onClick={onToggleCollapsed}
              aria-label="Collapse the trade ideas rail"
              title="Collapse rail"
            >
              »
            </button>
            <button
              type="button"
              className="ir-close"
              onClick={onClose}
              aria-label="Close trade ideas"
            >
              ✕
            </button>
          </span>
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
            <>
              {failed ? (
                <div className="ir-stale" role="status">
                  FEED OFFLINE · showing last
                  <button type="button" className="widget-retry" onClick={pull}>
                    RETRY
                  </button>
                </div>
              ) : null}
              {ideas!.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  expanded={isExpanded(idea.id)}
                  onToggle={() => toggleCard(idea.id)}
                />
              ))}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

// UX2 — reading order: TICKER → ENTRY (the bright chip) → REASONING (accent
// block) → secondary metadata (target · age; risk stays a quiet top badge).
// UX3 — a card can fold to one line (TICKER · risk · entry one-liner); the
// head row is the toggle either way.
function IdeaCard({
  idea,
  expanded,
  onToggle,
}: {
  idea: PublicIdea;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`ir-card${expanded ? "" : " compact"}`}>
      <button type="button" className="ir-card-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="ir-sym">{idea.instrument}</span>
        {expanded ? (
          <span className="ir-head-sp" aria-hidden />
        ) : idea.entry ? (
          <span className="ir-line-entry" title={idea.entry}>
            {idea.entry}
          </span>
        ) : (
          <span className="ir-line-entry ir-absent">no entry</span>
        )}
        <span className={`ir-risk ir-risk-${idea.riskLevel}`}>{RISK_LABEL[idea.riskLevel]}</span>
        <span className="ir-caret" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded ? (
        <ExpandedBody idea={idea} />
      ) : null}
    </article>
  );
}

function ExpandedBody({ idea }: { idea: PublicIdea }) {
  return (
    <>
      <div className="ir-entry">
        <span className="ir-entry-k">ENTRY</span>
        {idea.entry ? (
          <span className="ir-entry-v">{idea.entry}</span>
        ) : (
          <span className="ir-absent">not stated</span>
        )}
      </div>
      <p className="ir-thesis">{idea.thesis}</p>
      <div className="ir-meta">
        {idea.target ? (
          <span className="ir-level">
            <span className="ir-level-k">TARGET</span> {idea.target}
          </span>
        ) : null}
        <span className="ir-when">{relativeTime(idea.createdAt)}</span>
      </div>
    </>
  );
}
