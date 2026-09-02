// Owner console ask stats (feature/command-bar). GET — today's ask lane at a
// glance: asks served (model + cache), cache hits, and the top 5 identities
// by ask count. Read-only, straight off the aug:askstats keys the chat route
// writes; unconfigured Redis answers honestly with configured:false rather
// than zeros pretending to be a quiet day.
import { Redis } from "@upstash/redis";
import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { readAskStats } from "@/lib/ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let _redis: Redis | null | undefined;
function getKv(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    _redis = url && token && url.startsWith("https://") ? new Redis({ url, token }) : null;
  } catch {
    _redis = null;
  }
  return _redis;
}

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;

  const kv = getKv();
  if (!kv) return Response.json({ ok: true, configured: false });
  const stats = await readAskStats(kv); // null = KV configured but unreachable
  if (!stats) return Response.json({ ok: false, error: "stats_unreachable" }, { status: 502 });
  return Response.json({ ok: true, configured: true, stats });
}
