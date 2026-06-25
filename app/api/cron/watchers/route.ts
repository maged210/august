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
import { checkWatchers } from "@/lib/watchers";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // feed fetches across N watchers can take a few seconds

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
    const result = await checkWatchers();
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
