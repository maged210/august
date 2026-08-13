"use client";

// THE PIT (GAME-3) — CAREER LOOP. Round brief → live trading → bell → round
// complete → next, up a five-round ladder. SIMULATED ONLY, permanently
// labeled. The round itself (tapes, catalysts, positions, score) is the pure
// engine in lib/pit-engine — this component only draws it and talks to the
// boards. One canvas, rAF, pause on blur; network = one GET on entry and one
// POST per completed round.
//
// MOUNT LAW (GC-G1 fix): the RoundRun is created SYNCHRONOUSLY in the OPEN
// THE MARKET click, before the phase flips — the live scene can never render
// against a missing game. If the scene still fails to mount, the effect
// throws and the PitBoundary shows a styled PIT ERROR instead of a silent
// dead button.

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { LeaderRow, PitPlayer } from "@/lib/pit";
import {
  LADDER, MARGIN_FRAC, START_CASH, TPS,
  createRoundRun, type RoundRun, type RoundSummary,
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

// ── component ────────────────────────────────────────────────────────────────
type Phase = "lobby" | "brief" | "live" | "complete" | "gameover";
type RoundResult = RoundSummary & { n: number };

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
  const runSeed = useRef(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runRef = useRef<RoundRun | null>(null);
  const popsRef = useRef<Array<{ text: string; cls: number; at: number }>>([]);
  const [focus, setFocus] = useState(0);
  const focusRef = useRef(0);
  const [, force] = useState(0); // chip strip re-render tick
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

  const def = LADDER[Math.min(roundIx, LADDER.length - 1)];

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
      runRef.current = createRoundRun(def, runSeed.current, careerEq, (pop) =>
        popsRef.current.push({ ...pop, at: performance.now() }),
      );
      setFocus(0);
      setPhase("live");
    } catch (e) {
      setBootErr(e instanceof Error ? e : new Error(String(e)));
    }
  };

  // ── the live round: canvas + clock only — the engine owns the rules ────────
  useEffect(() => {
    if (phase !== "live") return;
    const run = runRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!run || !canvas || !ctx) {
      // loud by design: the boundary turns this into the PIT ERROR screen
      throw new Error(
        `PIT: live scene failed to mount (run=${!!run} canvas=${!!canvas} ctx=${!!ctx})`,
      );
    }
    const rdef = run.def;
    const N = rdef.secs * TPS;
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
      const sum = run.finish(margin);
      const res: RoundResult = { ...sum, n: rdef.n };
      setResult(res);
      setCareerEq(sum.endEq);
      setPhase(margin ? "gameover" : "complete");
      const finalFlag = margin ? "margin" : rdef.n === 5 ? true : false;
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
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const s = focusRef.current;
      const i = run.i;
      const eq = run.equity();
      const px = run.px;
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
      ctx.fillText(`R${rdef.n} · ${rdef.name} · SIM`, 12, 20);
      ctx.fillText(rdef.mission, 12, 36);
      ctx.fillStyle = "#d8ecd9"; ctx.font = "700 19px ui-monospace, monospace";
      ctx.fillText(`$${eq.toFixed(0)}`, 12, H - 16);
      const rp = (eq / run.startEq - 1) * 100;
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.fillStyle = rp >= 0 ? "#7fe0a5" : "#e08a7a";
      ctx.fillText(`${rp >= 0 ? "+" : ""}${rp.toFixed(1)}%`, 120, H - 16);
      const remain = Math.max(0, Math.ceil((N - i) / TPS));
      ctx.fillStyle = remain <= 10 ? "#ffd27a" : "rgba(216,236,217,0.7)";
      ctx.font = `700 ${remain <= 10 ? 17 : 13}px ui-monospace, monospace`;
      ctx.fillText(`🔔 ${remain}s`, W - 78, 22);
      // catalyst clue banner (the fairness rule: warned, never ambushed)
      const clue = run.clue;
      if (clue) {
        ctx.fillStyle = "#ffd27a"; ctx.font = "700 13px ui-monospace, monospace";
        const t = `⚠ ${run.stocks[clue.stock].ticker} CATALYST IN ${Math.ceil((clue.at - i) / TPS)}s`;
        ctx.fillText(t, (W - ctx.measureText(t).width) / 2, 54);
      }
      const live = run.catalysts.find((c) => i >= c.at && i < c.at + 4 * TPS);
      if (live) {
        ctx.fillStyle = live.dir === 1 ? "#7fe0a5" : "#e08a7a";
        ctx.font = "700 14px ui-monospace, monospace";
        const t = `${run.stocks[live.stock].ticker} — ${live.label} · SIM`;
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
    };

    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden) { last = now; return; }
      acc += Math.min(200, now - last); last = now;
      const step = 1000 / TPS;
      while (acc >= step) {
        acc -= step;
        const end = run.tick();
        if (end) return finish(end === "margin");
      }
      draw();
      if (run.i % 6 === 0) force((v) => v + 1); // chip strip refresh
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => { focusRef.current = focus; }, [focus]);

  // ── shells ───────────────────────────────────────────────────────────────
  const run = runRef.current;
  const rows = board === "today" ? boards.today : boards.best;
  return (
    <div className="pit2">
      <p className="pit-sim">SIMULATED — entertainment, not investment advice. No real orders.</p>

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
              <p className="pit3-eyebrow">ROUND {def.n} OF {LADDER.length}</p>
              <h2>{def.name}</h2>
              <p className="pit3-mission">MISSION: {def.mission}</p>
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
              <p className="pit3-eyebrow">ROUND {result.n} COMPLETE{result.missionHit ? " · MISSION ✓" : ""}</p>
              <p className="pit2-endpct">
                ${result.startEq.toFixed(0)} → ${result.endEq.toFixed(0)}
              </p>
              <p className={`pit2-endpct ${result.endEq >= result.startEq ? "up" : "down"}`}>
                {result.roundPct.toFixed(1)}% · SPY {result.spyPct >= 0 ? "+" : ""}{result.spyPct.toFixed(1)}%
                {" "}· {result.roundPct > result.spyPct ? "OUTPERFORMED MARKET" : "UNDERPERFORMED"}
              </p>
              <p className="pit2-stats">SCORE {result.score.toLocaleString()} — {result.parts.map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v}`).join(" · ")}</p>
              <p className="pit2-stats">+{result.xp} XP · LEVEL {player?.level ?? 1}{player ? ` · ${player.xp} XP total` : ""}</p>
              {result.n < LADDER.length ? (
                <button type="button" className="pit2-btn pit2-run" onClick={() => { setRoundIx(result.n); setPhase("brief"); }}>
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
              <p className="pit2-endpct down">R{result.n} · ${result.endEq.toFixed(0)}</p>
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

export default function PitSurface(props: { active: boolean }) {
  return (
    <PitBoundary>
      <PitInner {...props} />
    </PitBoundary>
  );
}
