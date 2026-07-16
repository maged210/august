// A single source — enable/disable (PATCH) or remove (DELETE).
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getSource, removeSource, saveSource } from "@/lib/intel/store";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  // Intel data is SHARED; mutating it is OWNER-only (no-op when auth unconfigured).
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  const { id } = await ctx.params;
  const src = await getSource(id);
  if (!src) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof body.enabled === "boolean") src.enabled = body.enabled;
  await saveSource(src);
  return Response.json({ ok: true, source: src });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  const { id } = await ctx.params;
  await removeSource(id);
  return Response.json({ ok: true });
}
