"use client";

import { useEffect, useRef, useState } from "react";
import type { PulseDelta } from "@/lib/pulse";

// The Pulse card — ONE narrow card under the orb showing what changed since
// your last visit, one delta at a time (max 4), cycling on a slow clock with a
// soft cross-fade and a tiny dot pager. Clicking a delta slides the deck to its
// surface; informational lines (calendar) stay put. ZERO deltas → render null:
// the empty state is the point — nothing changed, so nothing asks for you.
// Reduced motion: no cycling; the dots become the pager.

const CYCLE_MS = 8_000;
const FADE_MS = 260; // keep in step with .pulse-body's opacity transition

export default function PulseCard({
  deltas,
  onNavigate,
}: {
  deltas: PulseDelta[];
  onNavigate?: (key: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [fading, setFading] = useState(false);
  const [reduced, setReduced] = useState(false);
  // Bumped on manual dot jumps so the cycle effect restarts — the chosen delta
  // gets a full 8s beat instead of inheriting the old interval's phase.
  const [cycleKey, setCycleKey] = useState(0);
  const fadeTimerRef = useRef(0);

  // Respect prefers-reduced-motion, live (the pager still works by dot-click).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // If the list shrinks under the cursor (e.g. the world delta clears on a World
  // visit), fold the index back into range rather than showing a hole.
  useEffect(() => {
    setFading(false); // a shrink mid-fade must never strand the body at opacity 0
    setIdx((i) => (i >= deltas.length ? 0 : i));
  }, [deltas.length]);

  // The slow cycle — fade out, swap, fade back in. Only when there's more than
  // one delta and motion is welcome.
  useEffect(() => {
    if (reduced || deltas.length < 2) return;
    const id = window.setInterval(() => {
      setFading(true);
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = window.setTimeout(() => {
        setIdx((i) => (i + 1) % deltas.length);
        setFading(false);
      }, FADE_MS);
    }, CYCLE_MS);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(fadeTimerRef.current);
    };
  }, [reduced, deltas.length, cycleKey]);

  if (deltas.length === 0) return null; // nothing changed — no card at all

  const d = deltas[Math.min(idx, deltas.length - 1)];

  const jumpTo = (i: number) => {
    window.clearTimeout(fadeTimerRef.current);
    setFading(false);
    setIdx(i);
    setCycleKey((k) => k + 1); // restart the auto-cycle clock from this jump
  };

  const body = (
    <>
      {d.glyph ? (
        <span className={`pulse-glyph${d.tone ? ` ${d.tone}` : ""}`} aria-hidden>
          {d.glyph}
        </span>
      ) : null}
      <span className="pulse-text">{d.line}</span>
    </>
  );

  return (
    <div className="pulse-card" role="group" aria-label="Since your last visit">
      <span className="pulse-eyebrow">SINCE LAST VISIT</span>
      <div className={`pulse-body${fading ? " pulse-fading" : ""}`}>
        {d.nav ? (
          <button type="button" className="pulse-line" onClick={() => onNavigate?.(d.nav!)}>
            {body}
          </button>
        ) : (
          <div className="pulse-line">{body}</div>
        )}
        {d.sub ? <div className="pulse-sub">{d.sub}</div> : null}
      </div>
      {deltas.length > 1 ? (
        <div className="pulse-dots">
          {deltas.map((x, i) => (
            <button
              key={x.key}
              type="button"
              className={`pulse-dot${i === idx ? " on" : ""}`}
              onClick={() => jumpTo(i)}
              aria-label={`Change ${i + 1} of ${deltas.length}`}
              aria-current={i === idx || undefined}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
