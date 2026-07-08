// Videos — list all discovered/processed videos.
// Source privacy: every row carries channel/title attribution, so GET returns
// the list only when the server-side INTEL_OWNER_VIEW flag is set — same
// contract as overview.
import { listVideos } from "@/lib/intel/store";
import { intelOwnerView } from "@/lib/intel/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!intelOwnerView()) return Response.json({ videos: [] });
  return Response.json({ videos: await listVideos() });
}
