// THE PIT (GAME-2 — arcade). SIMULATED ONLY, permanently labeled. One run =
// one synthetic trading day (~75s), seeded daily so everyone plays the same
// tape. This lib holds the identity + boards; the tape/game logic is client-
// side (components/surfaces/PitSurface.tsx) — the server only validates and
// records run results. Player ids stay PRINCIPAL-SHAPED for AUTH-1:
//   v:{visitorId} anonymous (today) · u:{email} account (claim = copy+repoint)

import { Redis } from "@upstash/redis";
import type { StorePrincipal } from "./user-scope";

export type RunStats = {
  trades: number;
  wins: number;
  bestTrade: number; // best single-trade % move captured
  perfectDips: number;
};

export type PitPlayer = {
  pid: string;
  name: string;
  /** best run % of all time (equity gain vs start) */
  bestRun: number | null;
  bestRunDate: string | null;
  /** best run % on today's tape (ET date) */
  todayRun: number | null;
  todayDate: string | null;
  runs: number;
  lastStats?: RunStats;
  // GAME-3 — career progression (persists on the pid; AUTH-1 claimable)
  xp: number;
  level: number;
  /** best single-round PIT SCORE */
  bestRound: number | null;
  /** consecutive completed runs (reset by margin call) */
  runStreak: number;
  // GAME-5 — the season frame (records panel; claim-ready like everything else)
  /** furthest season position ever reached — the map's ghost mark */
  furthestWeek: number;
  furthestDay: number;
  /** best PIT RATING letter across ended runs */
  bestRating: string | null;
  /** best rank ever taken on a DAILY PIT board (1 = top) */
  bestDailyRank: number | null;
  /** consecutive ET dates with at least one daily attempt */
  dailyStreak: number;
  lastDailyDate: string | null;
  /** today's DAILY PIT state — resets when the date turns */
  daily?: { date: string; attempts: number; bestPct: number | null };
  /** AUTH-1a — the account's in-progress career run (client SavedRun blob),
   *  synced when signed in so a career follows the player across devices.
   *  The account's run wins; a device's unclaimed run is offered once. */
  activeRun?: unknown;
  activeRunAt?: number;
  /** TRAIN-1 — completed training-floor lessons ("L1".."L8"); claim merges
   *  as a union. All eight = the TRAINED badge. */
  training?: { done: string[] };
  createdAt: number;
  updatedAt: number;
};

// GAME-3 — level ladder (thresholds are cumulative XP)
export const LEVELS = [
  { level: 1, name: "ROOKIE", xp: 0 },
  { level: 2, name: "SCOUT", xp: 800 },
  { level: 3, name: "MOMENTUM", xp: 2200 },
  { level: 4, name: "VOLATILITY", xp: 4500 },
  { level: 5, name: "OPERATOR", xp: 8000 }, // L5+ reserved: options
] as const;

/** PURE. Level for a cumulative XP total. */
export function levelFor(xp: number): number {
  let lv = 1;
  for (const l of LEVELS) if (xp >= l.xp) lv = l.level;
  return lv;
}

/** PURE. Fold a completed ROUND into the player (score/xp clamped). */
export function applyRound(p: PitPlayer, score: number, xp: number): void {
  const s = Math.max(0, Math.min(50_000, Math.floor(score)));
  const x = Math.max(0, Math.min(2_000, Math.floor(xp)));
  p.xp = (p.xp ?? 0) + x;
  p.level = levelFor(p.xp);
  if (p.bestRound === null || p.bestRound === undefined || s > p.bestRound) p.bestRound = s;
}

export const MAX_NAME_CHARS = 16;
export const LEADERBOARD_SIZE = 20;
export const RUN_MIN_PCT = -100;
export const RUN_MAX_PCT = 500;

// --- pure helpers -------------------------------------------------------------

/** G4 — the principal-shaped player id (AUTH-1 claims v:→u: later). */
export function pidFor(p: StorePrincipal): string | null {
  if (typeof p === "string") return `u:${p}`;
  if (p && typeof p === "object") return `v:${p.visitorId}`;
  return process.env.NODE_ENV === "production" ? null : "v:dev-local";
}

