"use client";

// TRAIN-1 — THE TRAINING FLOOR (surface). Split template per DESIGN_LAWS:
// lesson rail right, live scripted tape left. The engine is lib/train.ts +
// lib/pit-engine.ts; this component only draws and forwards interactions.
// SIMULATED banner persists; every lesson footer: education, not advice.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createRoundRun, START_CASH,
  type PitEvent, type RoundRun, type RoundSummary,
} from "@/lib/pit-engine";
import {
  LESSONS, lessonUnlocked, nearExtreme, profitableClose, planRatioOk, exitAtPlan,
  trainedBadge, type LessonDef, type TradePlan,
} from "@/lib/train";

type LessonPhase = "brief" | "live" | "task" | "passed" | "retry";

const fmt$ = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export default function TrainingFloor({
  done,
  onLessonDone,
  onExit,
}: {
  /** completed lesson ids from the player record */
  done: string[];
  /** persist a completion (POST /api/pit action:train) */
  onLessonDone: (id: string) => void;
  onExit: () => void;
}) {
  const [open, setOpen] = useState<LessonDef | null>(null);

  return (
    <div className="trn">
      <p className="pit-sim">SIMULATED — training floor. Education, not investment advice.</p>
      {open ? (
        <LessonRoom
          key={open.id}
          lesson={open}
          onDone={() => onLessonDone(open.id)}
          onBack={() => setOpen(null)}
        />
      ) : (
        <LessonIndex done={done} onOpen={setOpen} onExit={onExit} />
      )}
    </div>
  );
}

