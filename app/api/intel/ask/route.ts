// Ask AUGUST — cited retrieval Q&A over processed videos. OWNER-ONLY: the
// answer path is built around attribution (the model sees channel + video
// titles and must cite videoId + timestamp, and its prose may name channels),
// so it cannot be served redacted — non-owners are gated instead of leaked to.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { askIntel } from "@/lib/intel/ask";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelAsk", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  let q = "";
  try {
    q = String((await req.json())?.question ?? "").trim();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (q.length < 3) return Response.json({ error: "question_required" }, { status: 400 });
  return Response.json(await askIntel(q));
}
