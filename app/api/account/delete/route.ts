// POST /api/account/delete — a signed-in user deletes their own account.
//
// CONFIRM-THEN-DELETE, not one tap: the body must carry { confirm: "DELETE" }.
// The UI asks first; this is the second, independent check, so a stray fetch
// or a mis-click can never destroy an account.
//
// The caller can only ever delete THEMSELVES. The email comes from the signed
// session, never from the request body — there is deliberately no way to name
// someone else's account here, not even for the owner.

import { auth } from "@/auth";
import { deleteAccount } from "@/lib/account-delete";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { VISITOR_COOKIE } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// the sweep SCANs several unindexed key patterns; give it room
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("account", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return Response.json({ ok: false, error: "not_signed_in" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "body_not_json" }, { status: 400 });
  }
  // the second confirmation — deliberately an exact word, not a boolean
  if ((body as { confirm?: unknown } | null)?.confirm !== "DELETE") {
    return Response.json({ ok: false, error: "confirm_required" }, { status: 400 });
  }

  // the caller's own device id, so this browser's claim markers and anonymous
  // rows go with the account rather than being orphaned
  const visitorId =
    req.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${VISITOR_COOKIE}=`))
      ?.slice(VISITOR_COOKIE.length + 1) ?? null;

  const report = await deleteAccount(email, { visitorId });
  if (!report.ok) {
    return Response.json({ ok: false, error: report.error ?? "delete_failed" }, { status: 502 });
  }

  // Sign the browser out and drop the device cookie. The session is a
  // stateless JWT, so clearing the cookie IS the sign-out — there is no
  // server-side session record left to remove.
  const res = Response.json({
    ok: true,
    deletedKeys: report.deleted.length,
    membersRemoved: report.membersRemoved.length,
    // said out loud rather than omitted — the UI renders these verbatim
    unreachable: report.unreachable,
  });
  const expire = (name: string) => `${name}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;
  for (const c of [
    VISITOR_COOKIE,
    "authjs.session-token",
    "__Secure-authjs.session-token",
    "authjs.callback-url",
    "__Secure-authjs.callback-url",
  ]) {
    res.headers.append("Set-Cookie", expire(c));
  }
  return res;
}
