// THE CALL (feature/the-call) — today's card state and the one-tap take.
// Identity is the Pit's: pidFor(resolveChatPrincipal) — anonymous devices get
// the aug_vid cookie and their record claims into the account on sign-in
// (AUTH-1a, lib/claim.ts). POST is write-gated by identity, rate-limited, and
// refuses after the 09:30 ET lock (the engine re-checks server-side).
import { type NextRequest } from "next/server";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { resolveChatPrincipal } from "@/lib/user-scope";
import { pidFor } from "@/lib/pit";
import { callConfigured, readCallState, takeSide } from "@/lib/call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withCookie(res: Response, setCookie: string | null): Response {
  if (setCookie) res.headers.append("Set-Cookie", setCookie);
  return res;
}

export async function GET(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("call", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  if (!callConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }
  const { principal, setCookie } = await resolveChatPrincipal(req);
  const cid = pidFor(principal);
  const state = await readCallState(cid);
  return withCookie(
    Response.json({ ok: true, ...state }, { headers: { "Cache-Control": "no-store" } }),
    setCookie,
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("call", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  if (!callConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }
  const { principal, setCookie } = await resolveChatPrincipal(req);
  const cid = pidFor(principal);
  if (!cid) return Response.json({ ok: false, error: "no_identity" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "body_not_json" }, { status: 400 });
  }

  const res = await takeSide(cid, body.side);
  if (!res.ok) {
    const status =
      res.error === "bad_side" ? 400 :
      res.error === "no_active_call" ? 404 :
      res.error === "locked" || res.error === "already_taken" ? 409 : 500;
    return withCookie(Response.json({ ok: false, error: res.error }, { status }), setCookie);
  }
  const state = await readCallState(cid);
  return withCookie(
    Response.json({ ok: true, ...state }, { headers: { "Cache-Control": "no-store" } }),
    setCookie,
  );
}
