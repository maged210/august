import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { readLiveTape } from "@/lib/tape";
import { wireBody } from "@/lib/wire";

// Public desk-tape read (G3 round 4): LIVE entries only, newest first,
// provenance redacted (status/source never on the wire — same contract as
// GET /api/ideas). This is desk commentary, not a market data feed; the dock
// labels it "desk-sourced".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("tape", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  // A store outage answers 503 with the cause, never `{ ok: true, entries: [] }`
  // — the dock's "nothing on the public tape" is a claim about what the DESK
  // said, and it must never be printed while the desk can't be read
  // (DESIGN_LAWS L11). Zero rows from a healthy store is still a real answer.
  const { body, status } = wireBody(await readLiveTape(), "entries");
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
