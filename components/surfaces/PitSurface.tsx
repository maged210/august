"use client";

// THE PIT (GAME-3) — CAREER LOOP on the calendar. DAY brief → live tape →
// bell → DAY COMPLETE → next day; five days clear the WEEK. SIMULATED ONLY,
// permanently labeled. The day itself (tapes, catalysts, positions, score)
// is the pure engine in lib/pit-engine — this component draws it, talks to
// the boards, and carries the juice: AUGUST's floor commentary, stamps, the
// day replay, market weather, and the RISK DESK.
//
// MOUNT LAW (GC-G1): the RoundRun is created SYNCHRONOUSLY in the OPEN THE
// MARKET click, before the phase flips — the live scene can never render
// against a missing game. If a scene still fails to mount, the effect throws
// and PitBoundary shows a styled PIT ERROR instead of a silent dead button.

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LEVELS, type LeaderRow, type PitPlayer } from "@/lib/pit";
import {
  DEFAULT_TUNE, LADDER, MARGIN_FRAC, START_CASH,
  createRoundRunTuned, retuneRun,
  type PitEvent, type PitTune, type RoundDef, type RoundRun, type RoundSummary,
} from "@/lib/pit-engine";

// ── error boundary: a scene crash renders loud, never a dead button ──────────
class PitBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: { componentStack?: string | null }) {
    console.error("[PIT ERROR] scene crashed:", err, info.componentStack ?? "");
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="pit2">
        <p className="pit-sim">SIMULATED — entertainment, not investment advice. No real orders.</p>
        <div className="pit2-shell">
          <div className="pit2-verdict">
            <h2>PIT ERROR</h2>
            <p className="pit2-notreal">The scene crashed — reload to re-open the floor.</p>
            <button type="button" className="pit2-btn pit2-run" onClick={() => window.location.reload()}>
              RELOAD
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// ── the calendar (T4): weeks are the tiers; titles survive as subtitles ──────
const WEEK_PERKS: Record<number, string> = {
  2: "crypto desk joins the day 2–3 rotation",
  3: "high-vol names across days 1–3",
  4: "second book — 2 positions from day 1",
  5: "operator desk — options architecture on deck",
};

function weekAdjust(def: RoundDef, week: number): RoundDef {
  const swapIn = (cats: string[], cat: string, ix: number) =>
    cats.includes(cat) ? cats : cats.map((c, k) => (k === ix ? cat : c));
  let d = def;
  if (week >= 2 && (def.n === 2 || def.n === 3)) d = { ...d, cats: swapIn(d.cats, "crypto", d.cats.length - 1) };
  if (week >= 3 && def.n <= 3) d = { ...d, cats: swapIn(d.cats, "highvol", 2) };
  if (week >= 4 && d.positions < 2) d = { ...d, positions: 2 };
  return d;
}

// ── AUGUST ON THE FLOOR (T6): dry desk voice, one line per moment ───────────
const FLOOR_LINES: Partial<Record<PitEvent["type"], string[]>> = {
  goodEntry: ["clean fill. the desk noticed.", "bought it like you meant it."],
  catalyst: ["read the tape before it printed."],
  panicSell: ["sold the low. bold.", "that was the bottom, by the way."],
  stopOut: ["the risk desk covers its eyes."],
  diamondHands: ["held through the pain. paid for it. respect."],
  paperHands: ["it ripped right after. we don't talk about it."],
};
const FLOOR_COOLDOWN_MS = 12_000;

// ── component ────────────────────────────────────────────────────────────────
type Phase = "lobby" | "brief" | "live" | "complete" | "gameover";
type RoundResult = RoundSummary & { n: number };
type TuneKey = keyof PitTune;
const TUNE_SLIDERS: Array<{ key: TuneKey; label: string; min: number; max: number }> = [
  { key: "tps", label: "TICK RATE", min: 0.4, max: 2 },
  { key: "vol", label: "VOLATILITY", min: 0.3, max: 2.5 },
  { key: "drift", label: "DRIFT", min: 0.3, max: 2.5 },
  { key: "retrace", label: "RETRACE FREQ", min: 0.2, max: 2.5 },
  { key: "events", label: "EVENT INTENSITY", min: 0.3, max: 2.5 },
];

function PitInner({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [player, setPlayer] = useState<PitPlayer | null>(null);
  const [boards, setBoards] = useState<{ today: LeaderRow[]; best: LeaderRow[] }>({ today: [], best: [] });
  const [board, setBoard] = useState<"today" | "best">("today");
  const [nameDraft, setNameDraft] = useState("");
  const [roundIx, setRoundIx] = useState(0);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [careerEq, setCareerEq] = useState(START_CASH);
  const [bootErr, setBootErr] = useState<Error | null>(null);
  const [stamp, setStamp] = useState<string | null>(null);
  const [tuneOn, setTuneOn] = useState(false);
  const [tune, setTune] = useState<PitTune>({ ...DEFAULT_TUNE });
  const tuneRef = useRef<PitTune>(tune);
  const runSeed = useRef(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const replayRef = useRef<HTMLCanvasElement | null>(null);
  const riskRef = useRef<HTMLDivElement | null>(null);
  const runRef = useRef<RoundRun | null>(null);
  const popsRef = useRef<Array<{ text: string; cls: number; at: number }>>([]);
  const floorRef = useRef<{ text: string; until: number } | null>(null);
  const floorCdRef = useRef<Record<string, number>>({});
  const stampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focus, setFocus] = useState(0);
  const focusRef = useRef(0);
  const [, force] = useState(0); // chip strip / floor line re-render tick
  const loaded = useRef(false);

  // an event-handler crash can't reach the boundary directly — rethrow in render
  if (bootErr) throw bootErr;

  const refresh = useCallback(() => {
    fetch("/api/pit", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j) => {
        if (!j.ok) return;
        setPlayer(j.player);
        setBoards({ today: j.today, best: j.best });
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (active && !loaded.current) {
      loaded.current = true;
      refresh();
    }
  }, [active, refresh]);

  // T3 — the owner tuning overlay: ?tune=1, never on public paths
  useEffect(() => {
    try {
      const wanted = new URLSearchParams(window.location.search).get("tune") === "1";
      const allowed =
        process.env.NODE_ENV !== "production" ||
        window.location.hostname === "localhost" ||
        !!window.sessionStorage.getItem("aug-admin-token");
      setTuneOn(wanted && allowed);
    } catch { /* stays off */ }
  }, []);
  useEffect(() => { tuneRef.current = tune; }, [tune]);

  const week = player?.level ?? 1;
  const def = weekAdjust(LADDER[Math.min(roundIx, LADDER.length - 1)], week);

  const onEvent = useCallback((ev: PitEvent) => {
    if (ev.type === "pop") {
      popsRef.current.push({ text: ev.text, cls: ev.cls, at: performance.now() });
      return;
    }
    if (ev.type === "diamondHands" || ev.type === "paperHands") {
      setStamp(ev.type === "diamondHands" ? "DIAMOND HANDS" : "PAPER HANDS");
      if (stampTimer.current) clearTimeout(stampTimer.current);
      stampTimer.current = setTimeout(() => setStamp(null), 1400);
    }
    const lines = FLOOR_LINES[ev.type];
    if (!lines) return;
    const now = performance.now();
    if ((floorCdRef.current[ev.type] ?? 0) > now) return;
    floorCdRef.current[ev.type] = now + FLOOR_COOLDOWN_MS;
    floorRef.current = { text: lines[Math.floor(now / 1000) % lines.length], until: now + 4500 };
  }, []);

  const startCareer = () => {
    runSeed.current = (Date.now() % 100000) + 1;
    setCareerEq(START_CASH);
    setRoundIx(0);
    setPhase("brief");
  };

  // OPEN THE MARKET — the game exists BEFORE the live scene renders.
  const openMarket = () => {
    try {
      popsRef.current = [];
      floorRef.current = null;
      runRef.current = createRoundRunTuned(def, runSeed.current, careerEq, tuneRef.current, onEvent);
      setFocus(0);
      setPhase("live");
    } catch (e) {
      setBootErr(e instanceof Error ? e : new Error(String(e)));
    }
  };

  // T3 — non-clock sliders re-cut the RUNNING tape (debounced)
  const retuneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyTune = (key: TuneKey, value: number) => {
    setTune((t) => ({ ...t, [key]: value }));
    if (key === "tps") return; // the clock reads tuneRef live — no re-cut needed
    if (retuneTimer.current) clearTimeout(retuneTimer.current);
    retuneTimer.current = setTimeout(() => {
      const cur = runRef.current;
      if (cur && phase === "live") {
        try { runRef.current = retuneRun(cur, tuneRef.current, onEvent); } catch { /* keep the old tape */ }
      }
    }, 350);
  };

  // ── the live day: canvas + clock only — the engine owns the rules ──────────
  useEffect(() => {
    if (phase !== "live") return;
    const boot = runRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!boot || !canvas || !ctx) {
      // loud by design: the boundary turns this into the PIT ERROR screen
      throw new Error(`PIT: live scene failed to mount (run=${!!boot} canvas=${!!canvas} ctx=${!!ctx})`);
    }
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

    let alive = true;
    let raf = 0, last = performance.now(), acc = 0;

    const finish = (margin: boolean) => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
      const run = runRef.current!;
      const sum = run.finish(margin);
      const res: RoundResult = { ...sum, n: run.def.n };
      setResult(res);
      setCareerEq(sum.endEq);
      setPhase(margin ? "gameover" : "complete");
      const finalFlag = margin ? "margin" : run.def.n === 5 ? true : false;
      fetch("/api/pit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "round", score: sum.score, xp: sum.xp, final: finalFlag,
          careerPct: Math.round((sum.endEq / START_CASH - 1) * 10000) / 100,
          stats: { trades: sum.trades, wins: sum.wins, bestTrade: 0, perfectDips: sum.goodEntries },
        }),
      }).then(() => refresh()).catch(() => {});
    };

