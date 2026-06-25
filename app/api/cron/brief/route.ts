import { timingSafeEqual } from "node:crypto";
import { getOrCompileBrief, type MorningBrief } from "@/lib/morningbrief";
import { sendToAll } from "@/lib/push";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

// Morning Brief — Vercel Cron endpoint. Hit once daily (~6 AM ET, see vercel.json)
// to pre-compile the brief with overnight context so it's waiting when Maged opens
// the app. Force-recompiles (the whole point is fresh overnight synthesis) and
// writes to the Upstash day-cache.
//
// AUTH: Vercel sends `Authorization: Bearer <CRON_SECRET>` on the scheduled
// request when CRON_SECRET is set. We REQUIRE it in production so the
// (token-spending) compile can never be triggered by the public; in dev it's
// optional for manual testing. Rate-limited as belt-and-suspenders so even a
// misconfigured/authorized caller can't loop forced compiles.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // organ fetches + synthesis can take several seconds

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// A short spoken-brief teaser for the push body: headline + (when calendar is
// connected) the day's shape. DECOUPLED from the calendar — `brief.day` is absent
// when calendar isn't authorized, and the teaser falls back cleanly.
function buildTeaser(brief: MorningBrief): string {
  const n = brief.day?.count;
  if (typeof n === "number" && n > 0) {
    const first = brief.day?.nextUp;
    return `Your morning brief is ready — ${n} on today's calendar${first ? `, first ${first}` : ""}.`;
  }
  if (n === 0) return "Your morning brief is ready — calendar's clear today. Tap to hear it.";
  return "Your morning brief is ready — tap to hear it.";
}

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (!tokensMatch(auth, `Bearer ${secret}`)) {
      return new Response("Unauthorized", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Never run an open, token-spending compile in production.
    return new Response("CRON_SECRET not configured", { status: 503 });
  }

  // Defense-in-depth: cap forced compiles even for an authorized/misconfigured
  // caller (the legitimate once-daily cron is far under this).
  const rl = await checkRateLimit("brief", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  try {
    const brief = await getOrCompileBrief({ force: true });

    // Capstone: fire a push so AUGUST reaches Maged off-screen the moment the brief
    // is fresh. Fully DECOUPLED — wrapped so a push failure (or absent VAPID/subs)
    // never fails the compile; url opens the app and surfaces the brief with its
    // one-tap play control (iOS blocks autoplay, so playback stays user-initiated).
    let pushed: Awaited<ReturnType<typeof sendToAll>> | null = null;
    try {
      pushed = await sendToAll({
        title: "AUGUST",
        body: buildTeaser(brief),
        url: "/?brief=1",
        tag: "morning-brief", // collapse yesterday's if still pending
      });
    } catch (e) {
      console.error("[cron/brief] push failed:", e instanceof Error ? e.message : e);
    }

    return new Response(
      JSON.stringify({ ok: true, date: brief.date, sources: brief.sources, grounded: brief.grounded, pushed }),
      { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "compile_failed";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
