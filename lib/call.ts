// THE CALL (feature/the-call) — AUGUST's one daily directional call on NQ,
// the owner's one-tap agree/disagree, honest settlement at the close, and a
// running record for both sides. Replaces the retired Morning Brief. One card
// on the floor; no new surface.
//
// THE RULES — all deterministic, stated once, here:
//   DIRECTION  the SIGN of the regime vote sum (lib/regime — the same read
//              the home apex shows). RISK ON (sum ≥ +2) → HIGHER, RISK OFF
//              (sum ≤ −2) → LOWER; NEUTRAL follows its lean (+1 → HIGHER,
//              −1 → LOWER). THE NEUTRAL RULE: a dead-even sum (0) or an
//              UNAVAILABLE regime means NO CALL that day — AUGUST does not
//              manufacture conviction. No model call ever decides direction.
//   GENERATE   at the daily pass (22:10 UTC — post-close in EST and EDT),
//              only when the next weekday is literally tomorrow: Fri/Sat
//              passes generate nothing (the weekend card says NO SESSION),
//              Sunday's pass opens Monday's call.
//   LOCK       a side can be taken until 09:30 ET on the call's date; the
//              server refuses after.
//   SETTLE     at the pass, against Yahoo's NQ=F daily bar for the call's
//              date: bar close vs the prior bar's close (the same daily-bar
//              source the book pass evaluates against). Exact tie → PUSH,
//              counted for neither side. No bar for the date but a LATER bar
//              exists → the date never traded (surprise holiday): NO_SESSION,
//              counted for nobody. The app holds NO exchange calendar —
//              trading days are DERIVED from Yahoo's daily bars, deliberately.
//   RECORD     wins–losses per identity and for AUGUST, from zero, never
//              seeded. Hit rate = wins / settled calls (pushes excluded).
//   THESIS     the ONLY model use on this feature: one sentence, regenerated
//              ONLY when the regime label or an input's VOTE flips (the
//              fingerprint), cached until the next flip. Never per view,
//              never per user; input-value drift alone never regenerates.
//
// Identity is the Pit's (AUTH-1a): pidFor(resolveChatPrincipal) → u:<email>
// or v:<visitorId>; anonymous records claim into the account via
// claimCallRecord, wired into lib/claim.ts beside claimPitPlayer.

import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";
import { getDailyBars, getQuoteWithSpark, type DailyBar } from "@/lib/markets";
import { listLiveIdeas } from "@/lib/ideas";
import {
  computeRegime,
  parseStatedLevel,
  sparkTrendPct,
  sparkTrendPts,
  type RegimeRead,
} from "@/lib/regime";
import { etDate } from "@/lib/pit";
import { emitCallSettled } from "@/lib/call-events";

export type CallSide = "HIGHER" | "LOWER";
export type CallResult = CallSide | "FLAT" | "NO_SESSION";
export type CallVote = { input: string; vote: -1 | 0 | 1 };
export type CallTally = { wins: number; losses: number; pushes: number };

export type CallSettle = {
  result: CallResult;
  close: number | null;
  prevClose: number | null;
  closePct: number | null;
  /** null on FLAT (push) and NO_SESSION (void) */
  augustWin: boolean | null;
  settledAt: number;
};

export type DayCall = {
  forDate: string; // ET date the call settles on
  /** null = the pass ran and declined (dead-even or unavailable regime) */
  side: CallSide | null;
  noCallReason: "dead_even" | "unavailable" | null;
  regimeLabel: string;
  votes: CallVote[];
  createdAt: number;
  settle: CallSettle | null;
};

// --- pure: direction, fingerprint, dates, lock ------------------------------

/** PURE. THE DIRECTION RULE (see header). null = no call. */
export function callDirection(read: RegimeRead): CallSide | null {
  if (read.label === "UNAVAILABLE") return null;
  const sum = read.because.reduce((a, b) => a + b.vote, 0);
  return sum > 0 ? "HIGHER" : sum < 0 ? "LOWER" : null;
}

/** PURE. Flips only when the label or an input's VOTE flips — value drift
 *  (VIX 16.2 → 16.4) never regenerates the thesis. */
export function regimeFingerprint(read: RegimeRead): string {
  return `${read.label}|${read.because.map((b) => `${b.input}:${b.vote}`).join(",")}`;
}

/** PURE. Next weekday after an ET date (holidays are unknowable ahead of
 *  time without an exchange calendar — see SETTLE's NO_SESSION rule). */
