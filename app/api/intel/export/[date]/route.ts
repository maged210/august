// Export a dated brief as clean Markdown (PDF-ready via the browser's print).
// Exports leave the app, so redaction is UNCONDITIONAL — no channel, video, or
// timestamp attribution ever ships, owner flag or not.
import { getBrief } from "@/lib/intel/store";
import { briefToMarkdown } from "@/lib/intel/brief";
import { redactBrief } from "@/lib/intel/redact";
import { etDateKey } from "@/lib/intel/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ date: string }> }): Promise<Response> {
  const { date } = await ctx.params;
  const d = date === "today" ? etDateKey() : date;
  const brief = await getBrief(d);
  if (!brief) return new Response("No brief for that date.", { status: 404 });
  return new Response(briefToMarkdown(redactBrief(brief)), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="august-intel-${d}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