// ── the index — topic chips, locked states, progress ─────────────────────────

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
        eight lessons, the real tape engine, sim tickers only. the game never waits on this —
        CAREER and DAILY are open regardless.
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
          return (
            <li key={l.id}>
              <button
                type="button"
                className={`trn-row${isDone ? " done" : ""}${openable ? "" : " locked"}`}
                onClick={() => { if (openable) onOpen(l); }}
                aria-disabled={!openable}
              >
                <span className="trn-chip">{l.topic}</span>
                <span className="trn-title">{l.n}. {l.title}</span>
                <span className="trn-mins">{l.minutes}</span>
                <span className="trn-state">
                  {isDone ? "✓ DONE" : !unlocked ? "🔒 finish the one before" : !l.built ? "🔒 arrives next round" : "OPEN →"}
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

// ── one lesson — scripted tape left, rail right ──────────────────────────────

function LessonRoom({
  lesson, onDone, onBack,
}: {
  lesson: LessonDef; onDone: () => void; onBack: () => void;
}) {
  const [phase, setPhase] = useState<LessonPhase>("brief");
  const [, setTick] = useState(0);
  const runRef = useRef<RoundRun | null>(null);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // y→price inverse mapping for plan taps, updated every draw
  const scaleRef = useRef<{ lo: number; hi: number; n: number } | null>(null);
  const [coach, setCoach] = useState<string[]>([]);
  const beatIx = useRef(0);
  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const [failText, setFailText] = useState("");
  // L1 — tap the high, then the low
  const [tapStep, setTapStep] = useState<"hi" | "lo">("hi");
  const [taps, setTaps] = useState<Array<{ tick: number; which: "hi" | "lo" }>>([]);
  // L3 — the ghost plan
  const [plan, setPlan] = useState<Partial<TradePlan>>({});
  const [arm, setArm] = useState<"stop" | "target" | null>(null);

  const say = useCallback((text: string) => {
    setCoach((c) => [...c.slice(-3), text]);
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
  }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    setCoach([]); beatIx.current = 0; setSummary(null); setTaps([]); setTapStep("hi"); setPlan({}); setArm(null);
    const run = createRoundRun(lesson.day, lesson.seed, START_CASH, (ev: PitEvent) => {
      if (ev.type === "pop") say(ev.text.toLowerCase());
    });
    runRef.current = run;
    setPhase("live");
    timerRef.current = window.setInterval(() => {
      const r = runRef.current;
      if (!r) return;
      const end = r.tick();
      const sec = r.i / lesson.day.tps;
      const beats = lesson.beats;
      while (beatIx.current < beats.length && sec >= beats[beatIx.current].atSec) {
        say(beats[beatIx.current].text);
        beatIx.current += 1;
      }
      setTick((t) => t + 1);
      if (end) {
        stop();
        const s = r.finish(end === "margin");
        setSummary(s);
        settle(s, end === "margin");
      }
    }, 1000 / lesson.day.tps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, say, stop]);

  // bell → validate the lesson's task
  const settle = (s: RoundSummary, margin: boolean) => {
    const r = runRef.current;
    if (!r) return;
    if (lesson.id === "L1") {
      say("bell. now show me the edges — tap the day's high first.");
      setPhase("task");
      return;
    }
    if (margin) {
      setFailText("margin call. the lesson stands: risk first. run it again.");
      setPhase("retry");
      return;
    }
    if (lesson.id === "L2") {
      if (profitableClose(r.log)) pass("one clean round trip, booked. that's the job.");
      else { setFailText("no profitable close on the log. same tape, run it again — wait for the pause."); setPhase("retry"); }
      return;
    }
    if (lesson.id === "L3") {
      const p = plan;
      if (p.entry != null && p.stop != null && p.target != null && exitAtPlan(p as TradePlan, r.log)) {
        pass("exited at the plan. either side of it counts — discipline is the trade.");
      } else {
        setFailText("the exit didn't land on the plan. same tape — set it, then obey it.");
        setPhase("retry");
      }
      return;
    }
    pass("done.");
  };

  const pass = (line: string) => {
    say(line);
    setPhase("passed");
    onDone();
  };

  // L1 tap validation / L3 plan taps
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = runRef.current;
    const canvas = canvasRef.current;
    const scale = scaleRef.current;
    if (!r || !canvas || !scale) return;
    const rect = canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    if (phase === "task" && lesson.id === "L1") {
      const tick = Math.max(0, Math.min(scale.n - 1, Math.round(fx * (scale.n - 1))));
      const prices = r.stocks[0].prices;
      if (nearExtreme(prices, tick, tapStep)) {
        setTaps((t) => [...t, { tick, which: tapStep }]);
        if (tapStep === "hi") { say("that's the high. now the low."); setTapStep("lo"); }
        else pass("high and low, marked. you read the day. next lesson's buttons come off.");
      } else {
        say(tapStep === "hi" ? "not the high. look for the price nothing traded above." : "not the low. look for the price nothing traded under.");
      }
      return;
    }
    if (phase === "live" && lesson.ghostPlan && arm) {
      const price = scale.hi - fy * (scale.hi - scale.lo);
      setPlan((p) => ({ ...p, [arm]: price }));
      setArm(null);
    }
  };

  // the tape canvas — one focused stock, marks, ghost plan
  useEffect(() => {
    const canvas = canvasRef.current;
    const r = runRef.current;
    if (!canvas || !r || (phase !== "live" && phase !== "task" && phase !== "passed" && phase !== "retry")) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const upto = phase === "live" ? Math.max(2, r.i) : r.stocks[0].prices.length;
    const prices = r.stocks[0].prices.slice(0, upto);
    let lo = Math.min(...prices), hi = Math.max(...prices);
    for (const v of [plan.stop, plan.target]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    scaleRef.current = { lo, hi, n: r.stocks[0].prices.length };
    const N = r.stocks[0].prices.length;
    const X = (t: number) => (t / (N - 1)) * w;
    const Y = (p: number) => h - ((p - lo) / (hi - lo)) * h;
    // price path
    ctx.beginPath();
    prices.forEach((p, t) => { const x = X(t), y = Y(p); if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = prices[prices.length - 1] >= prices[0] ? "#57d98a" : "#e08a7a";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // ghost plan (L3) — training-only furniture
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
      if (plan.entry != null) dash(plan.entry, "#8fa89a", "ENTRY");
    }
    // trade marks
    for (const m of r.log) {
      if (m.s !== 0) continue;
      ctx.fillStyle = m.kind === "open" ? "#cfe8d8" : (m.gain ?? 0) >= 0 ? "#57d98a" : "#e08a7a";
      ctx.beginPath();
      ctx.arc(X(m.tick), Y(m.price), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // L1 task taps
    for (const t of taps) {
      ctx.strokeStyle = "#cfe8d8";
      ctx.beginPath(); ctx.moveTo(X(t.tick), 0); ctx.lineTo(X(t.tick), h); ctx.stroke();
    }
  });

  const r = runRef.current;
  const pos = r?.positions[0] ?? null;
  const price = r ? r.px(0) : 0;
  const planReady = plan.stop != null && plan.target != null && plan.entry != null
    && planRatioOk(plan as TradePlan);
  const canEnter = lesson.controls.trade && (!lesson.ghostPlan || planReady);
  const rr = plan.stop != null && plan.target != null && plan.entry != null
    ? Math.abs((plan.target - plan.entry) / (plan.entry - plan.stop || 1)).toFixed(1)
    : null;

  const act = (dir: 1 | -1 | 0) => {
    if (!r || phase !== "live") return;
    if (dir !== 0 && lesson.ghostPlan && !planReady) { say("plan first. stop, then target, 2:1 or better."); return; }
    r.act(0, dir, 1);
    if (dir !== 0 && lesson.ghostPlan) setPlan((p) => ({ ...p, entry: r.px(0) }));
    setTick((t) => t + 1);
  };

  return (
    <div className="trn-room">
      <div className="trn-tape">
        <div className="trn-head">
          <span className="trn-chip">{lesson.topic}</span>
          <b>{lesson.n}. {lesson.title}</b>
          <span className="trn-eq">{r && phase !== "brief" ? `${fmt$(r.equity())} · ${price >= 1 ? price.toFixed(2) : "—"}` : lesson.minutes}</span>
        </div>
        {phase === "brief" ? (
          <div className="trn-brief">
            <p className="trn-weather">{lesson.day.weather}</p>
            <button type="button" className="pit2-btn pit2-run" onClick={start}>START THE TAPE</button>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className={`trn-canvas${phase === "task" || arm ? " aim" : ""}`}
              onClick={onCanvasClick}
              aria-label="Training tape"
            />
            <div className="trn-task" role="status">
              {phase === "task" ? (tapStep === "hi" ? "TAP THE DAY'S HIGH" : "NOW THE LOW") : `TASK — ${lesson.task}`}
            </div>
            {/* progressive controls — locked buttons are furniture, not absence */}
            <div className="trn-controls">
              <LockableBtn label="LONG" locked={!canEnter} lockLine={lesson.controls.trade ? "plan first" : "unlocks in L2"}
                onClick={() => act(1)} disabled={phase !== "live" || !!pos} />
              <LockableBtn label="SHORT" locked={!lesson.controls.short || (!!lesson.ghostPlan && !planReady)} lockLine={lesson.controls.short ? "plan first" : "unlocks in L2"}
                onClick={() => act(-1)} disabled={phase !== "live" || !!pos} />
              <LockableBtn label="CLOSE" locked={!lesson.controls.trade} lockLine="unlocks in L2"
                onClick={() => act(0)} disabled={phase !== "live" || !pos} />
              <LockableBtn label="SIZE" locked={!lesson.controls.sizing} lockLine="unlocks in L4"
                onClick={() => {}} disabled />
            </div>
            {lesson.ghostPlan && phase === "live" ? (
              <div className="trn-plan">
                <button type="button" className={arm === "stop" ? "on" : ""} onClick={() => setArm("stop")}>
                  {plan.stop != null ? `STOP ${plan.stop.toFixed(2)}` : "SET STOP — tap the tape"}
                </button>
                <button type="button" className={arm === "target" ? "on" : ""} onClick={() => setArm("target")}>
                  {plan.target != null ? `TARGET ${plan.target.toFixed(2)}` : "SET TARGET — tap the tape"}
                </button>
                <span className={`trn-rr${planReady ? " ok" : ""}`}>
                  {rr ? `R:R ${rr}:1` : plan.entry == null && plan.stop != null && plan.target != null ? "now enter" : "2:1 minimum"}
                </span>
              </div>
            ) : null}
            {pos ? (
              <p className="trn-pos">
                {pos.dir === 1 ? "LONG" : "SHORT"} @ {pos.entry.toFixed(2)} ·{" "}
                {(((price / pos.entry - 1) * 100) * pos.dir).toFixed(1)}%
              </p>
            ) : null}
          </>
        )}
        <div className="trn-coach" aria-live="polite">
          {coach.map((c, i) => <p key={i}><b>AUG ▸</b> {c}</p>)}
        </div>
        {phase === "passed" ? (
          <div className="trn-result up">
            <p>LESSON COMPLETE — {lesson.title}</p>
            {summary ? <p className="dim">day {summary.roundPct >= 0 ? "+" : ""}{summary.roundPct.toFixed(1)}% · {summary.trades} trade{summary.trades === 1 ? "" : "s"}</p> : null}
            <button type="button" className="pit2-btn pit2-run" onClick={onBack}>BACK TO THE INDEX</button>
          </div>
        ) : phase === "retry" ? (
          <div className="trn-result down">
            <p>{failText}</p>
            <button type="button" className="pit2-btn pit2-run" onClick={start}>RUN IT AGAIN — SAME TAPE</button>
          </div>
        ) : null}
      </div>
      <aside className="trn-rail">
        <button type="button" className="pit5-back" onClick={() => { stop(); onBack(); }}>← LESSONS</button>
        {lesson.prose.map((p, i) => <p key={i}>{p}</p>)}
        <p className="trn-taskline">TASK · {lesson.task}</p>
        <p className="trn-footer">education, not investment advice. every tape simulated.</p>
      </aside>
    </div>
  );
}

function LockableBtn({
  label, locked, lockLine, onClick, disabled,
}: {
  label: string; locked: boolean; lockLine: string; onClick: () => void; disabled?: boolean;
}) {
  if (locked) {
    return (
      <span className="trn-lockbtn" title={lockLine}>
        <button type="button" className="pit4-act" disabled aria-disabled="true">{label}</button>
        <i>🔒 {lockLine}</i>
      </span>
    );
  }
  return (
    <button type="button" className={`pit4-act${label === "SHORT" ? " sht" : ""}`} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
