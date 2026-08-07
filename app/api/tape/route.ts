import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { listLiveTape } from "@/lib/tape";

// Public desk-tape read (G3 round 4): LIVE entries only, newest first,
// provenance redacted (status/source never on the wire — same contract as
// GET /api/ideas). This is desk commentary, not a market data feed; the dock
// labels it "desk-sourced".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("tape", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const entries = await listLiveTape();
  return Response.json(
    { ok: true, entries },
    { headers: { "Cache-Control": "no-store" } },
  );
}