export function nextWeekday(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** PURE. What the pass should generate FOR, given today's ET date: the next
 *  weekday, but only when that is literally tomorrow ("NQ TOMORROW"). */
export function passTarget(todayEt: string): string | null {
  const next = nextWeekday(todayEt);
  const d = new Date(`${todayEt}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return next === d.toISOString().slice(0, 10) ? next : null;
}

/** PURE. An ET wall-clock moment on a date as epoch ms — DST-correct by
 *  checking the round-trip instead of hardcoding an offset. */
function etTs(date: string, hhmm: string): number {
  for (const off of ["-04:00", "-05:00"]) {
    const t = Date.parse(`${date}T${hhmm}:00.000${off}`);
    const back = new Date(t).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    if (back === hhmm) return t;
  }
  return Date.parse(`${date}T${hhmm}:00.000-05:00`);
}

/** PURE. 09:30 ET on the call's date — the take lock. */
export function lockTs(forDate: string): number {
  return etTs(forDate, "09:30");
}

/** PURE. 17:00 ET — the NQ=F Globex session end: the moment the date's daily
 *  bar is FINAL. Yahoo serves the day's in-progress bar all session, so
 *  settling before this against today's bar would grade a live price. */
export function sessionCloseTs(forDate: string): number {
  return etTs(forDate, "17:00");
}

/** PURE. 16:00 ET — the earliest moment a pass may GENERATE tomorrow's call.
 *  BACKSTOP: the cron itself runs 22:10 UTC (post-close both seasons), but
 *  the route is also pinged every ~10–15 min during market hours; without
 *  this gate the first morning ping would generate tomorrow's call from the
 *  morning regime instead of "the regime state at the pass". */
export function generateGateTs(date: string): number {
  return etTs(date, "16:00");
}

/** PURE. May a side still be taken? */
export function canTake(forDate: string, nowMs: number): boolean {
  return nowMs < lockTs(forDate);
}

// --- pure: settle math ------------------------------------------------------

const barEtDate = (sec: number): string =>
  new Date(sec * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** PURE. Settle a call against daily bars (see SETTLE in the header).
 *  null = not determinable yet (no bar, session not ended, no later bar, or
 *  thin data) — the call stays unsettled and the next pass retries.
 *  settledAt is stamped by the caller.
 *
 *  BAR FINALITY: Yahoo's daily feed includes the CURRENT day's in-progress
 *  bar with a live close, all session long — so a bar for forDate is only
 *  trusted once the session has provably ended: nowMs past 17:00 ET on
 *  forDate, or a later-dated bar exists. The 22:10 UTC cron clears this in
 *  both EST and EDT; the gate stays as the BACKSTOP against the market-hours
 *  pinger (and any mis-set cron hour) permanently grading a live price. */
export function settleAgainstBars(
  forDate: string,
  side: CallSide,
  bars: DailyBar[],
  nowMs: number,
): Omit<CallSettle, "settledAt"> | null {
  if (bars.length === 0) return null;
  const idx = bars.findIndex((b) => barEtDate(b.t) === forDate);
  const laterBar = bars.some((b) => barEtDate(b.t) > forDate);
  if (idx === -1) {
    // the date never printed a bar; only conclude "no session" once the
    // exchange demonstrably traded PAST it (rules out feed lag)
    return laterBar
      ? { result: "NO_SESSION", close: null, prevClose: null, closePct: null, augustWin: null }
      : null;
  }
  if (nowMs < sessionCloseTs(forDate) && !laterBar) return null; // bar still trading
  if (idx === 0) return null; // no prior close held — refuse rather than guess
  const close = bars[idx].c;
  const prevClose = bars[idx - 1].c;
  if (!(close > 0) || !(prevClose > 0)) return null;
  const closePct = ((close - prevClose) / prevClose) * 100;
  const result: CallResult = close === prevClose ? "FLAT" : close > prevClose ? "HIGHER" : "LOWER";
  return {
    result,
    close,
    prevClose,
    closePct,
    augustWin: result === "FLAT" ? null : result === side,
  };
}

// --- pure: records + display lines ------------------------------------------

export const EMPTY_TALLY: CallTally = { wins: 0, losses: 0, pushes: 0 };

/** PURE. Fold one settled outcome into a tally. null = push. */
export function foldTally(t: CallTally, win: boolean | null): CallTally {
  return {
    wins: t.wins + (win === true ? 1 : 0),
    losses: t.losses + (win === false ? 1 : 0),
    pushes: t.pushes + (win === null ? 1 : 0),
  };
}

/** PURE. Hit rate = wins / settled (pushes excluded). null before the first
 *  settled call — never a fake 0%. */
export function hitRate(t: CallTally): number | null {
  const settled = t.wins + t.losses;
  return settled > 0 ? t.wins / settled : null;
}

/** PURE. "3–1" (wins–losses; pushes deliberately not displayed). */
export function fmtRecord(t: CallTally): string {
  return `${t.wins}–${t.losses}`;
}

/** PURE. "+0.4%" — precision grows until a real move stops rounding to zero
 *  (a fabricated "flat" beside a graded ✓/✗ is exactly what this product
 *  forbids; a one-tick NQ close is ~0.001%, which 2dp would still hide). */
export function fmtClosePct(pct: number): string {
  if (pct === 0) return "0.0%";
  for (const dp of [1, 2, 4]) {
    const s = pct.toFixed(dp);
    if (Number(s) !== 0) return `${pct > 0 ? "+" : ""}${s}%`;
  }
  return `${pct > 0 ? "+" : "-"}0.0001%`; // sub-tick dust — never a fake flat
}

const SHORT_INPUT: Record<string, string> = {
  "INDEX TREND (1mo)": "INDEX TREND",
  "VIX LEVEL": "VIX",
  "VIX TREND (1mo)": "VIX TREND",
  "DESK BOOK BIAS": "BOOK BIAS",
  "NQ vs STATED LEVELS": "NQ vs LEVELS",
};

/** PURE, no model call. Names the call-time inputs that voted with the day's
 *  actual direction — i.e. the ones that disagreed with the loser. youWin is
 *  null when the viewer never took a side. */
export function disagreeLine(
  votes: CallVote[],
  result: CallResult,
  augustWin: boolean | null,
  youWin: boolean | null,
): string | null {
  if (result === "FLAT" || result === "NO_SESSION" || augustWin === null) return null;
  const want = result === "HIGHER" ? 1 : -1;
  const names = votes.filter((v) => v.vote === want).map((v) => SHORT_INPUT[v.input] ?? v.input);
  if (names.length === 0) return "no input saw it — the tape went against the whole read";
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  if (augustWin) return `${list} sided with AUGUST`;
  return youWin === true ? `${list} sided with you` : `${list} sided against AUGUST`;
}

// --- store (injectable KV, standard lazy Upstash default) -------------------

export type CallKv = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts?: { nx?: true; ex?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  smembers(key: string): Promise<unknown>;
  scard(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
};

const NS = "august:call:v1";
const K = {
  day: (d: string) => `${NS}:day:${d}`,
  active: `${NS}:active`,
  lastSettled: `${NS}:lastsettled`,
  take: (d: string, cid: string) => `${NS}:take:${d}:${cid}`,
  takers: (d: string) => `${NS}:takers:${d}`,
  rec: (id: string) => `${NS}:rec:${id}`, // cid, or the literal "august"
  settleClaim: (d: string) => `${NS}:settling:${d}`, // NX — one invocation settles
  folded: (d: string, id: string) => `${NS}:folded:${d}:${id}`, // NX — exactly-once folds
  claimed: (cid: string) => `${NS}:claimed:${cid}`, // NX — one account claim per device
  thesis: `${NS}:thesis`,
  thesisLock: `${NS}:thesis:lock`,
};
const DAY_TTL_S = 45 * 86_400;
const TAKE_TTL_S = 7 * 86_400;
/** Hard bound on takers per day — keeps the settle fold loop inside the cron
 *  budget even against minted visitor ids (the cookie is client-supplied). */
export const TAKERS_CAP = 1000;

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    _redis = url && token && url.startsWith("https://") ? new Redis({ url, token }) : null;
  } catch {
    _redis = null;
  }
  return _redis;
}

export function callConfigured(): boolean {
  return getRedis() !== null;
}

function defaultKv(): CallKv | null {
  return getRedis();
}

// defensive parses — Redis holds JSON, never trust the shape
function asDayCall(raw: unknown): DayCall | null {
  const d = (typeof raw === "string" ? safeJson(raw) : raw) as DayCall | null;
  if (!d || typeof d.forDate !== "string") return null;
  return {
    forDate: d.forDate,
    side: d.side === "HIGHER" || d.side === "LOWER" ? d.side : null,
    noCallReason: d.noCallReason === "dead_even" || d.noCallReason === "unavailable" ? d.noCallReason : null,
    regimeLabel: typeof d.regimeLabel === "string" ? d.regimeLabel : "",
    votes: Array.isArray(d.votes) ? d.votes.filter((v) => v && typeof v.input === "string") : [],
    createdAt: Number(d.createdAt) || 0,
    settle: d.settle && typeof d.settle === "object" ? d.settle : null,
  };
}
function asTally(raw: unknown): CallTally {
  const t = (typeof raw === "string" ? safeJson(raw) : raw) as CallTally | null;
  if (!t) return { ...EMPTY_TALLY };
  return {
    wins: Math.max(0, Math.floor(Number(t.wins) || 0)),
    losses: Math.max(0, Math.floor(Number(t.losses) || 0)),
    pushes: Math.max(0, Math.floor(Number(t.pushes) || 0)),
  };
}
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// --- server regime assembly -------------------------------------------------

/** The regime read, server-side — the SAME inputs and pure math as the home
 *  apex (components/HomeBrief) and the chat grounding (lib/desk-snapshot);
 *  kept in lockstep with both. Quote fetches ride lib/markets' 60s cache. */
export async function readServerRegime(): Promise<RegimeRead> {
  const settle = async <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const [spy, qqq, vix, nq, ideas] = await Promise.all([
    settle(getQuoteWithSpark("SPY")),
    settle(getQuoteWithSpark("QQQ")),
    settle(getQuoteWithSpark("^VIX")),
    settle(getQuoteWithSpark("NQ=F")),
    settle(listLiveIdeas()),
  ]);
  const longs = (ideas ?? []).filter((i) => i.side === "long").length;
  const shorts = (ideas ?? []).filter((i) => i.side === "short").length;
  const stated = (ideas ?? [])
    .filter((i) => /^NQ\b/i.test(i.instrument.trim()))
    .map((i) => parseStatedLevel(i.entry) ?? parseStatedLevel(i.target) ?? parseStatedLevel(i.stop))
    .filter((n): n is number => n !== null);
  const nqPx = nq && Number.isFinite(nq.price) ? nq.price : null;
  const avgStated = stated.length ? stated.reduce((a, b) => a + b, 0) / stated.length : null;
  return computeRegime({
    spyTrendPct: sparkTrendPct(spy?.closes),
    qqqTrendPct: sparkTrendPct(qqq?.closes),
    vix: vix && Number.isFinite(vix.price) ? vix.price : null,
    vixTrendPts: sparkTrendPts(vix?.closes),
    bookLongs: longs,
    bookShorts: shorts,
    nqVsLevelPct: nqPx !== null && avgStated !== null ? ((nqPx - avgStated) / avgStated) * 100 : null,
  });
}

// --- the thesis line (the ONLY model use; cached per regime flip) -----------

const THESIS_MODEL = "claude-sonnet-4-6";

export type ThesisGen = (read: RegimeRead) => Promise<string | null>;
type StoredThesis = { text: string; fingerprint: string; at: number };

function asThesis(raw: unknown): StoredThesis | null {
  const t = (typeof raw === "string" ? safeJson(raw) : raw) as StoredThesis | null;
  if (!t || typeof t.text !== "string" || typeof t.fingerprint !== "string" || !t.text.trim()) return null;
  return t;
}

/** PURE. Regenerate only on a fingerprint flip. */
export function shouldRegenerateThesis(stored: { fingerprint: string } | null, fp: string): boolean {
  return stored === null || stored.fingerprint !== fp;
}

let _anthropic: Anthropic | null = null;
async function anthropicThesis(read: RegimeRead): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    if (!_anthropic || (_anthropic.apiKey as string | null) !== apiKey) {
      _anthropic = new Anthropic({ apiKey });
    }
    const inputs = read.because
      .map((b) => `${b.input}: ${b.value} (${b.vote > 0 ? "risk-on" : b.vote < 0 ? "risk-off" : "neutral"})`)
      .join("; ");
    const msg = await _anthropic.messages.create({
      model: THESIS_MODEL,
      max_tokens: 120,
      system:
        "You are AUGUST, a market desk. Write EXACTLY ONE sentence: your read of the tape right now, grounded ONLY in the inputs given. " +
        "Declarative, specific, like a desk — not a chatbot. No hedging filler, no emoji, no preamble, no surrounding quotes, no invented numbers beyond the inputs. Under 30 words.",
      messages: [{ role: "user", content: `Regime: ${read.label}. Inputs: ${inputs}.` }],
    });
    const text = msg.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join(" ")
      .trim();
    if (!text || text.length > 240) return null; // ignored the constraint — omit rather than ramble
    return text;
  } catch (err) {
    console.warn("[call] thesis generation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** The current thesis line. Cache hit on matching fingerprint; a flip makes
 *  ONE model call (NX-locked against stampedes — concurrent views during a
 *  flip serve nothing rather than double-spend). Failure omits the line and
 *  the 90s lock throttles retries. */
export async function getThesis(
  read: RegimeRead,
  opts?: { kv?: CallKv | null; gen?: ThesisGen; now?: number },
): Promise<string | null> {
  if (read.label === "UNAVAILABLE") return null;
  const kv = opts?.kv !== undefined ? opts.kv : defaultKv();
  if (!kv) return null;
  const fp = regimeFingerprint(read);
  try {
    const stored = asThesis(await kv.get(K.thesis));
    if (stored && !shouldRegenerateThesis(stored, fp)) return stored.text;
    // ONE generation attempt per 5 minutes, success or failure — the lock is
    // NOT released on success: per-instance quote caches can straddle a vote
    // threshold and alternate the fingerprint per request, and without a
    // standing window that degenerates to one model call per view. A genuine
    // flip inside the window serves no line briefly; the next attempt after
    // expiry regenerates.
    const lock = await kv.set(K.thesisLock, "x", { nx: true, ex: 300 });
    if (lock === null) return null; // inside the window — no spend
    const text = await (opts?.gen ?? anthropicThesis)(read);
    if (!text) return null;
    await kv.set(K.thesis, { text, fingerprint: fp, at: opts?.now ?? Date.now() });
    return text;
  } catch {
    return null;
  }
}

// --- the pass: settle, then generate ---------------------------------------

export type CallPassDeps = {
  kv?: CallKv | null;
  now?: number;
  bars?: DailyBar[] | null;
  readRegime?: () => Promise<RegimeRead>;
  thesisGen?: ThesisGen;
};

export type CallPassResult = {
  configured: boolean;
  settled: CallResult | null;
  generated: CallSide | "no_call" | null;
};

/** The daily pass (22:10 UTC). SETTLE first (today's call against today's bar), then
 *  GENERATE tomorrow's call from the regime state at this moment. Idempotent:
 *  double-runs settle nothing twice (settle is guarded on the stored record)
 *  and generation is SET NX. */
export async function runCallPass(deps?: CallPassDeps): Promise<CallPassResult> {
  const kv = deps?.kv !== undefined ? deps.kv : defaultKv();
  if (!kv) return { configured: false, settled: null, generated: null };
  const now = deps?.now ?? Date.now();
  const today = etDate(new Date(now));
  let settled: CallResult | null = null;
  let generated: CallSide | "no_call" | null = null;

  // 1 — SETTLE every unsettled call in the recent window (not just the active
  // pointer: a bars-lag day must not orphan once the pointer advances; a dead
  // cron week must not orphan either — hence 14 days plus the pointer).
  // Oldest first so records fold in order.
  try {
    const candidates: string[] = [];
    const d = new Date(`${today}T12:00:00Z`);
    for (let i = 13; i >= 0; i--) {
      const dd = new Date(d);
      dd.setUTCDate(dd.getUTCDate() - i);
      candidates.push(dd.toISOString().slice(0, 10));
    }
    const activeRaw = await kv.get(K.active);
    if (typeof activeRaw === "string" && !candidates.includes(activeRaw)) {
      candidates.unshift(activeRaw);
    }
    let bars: DailyBar[] | null = null;
    for (const date of candidates) {
      const day = asDayCall(await kv.get(K.day(date)));
      if (!day || !day.side || day.settle) continue;
      if (bars === null) bars = deps?.bars ?? (await getDailyBars("NQ=F").catch(() => []));
      const s = settleAgainstBars(day.forDate, day.side, bars ?? [], now);
      if (!s) continue;
      // one invocation settles a day (the route is also externally pinged);
      // the claim expires so a crash mid-settle retries next pass
      const claim = await kv.set(K.settleClaim(date), "x", { nx: true, ex: 300 });
      if (claim === null) continue;

      if (s.result !== "NO_SESSION") {
        // EXACTLY-ONCE folds (NX markers), BEFORE the settle marker lands: a
        // crash here retries next pass — the settle recomputes identically
        // from the same final bars and the markers skip what already folded.
        if ((await kv.set(K.folded(date, "august"), "x", { nx: true, ex: DAY_TTL_S })) !== null) {
          const aug = asTally(await kv.get(K.rec("august")));
          await kv.set(K.rec("august"), foldTally(aug, s.augustWin)); // FLAT folds as a push
        }
        const members = (await kv.smembers(K.takers(day.forDate)).catch(() => [])) as unknown;
        const cids = Array.isArray(members) ? members.filter((m): m is string => typeof m === "string") : [];
        for (const cid of cids) {
          const take = (await kv.get(K.take(day.forDate, cid))) as { side?: unknown } | null;
          const side = take?.side === "HIGHER" || take?.side === "LOWER" ? (take.side as CallSide) : null;
          if (!side) continue;
          if ((await kv.set(K.folded(date, cid), "x", { nx: true, ex: DAY_TTL_S })) === null) continue;
          const win = s.result === "FLAT" ? null : side === s.result;
          const rec = asTally(await kv.get(K.rec(cid)));
          await kv.set(K.rec(cid), foldTally(rec, win));
        }
      }
      day.settle = { ...s, settledAt: now };
      await kv.set(K.day(day.forDate), day, { ex: DAY_TTL_S });
      await kv.set(K.lastSettled, day.forDate, { ex: DAY_TTL_S });
      settled = s.result;
      // the push branch subscribes here (lib/call-events) — nothing else
      await emitCallSettled({
        forDate: day.forDate,
        side: day.side,
        result: s.result,
        closePct: s.closePct,
        augustWin: s.augustWin,
      });
    }
  } catch (err) {
    console.warn("[call] settle step failed:", err instanceof Error ? err.message : err);
  }

  // 2 — GENERATE tomorrow's call — only when tomorrow is a weekday AND the
  // session is over (post-16:00 ET): the route's market-hours pinger must not
  // generate tomorrow's call at 10am from the morning regime.
  try {
    const target = passTarget(today);
    if (target && now >= generateGateTs(today)) {
      const existing = asDayCall(await kv.get(K.day(target)));
      if (!existing) {
        const read = await (deps?.readRegime ?? readServerRegime)();
        const side = callDirection(read);
        const day: DayCall = {
          forDate: target,
          side,
          noCallReason: side ? null : read.label === "UNAVAILABLE" ? "unavailable" : "dead_even",
          regimeLabel: read.label,
          votes: read.because.map((b) => ({ input: b.input, vote: b.vote })),
          createdAt: now,
          settle: null,
        };
        const took = await kv.set(K.day(target), day, { nx: true, ex: DAY_TTL_S });
        if (took !== null) {
          await kv.set(K.active, target, { ex: DAY_TTL_S });
          generated = side ?? "no_call";
        }
        // refresh the thesis at the pass (flip-guarded — usually a cache hit)
        await getThesis(read, { kv, gen: deps?.thesisGen, now });
      }
    }
  } catch (err) {
    console.warn("[call] generate step failed:", err instanceof Error ? err.message : err);
  }

  return { configured: true, settled, generated };
}

// --- read state (GET) + take (POST) ----------------------------------------

export type CallState = {
  configured: boolean;
  now: number;
  record: { august: CallTally; you: CallTally };
  active: {
    forDate: string;
    side: CallSide;
    lockTs: number;
    locked: boolean;
    youSide: CallSide | null;
    thesis: string | null;
  } | null;
  noCall: { reason: "no_session" | "dead_even" | "unavailable" | "not_generated"; nextDate: string } | null;
  settled: {
    forDate: string;
    side: CallSide;
    result: CallResult;
    closePct: number | null;
    augustWin: boolean | null;
    youSide: CallSide | null;
    youWin: boolean | null;
    disagree: string | null;
  } | null;
};

/** FIRST-RUN bootstrap only — the cron pass is the canonical generator, and
 *  once it has ever run (an active pointer or a settled date exists) reads
 *  never generate. Even on a truly fresh instance the bootstrap fills ONLY a
 *  still-takeable weekday morning ("today's call"); weekends and post-lock
 *  hours generate nothing — a Saturday GET must show NO SESSION, not open
 *  Monday's call early (that's Sunday's pass). */
async function ensureBootstrapped(
  kv: CallKv,
  now: number,
  readRegime: () => Promise<RegimeRead>,
): Promise<void> {
  const [activeRaw, lastRaw] = await Promise.all([kv.get(K.active), kv.get(K.lastSettled)]);
  if (typeof activeRaw === "string" || typeof lastRaw === "string") return; // the pass owns the loop
  const today = etDate(new Date(now));
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6 || !canTake(today, now)) return;
  const target = today;
  const read = await readRegime();
  const side = callDirection(read);
  const day: DayCall = {
    forDate: target,
    side,
    noCallReason: side ? null : read.label === "UNAVAILABLE" ? "unavailable" : "dead_even",
    regimeLabel: read.label,
    votes: read.because.map((b) => ({ input: b.input, vote: b.vote })),
    createdAt: now,
    settle: null,
  };
  const took = await kv.set(K.day(target), day, { nx: true, ex: DAY_TTL_S });
  if (took !== null) await kv.set(K.active, target, { ex: DAY_TTL_S });
}

export async function readCallState(
  cid: string | null,
  opts?: {
    kv?: CallKv | null;
    now?: number;
    thesisGen?: ThesisGen;
    readRegime?: () => Promise<RegimeRead>;
  },
): Promise<CallState> {
  const kv = opts?.kv !== undefined ? opts.kv : defaultKv();
  const now = opts?.now ?? Date.now();
  const empty: CallState = {
    configured: kv !== null,
    now,
    record: { august: { ...EMPTY_TALLY }, you: { ...EMPTY_TALLY } },
    active: null,
    noCall: null,
    settled: null,
  };
  if (!kv) return empty;
  const today = etDate(new Date(now));

  try {
    await ensureBootstrapped(kv, now, opts?.readRegime ?? readServerRegime);
  } catch {
    /* bootstrap is best-effort — reads must still serve */
  }

  const state = { ...empty };
  try {
    const [augRaw, youRaw, activeRaw, lastRaw] = await Promise.all([
      kv.get(K.rec("august")),
      cid ? kv.get(K.rec(cid)) : Promise.resolve(null),
      kv.get(K.active),
      kv.get(K.lastSettled),
    ]);
    state.record.august = asTally(augRaw);
    state.record.you = asTally(youRaw);

    const activeDate = typeof activeRaw === "string" ? activeRaw : null;
    const day = activeDate ? asDayCall(await kv.get(K.day(activeDate))) : null;

    if (day && !day.settle && day.side) {
      const take = cid ? ((await kv.get(K.take(day.forDate, cid))) as { side?: unknown } | null) : null;
      const youSide = take?.side === "HIGHER" || take?.side === "LOWER" ? (take.side as CallSide) : null;
      // the thesis rides the card — regime read is 60s-cached; model only on flip
      let thesis: string | null = null;
      try {
        thesis = await getThesis(await (opts?.readRegime ?? readServerRegime)(), {
          kv,
          gen: opts?.thesisGen,
          now,
        });
      } catch {
        thesis = null;
      }
      state.active = {
        forDate: day.forDate,
        side: day.side,
        lockTs: lockTs(day.forDate),
        locked: !canTake(day.forDate, now),
        youSide,
        thesis,
      };
    } else if (day && !day.settle && day.side === null && day.forDate >= today) {
      state.noCall = { reason: day.noCallReason ?? "dead_even", nextDate: nextWeekday(day.forDate) };
    }

    // the most recent settle stays on the card through its own ET day
    const lastDate = typeof lastRaw === "string" ? lastRaw : null;
    const sday = lastDate ? asDayCall(await kv.get(K.day(lastDate))) : null;
    if (sday?.settle && sday.side && etDate(new Date(sday.settle.settledAt)) === today) {
      const take = cid ? ((await kv.get(K.take(sday.forDate, cid))) as { side?: unknown } | null) : null;
      const youSide = take?.side === "HIGHER" || take?.side === "LOWER" ? (take.side as CallSide) : null;
      const youWin =
        youSide === null || sday.settle.result === "FLAT" || sday.settle.result === "NO_SESSION"
          ? null
          : youSide === sday.settle.result;
      state.settled = {
        forDate: sday.forDate,
        side: sday.side,
        result: sday.settle.result,
        closePct: sday.settle.closePct,
        augustWin: sday.settle.augustWin,
        youSide,
        youWin,
        disagree: disagreeLine(sday.votes, sday.settle.result, sday.settle.augustWin, youWin),
      };
    }

    // nothing active, nothing declined → the honest gap state. "NO SESSION"
    // is ONLY ever asserted on a weekend — a weekday gap (missed pass, failed
    // generation) says the CALL is absent, never that the market is closed.
    if (!state.active && !state.noCall) {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) {
        state.noCall = { reason: "no_session", nextDate: nextWeekday(today) };
      } else if (!state.settled) {
        state.noCall = { reason: "not_generated", nextDate: nextWeekday(today) };
      }
    }
  } catch (err) {
    console.warn("[call] read failed:", err instanceof Error ? err.message : err);
  }
  return state;
}

export type TakeResult =
  | { ok: true }
  | {
      ok: false;
      error: "not_configured" | "no_active_call" | "locked" | "already_taken" | "bad_side" | "call_full";
    };

/** POST core — one take per identity per trading day, refused after lock. */
export async function takeSide(
  cid: string,
  side: unknown,
  opts?: { kv?: CallKv | null; now?: number },
): Promise<TakeResult> {
  if (side !== "HIGHER" && side !== "LOWER") return { ok: false, error: "bad_side" };
  const kv = opts?.kv !== undefined ? opts.kv : defaultKv();
  if (!kv) return { ok: false, error: "not_configured" };
  const now = opts?.now ?? Date.now();
  const activeRaw = await kv.get(K.active);
  const activeDate = typeof activeRaw === "string" ? activeRaw : null;
  const day = activeDate ? asDayCall(await kv.get(K.day(activeDate))) : null;
  if (!day || day.settle || !day.side) return { ok: false, error: "no_active_call" };
  if (!canTake(day.forDate, now)) return { ok: false, error: "locked" };
  // bound the day's takers — minted visitor cookies must not grow the settle
  // fold loop past the cron budget
  const count = Number(await kv.scard(K.takers(day.forDate)).catch(() => 0)) || 0;
  if (count >= TAKERS_CAP) return { ok: false, error: "call_full" };
  const took = await kv.set(K.take(day.forDate, cid), { side, at: now }, { nx: true, ex: TAKE_TTL_S });
  if (took === null) return { ok: false, error: "already_taken" };
  await kv.sadd(K.takers(day.forDate), cid);
  await kv.expire(K.takers(day.forDate), TAKE_TTL_S);
  return { ok: true };
}

// --- AUTH-1a claim (wired into lib/claim.ts beside claimPitPlayer) ----------

/** Fold a visitor's call identity into the account's: records sum, and every
 *  RECENT UNSETTLED take moves (not just the active date — a bars-lag day's
 *  take must follow the account too, or its outcome folds into a dead
 *  visitor tally). NX-guarded so concurrent/repeat claims can never
 *  double-add (the summing merge, unlike the Pit's best-of, is farmable
 *  without it). One-way, best-effort — mirrors claimPitPlayer's contract. */
export async function claimCallRecord(fromCid: string, toCid: string): Promise<boolean> {
  const kv = defaultKv();
  if (!kv || fromCid === toCid) return false;
  try {
    const marker = await kv.set(K.claimed(fromCid), toCid, { nx: true });
    if (marker === null) return true; // this device already claimed — never re-add
    const from = asTally(await kv.get(K.rec(fromCid)));
    if (from.wins || from.losses || from.pushes) {
      const to = asTally(await kv.get(K.rec(toCid)));
      await kv.set(K.rec(toCid), {
        wins: to.wins + from.wins,
        losses: to.losses + from.losses,
        pushes: to.pushes + from.pushes,
      });
    }
    await kv.del(K.rec(fromCid));

    // move takes on every recent day that hasn't settled yet — the window is
    // tomorrow (the active call's latest possible date) back 14 days
    const dates: string[] = [];
    const base = new Date(`${etDate()}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + 1);
    for (let i = 0; i < 15; i++) {
      dates.push(base.toISOString().slice(0, 10));
      base.setUTCDate(base.getUTCDate() - 1);
    }
    for (const date of dates) {
      const day = asDayCall(await kv.get(K.day(date)));
      if (!day || !day.side || day.settle) continue;
      const fromTake = await kv.get(K.take(date, fromCid));
      if (!fromTake) continue;
      const took = await kv.set(K.take(date, toCid), fromTake, { nx: true, ex: TAKE_TTL_S });
      if (took !== null) {
        await kv.sadd(K.takers(date), toCid);
        await kv.expire(K.takers(date), TAKE_TTL_S);
      }
      await kv.del(K.take(date, fromCid));
      await kv.srem(K.takers(date), fromCid);
    }
    return true;
  } catch {
    return false;
  }
}