const NAME_RE = /^[A-Za-z0-9 _.-]{2,16}$/;
const BLOCKED = /(fuck|shit|cunt|nigg|fag|rape|hitler)/i;

/** PURE. Validate a display name; null = rejected. */
export function validatePitName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (!NAME_RE.test(name) || BLOCKED.test(name)) return null;
  return name;
}

/** PURE. Clamp + validate a submitted run % (the server never trusts a score
 *  it can't bound — the tape maxes out well inside these rails). */
export function validateRunPct(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(RUN_MIN_PCT, Math.min(RUN_MAX_PCT, Math.round(n * 100) / 100));
}

/** PURE. Today's ET date — the daily tape seed and the daily board key. */
export function etDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return parts; // YYYY-MM-DD
}

// --- GAME-5: the DAILY PIT + season records (pure layer) -----------------------

export const DAILY_ATTEMPTS = 3;

/** PURE. The shared daily seed — every player, same date, same tape. */
export function dailySeed(date: string): number {
  let h = 7;
  for (const ch of date) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 99_989) + 11;
}

/** PURE. Yesterday's ET date string for streak math. */
export function prevDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** PURE. Attempts left on today's tape. */
export function dailyAttemptsLeft(p: PitPlayer, date: string): number {
  const used = p.daily?.date === date ? p.daily.attempts : 0;
  return Math.max(0, DAILY_ATTEMPTS - used);
}

/** PURE. Record a daily attempt: cap 3, keep best-of, roll the streak on the
 *  first attempt of each date. Returns null when out of attempts, else
 *  whether this attempt improved the posted best. */
export function applyDaily(p: PitPlayer, pct: number, date: string): { improved: boolean } | null {
  if (dailyAttemptsLeft(p, date) <= 0) return null;
  if (p.daily?.date !== date) {
    p.dailyStreak = p.lastDailyDate === prevDate(date) ? (p.dailyStreak ?? 0) + 1 : 1;
    p.lastDailyDate = date;
    p.daily = { date, attempts: 0, bestPct: null };
  }
  p.daily.attempts += 1;
  const improved = p.daily.bestPct === null || pct > p.daily.bestPct;
  if (improved) p.daily.bestPct = pct;
  return { improved };
}

/** PURE. Advance the furthest-reached ghost. True = FURTHEST YET moment. */
export function applyProgress(p: PitPlayer, week: number, day: number): boolean {
  const pos = week * 10 + day;
  const prev = (p.furthestWeek ?? 0) * 10 + (p.furthestDay ?? 0);
  if (pos <= prev) return false;
  p.furthestWeek = week;
  p.furthestDay = day;
  return true;
}

const RATING_ORDER = ["F", "D", "C", "B", "A", "A+"];
/** PURE. Keep the best rating letter across ended runs. */
export function betterRating(cur: string | null, next: string): string {
  if (!RATING_ORDER.includes(next)) return cur ?? next;
  if (cur === null || RATING_ORDER.indexOf(next) > RATING_ORDER.indexOf(cur)) return next;
  return cur;
}

// --- store ---------------------------------------------------------------------

const NS = "august:pit:v1";
const K = {
  player: (pid: string) => `${NS}:player:${pid}`,
  best: `${NS}:lb:best`,
  day: (date: string) => `${NS}:lb:day:${date}`,
};
const DAY_BOARD_TTL_S = 3 * 86_400;

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

export function pitConfigured(): boolean {
  return getRedis() !== null;
}

export function newPlayer(pid: string): PitPlayer {
  const now = Date.now();
  return {
    pid, name: "PLAYER", bestRun: null, bestRunDate: null,
    todayRun: null, todayDate: null, runs: 0,
    xp: 0, level: 1, bestRound: null, runStreak: 0,
    furthestWeek: 0, furthestDay: 0, bestRating: null, bestDailyRank: null,
    dailyStreak: 0, lastDailyDate: null,
    createdAt: now, updatedAt: now,
  };
}

