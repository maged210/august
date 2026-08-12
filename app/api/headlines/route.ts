import { type NextRequest } from "next/server";
import { getHeadlines } from "@/lib/headlines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

// Home-brief headlines (UX2-T2) — free public RSS, server-cached ~15 min in
// lib/headlines. Public like the quotes route; the CDN absorbs repeats too.
export async function GET(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("headlines", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const headlines = await getHeadlines();
  return Response.json(
    { ok: true, headlines },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=300" } },
  );
}
