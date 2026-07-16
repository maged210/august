import { getInboxState } from "@/lib/gmail";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { resolveUserOr401 } from "@/lib/user-scope";

// Read-only inbox state for the Comms surface. Returns ONLY normalized metadata
// (sender, subject, category, timestamp) plus connection flags and a brief line.
// No tokens, no message bodies ever cross this boundary.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("inbox", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  // Session → namespace (stage 2): the tokens read are THIS user's.
  const user = await resolveUserOr401();
  if (!user.ok) return user.response;

  try {
    const state = await getInboxState(user.email);
    return new Response(JSON.stringify(state), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    console.error("[inbox]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
