import { timingSafeEqual } from "node:crypto";
import { authConfigured } from "@/auth";
import { hasStoredGoogleTokens } from "@/lib/gmail";
import { getOrCompileBrief, type MorningBrief } from "@/lib/morningbrief";
import { sendToAll } from "@/lib/push";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { listKnownUsers } from "@/lib/user-scope";

// Morning Brief — Vercel Cron endpoint. Hit once daily (~6 AM ET, see vercel.json)
// to pre-compile the brief with overnight context so it's waiting on app open.
// Force-recompiles (the whole point is fresh overnight synthesis) and writes to
// the Upstash day-cache.
//
// MULTI-USER (stage 2): with auth unconfigured this compiles the ONE legacy
// brief exactly as before. With auth configured it iterates the known users
// (users:index, populated at first sign-in) and compiles for each user who has
// a Google connection in their namespace — SEQUENTIALLY, capped at the first
// 10 (free-tier honesty: each compile is a multi-organ fetch + a model call;
// past ~10 users this needs a queue, not a bigger loop). Each user's push goes
// only to their own devices.
//
// AUTH: Vercel sends `Authorization: Bearer <CRON_SECRET>` on the scheduled
// request when CRON_SECRET is set. We REQUIRE it in production so the
// (token-spending) compile can never be triggered by the public; in dev it's
// optional for manual testing. Rate-limited as belt-and-suspenders so even a
// misconfigured/authorized caller can't loop forced compiles.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sequential per-user compiles: ~10 × (organ fetches + synthesis). 300s is the
// Fluid Compute ceiling on Hobby; the single-user path stays well under 60s.
export const maxDuration = 300;

const MAX_BRIEF_USERS = 10;

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

  // Compile + push for ONE namespace (email null = the legacy single-user
  // store). The push is fully DECOUPLED — wrapped so a push failure (or absent
  // VAPID/subs) never fails the compile; url opens the app and surfaces the
  // brief with its one-tap play control (iOS blocks autoplay, so playback
  // stays user-initiated).
  const compileFor = async (email: string | null) => {
    const brief = await getOrCompileBrief(email, { force: true });
    let pushed: Awaited<ReturnType<typeof sendToAll>> | null = null;
    try {
      pushed = await sendToAll(email, {
        title: "AUGUST",
        body: buildTeaser(brief),
        url: "/?brief=1",
        tag: "morning-brief", // collapse yesterday's if still pending
      });
    } catch (e) {
      console.error("[cron/brief] push failed:", e instanceof Error ? e.message : e);
    }
    return { date: brief.date, sources: brief.sources, grounded: brief.grounded, pushed };
  };

  // Single-user fallback (auth unconfigured): the ONE legacy compile, as ever.
  if (!authConfigured) {
    try {
      const r = await compileFor(null);
      return new Response(JSON.stringify({ ok: true, ...r }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "compile_failed";
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Multi-user: sequential compiles for users with a Google connection in
  // their namespace (the brief's personal organs need it; users without one
  // are skipped and compile on-demand via POST /api/brief instead).
  const users = (await listKnownUsers()).slice(0, MAX_BRIEF_USERS);
  const compiled: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const email of users) {
    try {
      if (!(await hasStoredGoogleTokens(email))) {
        skipped++;
        continue;
      }
      const r = await compileFor(email);
      compiled.push({ user: email, ...r });
    } catch (err) {
      compiled.push({
        user: email,
        error: err instanceof Error ? err.message : "compile_failed",
      });
    }
  }
  console.log(
    `[cron/brief] multi-user: users=${users.length} compiled=${compiled.length} skipped=${skipped}`,
  );
  return new Response(
    JSON.stringify({ ok: true, mode: "multi-user", users: users.length, skipped, compiled }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}