export async function getPlayer(pid: string): Promise<PitPlayer | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<unknown>(K.player(pid));
    if (!raw) return null;
    const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as PitPlayer;
    if (typeof p?.pid !== "string") return null;
    // players written before GAME-5 lack the season fields — fill defaults
    return { ...newPlayer(p.pid), ...p };
  } catch {
    return null;
  }
}

export async function savePlayer(p: PitPlayer): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    p.updatedAt = Date.now();
    await redis.set(K.player(p.pid), JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

/** Record a finished CAREER run: bumps the player's all-time best and the
 *  all-time board. (The rotating day board belongs to the DAILY PIT now.) */
export async function recordRun(
  p: PitPlayer,
  pct: number,
  stats: RunStats,
  date: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  p.runs += 1;
  p.lastStats = stats;
  if (p.todayDate !== date || p.todayRun === null || pct > p.todayRun) {
    p.todayRun = pct;
    p.todayDate = date;
  }
  if (p.bestRun === null || pct > p.bestRun) {
    p.bestRun = pct;
    p.bestRunDate = date;
  }
  try {
    await savePlayer(p);
    await redis.zadd(K.best, { score: p.bestRun ?? pct, member: p.pid });
    return true;
  } catch {
    return false;
  }
}

/** DAILY PIT: post the player's best-of-day to the date's rotating board and
 *  return their current rank (1 = top), or null on store failure. */
export async function recordDailyScore(pid: string, bestPct: number, date: string): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const dayKey = K.day(date);
    await redis.zadd(dayKey, { score: bestPct, member: pid });
    await redis.expire(dayKey, DAY_BOARD_TTL_S);
    const rank = await redis.zrevrank(dayKey, pid);
    return typeof rank === "number" ? rank + 1 : null;
  } catch {
    return null;
  }
}

export type LeaderRow = { pid: string; name: string; pct: number };

async function board(key: string, limit: number): Promise<LeaderRow[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const rows = await redis.zrange<Array<string | number>>(key, 0, limit - 1, {
      rev: true,
      withScores: true,
    });
    const out: LeaderRow[] = [];
    for (let i = 0; i + 1 < rows.length; i += 2) {
      const pid = String(rows[i]);
      const pct = Number(rows[i + 1]);
      const p = await getPlayer(pid);
      out.push({ pid, name: p?.name ?? "PLAYER", pct: Math.round(pct * 100) / 100 });
    }
    return out;
  } catch {
    return [];
  }
}

export async function todayBoard(date: string, limit = LEADERBOARD_SIZE): Promise<LeaderRow[]> {
  return board(K.day(date), limit);
}

export async function bestBoard(limit = LEADERBOARD_SIZE): Promise<LeaderRow[]> {
  return board(K.best, limit);
}

/** PURE (AUTH-1a CLAIM). Best-of merge of two player records — records merge
 *  best-of, streaks keep the higher, XP takes the max (never summed: the two
 *  histories overlap in spirit, and max can't be farmed by re-claiming). */
