// AUTH-1a — POST /api/account/claim: fold THIS device's anonymous identity
// into the signed-in account (threads, memory, PIT records). Session
// required; the visitor id comes from the same httpOnly cookie the anonymous
// stores key on. One-way, idempotent (lib/claim marks claimed vids).
import { type NextRequest } from "next/server";
import { auth } from "@/auth";
import { claimVisitor } from "@/lib/claim";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { VISITOR_COOKIE } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("account", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return Response.json({ ok: false, error: "auth_required" }, { status: 401 });
  const m = new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([A-Za-z0-9-]{8,64})(?:;|$)`).exec(
    req.headers.get("cookie") ?? "",
  );
  if (!m) return Response.json({ ok: true, already: true, threads: 0, note: "no_anonymous_identity" });
  const result = await claimVisitor(email, m[1]);
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
