import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getCachedBrief, getOrCompileBrief } from "@/lib/morningbrief";
import { resolveUserOr401 } from "@/lib/user-scope";

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

  const user = await resolveUserOr401();
  if (!user.ok) return user.response;

  try {
    const brief = await getOrCompileBrief(user.email);
    return new Response(JSON.stringify({ ready: true, brief }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "compile_failed";
    return new Response(JSON.stringify({ ready: false, error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
