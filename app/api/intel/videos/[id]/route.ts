// One video — full bundle: metadata + chapters + transcript + analysis.
import { getChapters, getTranscript } from "@/lib/intel/store";
import { getVideoBundle } from "@/lib/intel/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const [{ video, analysis }, chapters, transcript] = await Promise.all([
    getVideoBundle(id),
    getChapters(id),
    getTranscript(id),
  ]);
  if (!video) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ video, analysis, chapters: chapters ?? [], transcript: transcript ?? [] });
}
