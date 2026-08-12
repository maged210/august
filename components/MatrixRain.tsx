"use client";

// Matrix code-rain — the [data-theme="matrix"] background layer. One 2D
// canvas, perf-first per the house canvas rules (Circle.tsx's skeleton plus
// Presence3D's park/resume gating):
//   • DPR capped at 2, ResizeObserver sizing with zero-size self-heal
//   • one rAF loop; columns advance on an accumulator — the rain is discrete
//     glyph steps, nothing here needs 60fps
//   • parks while document.hidden, resumes on visibility
//   • prefers-reduced-motion: one static sparse glyph field, no loop at all
// The color rides the --rain-rgb token (read at mount — the component only
// mounts while the matrix theme is active, so a theme flip remounts it), and
// the layer's overall strength is CSS (--rain-opacity on .matrix-rain).
//
// UX5 (v2): quieter and OURS. The falling strings are STOCK SYMBOLS from
// lib/rain-symbols — the current live/tracked book plus the pulse five and a
// small static filler — spelled vertically down each column with gaps between
// words. The pool refreshes in place when the book changes (new words pick up
// the new pool; the field is never reset). Every knob is turned down from v1:
// smaller glyphs, tighter columns, slower fall, drop opacity well below the
// old head/trail values — ambient texture you feel, not text you read.

import { useEffect, useRef } from "react";
import { onRainSymbols, rainSymbolPool } from "@/lib/rain-symbols";

const CELL = 13; // px per column/row — v1 was 16 (smaller glyphs, tighter columns)
const MAX_COLS = 260; // ultrawide guard: the cell scales up past ~3380px so the
// per-step glyph count stays bounded on a 7680×2160 display
const STEP_MS = 115; // column advance cadence — v1 was 80ms (slower fall)
const TRAIL = 14; // trail length in glyphs
const GAP = " ";

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

    // The symbol pool — refreshed in place on book changes (see cleanup).
    let pool = rainSymbolPool();
    const offPool = onRainSymbols(() => {
      pool = rainSymbolPool();
    });

    const pickWord = (): string => pool[(Math.random() * pool.length) | 0] ?? "NQ";

    let raf = 0;
    let running = false;
    let last = 0;
    let acc = 0;
    let cols = 0;
    let rows = 0;
    let heads: number[] = []; // fractional head row per column (negative = above viewport)
    let speeds: number[] = []; // rows per step, per column
    let grid: string[][] = []; // [col][row] → last glyph drawn at that cell
    // per-column word feeder: the next glyph the head writes spells the
    // column's current symbol top-to-bottom, then 1-3 blank cells, then a
    // fresh word from the (possibly refreshed) pool
    let words: string[] = [];
    let wordAt: number[] = [];
    let gaps: number[] = [];

    const nextGlyph = (c: number): string => {
      if (gaps[c] > 0) {
        gaps[c] -= 1;
        return GAP;
      }
      const w = words[c];
      const ch = w[wordAt[c]] ?? GAP;
      wordAt[c] += 1;
      if (wordAt[c] >= w.length) {
        words[c] = pickWord();
        wordAt[c] = 0;
        gaps[c] = 1 + ((Math.random() * 3) | 0);
      }
      return ch;
    };

    // Fit the column/row arrays to the current size, PRESERVING what survives:
    // a resize must not blank the whole field and leave it refilling for
    // seconds — only added columns seed fresh. New cells start blank; the
    // heads write symbols into them as they pass.
    const reflow = () => {
      cols = Math.max(1, Math.floor(canvas.clientWidth / cell));
      rows = Math.max(1, Math.ceil(canvas.clientHeight / cell) + 1);
      heads.length = Math.min(heads.length, cols);
      speeds.length = Math.min(speeds.length, cols);
      grid.length = Math.min(grid.length, cols);
      words.length = Math.min(words.length, cols);
      wordAt.length = Math.min(wordAt.length, cols);
      gaps.length = Math.min(gaps.length, cols);
      while (heads.length < cols) {
        heads.push(-Math.random() * rows * 1.5);
        speeds.push(0.4 + Math.random() * 0.5); // v1 was 0.55–1.3 rows/step
        grid.push(Array.from({ length: rows }, () => GAP));
        words.push(pickWord());
        wordAt.push(0);
        gaps.push((Math.random() * 3) | 0);
      }
      for (let c = 0; c < cols; c++) {
        const col = grid[c];
        if (col.length > rows) col.length = rows;
        while (col.length < rows) col.push(GAP);
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
      // Reduced motion: a dim, sparse, motionless field of ticker characters —
      // presence without animation.
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.fillStyle = `rgba(${rainRgb},0.3)`;
      const chars = pool.join("");
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (Math.random() < 0.03)
            ctx.fillText(chars[(Math.random() * chars.length) | 0] ?? "N", c * cell, r * cell);
        }
      }
    };

    const step = () => {
      for (let c = 0; c < cols; c++) {
        heads[c] += speeds[c];
        const head = Math.floor(heads[c]);
        if (head >= 0 && head < rows) grid[c][head] = nextGlyph(c);
        // trail fully off-screen → respawn above with a new pace
        if (head - TRAIL > rows) {
          heads[c] = -Math.random() * rows;
          speeds[c] = 0.4 + Math.random() * 0.5;
        }
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      // One fillStyle per trail depth (not per glyph) keeps state changes at
      // TRAIL+1 per frame instead of cols×TRAIL. Alphas midway between v1
      // (head 0.95 / trail 0.6) and the invisible first quiet pass (0.5/0.28)
      // — R1: faintly perceptible, never readable-loud.
      for (let t = 0; t <= TRAIL; t++) {
        const a = t === 0 ? 0.72 : 0.44 * Math.pow(1 - t / TRAIL, 1.7);
        if (a < 0.02) continue;
        ctx.fillStyle = `rgba(${rainRgb},${a})`;
        for (let c = 0; c < cols; c++) {
          const r = Math.floor(heads[c]) - t;
          if (r >= 0 && r < rows) {
            const g = grid[c][r];
            if (g !== GAP) ctx.fillText(g, c * cell, r * cell);
          }
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
      offPool();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={canvasRef} className="matrix-rain" aria-hidden />;
}
