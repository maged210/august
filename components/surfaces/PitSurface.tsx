"use client";

// THE PIT (GAME-3) — CAREER LOOP. Round brief → live trading → bell → round
// complete → next, up a five-round ladder. SIMULATED ONLY, permanently
// labeled; tapes are synthetic with per-category personality; catalysts are
// archetype headlines with a SIM chip — never factual claims about real
// companies. One canvas, rAF, pause on blur; network = one GET on entry and
// one POST per completed round.

import { useCallback, useEffect, useRef, useState } from "react";
import type { LeaderRow, PitPlayer } from "@/lib/pit";

const START_CASH = 10_000;
const MARGIN_FRAC = 0.4;
const TPS = 12;

// ── universe (GP2): real tickers, category personalities, SIM tapes ──────────
type Cat = { vol: number; drift: number; tickers: string[] };
const CATS: Record<string, Cat> = {
  mega: { vol: 0.004, drift: 0.0004, tickers: ["AAPL", "MSFT", "AMZN", "GOOGL"] },
  tech: { vol: 0.007, drift: 0.0007, tickers: ["NVDA", "META", "PLTR", "CRM"] },
  semi: { vol: 0.009, drift: 0.0006, tickers: ["AMD", "AVGO", "MU", "SMCI"] },
  banks: { vol: 0.004, drift: 0.0002, tickers: ["JPM", "GS", "BAC", "WFC"] },
  energy: { vol: 0.005, drift: 0.0002, tickers: ["XOM", "CVX", "OXY", "SLB"] },
  consumer: { vol: 0.004, drift: 0.0003, tickers: ["WMT", "MCD", "NKE", "SBUX"] },
  health: { vol: 0.005, drift: 0.0003, tickers: ["LLY", "UNH", "PFE", "MRK"] },
  crypto: { vol: 0.013, drift: 0.0008, tickers: ["COIN", "MSTR", "HOOD", "RIOT"] },
  highvol: { vol: 0.016, drift: 0.001, tickers: ["TSLA", "GME", "AFRM", "UPST"] },
};

type RoundDef = {
  n: number; name: string; mission: string; missionKey: "beat" | "momentum" | "short" | "lowrisk" | "survivor";
  secs: number; stocks: number; cats: string[]; shorts: boolean; positions: number;
  catalysts: number; volMult: number; regime: number; // regime drift bias
};
const LADDER: RoundDef[] = [
  { n: 1, name: "OPENING BELL", mission: "BEAT THE MARKET — finish above the SPY line", missionKey: "beat", secs: 90, stocks: 4, cats: ["mega", "consumer", "banks", "tech"], shorts: false, positions: 1, catalysts: 0, volMult: 0.8, regime: 0.0003 },
  { n: 2, name: "MOMENTUM", mission: "MOMENTUM HUNTER — take profit on the day's fastest riser", missionKey: "momentum", secs: 80, stocks: 4, cats: ["tech", "semi", "highvol", "mega"], shorts: true, positions: 1, catalysts: 1, volMult: 1.15, regime: 0.0002 },
  { n: 3, name: "EARNINGS", mission: "SHORT SELLER — book a profitable short", missionKey: "short", secs: 75, stocks: 4, cats: ["tech", "semi", "health", "consumer"], shorts: true, positions: 2, catalysts: 2, volMult: 1.1, regime: 0 },
  { n: 4, name: "THE CRASH", mission: "SURVIVOR — never breach 20% drawdown", missionKey: "survivor", secs: 45, stocks: 4, cats: ["banks", "energy", "mega", "highvol"], shorts: true, positions: 2, catalysts: 2, volMult: 1.5, regime: -0.0016 },
  { n: 5, name: "BOSS — TRIPLE WITCHING", mission: "LOW RISK — finish green with max drawdown under 5%", missionKey: "lowrisk", secs: 120, stocks: 5, cats: ["highvol", "crypto", "semi", "tech", "mega"], shorts: true, positions: 2, catalysts: 3, volMult: 1.6, regime: -0.0002 },
];

