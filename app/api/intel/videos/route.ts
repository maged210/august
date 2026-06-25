// Videos — list all discovered/processed videos.
import { listVideos } from "@/lib/intel/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ videos: await listVideos() });
}
