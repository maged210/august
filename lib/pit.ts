// THE PIT (GAME-1) — visitors play against the desk. SIMULATED ONLY: every
// number here derives from stores that already exist (live ideas, the tracked
// feed's since-call %, the quote pipeline). Zero new data sources, no real
// orders, entertainment only — the UI carries that label permanently.
//
// House store pattern: pure, node:test-friendly helpers up top; lazy
// best-effort Redis below. Player ids are PRINCIPAL-SHAPED for AUTH-1:
//   v:{visitorId}  anonymous player (today)
//   u:{email}      account player (later — claiming = copy v:→u:, repoint)

import { Redis } from "@upstash/redis";
import type { StorePrincipal } from "./user-scope";

export type PickSide = "ride" | "fade";
export type PickStatus = "open" | "scored" | "push";

export type PitPick = {
  ideaId: string;
  ticker: string;
  side: PickSide;
  at: number;
  status: PickStatus;
  /** signed % credited to the player (scored only) */
  pct?: number;
};

export type DailyPick = { sym: string; dir: "over" | "under"; line: number };
export type PitDaily = {
  /** ET date this card belongs to */
  date: string;
  picks: DailyPick[];
  resolved?: boolean;
  /** per-pick outcome, same order as picks (scored on resolve) */
  results?: boolean[];
};

export type PitPlayer = {
  pid: string;
  name: string;
  score: number; // cumulative signed %
  wins: number;
  losses: number;
  pushes: number;
  streak: number; // current win streak across BOTH modes
  bestStreak: number;
  picks: PitPick[]; // newest first, capped
  daily?: PitDaily;
  createdAt: number;
  updatedAt: number;
};

export const MAX_PICK_HISTORY = 100;
export const MAX_NAME_CHARS = 16;
export const LEADERBOARD_SIZE = 20;

// --- pure helpers -------------------------------------------------------------

/** G4 — the principal-shaped player id (AUTH-1 claims v:→u: later). */
export function pidFor(p: StorePrincipal): string | null {
  if (typeof p === "string") return `u:${p}`;
  if (p && typeof p === "object") return `v:${p.visitorId}`;
  // legacy dev fallback plays as a fixed local player
  return process.env.NODE_ENV === "production" ? null : "v:dev-local";
}

const NAME_RE = /^[A-Za-z0-9 _.-]{2,16}$/;
// a deliberately small serverside list — the client filters more; the owner
// purge from /admin is the real backstop
const BLOCKED = /(fuck|shit|cunt|nigg|fag|rape|hitler)/i;

/** PURE. Validate a display name; null = rejected. */
export function validatePitName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (!NAME_RE.test(name) || BLOCKED.test(name)) return null;
  return name;
}

/** PURE. Score one pick from the desk's own since-call % (fade inverts). */
export function scorePick(side: PickSide, deskPct: number): number {
  return side === "ride" ? deskPct : -deskPct;
}

/** PURE. Previous close derived from the existing quote (price + day %). */
export function prevCloseOf(price: number, chgPct: number): number | null {
  const d = 1 + chgPct / 100;
  if (!Number.isFinite(price) || !Number.isFinite(d) || d === 0) return null;
  return price / d;
}

/** PURE. ET clock pieces for the daily card (lock at the 09:30 open). */
export function etNow(now: Date = new Date()): { date: string; mins: number; weekend: boolean } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "numeric", hour12: false, weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    mins: parseInt(get("hour") || "0", 10) * 60 + parseInt(get("minute") || "0", 10),
    weekend: get("weekday") === "Sat" || get("weekday") === "Sun",
  };
}
export const DAILY_LOCK_MINS = 9 * 60 + 30; // 09:30 ET
export const DAILY_RESOLVE_MINS = 16 * 60; // 16:00 ET

/** PURE. The daily card's target session + lock state. Picks are open any
 *  time the market ISN'T in session: pre-open picks play today; after-close
 *  and weekend picks play the NEXT trading day (line = latest close). */
export function dailyCard(now: Date = new Date()): { date: string; locked: boolean } {
  const t = etNow(now);
  const inSession = !t.weekend && t.mins >= DAILY_LOCK_MINS && t.mins < DAILY_RESOLVE_MINS;
  if (inSession) return { date: t.date, locked: true };
  if (!t.weekend && t.mins < DAILY_LOCK_MINS) return { date: t.date, locked: false };
  // after close / weekend → next weekday (ET)
  const d = new Date(now);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (etNow(d).weekend);
  return { date: etNow(d).date, locked: false };
}

/** G6 — the AUTH-1 tier hook: which live ideas may this player play?
 *  Hardcoded ALL OPEN until tiers exist. */
export function pitVisibleIdeas<T>(ideas: T[]): T[] {
  return ideas;
}

/** PURE. Fold a resolved outcome into the player's tallies. */
export function applyOutcome(p: PitPlayer, pct: number): void {
  p.score = Math.round((p.score + pct) * 100) / 100;
  if (pct > 0) {
    p.wins += 1;
    p.streak += 1;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
  } else if (pct < 0) {
    p.losses += 1;
    p.streak = 0;
  } else {
    p.pushes += 1;
  }
}

// --- store ---------------------------------------------------------------------

const NS = "august:pit:v1";
const K = {
  player: (pid: string) => `${NS}:player:${pid}`,
  lb: `${NS}:lb`,
};

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

export function newPlayer(pid: string): PitPlayer {
  const now = Date.now();
  return {
    pid, name: "PLAYER", score: 0, wins: 0, losses: 0, pushes: 0,
    streak: 0, bestStreak: 0, picks: [], createdAt: now, updatedAt: now,
  };
}

export async function savePlayer(p: PitPlayer): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    p.updatedAt = Date.now();
    p.picks = p.picks.slice(0, MAX_PICK_HISTORY);
    await redis.set(K.player(p.pid), JSON.stringify(p));
    await redis.zadd(K.lb, { score: p.score, member: p.pid });
    return true;
  } catch {
    return false;
  }
}

export type LeaderRow = { pid: string; name: string; score: number; streak: number };

export async function topPlayers(limit = LEADERBOARD_SIZE): Promise<LeaderRow[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const pids = await redis.zrange<string[]>(K.lb, 0, limit - 1, { rev: true });
    if (!pids?.length) return [];
    const players = await Promise.all(pids.map((id) => getPlayer(id)));
    return players
      .filter((p): p is PitPlayer => p !== null)
      .map((p) => ({ pid: p.pid, name: p.name, score: p.score, streak: p.streak }));
  } catch {
    return [];
  }
}

/** /admin backstop — reset a player's name (never deletes their record). */
export async function purgePlayerName(pid: string): Promise<boolean> {
  const p = await getPlayer(pid);
  if (!p) return false;
  p.name = "PLAYER";
  return savePlayer(p);
}