export function mergePitPlayers(base: PitPlayer, absorb: PitPlayer): PitPlayer {
  const laterDaily =
    (absorb.daily?.date ?? "") > (base.daily?.date ?? "") ? absorb.daily : base.daily;
  const sameDay = absorb.daily?.date === base.daily?.date ? base.daily : undefined;
  const daily = sameDay && absorb.daily
    ? {
        date: sameDay.date,
        attempts: Math.min(DAILY_ATTEMPTS, Math.max(sameDay.attempts, absorb.daily.attempts)),
        bestPct: Math.max(sameDay.bestPct ?? -Infinity, absorb.daily.bestPct ?? -Infinity),
      }
    : laterDaily;
  const merged: PitPlayer = {
    ...base,
    name: base.name !== "PLAYER" ? base.name : absorb.name,
    bestRun: Math.max(base.bestRun ?? -Infinity, absorb.bestRun ?? -Infinity),
    bestRunDate:
      (base.bestRun ?? -Infinity) >= (absorb.bestRun ?? -Infinity) ? base.bestRunDate : absorb.bestRunDate,
    todayRun: Math.max(base.todayRun ?? -Infinity, absorb.todayRun ?? -Infinity),
    todayDate: base.todayDate ?? absorb.todayDate,
    runs: base.runs + absorb.runs,
    xp: Math.max(base.xp, absorb.xp),
    bestRound: Math.max(base.bestRound ?? -Infinity, absorb.bestRound ?? -Infinity),
    runStreak: Math.max(base.runStreak ?? 0, absorb.runStreak ?? 0),
    furthestWeek: 0,
    furthestDay: 0,
    bestRating: absorb.bestRating === null ? base.bestRating : betterRating(base.bestRating, absorb.bestRating),
    bestDailyRank:
      base.bestDailyRank === null ? absorb.bestDailyRank :
      absorb.bestDailyRank === null ? base.bestDailyRank :
      Math.min(base.bestDailyRank, absorb.bestDailyRank),
    dailyStreak: Math.max(base.dailyStreak ?? 0, absorb.dailyStreak ?? 0),
    lastDailyDate:
      (base.lastDailyDate ?? "") >= (absorb.lastDailyDate ?? "") ? base.lastDailyDate : absorb.lastDailyDate,
    ...(daily ? { daily: { ...daily, bestPct: daily.bestPct === -Infinity ? null : daily.bestPct } } : {}),
    // TRAIN-1 — lessons learned anywhere stay learned: union on claim
    ...(base.training || absorb.training
      ? { training: { done: [...new Set([...(base.training?.done ?? []), ...(absorb.training?.done ?? [])])].sort() } }
      : {}),
  };
  merged.level = levelFor(merged.xp);
  // ghost merges by furthest position, not per-field
  const basePos = (base.furthestWeek ?? 0) * 10 + (base.furthestDay ?? 0);
  const absorbPos = (absorb.furthestWeek ?? 0) * 10 + (absorb.furthestDay ?? 0);
  const win = basePos >= absorbPos ? base : absorb;
  merged.furthestWeek = win.furthestWeek ?? 0;
  merged.furthestDay = win.furthestDay ?? 0;
  const cleanNum = (v: number | null) => (v === null || v === -Infinity ? null : v);
  merged.bestRun = cleanNum(merged.bestRun);
  merged.todayRun = cleanNum(merged.todayRun);
  merged.bestRound = cleanNum(merged.bestRound);
  return merged;
}

/** CLAIM store op — fold the visitor's player into the account's and delete
 *  the visitor record; both boards repoint to the account pid (higher score
 *  wins). Safe when either record is missing. */
export async function claimPitPlayer(fromPid: string, toPid: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis || fromPid === toPid) return false;
  try {
    const [from, to] = await Promise.all([getPlayer(fromPid), getPlayer(toPid)]);
    if (!from) return true; // nothing to migrate — still a success
    const merged = { ...mergePitPlayers(to ?? newPlayer(toPid), from), pid: toPid };
    await savePlayer(merged);
    await redis.del(K.player(fromPid));
    for (const key of [K.best, K.day(etDate())]) {
      const [fs, ts] = await Promise.all([
        redis.zscore(key, fromPid),
        redis.zscore(key, toPid),
      ]);
      if (fs !== null && fs !== undefined) {
        const best = Math.max(Number(fs), ts === null || ts === undefined ? -Infinity : Number(ts));
        await redis.zadd(key, { score: best, member: toPid });
        await redis.zrem(key, fromPid);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** /admin backstop — reset a player's name (never deletes their record). */
export async function purgePlayerName(pid: string): Promise<boolean> {
  const p = await getPlayer(pid);
  if (!p) return false;
  p.name = "PLAYER";
  return savePlayer(p);
}

/** /admin list — top of the all-time board for the purge UI. */
export async function topPlayers(limit = 50): Promise<LeaderRow[]> {
  return bestBoard(limit);
}
