// One video — full bundle: metadata + chapters + transcript + analysis.
// OWNER-ONLY: the bundle is pure source material (channel, title, transcript,
// per-segment evidence) — exactly what source privacy exists to protect.
//
// READ boundary → the ATTRIBUTION gate, matching the sibling list route
// (/api/intel/videos), which serves this same attribution and is gated the same
// way. The write gate would resolve "unconfigured → open" in production and
// publish the whole video library one missing env var later.
import { getChapters, getTranscript } from "@/lib/intel/store";
import { getVideoBundle } from "@/lib/intel/pipeline";
import { gateIntelAttributionOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await gateIntelAttributionOrRespond();
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
