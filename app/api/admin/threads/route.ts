// HOTFIX (chat privacy) — the LEGACY thread namespace (the owner's pre-auth
// Jul–Aug history) is no longer served to anonymous traffic. It is preserved
// untouched (delete nothing) and readable ONLY here, behind the same dual
// admin gate as the ideas pipeline: Bearer ADMIN_TOKEN (works today, while
// production auth is unconfigured) or the signed-in owner session (whose
// first login also migrates these threads into the owner's own namespace).
import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { listThreads, threadDateLabel } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Math.min(50, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 50));
  // null principal = the LEGACY namespace, explicitly and only here
  const threads = (await listThreads(null, limit)).map((t) => ({
    ...t,
    label: threadDateLabel(t.updatedAt),
  }));
  return Response.json(
    { ok: true, scope: "legacy", threads },
    { headers: { "Cache-Control": "no-store" } },
  );
}
