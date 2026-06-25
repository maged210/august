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
  | "chat"
  | "speak"
  | "intel"
  | "memory"
  | "inbox"
  | "brief"
  | "token"
  | "push"
  | "day"
  | "draft"
  | "commsSend"
  | "watchers";

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
  push: 20,   // Web Push subscribe — unauthenticated POST, so bound it per IP
  day: 30,    // Google Calendar today-view — server-cached, Presence polls it
  draft: 15,  // AUGUST drafts a reply — an Anthropic call per draft
  commsSend: 10, // Gmail send — tight: each send dispatches real mail
  watchers: 10, // Watchers cron — an external ~15min pinger is far under this
};

const _limiters = new Map<RouteKey, Ratelimit>();

function getLimiter(key: RouteKey): Ratelimit {
  if (!_limiters.has(key)) {
    _limiters.set(
      key,
      new Ratelimit({
        redis: getRedis(),
        limiter: Ratelimit.slidingWindow(LIMITS[key], "60 s"),
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
