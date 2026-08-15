import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { ideasConfigured, mergeIdeas } from "@/lib/ideas";

// ADMIN-1 delta — MERGE two same-ticker ideas: the keeper keeps its levels,
// both theses land in its history, the twin is deleted. Dual admin gate like
// every other /api/admin/ideas surface.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  if (!ideasConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "body_not_json" }, { status: 400 });
  }
  const keepId = typeof body.keepId === "string" ? body.keepId.trim() : "";
  const absorbId = typeof body.absorbId === "string" ? body.absorbId.trim() : "";
  if (!keepId || !absorbId || keepId === absorbId) {
    return Response.json({ ok: false, error: "ids_invalid" }, { status: 400 });
  }

  const merged = await mergeIdeas(keepId, absorbId);
  if (merged === "mismatch") {
    return Response.json({ ok: false, error: "ticker_mismatch" }, { status: 409 });
  }
  if (!merged) {
    return Response.json({ ok: false, error: "merge_failed" }, { status: 500 });
  }
  return Response.json({ ok: true, idea: merged });
}
