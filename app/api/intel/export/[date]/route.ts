// Export a dated brief as clean Markdown (PDF-ready via the browser's print).
// Source privacy: only the OWNER's export carries attribution; every other
// caller gets the redacted brief (tradecraft intact, zero channel identity).
// The response is Markdown, so the ownerView flag travels as a header.
import { getBrief } from "@/lib/intel/store";
import { briefToMarkdown } from "@/lib/intel/brief";
import { etDateKey } from "@/lib/intel/session";
import { intelOwnerView, redactBrief } from "@/lib/intel/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ date: string }> }): Promise<Response> {
  const { date } = await ctx.params;
  const d = date === "today" ? etDateKey() : date;
  const [brief, ownerView] = await Promise.all([getBrief(d), intelOwnerView()]);
  if (!brief) return new Response("No brief for that date.", { status: 404 });
  return new Response(briefToMarkdown(ownerView ? brief : redactBrief(brief)), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="august-intel-${d}.md"`,
      "Cache-Control": "no-store",
      "X-Intel-Owner-View": String(ownerView),
    },
  });
}
