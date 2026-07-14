// Watchers — the scheduled check. PROTECTED. An external pinger (QStash, cron-job.org,
// or Vercel Cron) hits this every ~15 min; it loads active watchers, evaluates each
// against CURRENT feed data (reusing the existing markets/USGS/RSS fetchers), and fires
// ONE push per trip, then moves the watcher to cooldown. Cheap + safe to call
// repeatedly — cooldown + cursor state prevent double-fires, and quiet hours are a
// no-op tick. The scheduler itself is wired separately (after deploy).
//
// AUTH: same model as /api/cron/brief — require `Authorization: Bearer <CRON_SECRET>`.
// Vercel Cron injects it automatically; an external pinger sends it as a custom header.
// (A QStash signature could be added here as an alternative; the secret header is the
// simplest protection and matches the brief cron.) Accepts GET and POST so any pinger
// works. In production with no secret set, the route refuses — never left open.
import { timingSafeEqual } from "node:crypto";
import { authConfigured } from "@/auth";
import { checkWatchers, type CheckResult } from "@/lib/watchers";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { listKnownUsers } from "@/lib/user-scope";

// MULTI-USER (stage 2): with auth unconfigured this checks the ONE legacy
// watcher store exactly as before. With auth configured it iterates the known
// users' stores sequentially (capped; the feed fetchers share in-process TTL
// caches, so extra users cost Redis reads, not repeat feed hits) and pushes
// each trip only to the owning user's devices.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // feed fetches across N watchers can take a few seconds

const MAX_WATCHER_USERS = 25;

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (!tokensMatch(auth, `Bearer ${secret}`)) {
      return new Response("Unauthorized", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return new Response("CRON_SECRET not configured", { status: 503 });
  }

  const rl = await checkRateLimit("watchers", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  try {
    let result: CheckResult;
    if (!authConfigured) {
      // Single-user fallback: the legacy store, unchanged.
      result = await checkWatchers(null);
    } else {
      const users = (await listKnownUsers()).slice(0, MAX_WATCHER_USERS);
      result = { checked: 0, fired: 0, details: [] };
      if (!users.length) result.skipped = "no_users";
      for (const email of users) {
        const r = await checkWatchers(email);
        result.checked += r.checked;
        result.fired += r.fired;
        result.details.push(...r.details.map((d) => `${email}: ${d}`));
        if (r.skipped === "quiet_hours") {
          // Quiet hours are global (one ET clock) — no point looping on.
          result.skipped = "quiet_hours";
          break;
        }
      }
    }
    console.log(
      `[cron/watchers] checked=${result.checked} fired=${result.fired}${result.skipped ? ` skipped=${result.skipped}` : ""}`,
    );
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "check_failed";
    console.error("[cron/watchers]", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const GET = handle;
export const POST = handle;
