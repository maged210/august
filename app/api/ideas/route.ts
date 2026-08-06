import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { listLiveIdeas } from "@/lib/ideas";

// Public trade-ideas rail feed (CORE V2). Serves ONLY live ideas in the
// redacted PublicIdea shape — drafts, closed rows, and provenance never leave
// the server (lib/ideas owns that contract). Unconfigured Redis degrades to an
// honestly empty list: the rail shows NO LIVE IDEAS, never mock rows.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("ideas", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const ideas = await listLiveIdeas();
  return Response.json({ ok: true, ideas });
}
