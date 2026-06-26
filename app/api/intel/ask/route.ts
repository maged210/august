// Ask AUGUST — cited retrieval Q&A over processed videos.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { askIntel } from "@/lib/intel/ask";

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
  return Response.json(await askIntel(q));
}
