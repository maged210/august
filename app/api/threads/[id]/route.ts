// A single conversation thread — the full (capped) message history.
// Stage 2 of the home redesign opens threads from the RECENT THREADS list.
import { getThread } from "@/lib/threads";
import { resolveUserOr401 } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Session → namespace (stage 2): a user can only ever read THEIR threads.
  const user = await resolveUserOr401();
  if (!user.ok) return user.response;

  const { id } = await ctx.params;
  const thread = await getThread(user.email, id);
  if (!thread) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ thread }, { headers: { "Cache-Control": "no-store" } });
}
