// Manual transcript paste → process. The works-today path: supply a transcript and
// AUGUST runs the chapter-first extraction (fast pass → full pass) and stores cited intel.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { intelligenceConfigured } from "@/lib/intel/extract";
import { processManualTranscript } from "@/lib/intel/pipeline";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // multi Anthropic calls for fast + full pass (16K output cap + split retries)

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const rl = await checkRateLimit("intelProcess", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  // Intel data is SHARED; mutating it is OWNER-only (no-op when auth unconfigured).
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  if (!intelligenceConfigured()) return Response.json({ ok: false, error: "ai_unconfigured" }, { status: 501 });

  const { id } = await ctx.params;
  let transcript = "";
  try {
    transcript = String((await req.json())?.transcript ?? "");
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (transcript.trim().length < 40) return Response.json({ ok: false, error: "transcript_too_short" }, { status: 400 });

  const res = await processManualTranscript(id, transcript);
  return Response.json(res, { status: res.ok ? 200 : 422 });
}
