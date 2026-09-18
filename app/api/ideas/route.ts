import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { readLiveIdeas } from "@/lib/ideas";
import { DISCLAIMER_CALLS } from "@/lib/disclaimer";
import { wireBody } from "@/lib/wire";

// Public trade-ideas rail feed (CORE V2). Serves ONLY live ideas in the
// redacted PublicIdea shape — drafts, closed rows, and provenance never leave
// the server (lib/ideas owns that contract). A store that can't be read
// answers 503 { ok: false, error } (DESIGN_LAWS L11): "no live ideas" is a
// claim about the desk's record, and it must never stand in for "I couldn't
// read my own book". Zero live ideas is still a 200 — that one is true.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("ideas", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const read = await readLiveIdeas();
  // anyone consuming this wire is republishing the desk's calls — the
  // claim travels with the payload, not just on our own pages. wireBody
  // merges it into an ANSWER only: a disclaimer over rows that don't exist
  // disclaims nothing, and reads as though calls were published.
  const { body, status } = wireBody(read, "ideas", { disclaimer: DISCLAIMER_CALLS });
  return Response.json(body, { status });
}
