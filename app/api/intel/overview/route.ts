// One-shot dashboard payload: config flags, current session, sources, videos, and
// today's brief (if generated). Keeps the client to a single fetch + poll.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getBrief, intelStorageConfigured, listSources, listVideos } from "@/lib/intel/store";
import { intelligenceConfigured } from "@/lib/intel/extract";
import { youtubeApiConfigured } from "@/lib/intel/youtube";
import { etClock, etDateKey, etNiceDate, marketSession, SESSION_LABEL } from "@/lib/intel/session";
import { intelOwnerView, redactBrief, storeIdentityStrings } from "@/lib/intel/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const date = etDateKey();
  const [sources, videos, brief, ownerView] = await Promise.all([
    listSources(),
    listVideos(),
    getBrief(date),
    intelOwnerView(),
  ]);
  const lastSync = sources.reduce((m, s) => Math.max(m, s.lastChecked), 0);
  const lastProcessed = videos.reduce((m, v) => Math.max(m, v.status === "analyzed" ? v.updated : 0), 0);

  return Response.json({
    config: {
      storage: intelStorageConfigured(),
      ai: intelligenceConfigured(),
      youtube: youtubeApiConfigured(),
    },
    clock: { date, nice: etNiceDate(), time: etClock(), session: marketSession(), sessionLabel: SESSION_LABEL[marketSession()] },
    lastSync,
    lastBriefAt: brief?.generatedAt ?? 0,
    lastProcessed,
    // Source privacy: sources + videos ARE the attribution (who is watched) —
    // non-owners get none of them, and the brief only in its redacted form
    // (structural deletion + the prose scrub over the store's identity
    // strings — LLM-written brief text can name a channel/video in prose).
    sources: ownerView ? sources : [],
    videos: ownerView ? videos : [],
    brief: brief ? (ownerView ? brief : redactBrief(brief, storeIdentityStrings(sources, videos))) : null,
    ownerView,
  });
}
