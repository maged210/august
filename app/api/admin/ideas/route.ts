import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { createIdea, ideasConfigured, listIdeas, validateIdeaCreate } from "@/lib/ideas";

// Admin trade-ideas collection (CORE V2): the /admin console and the future
// transcript pipeline write here. Guarded by lib/admin's dual gate — Bearer
// ADMIN_TOKEN or the signed-in owner session. Deliberately NOT in the
// middleware matcher (token-guarded machine endpoints stay out, like /api/cron).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — every idea, all statuses, newest first (the admin board). */
export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  if (!ideasConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }

  const ideas = await listIdeas();
  return Response.json({ ok: true, ideas });
}

/** POST — create an idea (defaults: status draft, source manual). */
export async function POST(req: Request): Promise<Response> {
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
  const parsed = validateIdeaCreate(body);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  const idea = await createIdea(parsed.value);
  if (!idea) return Response.json({ ok: false, error: "store_write_failed" }, { status: 502 });
  return Response.json({ ok: true, idea }, { status: 201 });
}
