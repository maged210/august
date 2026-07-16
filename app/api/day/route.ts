// Today's calendar awareness — client-facing, read-only. Powers the restrained
// Presence "day" line. Mirrors /api/inbox: server holds the Google token, the client
// only ever receives normalized event metadata (titles + times), never tokens.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getDayState } from "@/lib/calendar";
import { resolveUserOr401 } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("day", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  // Session → namespace (stage 2): the tokens read are THIS user's.
  const user = await resolveUserOr401();
  if (!user.ok) return user.response;

  // getDayState never throws — it returns a safe empty/needsReconsent state.
  const day = await getDayState(user.email);
  return new Response(JSON.stringify(day), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
