// The PUBLIC feed — owner-published ideas, fully redacted. Every card reads as
// AUGUST's idea: attribution is fixed to "AUGUST DESK" and the payload carries
// ZERO source identity (no channelTitle/videoTitle/videoId/segment evidence —
// asserted by test). Served from a ~45s in-process cache; safe for anyone.

import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getPublicFeed } from "@/lib/intel/publishStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelFeed", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  try {
    const feed = await getPublicFeed();
    return Response.json(feed, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=30" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "feed_failed";
    console.error("[intel/feed]", msg);
    return Response.json({ ok: false, error: "feed_failed" }, { status: 500 });
  }
}
