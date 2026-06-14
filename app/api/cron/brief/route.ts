import { timingSafeEqual } from "node:crypto";
import { getOrCompileBrief } from "@/lib/morningbrief";
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
    return new Response(
      JSON.stringify({ ok: true, date: brief.date, sources: brief.sources, grounded: brief.grounded }),
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
