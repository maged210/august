// Publish curation — the owner decides which TRACKED ideas the public feed
// carries. Every method here is OWNER-gated (the whole surface is desk
// curation, including the listing): 401 auth_required signed-out, 403
// owner_only for other accounts, open when auth is unconfigured (single-user
// fallback). The public consumes /api/intel/feed, never this route.

import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";
import { intelStorageConfigured } from "@/lib/intel/store";
import { listPublishedWithState, publishTracked, unpublishTracked } from "@/lib/intel/publishStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readTrackedId(req: Request): Promise<string | null> {
  try {
    const id = String((await req.json())?.trackedId ?? "").trim();
    return id || null;
  } catch {
    return null;
  }
}

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  const published = await listPublishedWithState();
  return Response.json(
    { ok: true, published, count: published.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  if (!intelStorageConfigured()) return Response.json({ ok: false, error: "storage_unconfigured" }, { status: 501 });

  const trackedId = await readTrackedId(req);
  if (!trackedId) return Response.json({ ok: false, error: "trackedId_required" }, { status: 400 });

  const res = await publishTracked(trackedId);
  if (!res.ok) {
    const status = res.error === "tracked_not_found" ? 404 : 501;
    return Response.json(res, { status });
  }
  return Response.json(
    { ok: true, trackedId, already: res.already, count: res.count },
    { status: res.already ? 200 : 201 },
  );
}

export async function DELETE(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  if (!intelStorageConfigured()) return Response.json({ ok: false, error: "storage_unconfigured" }, { status: 501 });

  const trackedId = await readTrackedId(req);
  if (!trackedId) return Response.json({ ok: false, error: "trackedId_required" }, { status: 400 });

  const res = await unpublishTracked(trackedId);
  if (!res.ok) return Response.json(res, { status: 501 });
  return Response.json({ ok: true, trackedId, removed: res.removed, count: res.count });
}
