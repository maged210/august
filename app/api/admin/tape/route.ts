import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { createTapeEntry, listTape, tapeConfigured, validateTapeCreate } from "@/lib/tape";

// Admin desk-tape collection (G3 round 4): the /admin quick-add and the
// transcript pipeline write here. Same dual gate + shape as /api/admin/ideas.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — every entry, all statuses, newest first (the admin board). */
export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  if (!tapeConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }

  const entries = await listTape();
  return Response.json({ ok: true, entries });
}

/** POST — create an entry (defaults: status draft, source desk; the /admin
 *  quick-add sends status "live" explicitly — one Enter to publish). */
export async function POST(req: Request): Promise<Response> {
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
  const parsed = validateTapeCreate(body);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  const entry = await createTapeEntry(parsed.value);
  if (!entry) return Response.json({ ok: false, error: "store_write_failed" }, { status: 502 });
  return Response.json({ ok: true, entry }, { status: 201 });
}
