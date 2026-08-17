"use client";

// THE PIT (GAME-5) — the structured game: one continuous CAREER run from
// $10,000 across an 8-week season with three first-class endings (BUSTED /
// SEASON CLEARED / THE FUND), a season map with a furthest-reached ghost,
// the shared DAILY PIT (3 attempts, best posts), and a records panel.
// Composition only — the trading day itself is the GAME-4 engine untouched.
// SIMULATED ONLY, permanently labeled.
//
// MOUNT LAW (GC-G1): the RoundRun is created SYNCHRONOUSLY in the click that
// opens the market. A scene that fails to mount throws into PitBoundary.

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LEVELS, dailySeed, DAILY_ATTEMPTS, type LeaderRow, type PitPlayer } from "@/lib/pit";
import { explainTrades } from "@/lib/pit-review";
import {
  DEFAULT_TUNE, FUND_TARGET, LADDER, MARGIN_FRAC, MISSIONS, SEASON_WEEKS, START_CASH,
  WEEK_PERKS, WEEK_WAYPOINTS,
  advanceRun, careerDaySeed, createRoundRun, makeRound, pitRating, retuneRun, seasonTune, weekAdjust,
  type PitEvent, type PitTune, type RoundRun, type RoundSummary, type RunPos, type TradeMark,
} from "@/lib/pit-engine";
import {
  buildChallenge, buildShareText, dailyNumber, deskTeaserVisibility, glyphStrip,
  parseChallenge, pickStamp, type Challenge,
} from "@/lib/pit-share";
import { relativeTime, type PublicIdea } from "@/lib/ideas";
import TrainingFloor from "@/components/surfaces/TrainingFloor";

// ── error boundary ───────────────────────────────────────────────────────────
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

// ── AUGUST ON THE FLOOR ──────────────────────────────────────────────────────
const FLOOR_LINES: Partial<Record<PitEvent["type"], string[]>> = {
  goodEntry: ["clean fill. the desk noticed.", "bought it like you meant it."],
  catalyst: ["read the tape before it printed."],
  panicSell: ["sold the low. bold.", "that was the bottom, by the way."],
  stopOut: ["the risk desk covers its eyes."],
  diamondHands: ["held through the pain. paid for it. respect."],
  paperHands: ["it ripped right after. we don't talk about it."],
};
const FLOOR_COOLDOWN_MS = 12_000;

const SEND_OFF: Record<"busted" | "cleared" | "fund", string> = {
  busted: "the margin desk kept your imaginary furniture. the floor has already forgotten your name.",
  cleared: "forty days on the floor and you walked out the far door. the desk remembers the ones who finish.",
  fund: "the desk pulls you off the floor mid-print and hands you a book. run money, kid.",
};

const VOL_LABEL = (v: number) => (v < 0.004 ? "LOW" : v < 0.0055 ? "MED" : v < 0.0065 ? "HIGH" : "EXTREME");

// AUTH-1a — a PROMPT, never a wall (L5): inline, quiet, dismissible forever.
const NUDGE_KEY = "aug-signin-nudge-off";
function SignInNudge({ line }: { line: string }) {
  const [hidden, setHidden] = useState(() => {
    try { return window.localStorage.getItem(NUDGE_KEY) === "1"; } catch { return true; }
  });
  if (hidden) return null;
  return (
    <p className="pit7-nudge" role="note">
      <span>{line}</span>
      <a href="/login">SIGN IN</a>
      <button
        type="button"
        aria-label="Never show sign-in prompts again"
        title="Never show again"
        onClick={() => {
          try { window.localStorage.setItem(NUDGE_KEY, "1"); } catch { /* per-session only */ }
          setHidden(true);
        }}
      >
        ×
      </button>
    </p>
  );
}

// the daily's fixed frame: rotates the day archetype by date, week-3 rules
function dailyDefFor(date: string) {
  const idx = (parseInt(date.slice(8, 10), 10) || 1) % LADDER.length;
  return weekAdjust(LADDER[idx], 3);
}

function dailyCountdown(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const left = 24 * 60 - (h * 60 + m);
    return `${Math.floor(left / 60)}h ${String(left % 60).padStart(2, "0")}m`;
  } catch {
    return "—";
  }
}

