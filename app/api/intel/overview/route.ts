// One-shot dashboard payload: config flags, current session, sources, videos, and
// today's brief (if generated). Keeps the client to a single fetch + poll.
// Source privacy: the brief is redacted (no channel/video attribution) AND the
// source/video rosters are withheld (empty arrays) unless the server-side
// INTEL_OWNER_VIEW flag is set — same contract as the briefs routes. Config,
// clock, and sync timestamps stay public; who is watched does not.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getBrief, intelStorageConfigured, listSources, listVideos } from "@/lib/intel/store";
import { intelligenceConfigured } from "@/lib/intel/extract";
import { intelOwnerView, redactBrief } from "@/lib/intel/redact";
import { youtubeApiConfigured } from "@/lib/intel/youtube";
import { etClock, etDateKey, etNiceDate, marketSession, SESSION_LABEL } from "@/lib/intel/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const date = etDateKey();
  const [sources, videos, brief] = await Promise.all([listSources(), listVideos(), getBrief(date)]);
  const lastSync = sources.reduce((m, s) => Math.max(m, s.lastChecked), 0);
  const lastProcessed = videos.reduce((m, v) => Math.max(m, v.status === "analyzed" ? v.updated : 0), 0);
  const owner = intelOwnerView();

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
    sources: owner ? sources : [],
    videos: owner ? videos : [],
    brief: brief ? (owner ? brief : redactBrief(brief)) : null,
    ownerView: owner,
  });
}
