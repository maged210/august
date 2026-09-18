import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { readPublicIngests } from "@/lib/transcripts";
import { wireBody } from "@/lib/wire";

// DESK WIRE ingest events (G3 round 5): the ONLY wire fact that isn't already
// on a public endpoint. Redacted to counts + the owner-typed source label —
// raw text, draft contents, and failures never leave the admin surface. The
// other wire events (idea live / triggered / tape posted) are assembled
// client-side from /api/ideas and /api/tape.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("wire", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  // DESIGN_LAWS L11: an unreachable store answers 503 with its cause. This
  // route used to send `{ ok: true, ingests: [] }` through a Redis outage, and
  // the front page's wire card published that as "nothing has been ingested".
  // Zero ingests is still a 200 — an empty log is a real answer.
  const { body, status } = wireBody(await readPublicIngests(), "ingests");
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
