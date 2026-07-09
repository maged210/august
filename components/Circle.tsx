"use client";

import { useEffect, useRef } from "react";

export type AugustState = "boot" | "idle" | "listening" | "thinking" | "speaking";

type CircleProps = {
  state: AugustState;
  /** 0..1 live audio level — mic RMS while listening, speech envelope while speaking. */
  amplitudeRef: React.MutableRefObject<number>;
};

// Crystalline shard growths around the rim. Asymmetric on purpose.
const SHARDS = [
  { angle: -16, length: 66, width: 22, skew: 9 },
  { angle: 41, length: 36, width: 15, skew: -6 },
  { angle: 104, length: 82, width: 27, skew: 11 },
  { angle: 159, length: 28, width: 12, skew: 4 },
  { angle: 213, length: 56, width: 21, skew: -9 },
  { angle: 289, length: 46, width: 18, skew: 7 },
] as const;

function shardPoints(s: (typeof SHARDS)[number]): string {
  const a = (s.angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const px = -Math.sin(a);
  const py = Math.cos(a);
  const C = 300;
  const rb = 150;
  const rt = rb + s.length;
  const rm = rb + s.length * 0.42;
  const at = (r: number, off: number) =>
    `${(C + dx * r + px * off).toFixed(1)},${(C + dy * r + py * off).toFixed(1)}`;
  return [
    at(rb, -s.width / 2),
    at(rm, -s.width * 0.26),
    `${(C + dx * rt + px * s.skew).toFixed(1)},${(C + dy * rt + py * s.skew).toFixed(1)}`,
    at(rm, s.width * 0.34),
    at(rb, s.width / 2),
  ].join(" ");
}

type Particle = {
  ang: number;
  av: number; // angular drift, rad/s
  rOff: number; // radial offset, fraction of size
  wob: number; // radial wobble amount, fraction of size
  ws: number; // wobble speed
  phase: number;
  size: number;
  baseAlpha: number;
  tws: number; // twinkle speed
  tphase: number;
  steelBias: number; // 0..1 — how much this particle tints toward the accent
};

export default function Circle({ state, amplitudeRef }: CircleProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const groupRef = useRef<SVGGElement | null>(null);
  const shardsRef = useRef<SVGGElement | null>(null);
  const accentRef = useRef<SVGGElement | null>(null);
  const turbRef = useRef<SVGFETurbulenceElement | null>(null);
  const dispRef = useRef<SVGFEDisplacementMapElement | null>(null);

  // Mirror state into a ref so the animation loop reads the latest without restarting.
  const stateRef = useRef<AugustState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const svg = svgRef.current;
    if (!container || !canvas || !svg) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;

    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    let S = 0;
    const resize = () => {
      S = container.clientWidth;
      canvas.width = Math.round(S * dpr);
      canvas.height = Math.round(S * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // Build the particle haze.
    const N = reduced ? 64 : 140;
    const ps: Particle[] = [];
    for (let i = 0; i < N; i++) {
      ps.push({
        ang: Math.random() * Math.PI * 2,
        av: (Math.random() * 2 - 1) * 0.15,
        rOff: (Math.random() * 2 - 1) * 0.05,
        wob: 0.004 + Math.random() * 0.016,
        ws: 0.4 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        size: 0.6 + Math.random() * 1.7,
        baseAlpha: 0.12 + Math.random() * 0.5,
        tws: 0.5 + Math.random() * 2.2,
        tphase: Math.random() * Math.PI * 2,
        steelBias: Math.random(),
      });
    }

    const eased = {
      disp: 12,
      accent: 0,
      agit: 0.18,
      scale: 1,
      palpha: 0.45,
      shardScale: 1,
      reveal: 0,
    };
    let rot = 0;
    let shardRot = 0;
    const t0 = performance.now();
    let last = t0;
    let raf = 0;

    const ease = (v: number, target: number, rate: number, dt: number) =>
      v + (target - v) * Math.min(1, dt * rate);

    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Self-heal sizing: if the first layout reported 0 (fonts/layout not ready,
      // or ResizeObserver hasn't delivered yet), recover the moment we have a size.
      if (S <= 0 || canvas.width === 0) {
        const w = container.clientWidth;
        if (w > 0) {
          S = w;
          canvas.width = Math.round(S * dpr);
          canvas.height = Math.round(S * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      }

      const st = stateRef.current;
      const amp = Math.max(0, Math.min(1, amplitudeRef.current || 0));

      let tDisp: number;
      let tAccent: number;
      let tAgit: number;
      let rotSpeed: number;
      let shardSpeed: number;
      let tPalpha: number;
      let tShardScale: number;
      let scaleTarget: number;

      switch (st) {
        case "listening": // ring tightens, particles agitate, accent fades in
          tDisp = 20 + amp * 22;
          tAccent = 0.5 + amp * 0.25;
          tAgit = 0.7 + amp * 0.6;
          rotSpeed = 2.4;
          shardSpeed = 2.6;
          tPalpha = 0.7 + amp * 0.3;
          tShardScale = 1 + amp * 0.04;
          scaleTarget = 0.975 + Math.sin(t * 0.9) * 0.008 + amp * 0.02;
          break;
        case "thinking": // slow inward pulse, shards rotate, accent dims
          tDisp = 15;
          tAccent = 0.14 + 0.06 * (0.5 + 0.5 * Math.sin(t * 1.5));
          tAgit = 0.4;
          rotSpeed = 5.5;
          shardSpeed = 8;
          tPalpha = 0.5;
          tShardScale = 1;
          scaleTarget = 1 - (0.5 + 0.5 * Math.sin(t * 1.5)) * 0.03;
          break;
        case "speaking": // ring + shards react to the spoken-audio envelope
          tDisp = 18 + amp * 26;
          tAccent = 0.32 + amp * 0.22;
          tAgit = 0.5 + amp * 0.6;
          rotSpeed = 3;
          shardSpeed = 3.6;
          tPalpha = 0.6 + amp * 0.3;
          tShardScale = 1 + amp * 0.08;
          scaleTarget = 1 + Math.sin(t * 0.9) * 0.012 + amp * 0.05;
          break;
        default: // idle + boot — slow drift, gentle breathing, monochrome
          tDisp = 12;
          tAccent = 0;
          tAgit = 0.18;
          rotSpeed = 3;
          shardSpeed = 2;
          tPalpha = 0.45;
          tShardScale = 1;
          scaleTarget = 1 + Math.sin(t * 0.85) * 0.012;
          break;
      }

      if (reduced) {
        rotSpeed *= 0.4;
        shardSpeed *= 0.4;
        tAgit *= 0.5;
      }

      eased.disp = ease(eased.disp, tDisp, 5, dt);
      eased.accent = ease(eased.accent, tAccent, 4, dt);
      eased.agit = ease(eased.agit, tAgit, 4, dt);
      eased.palpha = ease(eased.palpha, tPalpha, 3, dt);
      eased.shardScale = ease(eased.shardScale, tShardScale, 6, dt);
      eased.scale = ease(eased.scale, scaleTarget, 6, dt);
      eased.reveal = ease(eased.reveal, 1, 1.6, dt);

      rot += dt * rotSpeed;
      shardRot += dt * shardSpeed;

      // The circle resolves out of noise on load: extra edge displacement that
      // decays over the first ~1.2s.
      const dispBonus = Math.max(0, 1 - t / 1.2) * 45;

      turbRef.current?.setAttribute(
        "baseFrequency",
        (0.011 + 0.0026 * Math.sin(t * 0.22)).toFixed(4),
      );
      dispRef.current?.setAttribute("scale", (eased.disp + dispBonus).toFixed(2));
      groupRef.current?.setAttribute(
        "transform",
        `rotate(${rot.toFixed(2)} 300 300) translate(300 300) scale(${eased.scale.toFixed(4)}) translate(-300 -300)`,
      );
      shardsRef.current?.setAttribute(
        "transform",
        `rotate(${shardRot.toFixed(2)} 300 300) translate(300 300) scale(${eased.shardScale.toFixed(4)}) translate(-300 -300)`,
      );
      if (accentRef.current) accentRef.current.style.opacity = eased.accent.toFixed(3);
      svg.style.opacity = eased.reveal.toFixed(3);

      // Particle haze.
      const cx = S / 2;
      const cy = S / 2;
      const base = 0.25 * S;
      const gAlpha = eased.palpha * eased.reveal;
      ctx.clearRect(0, 0, S, S);
      for (const p of ps) {
        p.ang += p.av * (0.4 + eased.agit * 2) * dt;
        const wob = Math.sin(t * p.ws + p.phase) * p.wob * S * (0.6 + eased.agit * 1.3);
        const r = base + p.rOff * S + wob;
        const x = cx + Math.cos(p.ang) * r;
        const y = cy + Math.sin(p.ang) * r;
        const tw = 0.5 + 0.5 * Math.sin(t * p.tws + p.tphase);
        const alpha = p.baseAlpha * (0.35 + 0.65 * tw) * gAlpha;
        if (alpha <= 0.003) continue;
        const mix = eased.accent * p.steelBias;
        const cr = Math.round(232 + (110 - 232) * mix);
        const cg = Math.round(230 + (140 - 230) * mix);
        const cb = Math.round(225 + (168 - 225) * mix);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [amplitudeRef]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none relative"
      style={{ width: "min(82vmin, 640px)", height: "min(82vmin, 640px)" }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <svg
        ref={svgRef}
        viewBox="0 0 600 600"
        className="absolute inset-0 h-full w-full"
        style={{ opacity: 0 }}
      >
        <defs>
          <filter id="aug-smoke" x="-50%" y="-50%" width="200%" height="200%">
            <feTurbulence
              ref={turbRef}
              type="fractalNoise"
              baseFrequency="0.012"
              numOctaves="2"
              seed="7"
              result="noise"
            />
            <feDisplacementMap
              ref={dispRef}
              in="SourceGraphic"
              in2="noise"
              scale="14"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <radialGradient id="aug-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#e8e6e1" stopOpacity="0.05" />
            <stop offset="60%" stopColor="#9a9a9f" stopOpacity="0.03" />
            <stop offset="100%" stopColor="#13151a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="aug-shard" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e8e6e1" stopOpacity="0" />
            <stop offset="55%" stopColor="#e8e6e1" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.68" />
          </linearGradient>
        </defs>

        <g ref={groupRef}>
          {/* faint smoky inner disc — gives the ring a little volume */}
          <circle cx="300" cy="300" r="150" fill="url(#aug-core)" filter="url(#aug-smoke)" />

          {/* crystalline shards — crisp against the smoky ring, with their own slow spin */}
          <g ref={shardsRef}>
            {SHARDS.map((s, i) => (
              <polygon
                key={i}
                points={shardPoints(s)}
                fill="url(#aug-shard)"
                stroke="#e8e6e1"
                strokeOpacity="0.22"
                strokeWidth="0.6"
              />
            ))}
          </g>

          {/* the irregular ink ring */}
          <g filter="url(#aug-smoke)">
            <circle cx="300" cy="300" r="150" fill="none" stroke="#e8e6e1" strokeOpacity="0.85" strokeWidth="2.2" />
            <circle cx="300" cy="300" r="150" fill="none" stroke="#9a9a9f" strokeOpacity="0.10" strokeWidth="9" />
            <circle cx="300" cy="300" r="137" fill="none" stroke="#9a9a9f" strokeOpacity="0.18" strokeWidth="0.8" />
          </g>

          {/* the one cold accent — opacity driven by state */}
          <g ref={accentRef} style={{ opacity: 0 }}>
            <g filter="url(#aug-smoke)">
              <circle cx="300" cy="300" r="150" fill="none" stroke="#6e8ca8" strokeOpacity="0.9" strokeWidth="1.6" />
              <circle cx="300" cy="300" r="150" fill="none" stroke="#6e8ca8" strokeOpacity="0.25" strokeWidth="6" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
