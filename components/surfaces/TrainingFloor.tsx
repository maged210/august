"use client";

// TRAIN-1 — THE TRAINING FLOOR, round 2: a TRADING COCKPIT with lessons
// attached (T-G1 feedback), not pages with a chart. The PIT engine's own
// position/order/commentary systems run every lesson:
//   R1 — persistent training account: $50,000 sim · MLL $48,000 · REALIZED ·
//        UNREALIZED, tick-by-tick; survives across lessons; RESET always
//        available; an MLL breach is a teachable moment, never a dead end.
//   R2 — persistent order ticket (size · BUY MKT · SELL MKT · FLATTEN);
//        L1 keeps the padlock; from L2 the panel is live in EVERY lesson.
//        Fills mark the tape; UP&L breathes while holding; closes pop.
//   R3 — L3 stop/target lines placed on the chart, auto-flatten on touch,
//        2:1 validated from the learner's actual placed levels. Coach reacts
//        to the learner's own fills via the engine's floor commentary.
//   R4 — continuous sessions: PAUSE/RESUME · RESET CHART; tasks completing
//        never stop the tape — free practice is the point.
// SIMULATED ONLY. Education, not investment advice.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRoundRun, START_CASH,
  type PitEvent, type RoundRun,
} from "@/lib/pit-engine";
import {
  LESSONS, lessonUnlocked, nearExtreme, planRatioOk,
  trainedBadge, type LessonDef, type TradePlan,
} from "@/lib/train";

// the training account: engine days run on $10k — the strip displays the
// $50k desk account by scaling engine equity deltas
const ACCT_START = 50_000;
const MLL = 48_000;
const SCALE = ACCT_START / START_CASH;
const SIZES = [1, 2, 3, 4]; // contracts → fraction of available cash

