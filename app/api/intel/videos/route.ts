// Videos — list all discovered/processed videos. OWNER-ONLY: video rows carry
// full channel/title attribution (source privacy — non-owners get the redacted
// brief + public feed surfaces instead).
import { listVideos } from "@/lib/intel/store";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  return Response.json({ videos: await listVideos() });
}
