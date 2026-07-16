// Videos — list all discovered/processed videos. OWNER-ONLY: video rows carry
// full channel/title attribution (source privacy — non-owners get the redacted
// brief + public feed surfaces instead). Attribution READ boundary, so it rides
// the attribution gate: open when auth is unconfigured OUTSIDE production
// (single-user fallback), refused inside it — a missing env var on a deploy
// must never publish the video library.
import { listVideos } from "@/lib/intel/store";
import { gateIntelAttributionOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const denied = await gateIntelAttributionOrRespond();
  if (denied) return denied;
  return Response.json({ videos: await listVideos() });
}