const usd = (v: number, sign = false) =>
  `${v < 0 ? "−" : sign && v > 0 ? "+" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function loadBal(): number {
  try {
    const v = Number(window.localStorage.getItem("aug-train-bal"));
    return Number.isFinite(v) && v > 0 ? v : ACCT_START;
  } catch { return ACCT_START; }
}
function saveBal(v: number) {
  try { window.localStorage.setItem("aug-train-bal", String(v)); } catch { /* session-only */ }
}

export default function TrainingFloor({
  done, onLessonDone, onExit,
}: {
  done: string[];
  onLessonDone: (id: string) => void;
  onExit: () => void;
}) {
  const [open, setOpen] = useState<LessonDef | null>(null);
  // P4 — the spine advances immediately: completions apply locally the moment
  // they happen; the server refresh confirms behind them.
  const [localDone, setLocalDone] = useState<string[]>([]);
  const allDone = [...new Set([...done, ...localDone])];
  const next = open ? LESSONS.find((l) => l.n === open.n + 1) ?? null : null;
  return (
    <div className="trn">
      <p className="pit-sim">SIMULATED — training floor. Education, not investment advice.</p>
      {open ? (
        <Cockpit key={open.id} lesson={open} done={allDone}
          onDone={() => { setLocalDone((d) => [...d, open.id]); onLessonDone(open.id); }}
          onBack={() => setOpen(null)}
          onNext={next && next.built ? () => setOpen(next) : null}
          nextTitle={next ? `${next.n}. ${next.title}${next.built ? "" : " (arrives next round)"}` : null}
        />
      ) : (
        <LessonIndex done={allDone} onOpen={setOpen} onExit={onExit} />
      )}
    </div>
  );
}

function LessonIndex({
  done, onOpen, onExit,
}: {
  done: string[]; onOpen: (l: LessonDef) => void; onExit: () => void;
}) {
  const doneCount = LESSONS.filter((l) => done.includes(l.id)).length;
  return (
    <div className="trn-index">
      <h2>THE TRAINING FLOOR</h2>
      <p className="trn-sub">
        a $50,000 sim desk, the real tape engine, lessons attached. the game never waits on
        this — CAREER and DAILY are open regardless.
      </p>
      <div className="trn-progress" role="img" aria-label={`${doneCount} of 8 lessons complete`}>
        <span style={{ width: `${(doneCount / 8) * 100}%` }} />
      </div>
      {trainedBadge(done) ? <p className="trn-badge">TRAINED — course complete</p> : null}
      <ol className="trn-list">
        {LESSONS.map((l) => {
          const isDone = done.includes(l.id);
          const unlocked = lessonUnlocked(l.n, done);
          const openable = unlocked && l.built;
          // P4 — the spine is visible: ✓ done · ▸ current · 🔒 locked
          const isCurrent = !isDone && openable;
          return (
            <li key={l.id}>
              <button type="button"
                className={`trn-row${isDone ? " done" : ""}${isCurrent ? " current" : ""}${openable ? "" : " locked"}`}
                onClick={() => { if (openable) onOpen(l); }} aria-disabled={!openable}>
                <span className="trn-chip">{l.topic}</span>
                <span className="trn-title">{l.n}. {l.title}</span>
                <span className="trn-mins">{l.minutes}</span>
                <span className="trn-state">
                  {isDone ? "✓ DONE" : isCurrent ? "▸ CURRENT — OPEN" : !unlocked ? "🔒 finish the one before" : "🔒 arrives next round"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <button type="button" className="pit5-back" onClick={onExit}>← THE FLOOR</button>
    </div>
  );
}

// ── the cockpit ──────────────────────────────────────────────────────────────

type TapeState = "idle" | "running" | "paused" | "over";

function Cockpit({
  lesson, done, onDone, onBack, onNext, nextTitle,
}: {
  lesson: LessonDef; done: string[]; onDone: () => void; onBack: () => void;
  onNext: (() => void) | null; nextTitle: string | null;
}) {
  const [tape, setTape] = useState<TapeState>("idle");
  // P4 — the completion panel (dismissable; the tape rolls on beneath it)
  const [showComplete, setShowComplete] = useState(false);
  // P1 — locked controls always react: a pulse key + rotating coach nudges
  const [lockPulse, setLockPulse] = useState(0);
  const lockNudges = useRef(0);
  // P1 — the unlock ceremony: first entry into the lesson that frees the ticket
  const [ceremony, setCeremony] = useState(false);
  // P3 — the last missed tap (drawn as a fading ✗) + tap markers with state
  const [miss, setMiss] = useState<{ tick: number; key: number } | null>(null);
  const [, setTick] = useState(0);
  const runRef = useRef<RoundRun | null>(null);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scaleRef = useRef<{ lo: number; hi: number; n: number } | null>(null);

  // R1 — the persistent account. baseline = engine equity the strip zeroes on
  const [bal, setBal] = useState(ACCT_START);
  const balRef = useRef(ACCT_START);
  const baseRef = useRef(START_CASH);
  useEffect(() => { const b = loadBal(); setBal(b); balRef.current = b; }, []);
  const setBalance = useCallback((v: number) => {
    balRef.current = v; setBal(v); saveBal(v);
  }, []);

  const [coach, setCoach] = useState<string[]>([]);
  const beatIx = useRef(0);
  const say = useCallback((text: string) => setCoach((c) => [...c.slice(-3), text]), []);

  const [taskDone, setTaskDone] = useState(done.includes(lesson.id));
  const taskDoneRef = useRef(taskDone);
  const complete = useCallback((line: string) => {
    if (taskDoneRef.current) return;
    taskDoneRef.current = true; setTaskDone(true);
    say(line);
    setShowComplete(true);
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say]);

  // P1 — a locked control was poked: pulse the padlock, explain, promise
  const lockNudge = useCallback((what: string, when: string) => {
    setLockPulse((k) => k + 1);
    const lines = [
      `not yet — eyes today, ${what.toLowerCase()} in ${when}.`,
      `the ${what.toLowerCase()} button unlocks in ${when}. this lesson is about seeing, not doing.`,
      `patience is a position too. ${when} puts that button in your hands.`,
    ];
    say(lines[lockNudges.current % lines.length]);
    lockNudges.current += 1;
  }, [say]);

  // R2 — order ticket state
  const [sizeIx, setSizeIx] = useState(0);
  const sizeRef = useRef(0);
  useEffect(() => { sizeRef.current = sizeIx; }, [sizeIx]);
  const [pop, setPop] = useState<{ text: string; cls: 1 | -1; key: number } | null>(null);
  const [flash, setFlash] = useState<0 | 1 | -1>(0);
  const holdCts = useRef(0);

  // R3 — placed stop/target lines (L3+). Refs govern in the tick loop.
  const [plan, setPlan] = useState<Partial<TradePlan>>({});
  const planRef = useRef<Partial<TradePlan>>({});
  useEffect(() => { planRef.current = plan; }, [plan]);
  const [arm, setArm] = useState<"stop" | "target" | null>(null);

  // L1 — tap-the-edges task
  const [tapStep, setTapStep] = useState<"hi" | "lo">("hi");
  const [taps, setTaps] = useState<Array<{ tick: number }>>([]);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
  }, []);
  useEffect(() => stopTimer, [stopTimer]);

  // bank the open engine delta into the account (lesson exit / bell / reset)
  const bank = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    const delta = (r.equity() - baseRef.current) * SCALE;
    if (Math.abs(delta) > 0.5) setBalance(Math.max(0, Math.round(balRef.current + delta)));
    baseRef.current = r.equity();
  }, [setBalance]);

  const onEngine = useCallback((ev: PitEvent) => {
    // the PIT's floor commentary, wholesale — reacting to the learner's fills
    if (ev.type === "pop") say(ev.text.toLowerCase());
    else if (ev.type === "goodEntry") say("good entry — you didn't chase.");
    else if (ev.type === "panicSell") say("you sold the low. the tape smelled it.");
    else if (ev.type === "stopOut") say("stopped out hard. size was the problem, not the idea.");
    else if (ev.type === "diamondHands") say("held through the drawdown and got paid. noted.");
    else if (ev.type === "paperHands") say("paper hands — that runner kept going without you.");
    else if (ev.type === "closedInfo") {
      const r = runRef.current;
      if (!r) return;
      // realized pop in desk dollars
      const dollars = (ev.gain / 100) * START_CASH * SCALE * (holdCts.current / SIZES.length || 0.25);
      setPop({ text: usd(Math.round(dollars), true), cls: ev.gain >= 0 ? 1 : -1, key: Date.now() });
      if (lesson.id === "L2" && ev.gain > 0) {
        complete("that's the round trip. lesson done — the tape keeps rolling, trade it.");
      }
    }
  }, [say, lesson.id, complete]);

  const start = useCallback((freshCoach = true) => {
    stopTimer();
    if (freshCoach) { setCoach([]); }
    beatIx.current = 0;
    setTaps([]); setTapStep("hi"); setPlan({}); setArm(null); setPop(null);
    const run = createRoundRun(lesson.day, lesson.seed, START_CASH, onEngine);
    runRef.current = run;
    baseRef.current = run.equity();
    setTape("running");
    // P1 — the unlock ceremony: the first tape of the lesson that frees the
    // ticket breaks the padlocks open on screen, with the beat to match
    if (lesson.id === "L2" && !taskDoneRef.current) {
      setCeremony(true);
      window.setTimeout(() => say("ticket's yours. don't embarrass the desk."), 900);
      window.setTimeout(() => setCeremony(false), 3200);
    }
    timerRef.current = window.setInterval(() => {
      if (runRef.current) tickRef.current(runRef.current);
    }, 1000 / lesson.day.tps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, onEngine, stopTimer]);

  const pause = () => {
    if (tape === "running") { stopTimer(); setTape("paused"); }
    else if (tape === "paused" && runRef.current) {
      // resume: re-arm the interval without resetting the run (R4)
      setTape("running");
      timerRef.current = window.setInterval(() => {
        if (runRef.current) tickRef.current(runRef.current);
      }, 1000 / lesson.day.tps);
    }
  };
  // ONE tick body (interval closures go through the ref so nothing stales)
  const tickOnce = (r: RoundRun) => {
    const prevPx = r.px(0);
    const end = r.tick();
    const px = r.px(0);
    const pos = r.positions[0];
    setFlash(pos ? (px > prevPx ? 1 : px < prevPx ? -1 : 0) : 0);
    const sec = r.i / lesson.day.tps;
    while (beatIx.current < lesson.beats.length && sec >= lesson.beats[beatIx.current].atSec) {
      say(lesson.beats[beatIx.current].text);
      beatIx.current += 1;
    }
    const p = planRef.current;
    if (pos && (p.stop != null || p.target != null)) {
      const hitStop = p.stop != null && (pos.dir === 1 ? px <= p.stop : px >= p.stop);
      const hitTarget = p.target != null && (pos.dir === 1 ? px >= p.target : px <= p.target);
      if (hitStop || hitTarget) {
        const entry = pos.entry;
        r.act(0, 0);
        say(hitTarget ? "target touched — flat. that's the plan paying." : "stopped. that's the plan working, not failing.");
        if (lesson.id === "L3" && p.stop != null && p.target != null
          && planRatioOk({ entry, stop: p.stop, target: p.target })) {
          complete("planned, entered, exited at the line. 2:1 obeyed — lesson done. keep practicing.");
        }
      }
    }
    const eq = balRef.current + (r.equity() - baseRef.current) * SCALE;
    if (eq <= MLL) {
      for (let s = 0; s < r.positions.length; s++) if (r.positions[s]) r.act(s, 0);
      say("that's the max loss line. a real desk takes the seat away. training desk resets — remember this feeling.");
      baseRef.current = r.equity();
      setBalance(ACCT_START);
    }
    setTick((t) => t + 1);
    if (end) {
      stopTimer();
      setTape("over");
      bank();
      if (lesson.id === "L1" && !taskDoneRef.current) say("bell. now show me the edges — tap the day's high first.");
      else if (!taskDoneRef.current) say("bell. the task's still open — reset the chart and run it again.");
      else say("bell. banked.");
    }
  };
  const tickRef = useRef(tickOnce);
  useEffect(() => { tickRef.current = tickOnce; });

  const resetChart = () => { bank(); start(false); say("fresh chart, same tape. the account remembers."); };
  const resetAccount = () => { setBalance(ACCT_START); baseRef.current = runRef.current?.equity() ?? START_CASH; say("account reset — $50,000 even."); };

  // R2 — the ticket
  const r = runRef.current;
  const pos = r?.positions[0] ?? null;
  const px = r ? r.px(0) : 0;
  const uPnlEngine = pos && r ? pos.qty * (px - pos.entry) * pos.dir : 0;
  const uPnl = uPnlEngine * SCALE;
  const dispEq = balRef.current + (r ? (r.equity() - baseRef.current) * SCALE : 0);
  const realized = dispEq - ACCT_START - uPnl;
  const ticketLive = lesson.controls.trade && tape !== "idle";

  const order = (dir: 1 | -1) => {
    if (!r || tape !== "running" || !ticketLive) return;
    const frac = SIZES[sizeRef.current] / SIZES.length;
    const before = r.positions[0];
    r.act(0, dir, frac);
    const after = r.positions[0];
    if (after && (!before || before !== after)) {
      holdCts.current = Math.max(1, Math.round(after.sizeFrac * SIZES.length));
      say(`filled — ${dir === 1 ? "long" : "short"} ${SIZES[sizeRef.current]} @ ${px.toFixed(2)}`);
      if (lesson.ghostPlan && (planRef.current.stop == null || planRef.current.target == null)) {
        say("no lines on the chart. where are you wrong? where are you paid?");
      }
      setPlan((pl) => ({ ...pl, entry: px }));
    }
    setTick((t) => t + 1);
  };
  const flatten = () => {
    if (!r || tape !== "running" || !pos) return;
    r.act(0, 0);
    setTick((t) => t + 1);
  };

  // P3/P5 — canvas interactions on POINTER events (mouse + touch + pen):
  // L1 taps drop a marker instantly, misses get a located hint, plan lines
  // place where the finger says.
  const tapMode = tape === "over" && lesson.id === "L1" && !taskDone;
  const onCanvasTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const scale = scaleRef.current;
    if (!r || !canvas || !scale) return;
    const rect = canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    if (tape === "over" && lesson.id === "L1" && !taskDoneRef.current) {
      const tick = Math.max(0, Math.min(scale.n - 1, Math.round(fx * (scale.n - 1))));
      const prices = r.stocks[0].prices;
      if (nearExtreme(prices, tick, tapStep)) {
        setTaps((t) => [...t, { tick }]);
        setMiss(null);
        if (tapStep === "hi") { say("✓ that's the high. now the low."); setTapStep("lo"); }
        else complete("✓ high and low, marked. you read the day. L2 takes the padlocks off.");
      } else {
        // a located hint, not a rejection: point at where the answer lives
        setMiss({ tick, key: Date.now() });
        const targetTick = tapStep === "hi"
          ? prices.indexOf(Math.max(...prices))
          : prices.indexOf(Math.min(...prices));
        const zone = targetTick < prices.length / 3 ? "near the open"
          : targetTick < (2 * prices.length) / 3 ? "midday" : "late in the session";
        say(tapStep === "hi" ? `higher — look at the spike ${zone}.` : `lower — look at the flush ${zone}.`);
      }
      return;
    }
    if (lesson.ghostPlan && arm && tape !== "idle") {
      const price = scale.hi - fy * (scale.hi - scale.lo);
      setPlan((p) => ({ ...p, [arm]: price }));
      setArm(null);
      say(arm === "stop" ? "stop on the chart. it will fire — that's its job." : "target set. let it come to you.");
    }
  };

  // the tape canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !r || tape === "idle") return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const upto = tape === "over" ? r.stocks[0].prices.length : Math.max(2, r.i);
    const prices = r.stocks[0].prices.slice(0, upto);
    let lo = Math.min(...prices), hi = Math.max(...prices);
    for (const v of [plan.stop, plan.target, pos?.entry]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const padY = (hi - lo) * 0.08 || 1; lo -= padY; hi += padY;
    scaleRef.current = { lo, hi, n: r.stocks[0].prices.length };
    const N = r.stocks[0].prices.length;
    const X = (t: number) => (t / (N - 1)) * w;
    const Y = (p: number) => h - ((p - lo) / (hi - lo)) * h;
    ctx.beginPath();
    prices.forEach((p, t) => { const x = X(t), y = Y(p); if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = prices[prices.length - 1] >= prices[0] ? "#57d98a" : "#e08a7a";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    const dash = (price: number, color: string, label: string) => {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, Y(price)); ctx.lineTo(w, Y(price)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.font = "9px monospace";
      ctx.fillText(`${label} ${price.toFixed(2)}`, 6, Y(price) - 3);
      ctx.restore();
    };
    if (lesson.ghostPlan) {
      if (plan.stop != null) dash(plan.stop, "#e08a7a", "STOP");
      if (plan.target != null) dash(plan.target, "#57d98a", "TARGET");
    }
    // the live entry line + position tag (R2)
    if (pos) {
      dash(pos.entry, "#cfe8d8", "ENTRY");
      ctx.fillStyle = uPnl >= 0 ? "#57d98a" : "#e08a7a";
      ctx.font = "bold 11px monospace";
      const tag = `${pos.dir === 1 ? "+" : "−"}${holdCts.current} · ${usd(Math.round(uPnl), true)}`;
      ctx.fillText(tag, Math.min(X(upto - 1) + 8, w - 90), Y(px) - 6);
    }
    for (const m of r.log) {
      if (m.s !== 0) continue;
      ctx.fillStyle = m.kind === "open" ? "#cfe8d8" : (m.gain ?? 0) >= 0 ? "#57d98a" : "#e08a7a";
      ctx.beginPath(); ctx.arc(X(m.tick), Y(m.price), 3, 0, Math.PI * 2); ctx.fill();
    }
    for (const t of taps) {
      // a confirmed tap: the marker line + a ✓ at the marked price
      ctx.strokeStyle = "#cfe8d8";
      ctx.beginPath(); ctx.moveTo(X(t.tick), 0); ctx.lineTo(X(t.tick), h); ctx.stroke();
      ctx.fillStyle = "#57d98a"; ctx.font = "bold 12px monospace";
      ctx.fillText("✓", X(t.tick) + 4, Y(r.stocks[0].prices[t.tick]) - 4);
    }
    if (miss) {
      ctx.fillStyle = "#e08a7a"; ctx.font = "bold 12px monospace";
      ctx.fillText("✗", X(miss.tick) - 4, h / 2);
    }
  });

  const exitLesson = () => { bank(); stopTimer(); onBack(); };

  // P2 — the session clock: no learner ever wonders waiting-or-stuck
  const secsLeft = r && tape !== "idle" ? Math.max(0, Math.ceil((r.N - r.i) / lesson.day.tps)) : lesson.day.secs;
  const clock = tape === "over" ? "BELL RUNG"
    : `BELL IN ${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")}`;
  const bellGated = lesson.id === "L1" && !taskDone;

  return (
    <div className="trn-room">
      <div className="trn-tape">
        {/* P4 — the persistent course header */}
        <div className="trn-course">
          <span>LESSON {lesson.n} OF 8</span>
          <div className="trn-progress slim"><span style={{ width: `${(LESSONS.filter((l) => done.includes(l.id)).length / 8) * 100}%` }} /></div>
        </div>
        <div className="trn-head">
          <span className="trn-chip">{lesson.topic}</span>
          <b>{lesson.n}. {lesson.title}</b>
          {taskDone ? <span className="trn-donechip">✓ TASK DONE</span> : null}
          {tape !== "idle" ? (
            <span className={`trn-clock${tape === "over" ? " rung" : ""}`}>
              {clock}{bellGated && tape !== "over" ? " · task starts at the bell" : ""}
            </span>
          ) : null}
          <span className="trn-eq">{tape !== "idle" && r ? `${r.stocks[0].ticker} · ${px.toFixed(2)}` : lesson.minutes}</span>
        </div>

        {tape === "idle" ? (
          <div className="trn-brief">
            <p className="trn-weather">{lesson.day.weather}</p>
            <button type="button" className="pit2-btn pit2-run" onClick={() => start()}>START THE TAPE</button>
          </div>
        ) : (
          <>
            <div className={`trn-canvaswrap${flash === 1 ? " up" : flash === -1 ? " down" : ""}`}>
              <canvas ref={canvasRef}
                className={`trn-canvas${tapMode || arm ? " aim" : ""}`}
                onPointerUp={onCanvasTap} aria-label="Training tape" />
              {/* P3 — visible tap mode: the prompt rides the tape itself */}
              {tapMode ? (
                <span className="trn-tapprompt">✚ {tapStep === "hi" ? "TAP THE DAY'S HIGH" : "✓ NOW TAP THE LOW"}</span>
              ) : arm ? (
                <span className="trn-tapprompt">✚ TAP THE CHART TO PLACE THE {arm.toUpperCase()}</span>
              ) : null}
              {pop ? <span key={pop.key} className={`trn-pop ${pop.cls === 1 ? "up" : "down"}`}>{pop.text}</span> : null}
            </div>
            {/* R1 — the account strip, tick by tick */}
            <div className="trn-acct" role="status">
              <span>BAL<b>{usd(Math.round(dispEq))}</b></span>
              <span>MAX LOSS LIMIT<b className={dispEq - MLL < 500 ? "down" : ""}>{usd(MLL)}</b></span>
              <span>REALIZED<b className={realized > 0 ? "up" : realized < 0 ? "down" : ""}>{usd(Math.round(realized), true)}</b></span>
              <span>UNREALIZED<b className={uPnl > 0 ? "up" : uPnl < 0 ? "down" : ""}>{usd(Math.round(uPnl), true)}</b></span>
            </div>
            {/* P4 — LESSON COMPLETE: the inverted pyramid, NEXT dominant */}
            {showComplete ? (
              <div className="trn-complete" role="status">
                <p className="trn-complete-h"><span className="trn-chip done">✓ {lesson.topic}</span> LESSON {lesson.n} COMPLETE — {lesson.title}</p>
                {lesson.learned ? <p className="trn-learned">{lesson.learned}</p> : null}
                <p className="trn-carry">account carries forward: <b>{usd(Math.round(dispEq))}</b></p>
                <div className="trn-complete-btns">
                  {onNext ? (
                    <button type="button" className="pit2-btn pit2-run trn-next" onClick={() => { bank(); stopTimer(); onNext(); }}>
                      NEXT LESSON — {nextTitle} →
                    </button>
                  ) : nextTitle ? (
                    <p className="trn-chain">next: {nextTitle}</p>
                  ) : null}
                  <button type="button" className="trn-keep" onClick={() => setShowComplete(false)}>
                    keep practicing — the tape is still yours
                  </button>
                </div>
              </div>
            ) : (
            <div className="trn-task" role="status">
              {tape === "over" && lesson.id === "L1" && !taskDone
                ? (tapStep === "hi" ? "TAP THE DAY'S HIGH" : "NOW THE LOW")
                : `TASK — ${lesson.task}${taskDone ? " ✓" : ""}`}
            </div>
            )}
            {/* R4 — the tape is a session, not a slide */}
            <div className="trn-session">
              <button type="button" onClick={pause} disabled={tape === "over"}>
                {tape === "paused" ? "RESUME" : "PAUSE"}
              </button>
              <button type="button" onClick={resetChart}>RESET CHART</button>
              <button type="button" onClick={resetAccount}>RESET ACCOUNT</button>
            </div>
          </>
        )}

        <div className="trn-coach" aria-live="polite">
          {coach.map((c, i) => <p key={i}><b>AUG ▸</b> {c}</p>)}
        </div>
      </div>

      <aside className="trn-rail">
        <button type="button" className="pit5-back" onClick={exitLesson}>← LESSONS</button>

        {/* R2/P1 — the order ticket: always present; progression locks are
            never silent (pulse + coach line + the inline promise) */}
        <div className={`trn-ticket${!lesson.controls.trade ? " chained" : ""}${ceremony ? " ceremony" : ""}`}>
          <p className="trn-ticket-h">ORDER TICKET{ceremony ? <i className="trn-broken">🔓 UNLOCKED</i> : null}</p>
          <div className="trn-sizes" role="radiogroup" aria-label="Contracts">
            {SIZES.map((n, ix) => (
              <button key={n} type="button" className={sizeIx === ix ? "on" : ""}
                onClick={() => {
                  if (!ticketLive) { lockNudge("orders", "Lesson 2"); return; }
                  setSizeIx(ix);
                }}>{n}</button>
            ))}
          </div>
          <button type="button" className={`trn-buy${!lesson.controls.trade ? " locked" : ""}`}
            disabled={ticketLive && (tape !== "running")}
            onClick={() => { if (!lesson.controls.trade) { lockNudge("hands", "Lesson 2"); return; } if (tape === "idle") { say("start the tape first."); return; } order(1); }}>
            BUY MARKET{!lesson.controls.trade ? " · 🔒 L2" : ""}
          </button>
          <button type="button" className={`trn-sell${!lesson.controls.short ? " locked" : ""}`}
            disabled={ticketLive && lesson.controls.short && tape !== "running"}
            onClick={() => { if (!lesson.controls.short) { lockNudge("hands", "Lesson 2"); return; } if (tape === "idle") { say("start the tape first."); return; } order(-1); }}>
            SELL MARKET{!lesson.controls.short ? " · 🔒 L2" : ""}
          </button>
          <button type="button" className={`trn-flat${!lesson.controls.trade ? " locked" : ""}`}
            disabled={ticketLive && (tape !== "running" || !pos)}
            onClick={() => { if (!lesson.controls.trade) { lockNudge("hands", "Lesson 2"); return; } flatten(); }}>
            FLATTEN{!lesson.controls.trade ? " · 🔒 L2" : ""}
          </button>
          {!lesson.controls.trade ? (
            <p key={lockPulse} className={`trn-chain${lockPulse > 0 ? " pulse" : ""}`}>🔒 eyes today, hands in Lesson 2</p>
          ) : pos ? (
            <p className="trn-pos">{pos.dir === 1 ? "+" : "−"}{holdCts.current} @ {pos.entry.toFixed(2)} · <b className={uPnl >= 0 ? "up" : "down"}>{usd(Math.round(uPnl), true)}</b></p>
          ) : (
            <p className="trn-chain dim">flat — the tape is live, trade it any time</p>
          )}
          {lesson.ghostPlan ? (
            <div className="trn-plan">
              <button type="button" className={arm === "stop" ? "on" : ""} disabled={tape !== "running"} onClick={() => setArm("stop")}>
                {plan.stop != null ? `STOP ${plan.stop.toFixed(2)}` : "PLACE STOP — tap the chart"}
              </button>
              <button type="button" className={arm === "target" ? "on" : ""} disabled={tape !== "running"} onClick={() => setArm("target")}>
                {plan.target != null ? `TARGET ${plan.target.toFixed(2)}` : "PLACE TARGET — tap the chart"}
              </button>
              {plan.stop != null && plan.target != null ? (
                <span className={`trn-rr${planRatioOk({ entry: plan.entry ?? px, stop: plan.stop, target: plan.target }) ? " ok" : ""}`}>
                  R:R {Math.abs((plan.target - (plan.entry ?? px)) / (((plan.entry ?? px) - plan.stop) || 1)).toFixed(1)}:1
                  {planRatioOk({ entry: plan.entry ?? px, stop: plan.stop, target: plan.target }) ? "" : " — 2:1 minimum"}
                </span>
              ) : <span className="trn-rr">lines auto-flatten when touched</span>}
            </div>
          ) : null}
        </div>

        <div className="trn-lesson">
          {lesson.prose.map((p, i) => <p key={i}>{p}</p>)}
          <p className="trn-taskline">TASK · {lesson.task}</p>
        </div>
        {taskDone ? (
          <button type="button" className="pit2-btn pit2-run" onClick={exitLesson}>BACK TO THE INDEX</button>
        ) : null}
        <p className="trn-footer">education, not investment advice. every tape simulated.</p>
      </aside>
    </div>
  );
}
