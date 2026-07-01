// Idea Tracker — the scheduled snapshot pass. PROTECTED. An external pinger
// (QStash / cron-job.org / Vercel Cron) hits this every ~10–15 min during
// market hours: it ingests the latest brief's ideas into the tracked set,
// batches quotes, evaluates honest lifecycle transitions (ARMED → TRIGGERED →
// TARGET_HIT/INVALIDATED), appends bounded snapshots, and updates MFE/MAE.
// Idempotent and cheap — snapshot dedupe + throttling make double-pings no-ops.
//
// AUTH: identical model to /api/cron/watchers — `Authorization: Bearer
// <CRON_SECRET>`, timing-safe compare, refuses in production when unset.
import { timingSafeEqual } from "node:crypto";
import { runTrackerPass } from "@/lib/intel/trackerStore";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // quote batch across N tickers can take a few seconds

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

  const rl = await checkRateLimit("intel-track", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  try {
    const result = await runTrackerPass({ force: true });
    console.log(
      `[cron/intel-track] configured=${result.configured} tracked=${result.tracked.length} quoted=${result.quoted ?? 0} transitions=${result.transitions ?? 0}`,
    );
    // Do NOT echo the full tracked set to the pinger — summary only.
    return new Response(
      JSON.stringify({
        ok: true,
        configured: result.configured,
        tracked: result.tracked.length,
        ingested: result.ingested ?? null,
        quoted: result.quoted ?? 0,
        transitions: result.transitions ?? 0,
        evicted: result.evicted ?? 0,
      }),
      { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "pass_failed";
    console.error("[cron/intel-track]", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const GET = handle;
export const POST = handle;
