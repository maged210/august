import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { listPublicIngests } from "@/lib/transcripts";

// DESK WIRE ingest events (G3 round 5): the ONLY wire fact that isn't already
// on a public endpoint. Redacted to counts + the owner-typed source label —
// raw text, draft contents, and failures never leave the admin surface. The
// other wire events (idea live / triggered / tape posted) are assembled
// client-side from /api/ideas, /api/intel/feed, and /api/tape.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("wire", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const ingests = await listPublicIngests();
  return Response.json(
    { ok: true, ingests },
    { headers: { "Cache-Control": "no-store" } },
  );
}
