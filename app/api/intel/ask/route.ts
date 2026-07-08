// Ask AUGUST — cited retrieval Q&A over processed videos.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { askIntel } from "@/lib/intel/ask";
import { intelOwnerView } from "@/lib/intel/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelAsk", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  let q = "";
  try {
    q = String((await req.json())?.question ?? "").trim();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (q.length < 3) return Response.json({ error: "question_required" }, { status: 400 });
  const result = await askIntel(q);
  // Privacy contract: same as the briefs routes — source attribution (videoId/videoTitle/channelTitle) never leaves the app unless INTEL_OWNER_VIEW; blanked cites are hidden by the client's videoId gate.
  if (!intelOwnerView()) {
    result.citations = result.citations.map((c) => ({ ...c, videoId: "", videoTitle: "", channelTitle: "" }));
  }
  return Response.json(result);
}
