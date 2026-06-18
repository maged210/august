"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AugustState } from "@/components/Presence3D";

// The radial telemetry frame around the Presence orb: faint orbital lattice rings
// + ticks, and the organs rendered as peripheral readouts (label · value) with a
// thin leader line + node back toward the orb. PRESENCE is the orb itself (centre
// label), so the periphery carries four organs at the four corners — MARKETS,
// WORLD, COMMS (clickable; they navigate the deck) and MEMORY (a status readout,
// no surface). WORLD fuses the globe + intel feeds: quakes (/api/command) over
// live wires (/api/intel). Each value is wired to the SAME endpoint its surface
// fetches — no invented data.

type Readout = { key: string; label: string; angle: number; value: string; sub: string; nav: boolean };

const REFRESH_MS = 30_000;

// — compact value extractors (real data only; "—" while a feed is warming) ——————
type Pair = { value: string; sub: string };
function fmtMarkets(m: any): Pair {
  const lv = m?.levels;
  if (lv && Number.isFinite(lv.current) && lv.current > 0) {
    return { value: `NQ ${Math.round(lv.current).toLocaleString("en-US")}`, sub: lv.above ? "ABOVE PIVOT" : "BELOW PIVOT" };
  }
  if (typeof m?.vix === "number") return { value: `VIX ${m.vix.toFixed(1)}`, sub: "MARKETS" };
  return { value: "—", sub: "WARMING" };
}
// WORLD = the merged globe + intel readout: seismic count over live wire count.
function fmtWorld(cmd: any, intel: any): Pair {
  const q = typeof cmd?.quakes === "number" ? cmd.quakes : null;
  const w = intel?.articles?.length;
  const wires = typeof w === "number" && w > 0 ? w : null;
  if (q != null && wires != null)
    return { value: `${q.toLocaleString("en-US")} QUAKES`, sub: `${wires} LIVE WIRES` };
  if (q != null) return { value: `${q.toLocaleString("en-US")} QUAKES`, sub: "GLOBE · 24H" };
  if (wires != null) return { value: `${wires} LIVE WIRES`, sub: "WORLD FEED" };
  return { value: "—", sub: "WORLD" };
}
function fmtComms(c: any): Pair {
  if (c?.connected) return { value: `${(c.unread ?? 0).toLocaleString("en-US")} UNREAD`, sub: "GMAIL" };
  if (c && c.oauthConfigured === false) return { value: "OFFLINE", sub: "NOT SET" };
  return { value: "CONNECT", sub: "GMAIL" };
}
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
function fmtMemory(sessionCount: number): Pair {
  const exchanges = Math.ceil(sessionCount / 2);
  return exchanges > 0 ? { value: "RETAINING", sub: `${exchanges} THIS SESSION` } : { value: "STANDBY", sub: "MEMORY" };
}

// The orb's projected radius is orbFrac · min(viewport w, h) — see Presence3D,
// which tunes its camera to the SAME fraction so the lattice hugs the sphere.
// Keep these two in lock-step.
const orbFrac = (w: number, h: number) => (Math.min(w, h) < 540 ? 0.13 : 0.18);

type Layout = {
  w: number;
  h: number;
  cx: number;
  cy: number;
  orbR: number;
  ring1: number;
  ring2: number;
  rx: number;
  ry: number;
};

function computeLayout(w: number, h: number): Layout {
  const cx = w / 2;
  const cy = h / 2;
  const narrow = w < 760;
  const orbR = orbFrac(w, h) * Math.min(w, h);
  const ring1 = orbR * 1.26;
  const ring2 = orbR * 1.5;

  // Vertical readout radius — bounded so the steepest (corner) readouts clear the
  // deck dots up top and the composer down low, and never run off-screen.
  const blockH = 52;
  const topReserve = 58;
  const bottomReserve = narrow ? 150 : 116;
  const maxSin = 0.82; // sin(55°) — the corner angle
  const ryTop = (cy - topReserve - blockH) / maxSin;
  const ryBot = (h - bottomReserve - blockH - cy) / maxSin;
  let ry = Math.min(ryTop, ryBot, 0.32 * h);
  ry = Math.max(ry, ring2 * 1.16); // keep readouts outside the lattice…
  ry = Math.min(ry, ryBot); // …but never past the composer

  // Horizontal radius — more generous (wide viewport), bounded by width so the
  // side readouts' text never runs off the edge.
  const rxCap = Math.min(ry * 1.5, w / 2 - (narrow ? 110 : 142));
  const rx = Math.max(ring2 * 1.14, Math.min(ry * 1.3, rxCap));

  return { w, h, cx, cy, orbR, ring1, ring2, rx, ry };
}

