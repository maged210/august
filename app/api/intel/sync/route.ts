// Manual sync — discover new uploads for channel sources (needs YOUTUBE_API_KEY).
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { syncSources } from "@/lib/intel/pipeline";
import { youtubeApiConfigured } from "@/lib/intel/youtube";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  // Intel data is SHARED; mutating it is OWNER-only (no-op when auth unconfigured).
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  if (!youtubeApiConfigured()) {
    return Response.json(
      { ok: false, error: "youtube_unconfigured", message: "Add YOUTUBE_API_KEY to auto-discover channel uploads. You can still add videos by URL and process transcripts manually." },
      { status: 501 },
    );
  }
  const result = await syncSources();
  return Response.json({ ok: true, ...result });
}
