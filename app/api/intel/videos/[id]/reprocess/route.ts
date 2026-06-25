// Re-run extraction from the stored transcript (e.g. after an analysis-version bump).
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { reprocessVideo } from "@/lib/intel/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const rl = await checkRateLimit("intelProcess", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const { id } = await ctx.params;
  const res = await reprocessVideo(id);
  return Response.json(res, { status: res.ok ? 200 : 422 });
}
