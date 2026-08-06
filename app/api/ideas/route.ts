import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import type { PublicIdea } from "@/lib/ideas";

// Public trade-ideas rail feed (CORE V2). Serves ONLY live ideas in the
// redacted PublicIdea shape — drafts, closed rows, and provenance never leave
// the server. P3 wires the Upstash-backed store behind this contract; until
// then the list is honestly empty (the rail shows its NO LIVE IDEAS state,
// never mock rows).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("ideas", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const ideas: PublicIdea[] = [];
  return Response.json({ ok: true, ideas });
}
