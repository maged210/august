"use client";

// THE PIT (GAME-4) — event-driven trading on the calendar. DAY brief →
// position → market moves → EVENT → reaction → risk → exit → scorecard →
// next day; five days clear the WEEK. SIMULATED ONLY, permanently labeled.
// The game itself is lib/pit-engine (data-driven systems); this component
// draws it and carries the juice: event cards, reaction windows, the risk
// meter, AUGUST's floor commentary, stamps, the day replay.
//
// MOUNT LAW (GC-G1): the RoundRun is created SYNCHRONOUSLY in the OPEN THE
// MARKET click, before the phase flips. If a scene still fails to mount, the
// effect throws and PitBoundary renders a styled PIT ERROR.

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LEVELS, type LeaderRow, type PitPlayer } from "@/lib/pit";
import {
  DEFAULT_TUNE, LADDER, MARGIN_FRAC, MISSIONS, START_CASH, WEEK_PERKS,
  createRoundRun, makeRound, retuneRun, weekAdjust,
  type PitEvent, type PitTune, type RoundRun, type RoundSummary,
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

// ── AUGUST ON THE FLOOR: dry desk voice, one line per moment ────────────────
const FLOOR_LINES: Partial<Record<PitEvent["type"], string[]>> = {
  goodEntry: ["clean fill. the desk noticed.", "bought it like you meant it."],
  catalyst: ["read the tape before it printed."],
  panicSell: ["sold the low. bold.", "that was the bottom, by the way."],
  stopOut: ["the risk desk covers its eyes."],
  diamondHands: ["held through the pain. paid for it. respect."],
  paperHands: ["it ripped right after. we don't talk about it."],
};
const FLOOR_COOLDOWN_MS = 12_000;

const VOL_LABEL = (v: number) => (v < 0.004 ? "LOW" : v < 0.0055 ? "MED" : v < 0.0065 ? "HIGH" : "EXTREME");

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
const SIZES = [25, 50, 75, 100] as const;

function PitInner({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [player, setPlayer] = useState<PitPlayer | null>(null);
  const [boards, setBoards] = useState<{ today: LeaderRow[]; best: LeaderRow[] }>({ today: [], best: [] });
  const [board, setBoard] = useState<"today" | "best">("today");
  const [nameDraft, setNameDraft] = useState("");
  const [roundIx, setRoundIx] = useState(0);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [careerEq, setCareerEq] = useState(START_CASH);
  const [careerStreak, setCareerStreak] = useState(0);
  const [bootErr, setBootErr] = useState<Error | null>(null);
  const [stamp, setStamp] = useState<string | null>(null);
  const [sizePct, setSizePct] = useState<(typeof SIZES)[number]>(100);
  const [tuneOn, setTuneOn] = useState(false);
  const [tune, setTune] = useState<PitTune>({ ...DEFAULT_TUNE });
  const tuneRef = useRef<PitTune>(tune);
  const runSeed = useRef(1);
  const weekStartRef = useRef(1);
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
  const [, force] = useState(0); // live HUD re-render tick
  const loaded = useRef(false);

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

  // owner tuning overlay: ?tune=1, never on public paths
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
  const mission = MISSIONS[def.missionKey].label;

  // the briefing board — same seed as the run, so the tickers are the truth
  const briefTickers = useMemo(() => {
    if (phase !== "brief") return [];
    try { return makeRound(def, runSeed.current, tuneRef.current).stocks.map((s) => s.ticker); }
    catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roundIx, week]);

  const onEvent = useCallback((ev: PitEvent) => {
    if (ev.type === "pop") {
      popsRef.current.push({ text: ev.text, cls: ev.cls, at: performance.now() });
      return;
    }
    if (ev.type === "news") return; // the card renders from run.activeEvents()
    if (ev.type === "streak") {
      popsRef.current.push({ text: `${ev.count}-TRADE STREAK +${ev.xp} XP`, cls: 1, at: performance.now() });
      return;
    }
    if (ev.type === "reaction") {
      floorRef.current = {
        text: ev.correct ? "read it right." : "the tape disagreed.",
        until: performance.now() + 3500,
      };
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
    weekStartRef.current = week;
    setCareerEq(START_CASH);
    setCareerStreak(0);
    setRoundIx(0);
    setPhase("brief");
  };

  // OPEN THE MARKET — the game exists BEFORE the live scene renders.
  const openMarket = () => {
    try {
      popsRef.current = [];
      floorRef.current = null;
      runRef.current = createRoundRun(def, runSeed.current, careerEq, onEvent, {
        tune: tuneRef.current, initialStreak: careerStreak,
      });
      setFocus(0);
      setSizePct(100);
      setPhase("live");
    } catch (e) {
      setBootErr(e instanceof Error ? e : new Error(String(e)));
    }
  };

  // owner sliders re-cut the RUNNING tape (debounced); tick rate is clock-side
  const retuneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyTune = (key: TuneKey, value: number) => {
    setTune((t) => ({ ...t, [key]: value }));
    if (key === "tps") return;
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
    let lastEq = boot.equity(), eqFlash = 0; // -1 red / +1 green, decays

    const finish = (margin: boolean) => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
      const run = runRef.current!;
      const sum = run.finish(margin);
      const res: RoundResult = { ...sum, n: run.def.n };
      setResult(res);
      setCareerEq(sum.endEq);
      setCareerStreak(sum.streak);
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
      if (Math.abs(eq - lastEq) > 0.5) { eqFlash = eq > lastEq ? 1 : -1; lastEq = eq; }
      eqFlash *= 0.94;
      const px = run.px;
      ctx.fillStyle = "#04070a";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(64,220,110,0.09)";
      for (let y = 40; y < H; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      const span = Math.max(120, Math.floor(rdef.tps * 30)), from = Math.max(0, i - span);
      let lo = Infinity, hi = -Infinity;
      for (let j = from; j <= i; j++) { lo = Math.min(lo, px(s, j)); hi = Math.max(hi, px(s, j)); }
      const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
      const X = (j: number) => ((j - from) / span) * (W - 84);
      const Y = (v: number) => 56 + ((hi - v) / (hi - lo)) * (H - 120);
      ctx.strokeStyle = "rgba(216,236,217,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let j = from; j <= i; j++) {
        const v = (run.spy[j] / run.spy[0]) * px(s, from);
        const y = Y(Math.max(lo, Math.min(hi, v)));
        j === from ? ctx.moveTo(X(j), y) : ctx.lineTo(X(j), y);
      }
      ctx.stroke();
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
      ctx.fillText(MISSIONS[rdef.missionKey].label, 12, 36);
      // living P&L — flashes with the tape
      ctx.fillStyle = eqFlash > 0.08 ? "#7fe0a5" : eqFlash < -0.08 ? "#e08a7a" : "#d8ecd9";
      ctx.font = "700 21px ui-monospace, monospace";
      ctx.fillText(`$${eq.toFixed(0)}`, 12, H - 16);
      const rp = (eq / run.startEq - 1) * 100;
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.fillStyle = rp >= 0 ? "#7fe0a5" : "#e08a7a";
      ctx.fillText(`${rp >= 0 ? "+" : ""}${rp.toFixed(1)}%`, 128, H - 16);
      const remain = Math.max(0, Math.ceil((run.N - i) / rdef.tps));
      ctx.fillStyle = remain <= 10 ? "#ffd27a" : "rgba(216,236,217,0.7)";
      ctx.font = `700 ${remain <= 10 ? 17 : 13}px ui-monospace, monospace`;
      ctx.fillText(`🔔 ${remain}s`, W - 78, 22);
      const clue = run.clue;
      if (clue) {
        ctx.fillStyle = "#ffd27a"; ctx.font = "700 13px ui-monospace, monospace";
        const t = `⚠ ${run.stocks[clue.stocks[0]].ticker} CATALYST IN ${Math.ceil((clue.at - i) / rdef.tps)}s`;
        ctx.fillText(t, (W - ctx.measureText(t).width) / 2, 54);
      }
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
      // RISK DESK: red edges from 55% down toward the 40% margin call
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
      if (run.i % 4 === 0) force((v) => v + 1); // strip/cards/meter refresh
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => { focusRef.current = focus; }, [focus]);

  // DAY REPLAY: the whole day's tape + the player's marks + event ticks
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
    // event moments — amber ticks across the strip
    for (const ev of run.events) {
      ctx.strokeStyle = ev.misleading ? "rgba(224,138,122,0.55)" : "rgba(255,210,122,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(ev.at), 2); ctx.lineTo(X(ev.at), H - 2); ctx.stroke();
    }
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
  const pending = phase === "live" && run ? run.pendingReaction() : null;
  const activeCards = phase === "live" && run ? run.activeEvents().slice(-2) : [];
  const riskNow = phase === "live" && run ? run.risk() : null;
  const focusPos = phase === "live" && run ? run.positions[Math.min(focus, run.positions.length - 1)] : null;
  const unlocked = result && week > weekStartRef.current ? WEEK_PERKS[week] : null;

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
              const clue = run.clue?.stocks.includes(s) ?? false;
              return (
                <button key={st.ticker} type="button"
                  className={`pit3-chip${focus === s ? " on" : ""}${clue ? " clue" : ""}${pos ? (pos.dir === 1 ? " lng" : " sht") : ""}`}
                  onClick={() => setFocus(s)}>
                  <span>{st.ticker}</span>
                  <span className={chg >= 0.15 ? "up" : chg <= -0.15 ? "down" : ""}>
                    {chg >= 0 ? "+" : ""}{chg.toFixed(1)}% {chg >= 0.15 ? "↑" : chg <= -0.15 ? "↓" : "→"}
                  </span>
                  {pos ? <span className="tag">{pos.dir === 1 ? "LONG" : "SHORT"}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="pit4-events">
          {activeCards.map((ev) => {
            const s0 = ev.stocks[0];
            const move = (run.px(s0) / run.px(s0, ev.at) - 1) * 100;
            const oppLeft = ev.kind === "opportunity" ? Math.max(0, Math.ceil((ev.at + ev.windowTicks - run.i) / run.def.tps)) : 0;
            const isMine = pending?.eventId === ev.id;
            return (
              <div key={ev.id} className={`pit4-event${ev.kind === "opportunity" ? " opp" : ""}`} role="status">
                <p className="pit4-eyebrow">{ev.eyebrow}{ev.kind === "opportunity" ? ` · WINDOW ${oppLeft}s` : ""}</p>
                <p className="pit4-head">
                  <b>{ev.stocks.map((s) => run.stocks[s].ticker).join(" · ")}</b>
                  {" "}{ev.label} · <span className="simchip">SIM</span>
                </p>
                <p className={`pit4-print ${move >= 0 ? "up" : "down"}`}>
                  {run.stocks[s0].ticker} {move >= 0 ? "+" : ""}{move.toFixed(1)}%
                </p>
                {ev.kind === "opportunity" ? (
                  <button type="button" className="pit4-act trade" onClick={() => setFocus(s0)}>VIEW →</button>
                ) : isMine ? (
                  <div className="pit4-react">
                    <button type="button" className="pit4-act" onClick={() => run.react("hold")}>HOLD</button>
                    <button type="button" className="pit4-act exit" onClick={() => run.react("exit")}>EXIT</button>
                    {def.sizing ? <button type="button" className="pit4-act add" onClick={() => run.react("add")}>ADD</button> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          </div>

          <canvas ref={canvasRef} className="pit2-canvas" />
          <div ref={riskRef} className="pit3-risk" aria-hidden="true"><span>RISK DESK CALLING…</span></div>

          <div className="pit4-meta">
            {focusPos ? (
              <span className="pit4-pos">
                {focusPos.dir === 1 ? "LONG" : "SHORT"} {run.stocks[focus]?.ticker}
                {" "}· {Math.round(focusPos.sizeFrac * 100)}%
                {" "}· in {focusPos.entry.toFixed(2)}
                {" "}· now {run.px(focus).toFixed(2)}
                {" "}· <b className={run.px(focus) * focusPos.dir >= focusPos.entry * focusPos.dir ? "up" : "down"}>
                  {(() => { const d = focusPos.qty * (focusPos.dir === 1 ? run.px(focus) - focusPos.entry : focusPos.entry - run.px(focus)); return `${d >= 0 ? "+" : "−"}$${Math.abs(d).toFixed(0)}`; })()}
                </b>
              </span>
            ) : <span className="pit4-pos dim">no position — pick a lane</span>}
            {riskNow ? (
              <span className={`pit4-risk r-${riskNow.level.toLowerCase()}`}>
                RISK {"█".repeat(Math.max(1, Math.round(riskNow.frac * 10)))}{"░".repeat(10 - Math.max(1, Math.round(riskNow.frac * 10)))} {riskNow.level}
              </span>
            ) : null}
          </div>

          <p className={`pit3-floor${floor ? " on" : ""}`} aria-live="polite">{floor ? `AUG ▸ ${floor}` : " "}</p>

          <div className="pit2-ctl">
            {def.sizing ? (
              <div className="pit4-size" role="group" aria-label="Position size">
                {SIZES.map((z) => (
                  <button key={z} type="button" className={sizePct === z ? "on" : ""} onClick={() => setSizePct(z)}>{z}</button>
                ))}
              </div>
            ) : null}
            <button type="button" className="pit2-btn buy" onClick={() => run.act(focus, 1, sizePct / 100)}>LONG</button>
            {run.def.shorts ? (
              <button type="button" className="pit2-btn sellb" onClick={() => run.act(focus, -1, sizePct / 100)}>SHORT</button>
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
              <p className="pit4-board">{briefTickers.join(" · ")}</p>
              <div className="pit4-brief">
                <span>VOLATILITY<b>{VOL_LABEL(def.vol)}</b></span>
                <span>BIAS<b>{def.bias}</b></span>
                <span>CATALYSTS<b>{def.news}{def.opps ? ` +${def.opps} WINDOW` : ""}</b></span>
                <span>TIME<b>{def.secs}s</b></span>
              </div>
              <p className="pit3-mission">MISSION: {mission}</p>
              <p className="pit3-weather">{def.weather}</p>
              <p>
                ${careerEq.toFixed(0)} · {def.stocks} stocks · {def.shorts ? "LONG + SHORT" : "LONG ONLY"} ·
                {" "}{def.positions} position{def.positions > 1 ? "s" : ""}{def.sizing ? " · sized orders" : ""} · margin call at {MARGIN_FRAC * 100}%
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
              <canvas ref={replayRef} className="pit3-replay" aria-label="Day replay: tape, your trades, event moments" />
              <div className="pit4-card">
                <span>TRADES<b>{result.trades}</b></span>
                <span>WIN RATE<b>{result.trades ? `${result.winRate}%` : "—"}</b></span>
                <span>MAX DD<b>-{result.maxDD.toFixed(1)}%</b></span>
                <span>RISK<b>{result.riskGrade}</b></span>
                <span>REACTION<b>{result.reactionGrade}</b></span>
              </div>
              <p className="pit2-stats">SCORE {result.score.toLocaleString()} — {result.parts.map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v}`).join(" · ")}</p>
              {result.bonus.length ? (
                <p className="pit2-stats bonus">{result.bonus.map(([k, v]) => `${k} +${v} XP`).join(" · ")}</p>
              ) : null}
              <p className="pit2-stats">+{result.xp} XP · WEEK {week} — {levelDef.name}</p>
              {unlocked ? <p className="pit4-unlock">UNLOCKED · WEEK {week}: {unlocked}</p> : null}
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
              <canvas ref={replayRef} className="pit3-replay" aria-label="Day replay: tape, your trades, event moments" />
              <p className="pit2-notreal">The margin desk kept your imaginary furniture. The week ends here.</p>
              <button type="button" className="pit2-btn pit2-run" onClick={startCareer}>RUN IT BACK</button>
            </div>
          ) : (
            <div className="pit2-hero">
              <h2>THE PIT — CAREER</h2>
              <p>Five days clear the week. Headlines move the tape — some of them lie. Everyone trades the same seed today.</p>
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
