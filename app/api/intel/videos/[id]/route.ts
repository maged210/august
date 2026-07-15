// One video — full bundle: metadata + chapters + transcript + analysis.
// OWNER-ONLY: the bundle is pure source material (channel, title, transcript,
// per-segment evidence) — exactly what source privacy exists to protect.
import { getChapters, getTranscript } from "@/lib/intel/store";
import { getVideoBundle } from "@/lib/intel/pipeline";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  const { id } = await ctx.params;
  const [{ video, analysis }, chapters, transcript] = await Promise.all([
    getVideoBundle(id),
    getChapters(id),
    getTranscript(id),
  ]);
  if (!video) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ video, analysis, chapters: chapters ?? [], transcript: transcript ?? [] });
}
