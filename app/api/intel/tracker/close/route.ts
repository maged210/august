// Tracker CLOSE — the desk closes one tracked idea (INTEGRITY-1; the PHASE2
// deferred follow-up). WRITE-GATED like every intel mutation: owner-only in
// route (401 signed-out, 403 other accounts, open in the single-user
// fallback), rate-limited on the shared intelMutate budget. The engine
// records the close honestly in the status history; a later re-mention of
// the same call starts a NEW lifecycle.

import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";
import { intelStorageConfigured } from "@/lib/intel/store";
import { closeTracked } from "@/lib/intel/trackerStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  if (!intelStorageConfigured())
    return Response.json({ ok: false, error: "storage_unconfigured" }, { status: 501 });

  let trackedId = "";
  let reason: string | undefined;
  try {
    const body = (await req.json()) as { trackedId?: unknown; reason?: unknown };
    trackedId = String(body?.trackedId ?? "").trim();
    const r = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    reason = r || undefined;
  } catch {
    /* falls through to the 400 */
  }
  if (!trackedId) return Response.json({ ok: false, error: "trackedId_required" }, { status: 400 });

  const res = await closeTracked(trackedId, reason);
  if (!res.ok) {
    const status =
      res.error === "tracked_not_found" ? 404 : res.error === "store_write_failed" ? 502 : 501;
    return Response.json(res, { status });
  }
  return Response.json(
    { ok: true, trackedId, already: res.already, status: res.idea.status },
    { status: res.already ? 200 : 201 },
  );
}
