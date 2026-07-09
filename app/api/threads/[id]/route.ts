// A single conversation thread — the full (capped) message history.
// Stage 2 of the home redesign opens threads from the RECENT THREADS list.
import { getThread } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const thread = await getThread(id);
  if (!thread) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ thread }, { headers: { "Cache-Control": "no-store" } });
}
