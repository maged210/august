import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import {
  deleteTapeEntry,
  getTapeEntry,
  tapeConfigured,
  updateTapeEntry,
  validateTapePatch,
} from "@/lib/tape";

// Admin single tape entry: edit fields / drive the lifecycle. Approve is
// PATCH {status:"live"}; reject is DELETE (tape is draft|live only — there is
// no "closed" parking state, and a rejected callout has no audience).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  if (!tapeConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "body_not_json" }, { status: 400 });
  }
  const parsed = validateTapePatch(body);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  const { id } = await ctx.params;
  const entry = await updateTapeEntry(id, parsed.value);
  if (!entry) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, entry });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  if (!tapeConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }

  const { id } = await ctx.params;
  const existing = await getTapeEntry(id);
  if (!existing) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const gone = await deleteTapeEntry(id);
  if (!gone) return Response.json({ ok: false, error: "store_write_failed" }, { status: 502 });
  return Response.json({ ok: true });
}
