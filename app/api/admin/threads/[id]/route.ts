// HOTFIX (chat privacy) — full message bodies from the LEGACY thread
// namespace, admin-gated. See ../route.ts for the why.
import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getThread } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const thread = await getThread(null, id); // legacy namespace, admin-only
  if (!thread) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, scope: "legacy", thread }, { headers: { "Cache-Control": "no-store" } });
}