const CATALYST_COPY: Array<{ label: string; dir: 1 | -1 }> = [
  { label: "EARNINGS BEAT", dir: 1 },
  { label: "ANALYST DOWNGRADE", dir: -1 },
  { label: "SQUEEZE — ×2 WINDOW", dir: 1 },
  { label: "GUIDANCE CUT", dir: -1 },
  { label: "SECTOR UPGRADE", dir: 1 },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Catalyst = { stock: number; at: number; clueAt: number; label: string; dir: 1 | -1; hit: boolean };
type Stock = { ticker: string; prices: number[] };

function makeRound(def: RoundDef, runSeed: number): { stocks: Stock[]; spy: number[]; catalysts: Catalyst[] } {
  const rng = mulberry32(runSeed * 7919 + def.n * 104729);
  const N = def.secs * TPS;
  const picks: Array<{ t: string; c: Cat }> = [];
  const used = new Set<string>();
  for (let s = 0; s < def.stocks; s++) {
    const cat = CATS[def.cats[s % def.cats.length]];
    let t = cat.tickers[Math.floor(rng() * cat.tickers.length)];
    while (used.has(t)) t = cat.tickers[Math.floor(rng() * cat.tickers.length)];
    used.add(t);
    picks.push({ t, c: cat });
  }
  const catalysts: Catalyst[] = [];
  for (let k = 0; k < def.catalysts; k++) {
    const copy = CATALYST_COPY[Math.floor(rng() * CATALYST_COPY.length)];
    const at = Math.floor((0.25 + rng() * 0.55) * N);
    catalysts.push({ stock: Math.floor(rng() * def.stocks), at, clueAt: at - 5 * TPS, label: copy.label, dir: copy.dir, hit: false });
  }
  const gen = (c: Cat, idx: number): number[] => {
    let p = 60 + rng() * 240;
    const out: number[] = [];
    for (let i = 0; i < N; i++) {
      let drift = def.regime + (rng() - 0.5) * c.drift * 2;
      const cat = catalysts.find((x) => x.stock === idx && i >= x.at && i < x.at + 4 * TPS);
      if (cat) drift += cat.dir * (0.004 + rng() * 0.004); // the move the clue warned about
      const corr = def.regime < -0.001 ? def.regime * 2 : 0; // crash correlation
      p = Math.max(4, p * (1 + drift + corr + (rng() - 0.5) * c.vol * def.volMult));
      out.push(p);
    }
    return out;
  };
  const stocks = picks.map((pk, i) => ({ ticker: pk.t, prices: gen(pk.c, i) }));
  // the SPY sim line — the benchmark for BEAT THE MARKET
  let sp = 100;
  const spy = Array.from({ length: N }, () => (sp = sp * (1 + def.regime * 0.6 + (rng() - 0.5) * 0.002)));
  return { stocks, spy, catalysts };
}

// ── component ────────────────────────────────────────────────────────────────
type Phase = "lobby" | "brief" | "live" | "complete" | "gameover";
type RoundResult = {
  def: RoundDef; startEq: number; endEq: number; spyPct: number; missionHit: boolean;
  score: number; parts: Array<[string, number]>; xp: number; trades: number; wins: number;
  goodEntries: number; maxDD: number; margin: boolean;
};

export default function PitSurface({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [player, setPlayer] = useState<PitPlayer | null>(null);
  const [boards, setBoards] = useState<{ today: LeaderRow[]; best: LeaderRow[] }>({ today: [], best: [] });
  const [board, setBoard] = useState<"today" | "best">("today");
  const [nameDraft, setNameDraft] = useState("");
  const [roundIx, setRoundIx] = useState(0);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [careerEq, setCareerEq] = useState(START_CASH);
  const runSeed = useRef(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [focus, setFocus] = useState(0);
  const focusRef = useRef(0);
  const [, force] = useState(0); // chip strip re-render tick
  const gameRef = useRef<{
    act: (s: number, dir: 1 | -1 | 0) => void;
    stocks: Stock[]; positions: Array<{ dir: 1 | -1; entry: number; qty: number } | null>;
    i: number; clue: Catalyst | null;
  } | null>(null);
  const loaded = useRef(false);

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

  const def = LADDER[Math.min(roundIx, LADDER.length - 1)];

  const startCareer = () => {
    runSeed.current = (Date.now() % 100000) + 1;
    setCareerEq(START_CASH);
    setRoundIx(0);
    setPhase("brief");
  };

  // ── the live round ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "live") return;
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

    const { stocks, spy, catalysts } = makeRound(def, runSeed.current);
    const N = def.secs * TPS;
    const startEq = careerEq;
    let cash = startEq;
    const positions: Array<{ dir: 1 | -1; entry: number; qty: number } | null> = stocks.map(() => null);
    let i = 0;
    let peak = startEq;
    let maxDD = 0;
    let trades = 0, wins = 0, goodEntries = 0, shortWin = false;
    let bestRiserWin = false;
    const pops: Array<{ text: string; cls: number; at: number }> = [];
    let alive = true;
    let raf = 0, last = performance.now(), acc = 0;

    const px = (s: number, k = i) => stocks[s].prices[Math.max(0, Math.min(N - 1, k))];
    const equity = () => cash + positions.reduce((sum, p, s) => (p ? sum + p.qty * (p.dir === 1 ? px(s) : 2 * p.entry - px(s)) : sum), 0);
    const openCount = () => positions.filter(Boolean).length;

    const act = (s: number, dir: 1 | -1 | 0) => {
      const p = positions[s];
      const price = px(s);
      if (dir === 0 || (p && p.dir !== dir)) {
        if (!p) return;
        const value = p.qty * (p.dir === 1 ? price : 2 * p.entry - price);
        const gain = (p.dir === 1 ? price / p.entry - 1 : 1 - price / p.entry) * 100;
        cash += value;
        positions[s] = null;
        trades += 1;
        if (gain > 0) {
          wins += 1;
          if (p.dir === -1) shortWin = true;
          const riser = stocks.map((st, k) => st.prices[i] / st.prices[0]).indexOf(Math.max(...stocks.map((st) => st.prices[i] / st.prices[0])));
          if (s === riser) bestRiserWin = true;
        }
        pops.push({ text: `${gain >= 0 ? "+" : ""}${gain.toFixed(1)}% ${stocks[s].ticker}`, cls: gain >= 0 ? 1 : -1, at: performance.now() });
        if (dir !== 0) act(s, dir); // flip: flatten then open the other way
        return;
      }
      if (p || openCount() >= def.positions || (dir === -1 && !def.shorts)) return;
      const stake = cash / (def.positions - openCount());
      positions[s] = { dir, entry: price, qty: stake / price };
      cash -= stake;
      // timing quality: entry near the rolling low (long) / high (short)
      let lo = Infinity, hi = -Infinity;
      for (let j = Math.max(0, i - 48); j <= i; j++) { lo = Math.min(lo, px(s, j)); hi = Math.max(hi, px(s, j)); }
      const good = dir === 1 ? price <= lo * 1.02 : price >= hi * 0.98;
      if (good) { goodEntries += 1; pops.push({ text: "GOOD ENTRY", cls: 1, at: performance.now() }); }
      const cat = catalysts.find((c) => c.stock === s && i >= c.at && i < c.at + 6 * TPS);
      if (cat && ((cat.dir === 1 && dir === 1) || (cat.dir === -1 && dir === -1))) {
        cat.hit = true;
        pops.push({ text: "CATALYST CAPTURED", cls: 1, at: performance.now() });
      }
    };
    gameRef.current = { act, stocks, positions, i, clue: null };

    const finish = (margin: boolean) => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
      positions.forEach((p, s) => p && act(s, 0));
      const endEq = equity();
      const roundPct = (endEq / startEq - 1) * 100;
      const spyPct = (spy[Math.min(i, N - 1)] / spy[0] - 1) * 100;
      const missionHit = margin ? false :
        def.missionKey === "beat" ? roundPct > spyPct :
        def.missionKey === "momentum" ? bestRiserWin :
        def.missionKey === "short" ? shortWin :
        def.missionKey === "lowrisk" ? roundPct >= 0 && maxDD < 5 :
        maxDD < 20;
      const parts: Array<[string, number]> = [
        ["P&L", Math.round(roundPct * 120)],
        ["MISSION", missionHit ? 2000 : 0],
        ["TIMING", goodEntries * 350],
        ["ACCURACY", trades ? Math.round((wins / trades) * 1200) : 0],
        ["DRAWDOWN", -Math.round(maxDD * 60)],
      ];
      const score = Math.max(0, parts.reduce((a, [, v]) => a + v, 0));
      const xp = Math.max(50, Math.round(score / 10) + (missionHit ? 120 : 0));
      const res: RoundResult = { def, startEq, endEq, spyPct, missionHit, score, parts, xp, trades, wins, goodEntries, maxDD, margin };
      setResult(res);
      setCareerEq(endEq);
      setPhase(margin ? "gameover" : "complete");
      const finalFlag = margin ? "margin" : def.n === 5 ? true : false;
      fetch("/api/pit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "round", score, xp, final: finalFlag,
          careerPct: Math.round((endEq / START_CASH - 1) * 10000) / 100,
          stats: { trades, wins, bestTrade: 0, perfectDips: goodEntries },
        }),
      }).then(() => refresh()).catch(() => {});
    };

    const draw = () => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const s = focusRef.current;
      const eq = equity();
      ctx.fillStyle = "#04070a";
      ctx.fillRect(0, 0, W, H);
      // subtle grid
      ctx.strokeStyle = "rgba(64,220,110,0.09)";
      for (let y = 40; y < H; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      // window
      const span = 240, from = Math.max(0, i - span);
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
        const v = (spy[j] / spy[0]) * px(s, from);
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
      const p = positions[s];
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
      ctx.fillText(`R${def.n} · ${def.name} · SIM`, 12, 20);
      ctx.fillText(def.mission, 12, 36);
      ctx.fillStyle = "#d8ecd9"; ctx.font = "700 19px ui-monospace, monospace";
      ctx.fillText(`$${eq.toFixed(0)}`, 12, H - 16);
      const rp = (eq / startEq - 1) * 100;
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.fillStyle = rp >= 0 ? "#7fe0a5" : "#e08a7a";
      ctx.fillText(`${rp >= 0 ? "+" : ""}${rp.toFixed(1)}%`, 120, H - 16);
      const remain = Math.max(0, Math.ceil((N - i) / TPS));
      ctx.fillStyle = remain <= 10 ? "#ffd27a" : "rgba(216,236,217,0.7)";
      ctx.font = `700 ${remain <= 10 ? 17 : 13}px ui-monospace, monospace`;
      ctx.fillText(`🔔 ${remain}s`, W - 78, 22);
      // catalyst clue banner (the fairness rule: warned, never ambushed)
      const clue = catalysts.find((c) => i >= c.clueAt && i < c.at);
      gameRef.current!.clue = clue ?? null;
      if (clue) {
        ctx.fillStyle = "#ffd27a"; ctx.font = "700 13px ui-monospace, monospace";
        const t = `⚠ ${stocks[clue.stock].ticker} CATALYST IN ${Math.ceil((clue.at - i) / TPS)}s`;
        ctx.fillText(t, (W - ctx.measureText(t).width) / 2, 54);
      }
      const live = catalysts.find((c) => i >= c.at && i < c.at + 4 * TPS);
      if (live) {
        ctx.fillStyle = live.dir === 1 ? "#7fe0a5" : "#e08a7a";
        ctx.font = "700 14px ui-monospace, monospace";
        const t = `${stocks[live.stock].ticker} — ${live.label} · SIM`;
        ctx.fillText(t, (W - ctx.measureText(t).width) / 2, 74);
      }
      // pops
      const nowMs = performance.now();
      for (const pop of pops.slice(-4)) {
        const age = (nowMs - pop.at) / 900;
        if (age > 1) continue;
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = pop.cls > 0 ? "#7fe0a5" : "#e08a7a";
        ctx.font = "700 20px ui-monospace, monospace";
        ctx.fillText(pop.text, (W - ctx.measureText(pop.text).width) / 2, H * 0.4 - (reduced ? 0 : age * 26));
        ctx.globalAlpha = 1;
      }
    };

    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden) { last = now; return; }
      acc += Math.min(200, now - last); last = now;
      const step = 1000 / TPS;
      while (acc >= step) {
        acc -= step;
        i += 1;
        gameRef.current!.i = i;
        const eq = equity();
        peak = Math.max(peak, eq);
        maxDD = Math.max(maxDD, (1 - eq / peak) * 100);
        if (eq < startEq * MARGIN_FRAC) return finish(true);
        if (i >= N - 1) return finish(false);
      }
      draw();
      if (i % 6 === 0) force((v) => v + 1); // chip strip refresh
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => { focusRef.current = focus; }, [focus]);

  // ── shells ───────────────────────────────────────────────────────────────
  const g = gameRef.current;
  const rows = board === "today" ? boards.today : boards.best;
  return (
    <div className="pit2">
      <p className="pit-sim">SIMULATED — entertainment, not investment advice. No real orders.</p>

      {phase === "live" && g ? (
        <>
          <div className="pit3-strip">
            {g.stocks.map((st, s) => {
              const pos = g.positions[s];
              const chg = (st.prices[Math.min(g.i, st.prices.length - 1)] / st.prices[0] - 1) * 100;
              const clue = g.clue?.stock === s;
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
          <div className="pit2-ctl">
            <button type="button" className="pit2-btn buy" onClick={() => g.act(focus, 1)}>LONG</button>
            {def.shorts ? (
              <button type="button" className="pit2-btn sellb" onClick={() => g.act(focus, -1)}>SHORT</button>
            ) : null}
            <button type="button" className="pit2-btn" onClick={() => g.act(focus, 0)}>FLATTEN</button>
          </div>
        </>
      ) : (
        <div className="pit2-shell">
          {phase === "brief" ? (
            <div className="pit2-hero">
              <p className="pit3-eyebrow">ROUND {def.n} OF {LADDER.length}</p>
              <h2>{def.name}</h2>
              <p className="pit3-mission">MISSION: {def.mission}</p>
              <p>
                ${careerEq.toFixed(0)} · {def.stocks} stocks · {def.secs}s · {def.shorts ? "LONG + SHORT" : "LONG ONLY"} ·
                {" "}{def.positions} position{def.positions > 1 ? "s" : ""} · margin call at {MARGIN_FRAC * 100}%
              </p>
              <button type="button" className="pit2-btn pit2-run" onClick={() => { setFocus(0); setPhase("live"); }}>
                OPEN THE MARKET
              </button>
            </div>
          ) : phase === "complete" && result ? (
            <div className="pit2-verdict">
              <p className="pit3-eyebrow">ROUND {result.def.n} COMPLETE{result.missionHit ? " · MISSION ✓" : ""}</p>
              <p className="pit2-endpct">
                ${result.startEq.toFixed(0)} → ${result.endEq.toFixed(0)}
              </p>
              <p className={`pit2-endpct ${result.endEq >= result.startEq ? "up" : "down"}`}>
                {((result.endEq / result.startEq - 1) * 100).toFixed(1)}% · SPY {result.spyPct >= 0 ? "+" : ""}{result.spyPct.toFixed(1)}%
                {" "}· {((result.endEq / result.startEq - 1) * 100) > result.spyPct ? "OUTPERFORMED MARKET" : "UNDERPERFORMED"}
              </p>
              <p className="pit2-stats">SCORE {result.score.toLocaleString()} — {result.parts.map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v}`).join(" · ")}</p>
              <p className="pit2-stats">+{result.xp} XP · LEVEL {player?.level ?? 1}{player ? ` · ${player.xp} XP total` : ""}</p>
              {result.def.n < LADDER.length ? (
                <button type="button" className="pit2-btn pit2-run" onClick={() => { setRoundIx(result.def.n); setPhase("brief"); }}>
                  NEXT ROUND →
                </button>
              ) : (
                <>
                  <p className="pit2-notreal">Career complete: {((result.endEq / START_CASH - 1) * 100).toFixed(1)}% — every dollar fictional, every lesson free.</p>
                  <button type="button" className="pit2-btn pit2-run" onClick={startCareer}>RUN IT BACK</button>
                </>
              )}
            </div>
          ) : phase === "gameover" && result ? (
            <div className="pit2-verdict">
              <h2>💀 MARGIN CALLED</h2>
              <p className="pit2-endpct down">R{result.def.n} · ${result.endEq.toFixed(0)}</p>
              <p className="pit2-notreal">The margin desk kept your imaginary furniture. Run ends here.</p>
              <button type="button" className="pit2-btn pit2-run" onClick={startCareer}>RUN IT BACK</button>
            </div>
          ) : (
            <div className="pit2-hero">
              <h2>THE PIT — CAREER</h2>
              <p>Five rounds. Missions, catalysts, margin calls. Beat the ladder — everyone climbs the same seed today.</p>
              {player ? <p className="pit2-stats">LEVEL {player.level} · {player.xp} XP · best round {player.bestRound?.toLocaleString() ?? "—"} · run streak {player.runStreak ?? 0}</p> : null}
              <button type="button" className="pit2-btn pit2-run" onClick={startCareer}>START CAREER</button>
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
                  <button type="button" className={board === "best" ? "on" : ""} onClick={() => setBoard("best")}>ALL-TIME BEST RUN</button>
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
    </div>
  );
}