    const draw = () => {
      const run = runRef.current!;
      const rdef = run.def;
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const s = Math.min(focusRef.current, run.stocks.length - 1);
      const i = run.i;
      const eq = run.equity();
      const px = run.px;
      ctx.fillStyle = "#04070a";
      ctx.fillRect(0, 0, W, H);
      // subtle grid
      ctx.strokeStyle = "rgba(64,220,110,0.09)";
      for (let y = 40; y < H; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      // window
      const span = Math.max(120, Math.floor(rdef.tps * 30)), from = Math.max(0, i - span);
      let lo = Infinity, hi = -Infinity;
      for (let j = from; j <= i; j++) { lo = Math.min(lo, px(s, j)); hi = Math.max(hi, px(s, j)); }
      const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
      const X = (j: number) => ((j - from) / span) * (W - 84);
      const Y = (v: number) => 56 + ((hi - v) / (hi - lo)) * (H - 120);
      // SPY benchmark (dim) for the beat-the-market read
      ctx.strokeStyle = "rgba(216,236,217,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let j = from; j <= i; j++) {
        const v = (run.spy[j] / run.spy[0]) * px(s, from);
        const y = Y(Math.max(lo, Math.min(hi, v)));
        j === from ? ctx.moveTo(X(j), y) : ctx.lineTo(X(j), y);
      }
      ctx.stroke();
      // focused tape
      ctx.shadowColor = "rgba(64,220,110,0.9)";
      ctx.shadowBlur = reduced ? 0 : 10;
      ctx.strokeStyle = "#4ec97a";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let j = from; j <= i; j++) (j === from ? ctx.moveTo : ctx.lineTo).call(ctx, X(j), Y(px(s, j)));
      ctx.stroke();
      ctx.shadowBlur = 0;
      const price = px(s);
      const p = run.positions[s];
      if (p) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = p.dir === 1 ? "rgba(106,160,200,0.85)" : "rgba(205,126,109,0.85)";
        ctx.beginPath(); ctx.moveTo(0, Y(p.entry)); ctx.lineTo(W, Y(p.entry)); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = "#0a1a10"; ctx.strokeStyle = "#4ec97a";
      const hx = X(i), hy = Y(price);
      ctx.fillRect(hx + 6, hy - 11, 72, 22); ctx.strokeRect(hx + 6, hy - 11, 72, 22);
      ctx.fillStyle = "#d8ecd9"; ctx.font = "600 12px ui-monospace, monospace";
      ctx.fillText(price.toFixed(2), hx + 12, hy + 4);
      // HUD
      ctx.fillStyle = "rgba(216,236,217,0.65)"; ctx.font = "600 11px ui-monospace, monospace";
      ctx.fillText(`DAY ${rdef.n} · ${rdef.name} · SIM`, 12, 20);
      ctx.fillText(rdef.mission, 12, 36);
      ctx.fillStyle = "#d8ecd9"; ctx.font = "700 19px ui-monospace, monospace";
      ctx.fillText(`$${eq.toFixed(0)}`, 12, H - 16);
      const rp = (eq / run.startEq - 1) * 100;
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.fillStyle = rp >= 0 ? "#7fe0a5" : "#e08a7a";
      ctx.fillText(`${rp >= 0 ? "+" : ""}${rp.toFixed(1)}%`, 120, H - 16);
      const remain = Math.max(0, Math.ceil((run.N - i) / rdef.tps));
      ctx.fillStyle = remain <= 10 ? "#ffd27a" : "rgba(216,236,217,0.7)";
      ctx.font = `700 ${remain <= 10 ? 17 : 13}px ui-monospace, monospace`;
      ctx.fillText(`🔔 ${remain}s`, W - 78, 22);
      // catalyst clue banner (the fairness rule: warned, never ambushed)
      const clue = run.clue;
      if (clue) {
        ctx.fillStyle = "#ffd27a"; ctx.font = "700 13px ui-monospace, monospace";
        const t = `⚠ ${run.stocks[clue.stock].ticker} CATALYST IN ${Math.ceil((clue.at - i) / rdef.tps)}s`;
        ctx.fillText(t, (W - ctx.measureText(t).width) / 2, 54);
      }
      const liveCat = run.catalysts.find((c) => i >= c.at && i < c.at + 4 * rdef.tps);
      if (liveCat) {
        ctx.fillStyle = liveCat.dir === 1 ? "#7fe0a5" : "#e08a7a";
        ctx.font = "700 14px ui-monospace, monospace";
        const t = `${run.stocks[liveCat.stock].ticker} — ${liveCat.label} · SIM`;
        ctx.fillText(t, (W - ctx.measureText(t).width) / 2, 74);
      }
      // pops
      const nowMs = performance.now();
      for (const pop of popsRef.current.slice(-4)) {
        const age = (nowMs - pop.at) / 900;
        if (age > 1) continue;
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = pop.cls > 0 ? "#7fe0a5" : "#e08a7a";
        ctx.font = "700 20px ui-monospace, monospace";
        ctx.fillText(pop.text, (W - ctx.measureText(pop.text).width) / 2, H * 0.4 - (reduced ? 0 : age * 26));
        ctx.globalAlpha = 1;
      }
      // RISK DESK (T6): red edges from 55% down toward the 40% margin call
      const risk = riskRef.current;
      if (risk) {
        const frac = eq / run.startEq;
        const heat = frac < 0.55 ? Math.min(1, (0.55 - frac) / 0.15) : 0;
        risk.style.opacity = String(heat);
        risk.dataset.calling = frac < 0.47 ? "1" : "0";
      }
    };

    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden) { last = now; return; }
      acc += Math.min(200, now - last); last = now;
      const run = runRef.current!;
      const step = 1000 / (run.def.tps * tuneRef.current.tps);
      while (acc >= step) {
        acc -= step;
        const end = run.tick();
        if (end) return finish(end === "margin");
      }
      draw();
      if (run.i % 6 === 0) force((v) => v + 1); // chip strip + floor refresh
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => { focusRef.current = focus; }, [focus]);

  // DAY REPLAY (T6): the whole day's tape with the player's marks, static
  useEffect(() => {
    if (phase !== "complete" && phase !== "gameover") return;
    const run = runRef.current;
    const canvas = replayRef.current;
    const ctx = canvas?.getContext("2d");
    if (!run || !canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#04070a"; ctx.fillRect(0, 0, W, H);
    const N = run.N;
    const X = (t: number) => 4 + (t / (N - 1)) * (W - 8);
    for (let s = 0; s < run.stocks.length; s++) {
      const p = run.stocks[s].prices;
      let lo = Infinity, hi = -Infinity;
      for (const v of p) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const Y = (v: number) => 6 + ((hi - v) / (hi - lo || 1)) * (H - 12);
      const traded = run.log.some((t) => t.s === s);
      ctx.strokeStyle = traded ? "rgba(78,201,122,0.9)" : "rgba(216,236,217,0.18)";
      ctx.lineWidth = traded ? 1.6 : 1;
      ctx.beginPath();
      for (let t = 0; t < N; t += 2) (t === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, X(t), Y(p[t]));
      ctx.stroke();
      for (const m of run.log) {
        if (m.s !== s) continue;
        const x = X(m.tick), y = Y(p[Math.min(m.tick, N - 1)]);
        if (m.kind === "open") {
          ctx.fillStyle = m.dir === 1 ? "#6aa0c8" : "#cd7e6d";
          ctx.beginPath();
          if (m.dir === 1) { ctx.moveTo(x, y - 6); ctx.lineTo(x - 5, y + 3); ctx.lineTo(x + 5, y + 3); }
          else { ctx.moveTo(x, y + 6); ctx.lineTo(x - 5, y - 3); ctx.lineTo(x + 5, y - 3); }
          ctx.fill();
        } else {
          ctx.strokeStyle = (m.gain ?? 0) >= 0 ? "#7fe0a5" : "#e08a7a";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
          ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
          ctx.stroke();
        }
      }
    }
  }, [phase]);

  // ── shells ───────────────────────────────────────────────────────────────
  const run = runRef.current;
  const rows = board === "today" ? boards.today : boards.best;
  const nowMs = typeof performance !== "undefined" ? performance.now() : 0;
  const floor = floorRef.current && floorRef.current.until > nowMs ? floorRef.current.text : null;
  const levelDef = LEVELS[Math.min(week, LEVELS.length) - 1];
  const nextLevel = LEVELS[Math.min(week, LEVELS.length - 1)];
  const xp = player?.xp ?? 0;
  const weekFrac = nextLevel && nextLevel.xp > levelDef.xp
    ? Math.max(0, Math.min(1, (xp - levelDef.xp) / (nextLevel.xp - levelDef.xp)))
    : 1;

  return (
    <div className="pit2">
      <p className="pit-sim">SIMULATED — entertainment, not investment advice. No real orders.</p>

      {stamp ? <div className="pit3-stamp" role="status">{stamp}</div> : null}

      {phase === "live" && run ? (
        <>
          <div className="pit3-strip">
            {run.stocks.map((st, s) => {
              const pos = run.positions[s];
              const chg = (st.prices[Math.min(run.i, st.prices.length - 1)] / st.prices[0] - 1) * 100;
              const clue = run.clue?.stock === s;
              return (
                <button key={st.ticker} type="button"
                  className={`pit3-chip${focus === s ? " on" : ""}${clue ? " clue" : ""}${pos ? (pos.dir === 1 ? " lng" : " sht") : ""}`}
                  onClick={() => setFocus(s)}>
                  <span>{st.ticker}</span>
                  <span className={chg >= 0 ? "up" : "down"}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>
                  {pos ? <span className="tag">{pos.dir === 1 ? "LONG" : "SHORT"}</span> : null}
                </button>
              );
            })}
          </div>
          <canvas ref={canvasRef} className="pit2-canvas" />
          <div ref={riskRef} className="pit3-risk" aria-hidden="true"><span>RISK DESK CALLING…</span></div>
          <p className={`pit3-floor${floor ? " on" : ""}`} aria-live="polite">{floor ? `AUG ▸ ${floor}` : " "}</p>
          <div className="pit2-ctl">
            <button type="button" className="pit2-btn buy" onClick={() => run.act(focus, 1)}>LONG</button>
            {run.def.shorts ? (
              <button type="button" className="pit2-btn sellb" onClick={() => run.act(focus, -1)}>SHORT</button>
            ) : null}
            <button type="button" className="pit2-btn" onClick={() => run.act(focus, 0)}>FLATTEN</button>
          </div>
        </>
      ) : (
        <div className="pit2-shell">
          {phase === "brief" ? (
            <div className="pit2-hero">
              <p className="pit3-eyebrow">DAY {def.n} OF {LADDER.length} · WEEK {week}</p>
              <h2>{def.name}</h2>
              <p className="pit3-mission">MISSION: {def.mission}</p>
              <p className="pit3-weather">{def.weather}</p>
              <p>
                ${careerEq.toFixed(0)} · {def.stocks} stocks · {def.secs}s · {def.shorts ? "LONG + SHORT" : "LONG ONLY"} ·
                {" "}{def.positions} position{def.positions > 1 ? "s" : ""} · margin call at {MARGIN_FRAC * 100}%
              </p>
              <button type="button" className="pit2-btn pit2-run" onClick={openMarket}>
                OPEN THE MARKET
              </button>
            </div>
          ) : phase === "complete" && result ? (
            <div className="pit2-verdict">
              <p className="pit3-eyebrow">DAY {result.n} COMPLETE{result.missionHit ? " · MISSION ✓" : ""}</p>
              <p className="pit2-endpct">
                ${result.startEq.toFixed(0)} → ${result.endEq.toFixed(0)}
              </p>
              <p className={`pit2-endpct ${result.endEq >= result.startEq ? "up" : "down"}`}>
                {result.roundPct.toFixed(1)}% · SPY {result.spyPct >= 0 ? "+" : ""}{result.spyPct.toFixed(1)}%
                {" "}· {result.roundPct > result.spyPct ? "OUTPERFORMED MARKET" : "UNDERPERFORMED"}
              </p>
              <canvas ref={replayRef} className="pit3-replay" aria-label="Day replay with your entries and exits" />
              <p className="pit2-stats">SCORE {result.score.toLocaleString()} — {result.parts.map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v}`).join(" · ")}</p>
              <p className="pit2-stats">+{result.xp} XP · WEEK {week} — {levelDef.name}</p>
              <p className="pit2-stats aug">AUG ▸ {result.missionHit ? "the floor tips its hat." : result.roundPct >= 0 ? "green, but the mission board doesn't care." : "the market thanks you for the liquidity."}</p>
              {result.n < LADDER.length ? (
                <button type="button" className="pit2-btn pit2-run" onClick={() => { setRoundIx(result.n); setPhase("brief"); }}>
                  NEXT DAY →
                </button>
              ) : (
                <>
                  <p className="pit3-eyebrow">WEEK CLEARED</p>
                  <p className="pit2-notreal">
                    {((result.endEq / START_CASH - 1) * 100).toFixed(1)}% on the week — every dollar fictional, every lesson free.
                    {WEEK_PERKS[week + 1] ? ` NEXT: ${WEEK_PERKS[week + 1]}.` : ""}
                  </p>
                  <button type="button" className="pit2-btn pit2-run" onClick={startCareer}>RUN IT BACK</button>
                </>
              )}
            </div>
          ) : phase === "gameover" && result ? (
            <div className="pit2-verdict">
              <h2>💀 MARGIN CALLED</h2>
              <p className="pit2-endpct down">DAY {result.n} · ${result.endEq.toFixed(0)}</p>
              <canvas ref={replayRef} className="pit3-replay" aria-label="Day replay with your entries and exits" />
              <p className="pit2-notreal">The margin desk kept your imaginary furniture. The week ends here.</p>
              <button type="button" className="pit2-btn pit2-run" onClick={startCareer}>RUN IT BACK</button>
            </div>
          ) : (
            <div className="pit2-hero">
              <h2>THE PIT — CAREER</h2>
              <p>Five days clear the week. Missions, catalysts, margin calls — everyone trades the same seed today.</p>
              <div className="pit3-week">
                <p className="pit3-eyebrow">WEEK {week} — {levelDef.name}{WEEK_PERKS[week] ? ` · ${WEEK_PERKS[week]}` : ""}</p>
                <div className="pit3-weekbar"><span style={{ width: `${Math.round(weekFrac * 100)}%` }} /></div>
                <p className="pit2-stats">
                  {xp} XP{nextLevel && nextLevel.xp > levelDef.xp ? ` · week ${week + 1} at ${nextLevel.xp}` : " · top of the ladder"}
                  {player ? ` · best day ${player.bestRound?.toLocaleString() ?? "—"} · week streak ${player.runStreak ?? 0}` : ""}
                </p>
              </div>
              <button type="button" className="pit2-btn pit2-run" onClick={startCareer}>START THE WEEK</button>
            </div>
          )}

          {phase === "lobby" ? (
            <>
              <form className="pit2-name" onSubmit={async (e) => {
                e.preventDefault();
                if (!nameDraft.trim()) return;
                await fetch("/api/pit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "name", name: nameDraft }) });
                refresh();
              }}>
                <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={16}
                  placeholder={player?.name === "PLAYER" || !player ? "pick a name for the boards" : player.name} aria-label="Display name" />
                <button type="submit">SET</button>
              </form>
              <div className="pit2-boards">
                <div className="pit2-boardtabs">
                  <button type="button" className={board === "today" ? "on" : ""} onClick={() => setBoard("today")}>TODAY'S TAPE</button>
                  <button type="button" className={board === "best" ? "on" : ""} onClick={() => setBoard("best")}>ALL-TIME BEST WEEK</button>
                </div>
                <ol>
                  {rows.map((r, idx) => (
                    <li key={r.pid} className={player && r.pid === player.pid ? "me" : ""}>
                      <span>{idx + 1}</span><span className="nm">{r.name}</span>
                      <span className={`sc ${r.pct >= 0 ? "up" : "down"}`}>{r.pct >= 0 ? "+" : ""}{r.pct.toFixed(1)}%</span>
                    </li>
                  ))}
                  {rows.length === 0 ? <li className="empty">nobody on this board yet — be first</li> : null}
                </ol>
              </div>
            </>
          ) : null}
        </div>
      )}

      {tuneOn ? (
        <div className="pit3-tune">
          <p className="pit3-eyebrow">TUNING — OWNER ONLY</p>
          {TUNE_SLIDERS.map((sl) => (
            <label key={sl.key}>
              <span>{sl.label}</span>
              <input type="range" min={sl.min} max={sl.max} step={0.05} value={tune[sl.key]}
                onChange={(e) => applyTune(sl.key, Number(e.target.value))} />
              <b>{tune[sl.key].toFixed(2)}×</b>
            </label>
          ))}
          <button type="button" onClick={() => {
            const text = JSON.stringify(tune);
            try { void navigator.clipboard.writeText(text); } catch { /* shown below anyway */ }
          }}>COPY VALUES</button>
          <code>{JSON.stringify(tune)}</code>
        </div>
      ) : null}
    </div>
  );
}

export default function PitSurface(props: { active: boolean }) {
  return (
    <PitBoundary>
      <PitInner {...props} />
    </PitBoundary>
  );
}
