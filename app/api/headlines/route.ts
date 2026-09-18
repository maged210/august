import { type NextRequest } from "next/server";
import { readHeadlines } from "@/lib/headlines";
import { wireBody } from "@/lib/wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

// Home-brief headlines (UX2-T2) — free public RSS, server-cached ~15 min in
// lib/headlines. Public like the quotes route; the CDN absorbs repeats too.
export async function GET(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("headlines", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  // PUBLIC-LANGUAGE P2 — the zero-third-party-brand alternative, OFF by
  // default: PUBLIC_FEED_MODE=desk swaps the headlines module for the desk's
  // own tape on the front page. Owner flips the env var; no code change.
  if (process.env.PUBLIC_FEED_MODE === "desk") {
    return Response.json(
      { ok: true, mode: "desk", headlines: [] },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=300" } },
    );
  }

  // L11 — three answers, not two: rows, rows-with-the-dead-feeds-named
  // (`degraded`), or 503 with the cause. An empty list now means the wires
  // published nothing, and only that.
  const { body, status } = wireBody(await readHeadlines(), "headlines");
  return Response.json(body, {
    status,
    headers: {
      // the CDN must never hold a 503: the outage would outlive itself by five
      // minutes and every retry behind that edge would be answered from it
      "Cache-Control": status === 200 ? "public, max-age=0, s-maxage=300" : "no-store",
    },
  });
}
