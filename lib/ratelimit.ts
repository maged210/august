// Per-IP sliding-window rate limiting via Upstash Redis + @upstash/ratelimit.
//
// Design:
//   - Skip entirely (fail-open, no log) when Upstash env vars are absent —
//     covers local dev without requiring Upstash configuration.
//   - One Redis connection shared across all limiters (lazy singleton).
//   - Separate Ratelimit instances per route so prefixed keys never collide.
//   - Fail-open on ANY runtime error: a broken limiter must never 500 the app.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Checked once at module load — avoids touching Redis at all when unconfigured.
const CONFIGURED =
  typeof process.env.UPSTASH_REDIS_REST_URL === "string" &&
  process.env.UPSTASH_REDIS_REST_URL.length > 0 &&
  typeof process.env.UPSTASH_REDIS_REST_TOKEN === "string" &&
  process.env.UPSTASH_REDIS_REST_TOKEN.length > 0;

let _redis: Redis | null = null;
function getRedis(): Redis {
  // Called only when CONFIGURED is true, so env vars are present.
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

type RouteKey =
  | "chat" | "speak" | "intel" | "memory" | "inbox" | "brief" | "token"
  | "intelMutate" | "intelProcess" | "intelAsk" | "intelRole" | "intelFeed"
  | "push" | "day" | "draft" | "commsSend" | "watchers" | "intel-track"
  | "threads" | "watchlist" | "feeds" | "ideas" | "admin" | "transcripts"
  | "bars" | "tape" | "wire" | "headlines" | "pit" | "account";

// Sliding-window limits per route, per IP, per 60 seconds.
const LIMITS: Record<RouteKey, number> = {
  chat: 10,   // Anthropic tokens — most expensive
  speak: 40,  // ElevenLabs quota — raised for per-sentence voice pipelining (≈2-4 short
              // calls per spoken turn instead of 1); still bounds runaway cost
  intel: 30,  // Anthropic synthesis but heavily cached, generous
  memory: 20, // Upstash writes + occasional Anthropic summarisation
  inbox: 20,  // Gmail API quota — read-only, server-cached
  brief: 6,   // on-demand morning-brief compile — multi-organ fetch + Anthropic, tight
  token: 30,  // Deepgram STT grant-token mint — cheap, one per voice session/~2min, generous
  intelMutate: 30, // Market Intel CRUD (sources/settings/sync) — cheap
  intelProcess: 8, // transcript extraction / brief generation — multi Anthropic calls, tight
  intelAsk: 20,    // Ask-AUGUST retrieval over processed videos
  intelRole: 30,   // owner/auth signal — one cheap session read per page load
  intelFeed: 30,   // public published-ideas feed — served from a 45s cache
  push: 20,   // Web Push subscribe — unauthenticated POST, so bound it per IP
  day: 30,    // Google Calendar today-view — server-cached, Presence polls it
  draft: 15,  // AUGUST drafts a reply — an Anthropic call per draft
  commsSend: 10, // Gmail send — tight: each send dispatches real mail
  watchers: 10, // Watchers cron — an external ~15min pinger is far under this
  "intel-track": 10, // Idea Tracker cron — same external-pinger profile as watchers
  threads: 30, // conversation persistence — one background POST per completed reply
  watchlist: 30, // per-user watchlist reads/writes — cheap Redis ops
  feeds: 30,  // per-user feed prefs + onboarded flag — cheap Redis ops
  ideas: 30,  // public trade-ideas rail — cheap Redis read, 60s client poll
  admin: 30,  // admin ideas CRUD — token/owner-gated, cheap Redis ops
  transcripts: 8, // transcript extraction — an Anthropic call per POST, tight (intelProcess profile)
  bars: 30,   // chart-dock daily candles — Yahoo fetch behind a 5min server cache
  tape: 30,   // public desk-tape read — cheap Redis, dock polls ~60s
  wire: 30,   // public desk-wire ingest log — redacted counts, cheap Redis
  headlines: 30, // home-brief RSS headlines — 15min in-process cache upstream
  pit: 30, // THE PIT arcade — state read + one score submit per run
  account: 6, // AUTH-1a — claim migration; one real call per device ever
};

/** Positive integer from env, else the fallback. 0/garbage → fallback. */
function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Per-route limit — the chat route (real Anthropic spend on anonymous
 *  traffic) is env-tunable without a deploy: CHAT_RATE_PER_MIN. */
function limitFor(key: RouteKey): number {
  if (key === "chat") return envInt("CHAT_RATE_PER_MIN", LIMITS.chat);
  return LIMITS[key];
}

const _limiters = new Map<RouteKey, Ratelimit>();

function getLimiter(key: RouteKey): Ratelimit {
  if (!_limiters.has(key)) {
    _limiters.set(
      key,
      new Ratelimit({
        redis: getRedis(),
        limiter: Ratelimit.slidingWindow(limitFor(key), "60 s"),
        prefix: `rl:aug:${key}`,
        analytics: false,
      }),
    );
  }
  return _limiters.get(key)!;
}

// Extract the real client IP — always returns a non-empty string.
export function getIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") || "local";
}

export type RateLimitResult = { ok: true } | { ok: false; reset: number };

export async function checkRateLimit(
  key: RouteKey,
  identifier: string,
): Promise<RateLimitResult> {
  // Not configured (dev without Upstash) — pass through silently.
  if (!CONFIGURED) return { ok: true };

  // Guarantee a non-empty identifier; the limiter rejects empty strings.
  const id = identifier.trim() || "local";

  try {
    const { success, reset } = await getLimiter(key).limit(id);
    if (!success) return { ok: false, reset };
    return { ok: true };
  } catch (err) {
    // Fail open — Redis outage, network error, or misconfiguration must
    // never propagate as a 500 to the client.
    console.warn("[ratelimit] failing open:", (err as Error).message);
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Global daily chat budget (HOTFIX 2026-08-12) — the per-IP window bounds one
// visitor; this bounds the WHOLE DAY across all visitors, because /api/chat
// spends real Anthropic money on anonymous traffic. Env-tunable without a
// deploy: CHAT_DAILY_CAP (default 400 turns/day; set 0/unset for the default —
// there is deliberately no "off" value). Fail-open on Redis errors, same
// contract as the sliding window above.
// ---------------------------------------------------------------------------

export const CHAT_DAILY_CAP_DEFAULT = 400;

export async function checkChatDailyCap(): Promise<{ ok: boolean }> {
  if (!CONFIGURED) return { ok: true };
  const cap = envInt("CHAT_DAILY_CAP", CHAT_DAILY_CAP_DEFAULT);
  try {
    const day = new Date().toISOString().slice(0, 10); // UTC day bucket
    const key = `rl:aug:chat:daily:${day}`;
    const redis = getRedis();
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 90_000); // ~25h — outlives the bucket
    return { ok: n <= cap };
  } catch (err) {
    console.warn("[ratelimit] daily cap failing open:", (err as Error).message);
    return { ok: true };
  }
}

export function dailyCapResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "daily_budget",
      message: "AUGUST has hit today's conversation budget — back tomorrow.",
    }),
    { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "3600" } },
  );
}

export function rateLimitedResponse(reset: number): Response {
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: "Easy — too many requests. Give it a second.",
      reset,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    },
  );
}
