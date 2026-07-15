// Role signal — "am I the desk owner?" for the /intel client. Server-derived:
// never exposes OWNER_EMAIL's value, only the boolean outcome of comparing it
// with the session. Public and cheap; the client uses it to decide whether to
// render desk controls at all.
//
//   auth unconfigured        → { owner: true,  authConfigured: false }  (single-user fallback)
//   configured, signed out   → { owner: false, authConfigured: true }
//   configured, non-owner    → { owner: false, authConfigured: true }
//   configured, owner        → { owner: true,  authConfigured: true }

import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { checkIntelMutateAllowed } from "@/lib/user-scope";
import { authConfigured } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelRole", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const gate = await checkIntelMutateAllowed();
  return Response.json(
    { owner: gate.ok, authConfigured },
    { headers: { "Cache-Control": "no-store" } },
  );
}
