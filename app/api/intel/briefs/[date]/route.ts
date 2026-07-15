// A dated brief — GET the stored one, or POST to (re)generate it from the day's analyses.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getBrief } from "@/lib/intel/store";
import { generateBrief } from "@/lib/intel/brief";
import { intelligenceConfigured } from "@/lib/intel/extract";
import { etDateKey } from "@/lib/intel/session";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";
import { intelOwnerView, redactBrief } from "@/lib/intel/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function resolveDate(d: string): string {
  return d === "today" ? etDateKey() : d;
}

export async function GET(_req: Request, ctx: { params: Promise<{ date: string }> }): Promise<Response> {
  const { date } = await ctx.params;
  // Source privacy: the stored brief keeps full provenance for the OWNER's
  // audit trail; every other reader gets the redacted view (tradecraft intact,
  // zero attribution). ownerView is the contract for which one this is.
  const [brief, ownerView] = await Promise.all([getBrief(resolveDate(date)), intelOwnerView()]);
  return Response.json({ brief: brief ? (ownerView ? brief : redactBrief(brief)) : null, ownerView });
}

export async function POST(req: Request, ctx: { params: Promise<{ date: string }> }): Promise<Response> {
  const rl = await checkRateLimit("intelProcess", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  // Intel data is SHARED; (re)generating the brief is OWNER-only (no-op when
  // auth unconfigured). Reading a brief (GET) stays public.
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  if (!intelligenceConfigured()) return Response.json({ ok: false, error: "ai_unconfigured" }, { status: 501 });
  const { date } = await ctx.params;
  try {
    const brief = await generateBrief(resolveDate(date));
    return Response.json({ ok: true, brief });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "generate_failed" }, { status: 500 });
  }
}
