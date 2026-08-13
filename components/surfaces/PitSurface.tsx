"use client";

// THE PIT (GAME-2) — the arcade. One run = one synthetic trading day (~75s)
// on a canvas: perspective grid, glowing price line, all-in BUY / flat SELL,
// beat +15% before the bell, margin call under 40%. The tape is seeded by
// the ET date — one tape a day, everyone plays the same market. SIMULATED,
// permanently labeled. No network mid-run: GET once on entry, POST per run.

import { useCallback, useEffect, useRef, useState } from "react";
import type { LeaderRow, PitPlayer, RunStats } from "@/lib/pit";

const START_CASH = 10_000;
const TARGET_PCT = 15; // beat the bell at +15%
const MARGIN_PCT = 40; // margin call under 40% of start
const DURATION_S = 75;
const TPS = 12; // ticks per second
const N = DURATION_S * TPS;

// ── the daily tape (pure, seeded) ─────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type PitEvent = { at: number; len: number; kind: "crash" | "squeeze"; label: string };

function makeTape(dateSeed: string): { prices: number[]; events: PitEvent[]; name: string } {
  let h = 0;
  for (const c of dateSeed) h = (h * 31 + c.charCodeAt(0)) | 0;
  const rng = mulberry32(h);
  const NAMES = ["MTRX", "NEO", "ORCL-9", "ZION", "GRID", "PHOS", "DOJO", "RAIL"];
  const name = NAMES[Math.floor(rng() * NAMES.length)];

  // segment plan: drifts + spikes + dumps + fakeouts + ONE clean dip-and-rip
  const prices: number[] = [];
  let p = 100;
  const seg = (len: number, drift: number, vol: number) => {
    for (let i = 0; i < len; i++) {
      p = Math.max(20, p * (1 + drift + (rng() - 0.5) * vol));
      prices.push(p);
    }
  };
  const dipRipAt = 0.35 + rng() * 0.25; // the guaranteed arc, mid-tape
  const events: PitEvent[] = [];
  const crashAt = rng() < 0.5 ? 0.15 + rng() * 0.1 : 0.7 + rng() * 0.12;
  events.push({ at: Math.floor(crashAt * N), len: Math.floor(N * 0.04), kind: "crash", label: "FLASH CRASH" });
  events.push({ at: Math.floor((0.55 + rng() * 0.2) * N), len: Math.floor(N * 0.1), kind: "squeeze", label: "SQUEEZE — ×2 WINDOW" });

  while (prices.length < N) {
    const t = prices.length / N;
    const ev = events.find((e) => prices.length >= e.at && prices.length < e.at + e.len);
    if (ev?.kind === "crash") seg(Math.min(ev.at + ev.len - prices.length, 10), -0.006, 0.01);
    else if (t >= dipRipAt && t < dipRipAt + 0.06) seg(6, -0.004, 0.006); // the dip…
    else if (t >= dipRipAt + 0.06 && t < dipRipAt + 0.16) seg(6, 0.005, 0.006); // …and rip
    else if (rng() < 0.08) seg(4 + Math.floor(rng() * 6), (rng() - 0.45) * 0.008, 0.012); // spike/fakeout
    else seg(8, (rng() - 0.48) * 0.0015, 0.005); // texture drift
  }
  return { prices: prices.slice(0, N), events, name };
}

// ── the surface ───────────────────────────────────────────────────────────────

type Phase = "lobby" | "run" | "end";
type Boards = { today: LeaderRow[]; best: LeaderRow[] };
type EndState = {
  verdict: "BELL" | "MISS" | "MARGIN";
  pct: number;
  stats: RunStats;
};

