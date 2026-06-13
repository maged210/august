"use client";

// The one way every data widget shows its non-data states:
//   loading — skeleton shimmer rows in the house aesthetic
//   empty   — "NO SIGNAL"
//   error   — "FEED OFFLINE · RETRY" with a working retry
// Replaces ad-hoc spinners/blanks so the whole deck degrades identically.

type Props = {
  state: "loading" | "empty" | "error";
  /** skeleton rows while loading */
  rows?: number;
  onRetry?: () => void;
};

export default function WidgetState({ state, rows = 4, onRetry }: Props) {
  if (state === "loading") {
    return (
      <div className="skel-rows" role="status" aria-label="Loading">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skel-bar" style={{ width: `${55 + ((i * 23) % 40)}%` }} />
        ))}
      </div>
    );
  }
  if (state === "empty") {
    return <div className="widget-state">NO SIGNAL</div>;
  }
  return (
    <div className="widget-state err" role="alert">
      <span>FEED OFFLINE</span>
      {onRetry ? (
        <>
          <span className="widget-state-sep">·</span>
          <button type="button" className="widget-retry" onClick={onRetry}>
            RETRY
          </button>
        </>
      ) : null}
    </div>
  );
}
