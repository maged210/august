"use client";

// Matrix code-rain — the [data-theme="matrix"] background layer. One 2D
// canvas, perf-first per the house canvas rules (Circle.tsx's skeleton plus
// Presence3D's park/resume gating):
//   • DPR capped at 2, ResizeObserver sizing with zero-size self-heal
//   • one rAF loop; columns advance on an ~80ms accumulator — the rain is
//     discrete glyph steps, nothing here needs 60fps
//   • parks while document.hidden, resumes on visibility
//   • prefers-reduced-motion: one static sparse glyph field, no loop at all
// The color rides the --rain-rgb token (read at mount — the component only
// mounts while the matrix theme is active, so a theme flip remounts it), and
// the layer's overall strength is CSS (--rain-opacity on .matrix-rain).

import { useEffect, useRef } from "react";

const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEFXZ$+-<>*";
const CELL = 16; // px per column/row at normal widths
const MAX_COLS = 240; // ultrawide guard: the cell scales up past ~3840px so the
// per-step glyph count stays bounded on a 7680×2160 display
const STEP_MS = 80; // column advance cadence (~12.5 steps/s)
const TRAIL = 16; // trail length in glyphs

function glyph(): string {
  return GLYPHS[(Math.random() * GLYPHS.length) | 0];
}

export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rainRgb = (
      getComputedStyle(document.documentElement).getPropertyValue("--rain-rgb").trim() ||
      "64 220 110"
    )
      .split(/[\s,]+/)
      .join(",");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let cell = CELL;

    let raf = 0;
    let running = false;
    let last = 0;
    let acc = 0;
    let cols = 0;
    let rows = 0;
    let heads: number[] = []; // fractional head row per column (negative = above viewport)
    let speeds: number[] = []; // rows per step, per column
    let grid: string[][] = []; // [col][row] → last glyph drawn at that cell

    // Fit the column/row arrays to the current size, PRESERVING what survives:
    // a resize must not blank the whole field and leave it refilling for
    // seconds — only added columns/rows seed fresh. From empty state (boot)
    // this seeds everything, with heads staggered above the viewport.
    const reflow = () => {
      cols = Math.max(1, Math.floor(canvas.clientWidth / cell));
      rows = Math.max(1, Math.ceil(canvas.clientHeight / cell) + 1);
      heads.length = Math.min(heads.length, cols);
      speeds.length = Math.min(speeds.length, cols);
      grid.length = Math.min(grid.length, cols);
      while (heads.length < cols) {
        heads.push(-Math.random() * rows * 1.5);
        speeds.push(0.55 + Math.random() * 0.75);
        grid.push(Array.from({ length: rows }, glyph));
      }
      for (let c = 0; c < cols; c++) {
        const col = grid[c];
        if (col.length > rows) col.length = rows;
        while (col.length < rows) col.push(glyph());
        // a shrink must not strand a head far below the new bottom
        if (heads[c] > rows + TRAIL) heads[c] = rows + TRAIL;
      }
    };

    // Size the backing store; false = zero-size (hidden/mid-layout) — self-heal
    // by trying again when the observer fires with real bounds.
    const size = (): boolean => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return false;
      cell = Math.max(CELL, Math.ceil(w / MAX_COLS));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${cell - 2}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
      return true;
    };

    const drawStatic = () => {
      // Reduced motion: a dim, sparse, motionless glyph field — presence
      // without animation.
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.fillStyle = `rgba(${rainRgb},0.4)`;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (Math.random() < 0.045) ctx.fillText(glyph(), c * cell, r * cell);
        }
      }
    };

    const step = () => {
      for (let c = 0; c < cols; c++) {
        heads[c] += speeds[c];
        const head = Math.floor(heads[c]);
        if (head >= 0 && head < rows) grid[c][head] = glyph();
        // trail fully off-screen → respawn above with a new pace
        if (head - TRAIL > rows) {
          heads[c] = -Math.random() * rows;
          speeds[c] = 0.55 + Math.random() * 0.75;
        }
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      // One fillStyle per trail depth (not per glyph) keeps state changes at
      // TRAIL+1 per frame instead of cols×TRAIL.
      for (let t = 0; t <= TRAIL; t++) {
        const a = t === 0 ? 0.95 : 0.6 * Math.pow(1 - t / TRAIL, 1.7);
        if (a < 0.02) continue;
        ctx.fillStyle = `rgba(${rainRgb},${a})`;
        for (let c = 0; c < cols; c++) {
          const r = Math.floor(heads[c]) - t;
          if (r >= 0 && r < rows) ctx.fillText(grid[c][r], c * cell, r * cell);
        }
      }
    };

    const loop = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden) return; // parked — the visibility handler resumes
      const dt = Math.min(250, now - last); // clamp: a long tab-away is one step, not a burst
      last = now;
      acc += dt;
      if (acc < STEP_MS) return;
      while (acc >= STEP_MS) {
        acc -= STEP_MS;
        step();
      }
      draw();
    };

    const start = () => {
      if (running || reduced) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const boot = () => {
      if (!size()) return;
      reflow();
      if (reduced) drawStatic();
      else start();
    };
    boot();

    const ro = new ResizeObserver(() => {
      stop();
      if (!size()) return; // zero-size — heal on the next observer tick
      reflow();
      if (reduced) drawStatic();
      else if (!document.hidden) start();
    });
    ro.observe(canvas);

    const onVis = () => {
      if (reduced) return;
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={canvasRef} className="matrix-rain" aria-hidden />;
}
