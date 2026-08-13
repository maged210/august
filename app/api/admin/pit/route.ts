// THE PIT admin backstop (G4) — purge a player's display name.
import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { purgePlayerName, topPlayers } from "@/lib/pit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  return Response.json({ ok: true, players: await topPlayers(50) });
}

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.action !== "purgeName" || typeof b.pid !== "string") {
    return Response.json({ ok: false, error: "unknown_action" }, { status: 400 });
  }
  const ok = await purgePlayerName(b.pid);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
