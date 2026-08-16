import { authConfigured } from "@/auth";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getCachedBrief, getOrCompileBrief } from "@/lib/morningbrief";
import { resolveUserOr401 } from "@/lib/user-scope";

// HOTFIX (adjacent to the chat-privacy audit): with auth unconfigured in
// production, the legacy fallback served the OWNER's personal brief (calendar
// + inbox digest) to anonymous visitors. Same fail-closed rule as the intel
// gates: unconfigured production answers "no brief", full stop.
function personalFallbackClosed(): boolean {
  return !authConfigured && process.env.NODE_ENV === "production";
}

// Morning Brief — client-facing.
//   GET  : cheap "is today's brief ready?" check on app open. NEVER compiles.
//   POST : the "brief me" on-demand path — compile now (or return today's cache).
// Node runtime keeps the in-process organ caches + warm Anthropic client per
// instance; dynamic so it's never statically optimized.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("brief", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  if (personalFallbackClosed()) {
    return new Response(JSON.stringify({ ready: false, brief: null }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // Session → namespace (stage 2): the cached brief read is THIS user's.
  const user = await resolveUserOr401();
  if (!user.ok) return user.response;

  const brief = await getCachedBrief(user.email);
  return new Response(JSON.stringify({ ready: !!brief, brief: brief ?? null }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("brief", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  if (personalFallbackClosed()) {
    return new Response(JSON.stringify({ ready: false, error: "auth_unconfigured" }, ), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await resolveUserOr401();
  if (!user.ok) return user.response;

  try {
    const brief = await getOrCompileBrief(user.email);
    return new Response(JSON.stringify({ ready: true, brief }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[brief] compile failed:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ ready: false, error: "compile_failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
