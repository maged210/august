"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AugustState } from "@/components/Presence3D";

// The radial telemetry frame around the Presence orb: faint orbital lattice rings
// + ticks, and the centre AUGUST/state label with the restrained day line. The old
// four corner readouts are gone — "what changed since your last visit" lives in
// the single Pulse card (components/PulseCard.tsx, fed by lib/pulse.ts), and
// surface navigation moved to the word-rail at the foot of the surface. The only
// feed this frame still needs is /api/day, for the centre's calendar line.

const REFRESH_MS = 30_000;

function fmtPresence(state: AugustState): string {
  const map: Record<AugustState, string> = {
    boot: "WAKING",
    idle: "SYSTEMS STEADY",
    listening: "LISTENING",
    thinking: "PROCESSING",
    speaking: "SPEAKING",
  };
  return map[state] ?? "STEADY";
}

// The orb's projected radius is orbFrac · min(viewport w, h) — see Presence3D,
// which tunes its camera to the SAME fraction so the lattice hugs the sphere.
// Keep these two in lock-step.
const orbFrac = (w: number, h: number) => (Math.min(w, h) < 540 ? 0.13 : 0.18);

type Layout = { w: number; h: number; cx: number; cy: number; ring1: number; ring2: number };

function computeLayout(w: number, h: number): Layout {
  const orbR = orbFrac(w, h) * Math.min(w, h);
  return { w, h, cx: w / 2, cy: h / 2, ring1: orbR * 1.26, ring2: orbR * 1.5 };
}

type DayState = { connected?: boolean; count?: number; line?: string };

export default function PresenceTelemetry({
  state,
  visible,
}: {
  state: AugustState;
  visible: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [day, setDay] = useState<DayState | null>(null);

  // Measure the surface. Belt-and-suspenders so it can't stick at a mount-time 0×0.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    const raf = requestAnimationFrame(measure);
    const t = window.setTimeout(measure, 250);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, []);

  // The one feed the centre still needs: AUGUST's awareness of today's calendar
  // (the restrained day line). The poll is gated — nothing fetches while the tab
  // is hidden; a skipped cycle is caught up the moment the tab returns.
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      fetch("/api/day", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j) setDay(j);
        })
        .catch(() => {});
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  const L = computeLayout(size.w, size.h);
  const ready = size.w > 0 && size.h > 0;

  const ticks = useMemo(() => {
    if (!ready) return [];
    const out: Array<{ x1: number; y1: number; x2: number; y2: number; major: boolean }> = [];
    const NT = 72;
    for (let i = 0; i < NT; i++) {
      const a = (i / NT) * Math.PI * 2;
      const major = i % 6 === 0;
      const r2 = L.ring2 + (major ? 9 : 4);
      out.push({
        x1: L.cx + Math.cos(a) * L.ring2,
        y1: L.cy + Math.sin(a) * L.ring2,
        x2: L.cx + Math.cos(a) * r2,
        y2: L.cy + Math.sin(a) * r2,
        major,
      });
    }
    return out;
  }, [ready, L.cx, L.cy, L.ring2]);

  return (
    <div ref={ref} className={`telemetry${visible ? " telemetry-in" : ""}`}>
      {ready ? (
        <>
          <svg className="telemetry-svg" width={L.w} height={L.h} viewBox={`0 0 ${L.w} ${L.h}`} aria-hidden>
            <circle className="lattice lattice-1" cx={L.cx} cy={L.cy} r={L.ring1} />
            <circle className="lattice lattice-2" cx={L.cx} cy={L.cy} r={L.ring2} />
            {ticks.map((t, i) => (
              <line key={i} className={`tick${t.major ? " tick-major" : ""}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
            ))}
          </svg>

          <div className="presence-center">
            <div className="presence-center-t1">AUGUST</div>
            <div className="presence-center-t2">{fmtPresence(state)}</div>
            {/* Day awareness — a single restrained line (server-formatted "NEXT 9:00 AM
                · STANDUP" / "N TODAY"), shown only when the calendar's connected and
                has something today. Not a grid, not a list — just AUGUST knowing. */}
            {day?.connected && (day.count ?? 0) > 0 && day.line ? (
              <div className="presence-center-day">{day.line}</div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
