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
  createdAt: number;
  updatedAt: number;
};

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
    todayRun: null, todayDate: null, runs: 0, createdAt: now, updatedAt: now,
  };
}

export async function getPlayer(pid: string): Promise<PitPlayer | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<unknown>(K.player(pid));
    if (!raw) return null;
    const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as PitPlayer;
    return typeof p?.pid === "string" ? p : null;
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

/** Record a finished run: bumps the player's today/all-time bests and both
 *  boards (day board expires after a few days — it's a rotating sheet). */
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
    const dayKey = K.day(date);
    await redis.zadd(dayKey, { score: p.todayRun ?? pct, member: p.pid });
    await redis.expire(dayKey, DAY_BOARD_TTL_S);
    return true;
  } catch {
    return false;
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
