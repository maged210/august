// A single conversation thread — the full (capped) message history.
// Stage 2 of the home redesign opens threads from the RECENT THREADS list.
import { deleteThread, getThread } from "@/lib/threads";
import { resolveChatPrincipal } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  // HOTFIX (chat privacy): a caller can only ever read THEIR OWN namespace —
  // signed-in user, or the per-visitor principal; never the legacy shared keys
  // in production (those are ADMIN-gated at /api/admin/threads now).
  const { principal, setCookie } = await resolveChatPrincipal(req);

  const { id } = await ctx.params;
  const thread = await getThread(principal, id);
  const res = thread
    ? Response.json({ thread }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "not_found" }, { status: 404 });
  if (setCookie) res.headers.append("Set-Cookie", setCookie);
  return res;
}

/** B3 — delete one of YOUR threads (the principal scope IS the ownership
 *  check: the key namespace can only reach the caller's own records). */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { principal, setCookie } = await resolveChatPrincipal(req);
  const { id } = await ctx.params;
  const ok = await deleteThread(principal, id);
  const res = ok
    ? Response.json({ ok: true })
    : Response.json({ ok: false, error: "delete_failed" }, { status: 500 });
  if (setCookie) res.headers.append("Set-Cookie", setCookie);
  return res;
}
