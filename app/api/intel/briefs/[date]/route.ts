// A dated brief — GET the stored one, or POST to (re)generate it from the day's analyses.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getBrief } from "@/lib/intel/store";
import { generateBrief } from "@/lib/intel/brief";
import { intelligenceConfigured } from "@/lib/intel/extract";
import { etDateKey } from "@/lib/intel/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function resolveDate(d: string): string {
  return d === "today" ? etDateKey() : d;
}

export async function GET(_req: Request, ctx: { params: Promise<{ date: string }> }): Promise<Response> {
  const { date } = await ctx.params;
  const brief = await getBrief(resolveDate(date));
  return Response.json({ brief: brief ?? null });
}

export async function POST(req: Request, ctx: { params: Promise<{ date: string }> }): Promise<Response> {
  const rl = await checkRateLimit("intelProcess", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  if (!intelligenceConfigured()) return Response.json({ ok: false, error: "ai_unconfigured" }, { status: 501 });
  const { date } = await ctx.params;
  try {
    const brief = await generateBrief(resolveDate(date));
    return Response.json({ ok: true, brief });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "generate_failed" }, { status: 500 });
  }
}
