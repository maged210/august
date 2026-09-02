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
import { backfillPrintedWeek } from "@/lib/calendar-actuals";
import { runCallPass } from "@/lib/call";
import { flushCallPush, registerCallPush } from "@/lib/call-push";
import { runBookPass } from "@/lib/ideas-eval";
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
    // INTEGRITY-1 — the published book (lib/ideas.ts) is evaluated in the SAME
    // daily pass: every LIVE idea's stated trigger vs the daily close, stale
    // marking, and conflict demotion to REVIEW. See lib/ideas-eval.ts.
    const book = await runBookPass();
    // fix/whats-coming — the daily pass also warms the FRED actuals cache for
    // the week's printed majors, so released cards carry the print. Non-fatal:
    // a FRED or feed outage never breaks the tracker pass.
    let actuals = -1;
    try {
      actuals = await backfillPrintedWeek();
    } catch (err) {
      console.warn("[cron/intel-track] actuals backfill skipped:", err instanceof Error ? err.message : err);
    }
    // THE CALL (feature/the-call) — the same daily pass (22:10 UTC, after
    // Yahoo's bar is final in both EST and EDT) settles today's call against
    // today's close, then generates tomorrow's from the regime state at this
    // moment. Non-fatal: a call failure never breaks the tracker.
    let call: Awaited<ReturnType<typeof runCallPass>> | { configured: false; settled: null; generated: null } = {
      configured: false,
      settled: null,
      generated: null,
    };
    // feature/pwa-push — the settle seam's ONE subscriber: the handler
    // stashes the settle; flushCallPush (below, AFTER the pass) sends the
    // day's single notification once tomorrow's call exists too.
    registerCallPush();
    try {
      call = await runCallPass();
    } catch (err) {
      console.warn("[cron/intel-track] call pass skipped:", err instanceof Error ? err.message : err);
    }
    let push: Awaited<ReturnType<typeof flushCallPush>> = null;
    try {
      push = await flushCallPush();
    } catch (err) {
      console.warn("[cron/intel-track] call push skipped:", err instanceof Error ? err.message : err);
    }
    console.log(
      `[cron/intel-track] configured=${result.configured} tracked=${result.tracked.length} quoted=${result.quoted ?? 0} transitions=${result.transitions ?? 0} book=${book.live} bookCounts=${JSON.stringify(book.counts)} review=${book.demotedToReview} actuals=${actuals} call=${call.settled ?? "-"}/${call.generated ?? "-"}`,
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
        book,
        actuals,
        call: { settled: call.settled, generated: call.generated },
        push: push ? { recipients: push.recipients, sent: push.sent, pruned: push.pruned, failed: push.failed } : null,
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
