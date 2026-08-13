import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { deleteIdea, getIdea, ideasConfigured, updateIdea, validateIdeaPatch } from "@/lib/ideas";

// Admin single-idea route: edit fields / drive the lifecycle. Approve is
// PATCH {status:"live"}, close is {status:"closed"}, reject (a draft) is
// {status:"closed"} too — one verb, no parallel endpoints.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  if (!ideasConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }

  const { id } = await ctx.params;
  const idea = await getIdea(id);
  if (!idea) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, idea });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  if (!ideasConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "body_not_json" }, { status: 400 });
  }
  const parsed = validateIdeaPatch(body);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  const { id } = await ctx.params;
  const idea = await updateIdea(id, parsed.value);
  if (!idea) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, idea });
}

// ADMIN-1 — hard delete. The UI confirms first; the API just needs the gate.
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  if (!ideasConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }

  const { id } = await ctx.params;
  const existing = await getIdea(id);
  if (!existing) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const ok = await deleteIdea(id);
  return ok
    ? Response.json({ ok: true, deleted: id })
    : Response.json({ ok: false, error: "delete_failed" }, { status: 500 });
}