// ── S6: the share card — text is the format ──────────────────────────────────
function ShareCard({ tag, pct, trades, stamp, glyphs, challenge }: {
  tag: string; pct: number; trades: number; stamp: string | null; glyphs: string; challenge: Challenge;
}) {
  const [copied, setCopied] = useState(false);
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}/?view=pit&challenge=${buildChallenge(challenge)}`;
  const text = buildShareText({ tag, pct, trades, stamp, glyphs, url });
  const doShare = async () => {
    try {
      const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
      if (nav.share && window.matchMedia("(max-width: 700px)").matches) {
        await nav.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* user dismissed the sheet — nothing to clean up */ }
  };
  return (
    <div className="pit6-share">
      <p className="pit6-share-line">{text.split("\n")[0]}</p>
      <p className="pit6-share-glyphs">{glyphs}</p>
      <div className="pit6-share-row">
        <button type="button" className="pit2-btn pit6-copy" onClick={doShare}>
          {copied ? "COPIED ✓" : "COPY · SEND THIS TAPE"}
        </button>
      </div>
    </div>
  );
}

// ── S7: the desk teaser — losing is the ad ───────────────────────────────────
function DeskTeaser() {
  const [idea, setIdea] = useState<PublicIdea | null>(null);
  useEffect(() => {
    fetch("/api/ideas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: { ideas?: PublicIdea[] }) => {
        const list = Array.isArray(j.ideas) ? j.ideas : [];
        if (list.length) setIdea(list[0]); // newest first — the live book's top card
      })
      .catch(() => {});
  }, []);
  if (!idea) return null;
  const locked = deskTeaserVisibility() === "locked";
  return (
    <a className={`pit6-desk${locked ? " locked" : ""}`} href="/?view=terminal">
      <span className="pit6-desk-head">
        <b>{idea.instrument}</b>
        {idea.entry ? <span className="pit6-desk-entry">{idea.entry}</span> : null}
        <span className={`pit6-desk-risk r-${idea.riskLevel}`}>{idea.riskLevel.toUpperCase()} RISK</span>
        <span className="pit6-desk-age">{relativeTime(idea.updatedAt)}</span>
      </span>
      <span className="pit6-desk-cta">{locked ? "UNLOCK THE DESK →" : "SEE THE DESK →"}</span>
    </a>
  );
}

// ── the persisted run (a career survives reloads; simulated, client-held) ────
type RunAggState = { trades: number; wins: number; worstDayDD: number; missionsHit: number; daysPlayed: number };
type CurveMark = { idx: number; kind: "open" | "close" | "event"; cls: 1 | -1 };
type SavedRun = {
  v: 2; seed: number; week: number; day: number; eq: number; streak: number;
  agg: RunAggState; curve: number[]; marks: CurveMark[]; bounds: number[];
};
const RUN_KEY = "aug-pit-run-v2";
const ZERO_AGG: RunAggState = { trades: 0, wins: 0, worstDayDD: 0, missionsHit: 0, daysPlayed: 0 };

function asSavedRun(raw: unknown): SavedRun | null {
  const r = raw as SavedRun;
  return r && r.v === 2 && r.week >= 1 && r.day >= 1 && Number.isFinite(r.eq) ? r : null;
}
function loadRun(): SavedRun | null {
  try {
    const raw = window.localStorage.getItem(RUN_KEY);
    return raw ? asSavedRun(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
/** AUTH-1a — fire-and-forget active-run sync (career continuity across devices) */
function pushRunState(run: SavedRun | null): void {
  void fetch("/api/pit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "runState", run }),
  }).catch(() => {});
}
function saveRun(r: SavedRun | null): void {
  try {
    if (r) window.localStorage.setItem(RUN_KEY, JSON.stringify(r));
    else window.localStorage.removeItem(RUN_KEY);
  } catch { /* non-persistent */ }
}

// ── component ────────────────────────────────────────────────────────────────
type Phase = "modes" | "brief" | "live" | "result" | "ended" | "daily-result" | "challenge-result" | "training";
type Mode = "career" | "daily" | "challenge";
type RoundResult = RoundSummary & { n: number };
type Ending = { kind: "busted" | "cleared" | "fund"; rating: ReturnType<typeof pitRating> };
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
  const [phase, setPhase] = useState<Phase>("modes");
  const [mode, setMode] = useState<Mode>("career");
  const [player, setPlayer] = useState<PitPlayer | null>(null);
  const [boards, setBoards] = useState<{ today: LeaderRow[]; best: LeaderRow[] }>({ today: [], best: [] });
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [etToday, setEtToday] = useState<string>("");
  const [board, setBoard] = useState<"today" | "best">("today");
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [pos, setPos] = useState<RunPos>({ week: 1, day: 1 });
  const [nextPos, setNextPos] = useState<RunPos | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [careerEq, setCareerEq] = useState(START_CASH);
  const [careerStreak, setCareerStreak] = useState(0);
  const [furthestYet, setFurthestYet] = useState(false);
  const [saved, setSaved] = useState<SavedRun | null>(null);
  /** a device-local run displaced by the account's — offered once (L10) */
  const [orphanRun, setOrphanRun] = useState<SavedRun | null>(null);
  const [countdown, setCountdown] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [bootErr, setBootErr] = useState<Error | null>(null);
  const [stamp, setStamp] = useState<string | null>(null);
  const [sizePct, setSizePct] = useState<(typeof SIZES)[number]>(100);
  const [tuneOn, setTuneOn] = useState(false);
  const [tune, setTune] = useState<PitTune>({ ...DEFAULT_TUNE });
  const tuneRef = useRef<PitTune>(tune);
  const runSeed = useRef(1);
  const aggRef = useRef<RunAggState>({ ...ZERO_AGG });
  const curveRef = useRef<number[]>([]);
  const marksRef = useRef<CurveMark[]>([]);
  const boundsRef = useRef<number[]>([]);
  const dayCurveRef = useRef<number[]>([]);
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
  const [, force] = useState(0);
  const loaded = useRef(false);

  if (bootErr) throw bootErr;

  const refresh = useCallback(() => {
    fetch("/api/pit", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j) => {
        if (!j.ok) return;
        setPlayer(j.player);
        setBoards({ today: j.today, best: j.best });
        if (typeof j.attemptsLeft === "number") setAttemptsLeft(j.attemptsLeft);
        if (typeof j.date === "string") setEtToday(j.date);
        // AUTH-1a — reconcile the cross-device career: the ACCOUNT'S run wins;
        // a displaced device-local run is offered exactly once (adopt/discard)
        const pid: string = j.player?.pid ?? "";
        if (pid.startsWith("u:")) {
          const server = asSavedRun(j.player?.activeRun);
          const local = loadRun();
          if (server && (!local || local.seed === server.seed)) {
            saveRun(server);
            setSaved(server);
          } else if (server && local) {
            saveRun(server);
            setSaved(server);
            try {
              const k = `aug-orphan-${local.seed}`;
              if (!window.localStorage.getItem(k)) {
                window.localStorage.setItem(k, "1");
                setOrphanRun(local);
              }
            } catch { /* the offer is a nicety */ }
          } else if (!server && local) {
            pushRunState(local); // first sign-in with a run in hand — it becomes the account's
          }
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (active && !loaded.current) {
      loaded.current = true;
      refresh();
      setSaved(loadRun());
      setCountdown(dailyCountdown());
    }
  }, [active, refresh]);
  useEffect(() => {
    if (phase !== "modes" && phase !== "daily-result") return;
    const t = setInterval(() => setCountdown(dailyCountdown()), 30_000);
    setCountdown(dailyCountdown());
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      // S6 — an incoming challenge link: same seed, sender's score as the bar
      setChallenge(parseChallenge(params.get("challenge")));
      const wanted = params.get("tune") === "1";
      if (!wanted) return;
      if (process.env.NODE_ENV !== "production" || window.location.hostname === "localhost") {
        setTuneOn(true);
        return;
      }
      // R1 A4 — the token must VALIDATE against the admin gate, not merely exist
      const token = window.sessionStorage.getItem("aug-admin-token");
      if (!token) return;
      fetch("/api/admin/pit", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => { if (r.ok) setTuneOn(true); })
        .catch(() => {});
    } catch { /* stays off */ }
  }, []);
  useEffect(() => { tuneRef.current = tune; }, [tune]);

  const week = pos.week;
  const dayIx = Math.min(pos.day, LADDER.length) - 1;
  const def =
    mode === "daily" ? dailyDefFor(etToday || "2026-01-01") :
    mode === "challenge" && challenge ? weekAdjust(LADDER[Math.min(challenge.day, LADDER.length) - 1], challenge.week) :
    weekAdjust(LADDER[dayIx], week);
  const mission = MISSIONS[def.missionKey].label;

  // S8 — the mode's seed policy in one place: daily/challenge shared by
  // construction, career fresh per (runId, week, day)
  const seedForNow = () =>
    mode === "daily" ? dailySeed(etToday || "2026-01-01") :
    mode === "challenge" && challenge ? challenge.seed :
    careerDaySeed(runSeed.current, pos.week, pos.day);

  const briefTickers = useMemo(() => {
    if (phase !== "brief") return [];
    try {
      const t = mode === "career" ? seasonTune(week, tuneRef.current) : tuneRef.current;
      return makeRound(def, seedForNow(), t).stocks.map((s) => s.ticker);
    } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode, pos, week, etToday, challenge]);

  const onEvent = useCallback((ev: PitEvent) => {
    if (ev.type === "pop") {
      popsRef.current.push({ text: ev.text, cls: ev.cls, at: performance.now() });
      return;
    }
    if (ev.type === "news") return;
    if (ev.type === "streak") {
      popsRef.current.push({ text: `${ev.count}-TRADE STREAK +${ev.xp} XP`, cls: 1, at: performance.now() });
      return;
    }
    if (ev.type === "closedInfo") {
      if (ev.worstPct <= -5) {
        floorRef.current = { text: `sold ${ev.gain >= 0 ? "+" : ""}${ev.gain.toFixed(1)}% after holding ${ev.worstPct.toFixed(1)}% against`, until: performance.now() + 4500 };
      }
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

  // ── run lifecycle ──────────────────────────────────────────────────────────
  const startNewRun = () => {
    // S8 — wide entropy: no two runs (or players) share tapes
    runSeed.current = (((Date.now() & 0xffffff) * 1024) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 || 1;
    aggRef.current = { ...ZERO_AGG };
    curveRef.current = []; marksRef.current = []; boundsRef.current = [];
    saveRun(null); setSaved(null);
    setMode("career");
    setCareerEq(START_CASH);
    setCareerStreak(0);
    setPos({ week: 1, day: 1 });
    setEnding(null);
    setPhase("brief");
  };
  const continueRun = () => {
    const r = saved ?? loadRun();
    if (!r) return startNewRun();
    runSeed.current = r.seed;
    aggRef.current = { ...r.agg };
    curveRef.current = [...r.curve]; marksRef.current = [...r.marks]; boundsRef.current = [...r.bounds];
    setMode("career");
    setCareerEq(r.eq);
    setCareerStreak(r.streak);
    setPos({ week: r.week, day: r.day });
    setEnding(null);
    setPhase("brief");
  };
  const startDaily = () => {
    if ((attemptsLeft ?? 0) <= 0) return;
    setMode("daily");
    setPhase("brief");
  };
  const startChallenge = () => {
    if (!challenge) return;
    setMode("challenge");
    setPhase("brief");
  };

  const openMarket = () => {
    try {
      popsRef.current = [];
      floorRef.current = null;
      dayCurveRef.current = [];
      setFurthestYet(false);
      if (mode === "career") {
        runRef.current = createRoundRun(def, seedForNow(), careerEq, onEvent, {
          tune: seasonTune(week, tuneRef.current),
          initialStreak: careerStreak,
          fundAt: FUND_TARGET,
        });
      } else {
        // daily + challenge: standalone $10K on the shared seed
        runRef.current = createRoundRun(def, seedForNow(), START_CASH, onEvent, {
          tune: tuneRef.current,
        });
      }
      setFocus(0);
      setSizePct(100);
      setPhase("live");
    } catch (e) {
      setBootErr(e instanceof Error ? e : new Error(String(e)));
    }
  };

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

  // ── the live day ───────────────────────────────────────────────────────────
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
    let lastEq = boot.equity(), eqFlash = 0;

    const finish = (end: "margin" | "bell" | "fund") => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
      const run = runRef.current!;
      const margin = end === "margin";
      const sum = run.finish(margin);
      const res: RoundResult = { ...sum, n: run.def.n };
      setResult(res);

      if (mode === "challenge") {
        // exhibition match: nothing posts, the bar decides
        setPhase("challenge-result");
        return;
      }
      if (mode === "daily") {
        setPhase("daily-result");
        fetch("/api/pit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "daily", pct: Math.round(sum.roundPct * 100) / 100,
            stats: { trades: sum.trades, wins: sum.wins, bestTrade: sum.bestTrade, perfectDips: sum.goodEntries },
          }),
        }).then(() => refresh()).catch(() => {});
        return;
      }

      // career: fold the day into the run
      const agg = aggRef.current;
      agg.trades += sum.trades;
      agg.wins += sum.wins;
      agg.worstDayDD = Math.max(agg.worstDayDD, sum.maxDD);
      if (sum.missionHit) agg.missionsHit += 1;
      agg.daysPlayed += 1;
      // stitch the day's equity samples into the run curve
      const offset = curveRef.current.length;
      boundsRef.current.push(offset);
      curveRef.current.push(...dayCurveRef.current);
      const stride = run.def.tps;
      for (const ev of run.events) marksRef.current.push({ idx: offset + Math.floor(ev.at / stride), kind: "event", cls: ev.misleading ? -1 : 1 });
      for (const m of run.log) marksRef.current.push({ idx: offset + Math.floor(m.tick / stride), kind: m.kind, cls: m.kind === "close" ? ((m.gain ?? 0) >= 0 ? 1 : -1) : m.dir });

      setCareerEq(sum.endEq);
      setCareerStreak(sum.streak);
      const prevGhost = (player?.furthestWeek ?? 0) * 10 + (player?.furthestDay ?? 0);
      if (pos.week * 10 + pos.day > prevGhost) {
        setFurthestYet(true);
        setStamp("FURTHEST YET");
        if (stampTimer.current) clearTimeout(stampTimer.current);
        stampTimer.current = setTimeout(() => setStamp(null), 1400);
      }

      const after = advanceRun(pos);
      const endKind: Ending["kind"] | null =
        end === "margin" ? "busted" : end === "fund" ? "fund" : after === "cleared" ? "cleared" : null;
      const finalEq = sum.endEq;
      const post = (final: string | null, rating: string | null) =>
        fetch("/api/pit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "round", score: sum.score, xp: sum.xp,
            week: pos.week, day: pos.day,
            final: final ?? false, rating: rating ?? undefined,
            careerPct: Math.round((finalEq / START_CASH - 1) * 10000) / 100,
            stats: { trades: sum.trades, wins: sum.wins, bestTrade: sum.bestTrade, perfectDips: sum.goodEntries },
          }),
        }).then(() => refresh()).catch(() => {});

      if (endKind) {
        const rating = pitRating({ finalEq, ...agg });
        setEnding({ kind: endKind, rating });
        saveRun(null); setSaved(null);
        setPhase("ended");
        post(endKind, rating.grade);
      } else {
        const np = after as RunPos;
        setNextPos(np);
        const savedRun: SavedRun = {
          v: 2, seed: runSeed.current, week: np.week, day: np.day, eq: finalEq, streak: sum.streak,
          agg: { ...agg }, curve: [...curveRef.current], marks: [...marksRef.current], bounds: [...boundsRef.current],
        };
        saveRun(savedRun); setSaved(savedRun);
        if (player?.pid.startsWith("u:")) pushRunState(savedRun); // signed in: the career follows the account
        setPhase("result");
        post(null, null);
      }
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
      ctx.fillStyle = "rgba(216,236,217,0.65)"; ctx.font = "600 11px ui-monospace, monospace";
      const frame = mode === "daily" ? "DAILY PIT" : mode === "challenge" ? "CHALLENGE" : `WEEK ${pos.week} · DAY ${rdef.n}`;
      ctx.fillText(`${frame} · ${rdef.name} · SIM`, 12, 20);
      ctx.fillText(MISSIONS[rdef.missionKey].label, 12, 36);
      if (mode === "challenge" && challenge) {
        // S6 — the sender's score is THE BAR, on screen the whole run
        const barTxt = `THE BAR ${challenge.pct >= 0 ? "+" : ""}${challenge.pct.toFixed(1)}%`;
        ctx.fillStyle = (eq / run.startEq - 1) * 100 > challenge.pct ? "#7fe0a5" : "#ffd27a";
        ctx.font = "700 12px ui-monospace, monospace";
        ctx.fillText(barTxt, W - ctx.measureText(barTxt).width - 12, 40);
      }
      ctx.fillStyle = eqFlash > 0.08 ? "#7fe0a5" : eqFlash < -0.08 ? "#e08a7a" : "#d8ecd9";
      ctx.font = "700 21px ui-monospace, monospace";
      ctx.fillText(`$${eq.toFixed(0)}`, 12, H - 16);
      const rp = (eq / run.startEq - 1) * 100;
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.fillStyle = rp >= 0 ? "#7fe0a5" : "#e08a7a";
      ctx.fillText(`${rp >= 0 ? "+" : ""}${rp.toFixed(1)}%`, 128, H - 16);
      if (mode === "career") {
        const toFund = FUND_TARGET - eq;
        if (toFund > 0 && toFund < 20_000) {
          ctx.fillStyle = "#ffd27a";
          ctx.fillText(`$${toFund.toFixed(0)} FROM THE FUND`, 210, H - 16);
        }
      }
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
        if (run.i % run.def.tps === 0) dayCurveRef.current.push(run.equity());
        if (end) return finish(end);
      }
      draw();
      if (run.i % 4 === 0) force((v) => v + 1);
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => { focusRef.current = focus; }, [focus]);

  // DAY REPLAY (result screens) — the day's tape + marks + event ticks
  useEffect(() => {
    if (phase !== "result" && phase !== "daily-result" && phase !== "challenge-result") return;
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

  // FULL-RUN REPLAY (ending screen) — the equity curve of the entire career
  useEffect(() => {
    if (phase !== "ended") return;
    const canvas = replayRef.current;
    const ctx = canvas?.getContext("2d");
    const curve = curveRef.current;
    if (!canvas || !ctx || curve.length < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#04070a"; ctx.fillRect(0, 0, W, H);
    let lo = Infinity, hi = -Infinity;
    for (const v of curve) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    lo = Math.min(lo, START_CASH); hi = Math.max(hi, START_CASH * 1.1);
    const X = (i: number) => 4 + (i / (curve.length - 1)) * (W - 8);
    const Y = (v: number) => 6 + ((hi - v) / (hi - lo || 1)) * (H - 12);
    // day boundaries
    ctx.strokeStyle = "rgba(216,236,217,0.12)";
    ctx.lineWidth = 1;
    for (const b of boundsRef.current) {
      if (b === 0) continue;
      ctx.beginPath(); ctx.moveTo(X(b), 2); ctx.lineTo(X(b), H - 2); ctx.stroke();
    }
    // start line + the FUND line when in range
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(216,236,217,0.35)";
    ctx.beginPath(); ctx.moveTo(0, Y(START_CASH)); ctx.lineTo(W, Y(START_CASH)); ctx.stroke();
    if (hi >= FUND_TARGET * 0.85) {
      ctx.strokeStyle = "rgba(255,210,122,0.6)";
      ctx.beginPath(); ctx.moveTo(0, Y(FUND_TARGET)); ctx.lineTo(W, Y(FUND_TARGET)); ctx.stroke();
    }
    ctx.setLineDash([]);
    // event marks under the curve
    for (const m of marksRef.current) {
      if (m.kind !== "event") continue;
      ctx.strokeStyle = m.cls === 1 ? "rgba(255,210,122,0.35)" : "rgba(224,138,122,0.35)";
      ctx.beginPath(); ctx.moveTo(X(m.idx), H - 8); ctx.lineTo(X(m.idx), H - 2); ctx.stroke();
    }
    // the equity line
    ctx.shadowColor = "rgba(64,220,110,0.8)";
    ctx.shadowBlur = 6;
    ctx.strokeStyle = "#4ec97a";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < curve.length; i++) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, X(i), Y(curve[i]));
    ctx.stroke();
    ctx.shadowBlur = 0;
    // trades on the curve
    for (const m of marksRef.current) {
      if (m.kind === "event") continue;
      const x = X(m.idx), y = Y(curve[Math.min(m.idx, curve.length - 1)]);
      if (m.kind === "open") {
        ctx.fillStyle = m.cls === 1 ? "#6aa0c8" : "#cd7e6d";
        ctx.fillRect(x - 1.5, y - 4, 3, 8);
      } else {
        ctx.strokeStyle = m.cls === 1 ? "#7fe0a5" : "#e08a7a";
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3);
        ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3);
        ctx.stroke();
      }
    }
  }, [phase]);

  // ── the season map strip ───────────────────────────────────────────────────
  const ghostPos = (player?.furthestWeek ?? 0) * 10 + (player?.furthestDay ?? 0);
  const mapStrip = (cur: RunPos | null) => (
    <div className="pit5-map" aria-label="Season map, weeks 1 to 8">
      {WEEK_WAYPOINTS.map((name, ix) => {
        const w = ix + 1;
        const curHere = cur && cur.week === w;
        const done = cur && cur.week > w;
        const ghostHere = Math.floor(ghostPos / 10) === w;
        return (
          <span key={name} className={`pit5-wk${curHere ? " on" : ""}${done ? " done" : ""}`} title={name}>
            <i>{w}</i>
            {curHere ? <b>{name} · D{cur.day}</b> : null}
            {ghostHere && !curHere ? <em title={`furthest reached: week ${player?.furthestWeek} day ${player?.furthestDay}`}>◇</em> : null}
          </span>
        );
      })}
    </div>
  );
  const nextWaypoint = (cur: RunPos): string => {
    if (cur.week >= SEASON_WEEKS) return `${LADDER.length - cur.day + 1} day${LADDER.length - cur.day ? "s" : ""} from the FINAL PRINT`;
    const days = LADDER.length - cur.day + 1;
    return `${days} day${days > 1 ? "s" : ""} from ${WEEK_WAYPOINTS[cur.week]}`;
  };

  // ── shells ─────────────────────────────────────────────────────────────────
  const run = runRef.current;
  const rows = board === "today" ? boards.today : boards.best;
  const nowMs = typeof performance !== "undefined" ? performance.now() : 0;
  const floor = floorRef.current && floorRef.current.until > nowMs ? floorRef.current.text : null;
  const levelDef = LEVELS[Math.min(player?.level ?? 1, LEVELS.length) - 1];
  const pending = phase === "live" && run ? run.pendingReaction() : null;
  const activeCards = phase === "live" && run ? run.activeEvents().slice(-2) : [];
  const riskNow = phase === "live" && run ? run.risk() : null;
  const focusPos = phase === "live" && run ? run.positions[Math.min(focus, run.positions.length - 1)] : null;
  const bestRunCash = player?.bestRun !== null && player?.bestRun !== undefined
    ? Math.round((1 + player.bestRun / 100) * START_CASH) : null;

  // R3 — post-trade review: dry lines from observable round data, full tape
  const tradeReviews = result && runRef.current
    ? explainTrades(runRef.current.stocks, runRef.current.events, runRef.current.log, runRef.current.def)
    : [];
  const reviewBlock = tradeReviews.length ? (
    <div className="pit8-review">
      <i>TRADE REVIEW</i>
      {tradeReviews.map((t, ix) => (
        <p key={ix} className={t.gain >= 0 ? "up" : "down"}>{t.text}</p>
      ))}
    </div>
  ) : null;

  // S6 — share ingredients for the current result screen
  const dayLog: TradeMark[] = runRef.current?.log ?? [];
  const runMarksAsLog: TradeMark[] = marksRef.current
    .filter((m) => m.kind !== "event")
    .map((m) => ({ s: 0, tick: m.idx, price: 0, dir: m.cls, kind: m.kind as "open" | "close", gain: m.kind === "close" ? m.cls : undefined }));
  const dailyDayN = ((parseInt((etToday || "2026-01-01").slice(8, 10), 10) || 1) % LADDER.length) + 1;
  const dayChallenge: Challenge | null = result
    ? mode === "daily"
      ? { seed: dailySeed(etToday || "2026-01-01"), week: 3, day: dailyDayN, pct: result.roundPct }
      : mode === "challenge" && challenge
        ? { ...challenge, pct: result.roundPct } // pass it on — YOUR score is the new bar
        : { seed: careerDaySeed(runSeed.current, pos.week, pos.day), week: pos.week, day: pos.day, pct: result.roundPct }
    : null;
  const dayStamp = result ? pickStamp({ ...result, missionKey: def.missionKey }) : null;

  return (
    <div className="pit2">
      <p className="pit-sim">SIMULATED — entertainment, not investment advice. No real orders.</p>

      {stamp ? <div className="pit3-stamp" role="status">{stamp}</div> : null}

      {phase === "training" ? (
        <TrainingFloor
          done={player?.training?.done ?? []}
          onLessonDone={async (id) => {
            try {
              await fetch("/api/pit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "train", lesson: id }),
              });
            } catch { /* progress re-posts on the next completion */ }
            refresh();
          }}
          onExit={() => setPhase("modes")}
        />
      ) : phase === "live" && run ? (
        <>
          <div className="pit3-strip">
            {run.stocks.map((st, s) => {
              const posn = run.positions[s];
              const chg = (st.prices[Math.min(run.i, st.prices.length - 1)] / st.prices[0] - 1) * 100;
              const clue = run.clue?.stocks.includes(s) ?? false;
              return (
                <button key={st.ticker} type="button"
                  className={`pit3-chip${focus === s ? " on" : ""}${clue ? " clue" : ""}${posn ? (posn.dir === 1 ? " lng" : " sht") : ""}`}
                  onClick={() => setFocus(s)}>
                  <span>{st.ticker}</span>
                  <span className={chg >= 0.15 ? "up" : chg <= -0.15 ? "down" : ""}>
                    {chg >= 0 ? "+" : ""}{chg.toFixed(1)}% {chg >= 0.15 ? "↑" : chg <= -0.15 ? "↓" : "→"}
                  </span>
                  {posn ? <span className="tag">{posn.dir === 1 ? "LONG" : "SHORT"}</span> : null}
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
              <p className="pit3-eyebrow">
                {mode === "daily"
                  ? `DAILY PIT — ${etToday} · ${attemptsLeft ?? "?"} ATTEMPT${(attemptsLeft ?? 0) === 1 ? "" : "S"} LEFT`
                  : `WEEK ${pos.week} — ${WEEK_WAYPOINTS[pos.week - 1]} · DAY ${pos.day} OF ${LADDER.length}`}
              </p>
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
              {mode === "career" ? mapStrip(pos) : null}
              <p>
                ${(mode === "daily" ? START_CASH : careerEq).toFixed(0)} · {def.stocks} stocks · {def.shorts ? "LONG + SHORT" : "LONG ONLY"} ·
                {" "}{def.positions} position{def.positions > 1 ? "s" : ""}{def.sizing ? " · sized orders" : ""} · margin call at {MARGIN_FRAC * 100}%
              </p>
              <button type="button" className="pit2-btn pit2-run" onClick={openMarket}>
                OPEN THE MARKET
              </button>
              <button type="button" className="pit5-back" onClick={() => setPhase("modes")}>← THE FLOOR</button>
            </div>
          ) : phase === "result" && result ? (
            <div className="pit2-verdict">
              <p className="pit3-eyebrow">WEEK {pos.week} · DAY {result.n} COMPLETE{result.missionHit ? " · MISSION ✓" : ""}{furthestYet ? " · FURTHEST YET" : ""}</p>
              <p className="pit2-endpct">
                ${result.startEq.toFixed(0)} → ${result.endEq.toFixed(0)}
              </p>
              <p className={`pit2-endpct ${result.endEq >= result.startEq ? "up" : "down"}`}>
                {result.roundPct.toFixed(1)}% · INDEX {result.spyPct >= 0 ? "+" : ""}{result.spyPct.toFixed(1)}%
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
              {reviewBlock}
              <p className="pit2-stats">SCORE {result.score.toLocaleString()} — {result.parts.map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v}`).join(" · ")}</p>
              {result.bonus.length ? (
                <p className="pit2-stats bonus">{result.bonus.map(([k, v]) => `${k} +${v} XP`).join(" · ")}</p>
              ) : null}
              {nextPos ? mapStrip(nextPos) : null}
              {nextPos ? <p className="pit2-stats">{nextWaypoint(nextPos)} · ${FUND_TARGET.toLocaleString()} pulls you off the floor</p> : null}
              {dayChallenge ? (
                <ShareCard tag={`W${pos.week}D${result.n}`} pct={result.roundPct} trades={result.trades}
                  stamp={dayStamp} glyphs={glyphStrip(dayLog, "day")} challenge={dayChallenge} />
              ) : null}
              <button type="button" className="pit2-btn pit2-run" onClick={() => { if (nextPos) setPos(nextPos); setPhase("brief"); }}>
                NEXT DAY →
              </button>
            </div>
          ) : phase === "ended" && ending && result ? (
            <div className="pit2-verdict">
              {ending.kind === "busted" ? (
                <>
                  <h2>💀 BUSTED</h2>
                  <p className="pit2-endpct down">WEEK {pos.week} · DAY {pos.day} · ${result.endEq.toFixed(0)}</p>
                </>
              ) : ending.kind === "fund" ? (
                <>
                  <h2>🏛 THE FUND</h2>
                  <p className="pit2-endpct up">${FUND_TARGET.toLocaleString()} TOUCHED · WEEK {pos.week} · DAY {pos.day}</p>
                </>
              ) : (
                <>
                  <h2>SEASON CLEARED</h2>
                  <p className="pit2-endpct up">WEEK 8 · DAY 5 · ${result.endEq.toFixed(0)}</p>
                </>
              )}
              <div className="pit5-rating">
                <span className="grade">{ending.rating.grade}</span>
                <div className="lines">
                  {ending.rating.lines.map(([label, read, pts]) => (
                    <p key={label}><span>{label}</span><span>{read}</span><b>+{pts}</b></p>
                  ))}
                  <p className="total"><span>PIT RATING</span><span>{ending.rating.points}/10</span><b>{ending.rating.grade}</b></p>
                </div>
              </div>
              <canvas ref={replayRef} className="pit3-replay tall" aria-label="Full-run replay: equity curve, trades, events" />
              <p className="pit2-stats aug">AUG ▸ {SEND_OFF[ending.kind]}</p>
              {player?.pid.startsWith("v:") ? (
                <SignInNudge line="save this career — records follow you to every device." />
              ) : null}
              {dayChallenge ? (
                <ShareCard tag={`W${pos.week}D${pos.day}`}
                  pct={(result.endEq / START_CASH - 1) * 100}
                  trades={aggRef.current.trades}
                  stamp={ending.kind === "fund" ? "THE FUND" : ending.kind === "cleared" ? "SEASON CLEARED" : dayStamp}
                  glyphs={glyphStrip(runMarksAsLog, ending.kind)}
                  challenge={dayChallenge} />
              ) : null}
              <DeskTeaser />
              <button type="button" className="pit2-btn pit2-run" onClick={startNewRun}>RUN IT BACK</button>
              <button type="button" className="pit5-back" onClick={() => { setEnding(null); setPhase("modes"); }}>← THE FLOOR</button>
            </div>
          ) : phase === "daily-result" && result ? (
            <div className="pit2-verdict">
              <p className="pit3-eyebrow">DAILY PIT — {etToday}{result.missionHit ? " · MISSION ✓" : ""}</p>
              <p className={`pit2-endpct ${result.roundPct >= 0 ? "up" : "down"}`}>
                {result.roundPct >= 0 ? "+" : ""}{result.roundPct.toFixed(1)}%
              </p>
              <canvas ref={replayRef} className="pit3-replay" aria-label="Day replay" />
              <p className="pit2-stats">
                best of today {player?.daily?.date === etToday && player.daily.bestPct != null ? `${player.daily.bestPct >= 0 ? "+" : ""}${player.daily.bestPct.toFixed(1)}%` : "—"}
                {" "}· {attemptsLeft ?? 0} attempt{(attemptsLeft ?? 0) === 1 ? "" : "s"} left · resets in {countdown}
              </p>
              {reviewBlock}
              <div className="pit2-boards solo">
                <ol>
                  {boards.today.slice(0, 5).map((r, idx) => (
                    <li key={r.pid} className={player && r.pid === player.pid ? "me" : ""}>
                      <span>{idx + 1}</span><span className="nm">{r.name}</span>
                      <span className={`sc ${r.pct >= 0 ? "up" : "down"}`}>{r.pct >= 0 ? "+" : ""}{r.pct.toFixed(1)}%</span>
                    </li>
                  ))}
                  {boards.today.length === 0 ? <li className="empty">nobody on today's board yet</li> : null}
                </ol>
              </div>
              {dayChallenge ? (
                <ShareCard tag={`#${dailyNumber(etToday || "2026-01-01")}`} pct={result.roundPct} trades={result.trades}
                  stamp={dayStamp} glyphs={glyphStrip(dayLog, "daily")} challenge={dayChallenge} />
              ) : null}
              <DeskTeaser />
              {(attemptsLeft ?? 0) > 0 ? (
                <button type="button" className="pit2-btn pit2-run" onClick={() => setPhase("brief")}>RUN IT AGAIN ({attemptsLeft} LEFT)</button>
              ) : (
                <p className="pit2-notreal">out of attempts — today's tape resets in {countdown}</p>
              )}
              <button type="button" className="pit5-back" onClick={() => setPhase("modes")}>← THE FLOOR</button>
            </div>
          ) : phase === "challenge-result" && result && challenge ? (
            <div className="pit2-verdict">
              <p className="pit3-eyebrow">CHALLENGE — {def.name}</p>
              <p className={`pit2-endpct ${result.roundPct > challenge.pct ? "up" : "down"}`}>
                YOU {result.roundPct >= 0 ? "+" : ""}{result.roundPct.toFixed(1)}% · BAR {challenge.pct >= 0 ? "+" : ""}{challenge.pct.toFixed(1)}%
              </p>
              <p className="pit2-endpct">{result.roundPct > challenge.pct ? "BAR BEATEN" : "BAR MISSED"}</p>
              <canvas ref={replayRef} className="pit3-replay" aria-label="Day replay" />
              <div className="pit4-card">
                <span>TRADES<b>{result.trades}</b></span>
                <span>WIN RATE<b>{result.trades ? `${result.winRate}%` : "—"}</b></span>
                <span>MAX DD<b>-{result.maxDD.toFixed(1)}%</b></span>
              </div>
              {dayChallenge ? (
                <ShareCard tag={`W${challenge.week}D${challenge.day}`} pct={result.roundPct} trades={result.trades}
                  stamp={result.roundPct > challenge.pct ? "BAR BEATEN" : dayStamp} glyphs={glyphStrip(dayLog, "day")} challenge={dayChallenge} />
              ) : null}
              <DeskTeaser />
              <button type="button" className="pit2-btn pit2-run" onClick={() => setPhase("brief")}>RUN IT AGAIN</button>
              <button type="button" className="pit5-back" onClick={() => setPhase("modes")}>← THE FLOOR</button>
            </div>
          ) : (
            <div className="pit5-modes">
              <h2>THE PIT</h2>
              <p className="pit5-sub">Headlines move the tape — some of them lie. WEEK {player?.level ?? 1} desk tier: {levelDef.name}.</p>
              {player?.pid.startsWith("v:") ? (
                <SignInNudge line="new device? sign in and your career picks up here." />
              ) : null}
              {orphanRun ? (
                <div className="pit7-nudge pit7-orphan" role="note">
                  <span>
                    this device holds an unclaimed run — W{orphanRun.week}·D{orphanRun.day} ${orphanRun.eq.toFixed(0)}.
                    {" "}your account&apos;s run is loaded; adopt replaces it.
                  </span>
                  <button type="button" className="pit7-adopt" onClick={() => {
                    saveRun(orphanRun); setSaved(orphanRun); pushRunState(orphanRun); setOrphanRun(null);
                  }}>ADOPT</button>
                  <button type="button" onClick={() => setOrphanRun(null)}>DISCARD</button>
                </div>
              ) : null}

              {challenge ? (
                <button type="button" className="pit5-mode pit6-challenge" onClick={startChallenge}>
                  <span className="pit5-mode-name">CHALLENGE</span>
                  <span className="pit5-mode-line">
                    someone sent you this tape — the bar is {challenge.pct >= 0 ? "+" : ""}{challenge.pct.toFixed(1)}%. beat it.
                  </span>
                  <span className="pit5-mode-line dim">same seed, same headlines · no account needed</span>
                </button>
              ) : null}

              <button type="button" className="pit5-mode" onClick={saved ? continueRun : startNewRun}>
                <span className="pit5-mode-name">CAREER</span>
                {saved ? (
                  <span className="pit5-mode-line">CONTINUE — WEEK {saved.week} · DAY {saved.day} · ${saved.eq.toFixed(0)}</span>
                ) : (
                  <span className="pit5-mode-line">NEW RUN — $10,000 · 8 weeks · bust, clear, or touch ${FUND_TARGET.toLocaleString()}</span>
                )}
                {mapStrip(saved ? { week: saved.week, day: saved.day } : null)}
                {ghostPos > 0 ? <span className="pit5-ghost">furthest reached ◇ week {player?.furthestWeek} day {player?.furthestDay}</span> : null}
              </button>
              {saved ? (
                <button type="button" className="pit5-minor" onClick={startNewRun}>ABANDON + START NEW RUN</button>
              ) : null}

              <button type="button" className="pit5-mode" onClick={startDaily} disabled={(attemptsLeft ?? 1) <= 0}>
                <span className="pit5-mode-name">DAILY PIT</span>
                <span className="pit5-mode-line">
                  {attemptsLeft === null ? "one tape, everyone, today" : attemptsLeft > 0 ? `${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left today` : "out of attempts"}
                  {" "}· resets in {countdown}
                </span>
                {boards.today.length ? (
                  <span className="pit5-mode-line dim">
                    №1 {boards.today[0].name} {boards.today[0].pct >= 0 ? "+" : ""}{boards.today[0].pct.toFixed(1)}%
                  </span>
                ) : <span className="pit5-mode-line dim">today's board is open</span>}
              </button>

              {/* TRAIN-1 — an offer, never a prerequisite: the game stays open */}
              <button type="button" className="pit5-mode" onClick={() => setPhase("training")}>
                <span className="pit5-mode-name">TRAINING</span>
                <span className="pit5-mode-line">the training floor — guided lessons on the real tape engine</span>
                <span className="pit5-mode-line dim">
                  {(player?.training?.done?.length ?? 0) > 0
                    ? `${player?.training?.done?.length}/8 complete${(player?.training?.done?.length ?? 0) >= 8 ? " · TRAINED" : ""}`
                    : "start with L1 — reading the tape"}
                </span>
              </button>

              <button type="button" className="pit5-mode slim" onClick={() => setRecordsOpen((v) => !v)}>
                <span className="pit5-mode-name">RECORDS</span>
                <span className="pit5-mode-line dim">{recordsOpen ? "close" : "best run · furthest · ratings · streaks"}</span>
              </button>

              {recordsOpen ? (
                <>
                  <div className="pit4-card">
                    <span>BEST RUN<b>{bestRunCash !== null ? `$${bestRunCash.toLocaleString()}` : "—"}</b></span>
                    <span>FURTHEST<b>{ghostPos > 0 ? `W${player?.furthestWeek}·D${player?.furthestDay}` : "—"}</b></span>
                    <span>BEST RATING<b>{player?.bestRating ?? "—"}</b></span>
                    <span>BEST DAILY<b>{player?.bestDailyRank ? `#${player.bestDailyRank}` : "—"}</b></span>
                    <span>DAILY STREAK<b>{player?.dailyStreak ?? 0}</b></span>
                  </div>
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
                  {player?.pid.startsWith("v:") ? (
                    <SignInNudge line="claim this name on every device." />
                  ) : null}
                  <div className="pit2-boards">
                    <div className="pit2-boardtabs">
                      <button type="button" className={board === "today" ? "on" : ""} onClick={() => setBoard("today")}>DAILY — TODAY</button>
                      <button type="button" className={board === "best" ? "on" : ""} onClick={() => setBoard("best")}>ALL-TIME RUNS</button>
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
