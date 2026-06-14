"use client";

// The once-a-day spoken Morning Brief, surfaced on Presence. AUGUST speaks first:
// when today's pre-compiled brief is waiting, this card presents the text with a
// play/replay control and a dismiss. Playback is driven by the parent (page.tsx)
// so it reuses the exact ElevenLabs path + drives the Presence orb — this
// component is presentational and stateless about audio.
//
// Distinct from <Brief> (the per-surface THE BRIEF status lines), which stays.

export type MorningBriefData = {
  date: string;
  greeting: string;
  text: string;
  compiledAt: number;
  sources: string[];
  grounded: boolean;
};

export type BriefStatus = "checking" | "ready" | "none" | "compiling" | "error";

type Props = {
  brief: MorningBriefData | null;
  status: BriefStatus;
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
  onCompile: () => void;
  onDismiss: () => void;
};

function compiledTime(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function MorningBrief({
  brief,
  status,
  playing,
  onPlay,
  onStop,
  onCompile,
  onDismiss,
}: Props) {
  // No flash while we check whether today's brief is ready.
  if (status === "checking") return null;

  // No brief yet (opened before the cron ran, or it failed) — offer to compile.
  if (status === "none" || status === "error") {
    return (
      <div className="morning-brief mb-pill" role="status">
        <span className="mb-eyebrow">MORNING BRIEF</span>
        <span className="mb-pill-text">
          {status === "error" ? "Couldn't reach the feeds." : "Not compiled yet this morning."}
        </span>
        <button type="button" className="mb-btn mb-go" onClick={onCompile}>
          ▸ Brief me
        </button>
        <button type="button" className="mb-x" aria-label="Dismiss" onClick={onDismiss}>
          ✕
        </button>
      </div>
    );
  }

  if (status === "compiling") {
    return (
      <div className="morning-brief mb-pill" role="status" aria-live="polite">
        <span className="mb-eyebrow">MORNING BRIEF</span>
        <span className="mb-pill-text mb-pulse">Compiling your morning brief…</span>
      </div>
    );
  }

  // status === "ready"
  if (!brief) return null;
  const meta = [compiledTime(brief.compiledAt) ? `compiled ${compiledTime(brief.compiledAt)} ET` : "", ...brief.sources]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`morning-brief mb-card${playing ? " playing" : ""}`} role="region" aria-label="Morning brief">
      <div className="mb-head">
        <span className="mb-eyebrow">MORNING BRIEF</span>
        <span className="mb-greeting">{brief.greeting}</span>
        <button type="button" className="mb-x" aria-label="Dismiss" onClick={onDismiss}>
          ✕
        </button>
      </div>

      <p className="mb-text">{brief.text}</p>

      <div className="mb-foot">
        {playing ? (
          <button type="button" className="mb-btn mb-stop" onClick={onStop}>
            <StopGlyph /> Stop
          </button>
        ) : (
          <button type="button" className="mb-btn mb-play" onClick={onPlay}>
            <PlayGlyph /> {/* "Play" the first time, "Replay" after */}
            Play briefing
          </button>
        )}
        {meta ? <span className="mb-meta">{meta}</span> : null}
        {!brief.grounded ? <span className="mb-raw">raw read · synthesis offline</span> : null}
      </div>
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <path d="M2.5 1.6 10 6 2.5 10.4 Z" fill="currentColor" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
      <rect x="1.8" y="1.8" width="8.4" height="8.4" rx="1.4" fill="currentColor" />
    </svg>
  );
}