export default function PresenceTelemetry({
  state,
  sessionCount,
  visible,
  onNavigate,
}: {
  state: AugustState;
  sessionCount: number;
  visible: boolean;
  onNavigate?: (key: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [feeds, setFeeds] = useState<{ markets?: any; command?: any; intel?: any; comms?: any }>({});
  const [hovered, setHovered] = useState<string | null>(null);

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

  // Pull the same organ endpoints the surfaces use (the retired Brief's role).
  useEffect(() => {
    let alive = true;
    const pull = (key: string, url: string) =>
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j) setFeeds((prev) => ({ ...prev, [key]: j }));
        })
        .catch(() => {});
    const load = () => {
      pull("markets", "/api/markets");
      pull("command", "/api/command");
      pull("intel", "/api/intel");
      pull("comms", "/api/inbox");
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const readouts: Readout[] = useMemo(() => {
    const mk = fmtMarkets(feeds.markets);
    const wo = fmtWorld(feeds.command, feeds.intel);
    const co = fmtComms(feeds.comms);
    const me = fmtMemory(sessionCount);
    // Four organs on the four corners — balanced. MARKETS, WORLD and COMMS carry a
    // surface and navigate; MEMORY (no surface) is a quiet status readout.
    return [
      { key: "markets", label: "MARKETS", angle: -52, nav: true, ...mk },
      { key: "world", label: "WORLD", angle: 52, nav: true, ...wo },
      { key: "comms", label: "COMMS", angle: 128, nav: true, ...co },
      { key: "memory", label: "MEMORY", angle: -128, nav: false, ...me },
    ];
  }, [sessionCount, feeds]);

  const L = computeLayout(size.w, size.h);
  const ready = size.w > 0 && size.h > 0;

  // Place each readout on the ellipse, with a radial node (on ring2) + leader.
  const placed = useMemo(() => {
    if (!ready) return [];
    return readouts.map((r) => {
      const a = (r.angle * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const ex = L.cx + L.rx * cos;
      const ey = L.cy + L.ry * sin;
      const dlen = Math.hypot(L.rx * cos, L.ry * sin) || 1;
      const ndx = (L.rx * cos) / dlen;
      const ndy = (L.ry * sin) / dlen;
      return {
        ...r,
        ex,
        ey,
        nodeX: L.cx + ndx * L.ring2,
        nodeY: L.cy + ndy * L.ring2,
        leadX: ex - ndx * 9,
        leadY: ey - ndy * 9,
        align: cos < -0.3 ? "right" : cos > 0.3 ? "left" : "center",
        tx: cos < -0.3 ? "-100%" : cos > 0.3 ? "0%" : "-50%",
        ty: sin < -0.3 ? "-100%" : sin > 0.3 ? "0%" : "-50%",
      };
    });
  }, [ready, readouts, L.cx, L.cy, L.rx, L.ry, L.ring2]);

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
            {placed.map((p) => {
              const hot = hovered === p.key;
              return (
                <g key={p.key} className={hot ? "lead-hot" : undefined}>
                  <line className="leader" x1={p.nodeX} y1={p.nodeY} x2={p.leadX} y2={p.leadY} />
                  <circle className="leader-node" cx={p.nodeX} cy={p.nodeY} r={hot ? 3.6 : 2.6} />
                </g>
              );
            })}
          </svg>

          {placed.map((p) => {
            const style = { left: p.ex, top: p.ey, transform: `translate(${p.tx}, ${p.ty})`, textAlign: p.align as "left" | "right" | "center" };
            const inner = (
              <>
                <span className="readout-label">{p.label}</span>
                <span className="readout-value">{p.value}</span>
                <span className="readout-sub">{p.sub}</span>
              </>
            );
            return p.nav ? (
              <button
                key={p.key}
                type="button"
                className="readout readout-nav"
                style={style}
                onClick={() => onNavigate?.(p.key)}
                onPointerEnter={() => setHovered(p.key)}
                onPointerLeave={() => setHovered((h) => (h === p.key ? null : h))}
                onFocus={() => setHovered(p.key)}
                onBlur={() => setHovered((h) => (h === p.key ? null : h))}
                aria-label={`Open ${p.label}`}
              >
                {inner}
              </button>
            ) : (
              <div key={p.key} className="readout readout-static" style={style}>
                {inner}
              </div>
            );
          })}

          <div className="presence-center">
            <div className="presence-center-t1">AUGUST</div>
            <div className="presence-center-t2">{fmtPresence(state)}</div>
          </div>
        </>
      ) : null}
    </div>
  );
}
