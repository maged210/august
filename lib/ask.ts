// THE ASK LANE (feature/command-bar) — normalization, per-identity cache
// keys, daily caps, and the console's ask-stats. Pure helpers up top,
// injectable-KV operations below (house pattern). The command lane never
// touches any of this: commands are deterministic and local by law.

export const ASK_CACHE_TTL_S = 600; // identical normalized asks: 10 minutes
export const ASK_CAP_ANON_DEFAULT = 20; // per anonymous identity per UTC day
export const ASK_CAP_USER_DEFAULT = 100; // per signed-in identity per UTC day
const STATS_TTL_S = 48 * 3600; // stats live two days — the console shows today

// --- pure --------------------------------------------------------------------

/** PURE. One canonical form per ask: case, whitespace, and trailing
 *  punctuation don't make a new question. */
export function normalizeAsk(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[?!.\s]+$/, "");
}

// FNV-1a 32-bit — same tiny digest the calendar ask-cache uses.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** PURE. The cache is PER IDENTITY — the grounding includes the caller's own
 *  memory section, so a shared entry would leak one identity's context into
 *  another's answer (the calendarAsk lesson, kept). */
export function askCacheKey(cid: string, text: string): string {
  return `aug:ask:v1:${cid}:${fnv1a(normalizeAsk(text))}`;
}

/** PURE. The day's ask cap for an identity: signed-in accounts get the larger
 *  budget; both env-tunable without a deploy. */
export function askCapFor(
  cid: string,
  env: { anon?: string; user?: string } = { anon: process.env.ASK_CAP_ANON, user: process.env.ASK_CAP_USER },
): number {
  const parse = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return cid.startsWith("u:")
    ? parse(env.user, ASK_CAP_USER_DEFAULT)
    : parse(env.anon, ASK_CAP_ANON_DEFAULT);
}

export const utcDay = (now: number = Date.now()) => new Date(now).toISOString().slice(0, 10);

const CAP_KEY = (day: string, cid: string) => `aug:askcap:v1:${day}:${cid}`;
const STATS_KEY = (day: string) => `aug:askstats:v1:${day}`;
const TOP_KEY = (day: string) => `aug:askstats:v1:top:${day}`;

// --- KV operations (injectable) ---------------------------------------------

export type AskKv = {
  incr(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
  hincrby(key: string, field: string, by: number): Promise<unknown>;
  zincrby(key: string, by: number, member: string): Promise<unknown>;
  hgetall(key: string): Promise<unknown>;
  zrange(key: string, start: number, stop: number, opts?: { rev?: boolean; withScores?: boolean }): Promise<unknown>;
};

/** Count one MODEL-BOUND ask against the identity's day cap. Cache hits are
 *  deliberately NOT counted — a repeat that spends nothing costs nothing.
 *  Returns whether this ask is allowed (the increment that crosses the cap is
 *  still stored, so the count stays honest). Fail-open on KV errors. */
export async function takeAskBudget(
  kv: AskKv,
  cid: string,
  cap: number,
  now: number = Date.now(),
): Promise<{ allowed: boolean; used: number }> {
  try {
    const key = CAP_KEY(utcDay(now), cid);
    const used = Number(await kv.incr(key)) || 0;
    if (used === 1) await kv.expire(key, 90_000); // ~25h, outlives the bucket
    return { allowed: used <= cap, used };
  } catch {
    return { allowed: true, used: 0 };
  }
}

/** Record an ask for the console's stats: total, cache hits, per-identity. */
export async function recordAskStat(
  kv: AskKv,
  cid: string,
  kind: "model" | "cache",
  now: number = Date.now(),
): Promise<void> {
  try {
    const day = utcDay(now);
    await kv.hincrby(STATS_KEY(day), "asks", 1);
    if (kind === "cache") await kv.hincrby(STATS_KEY(day), "cacheHits", 1);
    await kv.zincrby(TOP_KEY(day), 1, cid);
    await kv.expire(STATS_KEY(day), STATS_TTL_S);
    await kv.expire(TOP_KEY(day), STATS_TTL_S);
  } catch {
    /* stats are best-effort */
  }
}

export type AskStats = {
  asks: number;
  cacheHits: number;
  top: Array<{ cid: string; asks: number }>;
};

/** Today's numbers for the owner console: asks · cache hits · top 5. */
export async function readAskStats(kv: AskKv, now: number = Date.now()): Promise<AskStats> {
  const empty: AskStats = { asks: 0, cacheHits: 0, top: [] };
  try {
    const day = utcDay(now);
    const h = (await kv.hgetall(STATS_KEY(day))) as Record<string, unknown> | null;
    const z = (await kv.zrange(TOP_KEY(day), 0, 4, { rev: true, withScores: true })) as unknown[];
    const top: Array<{ cid: string; asks: number }> = [];
    for (let i = 0; i + 1 < (z?.length ?? 0); i += 2) {
      top.push({ cid: String(z[i]), asks: Number(z[i + 1]) || 0 });
    }
    return {
      asks: Number(h?.asks) || 0,
      cacheHits: Number(h?.cacheHits) || 0,
      top,
    };
  } catch {
    return empty;
  }
}