export default function PitSurface({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [player, setPlayer] = useState<PitPlayer | null>(null);
  const [boards, setBoards] = useState<Boards>({ today: [], best: [] });
  const [date, setDate] = useState("");
  const [end, setEnd] = useState<EndState | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [board, setBoard] = useState<"today" | "best">("today");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const holdingRef = useRef(false); // mirrored for the button handlers
  const gameRef = useRef<{ buy: () => void; sell: () => void; stop: () => void } | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(() => {
    fetch("/api/pit", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: { ok: boolean; date: string; player: PitPlayer; today: LeaderRow[]; best: LeaderRow[] }) => {
        if (!j.ok) return;
        setPlayer(j.player);
        setBoards({ today: j.today, best: j.best });
        setDate(j.date);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!active || loaded.current) return;
    loaded.current = true;
    refresh();
  }, [active, refresh]);

  // ── the run ──────────────────────────────────────────────────────────────
  const startRun = useCallback(() => {
    setEnd(null);
    setPhase("run");
  }, []);

  useEffect(() => {
    if (phase !== "run") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fit = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    const { prices, events, name } = makeTape(date || new Date().toISOString().slice(0, 10));
    let i = 0; // tape index
    let cash = START_CASH;
    let shares = 0;
    let entryPx = 0;
    let combo = 0;
    let shownCash = START_CASH;
    const stats: RunStats = { trades: 0, wins: 0, bestTrade: 0, perfectDips: 0 };
    const pops: Array<{ text: string; cls: number; at: number; x: number }> = [];
    let flash = 0; // + green / − red screen feedback
    let alive = true;
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const px = (k: number) => prices[Math.max(0, Math.min(N - 1, k))];
    const local = (k: number, span = 48) => {
      let lo = Infinity, hi = -Infinity;
      for (let j = Math.max(0, k - span); j <= k; j++) {
        lo = Math.min(lo, prices[j]);
        hi = Math.max(hi, prices[j]);
      }
      return { lo, hi };
    };
    const inSqueeze = (k: number) =>
      events.some((e) => e.kind === "squeeze" && k >= e.at && k < e.at + e.len);

    const buy = () => {
      if (shares > 0 || i >= N - 2) return;
      const price = px(i);
      shares = cash / price;
      cash = 0;
      entryPx = price;
      const { lo } = local(i);
      const perfect = price <= lo * 1.015;
      if (perfect) {
        combo += 1;
        stats.perfectDips += 1;
        pops.push({ text: `PERFECT DIP ×${combo}`, cls: 1, at: performance.now(), x: 0.5 });
      } else {
        pops.push({ text: "ALL IN", cls: 0, at: performance.now(), x: 0.5 });
      }
      stats.trades += 1;
    };
    const sell = () => {
      if (shares === 0) return;
      const price = px(i);
      let value = shares * price;
      let gainPct = (price / entryPx - 1) * 100;
      const { hi } = local(i);
      const perfectExit = price >= hi * 0.985;
      if (perfectExit && gainPct > 0) combo += 1;
      else if (gainPct <= 0) combo = 0;
      if (inSqueeze(i) && gainPct > 0) {
        value += shares * (price - entryPx); // ×2 window doubles the gain
        gainPct *= 2;
        pops.push({ text: "×2 SQUEEZE", cls: 1, at: performance.now(), x: 0.7 });
      }
      if (combo > 1 && gainPct > 0) value += shares * entryPx * (gainPct / 100) * 0.25 * (combo - 1);
      cash = value;
      shares = 0;
      if (gainPct > 0) stats.wins += 1;
      stats.bestTrade = Math.max(stats.bestTrade, Math.round(gainPct * 100) / 100);
      pops.push({
        text: `${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%${perfectExit && gainPct > 0 ? " · CLEAN EXIT" : ""}`,
        cls: gainPct >= 0 ? 1 : -1,
        at: performance.now(),
        x: 0.5,
      });
      flash = gainPct >= 0 ? 1 : -1;
    };
    const finish = (verdict: EndState["verdict"]) => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
      const equity = cash + shares * px(Math.min(i, N - 1));
      const pct = Math.round((equity / START_CASH - 1) * 10000) / 100;
      const endState: EndState = { verdict, pct, stats };
      setEnd(endState);
      setPhase("end");
      holdingRef.current = false;
      // the one network call: submit the run, refresh the boards
      fetch("/api/pit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run", pct, stats }),
      })
        .then(() => refresh())
        .catch(() => {});
    };
    gameRef.current = { buy, sell, stop: () => finish("MISS") };

    const draw = () => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const price = px(i);
      const equity = cash + shares * price;
      holdingRef.current = shares > 0;
      shownCash += (equity - shownCash) * 0.2;
      // stage
      ctx.fillStyle = "#04070a";
      ctx.fillRect(0, 0, W, H);
      // drawdown / gain wash
      if (flash !== 0 && !reduced) {
        ctx.fillStyle = flash > 0 ? "rgba(78,201,122,0.08)" : "rgba(205,110,100,0.10)";
        ctx.fillRect(0, 0, W, H);
        flash *= 0.9;
        if (Math.abs(flash) < 0.05) flash = 0;
      }
      // perspective grid floor
      const horizon = H * 0.62;
      ctx.strokeStyle = "rgba(64,220,110,0.16)";
      ctx.lineWidth = 1;
      for (let r = 0; r < 8; r++) {
        const y = horizon + Math.pow(r / 8, 1.7) * (H - horizon);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      const slide = (i * 6) % 80;
      for (let c = -10; c < 11; c++) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + c * 26, horizon);
        ctx.lineTo(W / 2 + c * (W / 9) + (c > 0 ? slide : -slide) * 0.2, H);
        ctx.stroke();
      }
      // price window
      const span = 240;
      const from = Math.max(0, i - span);
      let lo = Infinity, hi = -Infinity;
      for (let j = from; j <= i; j++) { lo = Math.min(lo, prices[j]); hi = Math.max(hi, prices[j]); }
      const pad = (hi - lo) * 0.15 || 1;
      lo -= pad; hi += pad;
      const X = (j: number) => ((j - from) / span) * (W - 90);
      const Y = (v: number) => 46 + ((hi - v) / (hi - lo)) * (horizon - 80);
      // entry marker
      if (shares > 0) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "rgba(106,160,200,0.8)";
        ctx.beginPath(); ctx.moveTo(0, Y(entryPx)); ctx.lineTo(W, Y(entryPx)); ctx.stroke();
        ctx.setLineDash([]);
      }
      // the glowing line
      ctx.shadowColor = "rgba(64,220,110,0.9)";
      ctx.shadowBlur = reduced ? 0 : 12;
      ctx.strokeStyle = "#4ec97a";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let j = from; j <= i; j++) {
        const x = X(j), y = Y(prices[j]);
        j === from ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      // price chip at the head
      const hx = X(i), hy = Y(price);
      ctx.fillStyle = "#0a1a10";
      ctx.strokeStyle = "#4ec97a";
      ctx.strokeRect(hx + 8, hy - 11, 74, 22);
      ctx.fillRect(hx + 8, hy - 11, 74, 22);
      ctx.fillStyle = "#d8ecd9";
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.fillText(price.toFixed(2), hx + 14, hy + 4);
      // HUD: name/day + target bar + cash + clock
      ctx.fillStyle = "rgba(216,236,217,0.6)";
      ctx.font = "600 11px ui-monospace, monospace";
      ctx.fillText(`$${name} · ONE DAY · SIMULATED`, 14, 24);
      const prog = Math.min(1, Math.max(0, (equity / START_CASH - 1) / (TARGET_PCT / 100)));
      ctx.strokeStyle = "rgba(64,220,110,0.4)";
      ctx.strokeRect(14, 32, W - 28, 6);
      ctx.fillStyle = prog >= 1 ? "#7fe0a5" : "#4ec97a";
      ctx.fillRect(14, 32, (W - 28) * prog, 6);
      ctx.fillStyle = "#d8ecd9";
      ctx.font = "700 20px ui-monospace, monospace";
      ctx.fillText(`$${shownCash.toFixed(0)}`, 14, 64);
      ctx.font = "600 11px ui-monospace, monospace";
      ctx.fillStyle = equity >= START_CASH ? "#7fe0a5" : "#e08a7a";
      ctx.fillText(`${equity >= START_CASH ? "+" : ""}${((equity / START_CASH - 1) * 100).toFixed(1)}% · TARGET +${TARGET_PCT}%`, 14, 80);
      const remain = Math.max(0, Math.ceil((N - i) / TPS));
      const tense = remain <= 10;
      ctx.fillStyle = tense ? (i % 12 < 6 && !reduced ? "#ffd27a" : "#e08a7a") : "rgba(216,236,217,0.7)";
      ctx.font = `700 ${tense ? 18 : 13}px ui-monospace, monospace`;
      ctx.fillText(`🔔 ${remain}s`, W - 86, 26);
      // event banner
      const ev = events.find((e) => i >= e.at && i < e.at + e.len);
      if (ev) {
        ctx.fillStyle = ev.kind === "crash" ? "rgba(205,110,100,0.9)" : "rgba(255,210,122,0.95)";
        ctx.font = "700 14px ui-monospace, monospace";
        const tw = ctx.measureText(ev.label).width;
        ctx.fillText(ev.label, (W - tw) / 2, 104);
      }
      // P&L pops
      const nowMs = performance.now();
      for (const pop of pops.slice(-4)) {
        const age = (nowMs - pop.at) / 900;
        if (age > 1) continue;
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = pop.cls > 0 ? "#7fe0a5" : pop.cls < 0 ? "#e08a7a" : "#d8ecd9";
        ctx.font = "700 22px ui-monospace, monospace";
        const tw = ctx.measureText(pop.text).width;
        ctx.fillText(pop.text, (W - tw) * pop.x, H * 0.42 - (reduced ? 0 : age * 30));
        ctx.globalAlpha = 1;
      }
    };

    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden) { last = now; return; } // battery-sane pause
      acc += Math.min(200, now - last);
      last = now;
      const step = 1000 / TPS;
      while (acc >= step) {
        acc -= step;
        i += 1;
        const equity = cash + shares * px(Math.min(i, N - 1));
        if (equity < START_CASH * (MARGIN_PCT / 100)) return finish("MARGIN");
        if (i >= N - 1) {
          if (shares > 0) sell(); // the bell flattens you
          return finish(cash >= START_CASH * (1 + TARGET_PCT / 100) ? "BELL" : "MISS");
        }
      }
      draw();
    };
    raf = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "b" || e.key === "B" || e.key === " ") { e.preventDefault(); shares > 0 ? sell() : buy(); }
      if (e.key === "s" || e.key === "S") sell();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, [phase, date, refresh]);

  // ── shells ───────────────────────────────────────────────────────────────
  const winnings = end ? Math.round(START_CASH * (end.pct / 100)) : 0;
  const notReal =
    end === null ? "" :
    end.verdict === "MARGIN" ? "The margin desk sends its regards. It kept your imaginary furniture." :
    winnings >= 1500 ? `That's ${winnings.toLocaleString()} completely fictional dollars. The yacht is also fictional.` :
    winnings >= 0 ? `${winnings.toLocaleString()} pretend dollars. Real traders would call that a Tuesday.` :
    `${Math.abs(winnings).toLocaleString()} imaginary dollars vaporized. Fortunately: imaginary.`;

  return (
    <div className="pit2">
      <p className="pit-sim">SIMULATED — entertainment, not investment advice. No real orders.</p>

      {phase === "run" ? (
        <>
          <canvas ref={canvasRef} className="pit2-canvas" />
          <div className="pit2-ctl">
            <button type="button" className="pit2-btn buy" onClick={() => gameRef.current?.buy()}>
              BUY · ALL IN
            </button>
            <button type="button" className="pit2-btn sellb" onClick={() => gameRef.current?.sell()}>
              SELL · FLAT
            </button>
          </div>
        </>
      ) : (
        <div className="pit2-shell">
          {phase === "end" && end ? (
            <div className={`pit2-verdict v-${end.verdict.toLowerCase()}`}>
              <h2>
                {end.verdict === "BELL" ? "🔔 BEAT THE BELL" : end.verdict === "MARGIN" ? "💀 MARGIN CALLED" : "MISSED THE TARGET"}
              </h2>
              <p className={`pit2-endpct ${end.pct >= 0 ? "up" : "down"}`}>
                {end.pct >= 0 ? "+" : ""}
                {end.pct.toFixed(1)}%
              </p>
              <p className="pit2-stats">
                {end.stats.trades} trades · {end.stats.trades ? Math.round((end.stats.wins / end.stats.trades) * 100) : 0}% wins ·
                best {end.stats.bestTrade >= 0 ? "+" : ""}{end.stats.bestTrade.toFixed(1)}% · {end.stats.perfectDips} perfect dips
              </p>
              <p className="pit2-notreal">{notReal}</p>
            </div>
          ) : (
            <div className="pit2-hero">
              <h2>THE PIT</h2>
              <p>One day. All-in taps. Beat +{TARGET_PCT}% before the bell — everyone plays today's tape.</p>
            </div>
          )}

          <button type="button" className="pit2-btn pit2-run" onClick={startRun}>
            {phase === "end" ? "RUN IT BACK" : "OPEN THE MARKET"}
          </button>

          <form
            className="pit2-name"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!nameDraft.trim()) return;
              await fetch("/api/pit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "name", name: nameDraft }),
              });
              refresh();
            }}
          >
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={16}
              placeholder={player?.name === "PLAYER" || !player ? "pick a name for the boards" : player.name}
              aria-label="Display name"
            />
            <button type="submit">SET</button>
          </form>

          <div className="pit2-boards">
            <div className="pit2-boardtabs">
              <button type="button" className={board === "today" ? "on" : ""} onClick={() => setBoard("today")}>
                TODAY'S TAPE
              </button>
              <button type="button" className={board === "best" ? "on" : ""} onClick={() => setBoard("best")}>
                ALL-TIME BEST RUN
              </button>
            </div>
            <ol>
              {(board === "today" ? boards.today : boards.best).map((r, idx) => (
                <li key={r.pid} className={player && r.pid === player.pid ? "me" : ""}>
                  <span>{idx + 1}</span>
                  <span className="nm">{r.name}</span>
                  <span className={`sc ${r.pct >= 0 ? "up" : "down"}`}>
                    {r.pct >= 0 ? "+" : ""}
                    {r.pct.toFixed(1)}%
                  </span>
                </li>
              ))}
              {(board === "today" ? boards.today : boards.best).length === 0 ? (
                <li className="empty">nobody on this board yet — be first</li>
              ) : null}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
