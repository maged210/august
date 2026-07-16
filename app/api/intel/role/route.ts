// Role signal — "am I the desk owner, and am I signed in at all?" for the
// /intel client. Server-derived: never exposes OWNER_EMAIL's value or the
// session email, only booleans. Public and cheap (same intelRole rate-limit
// bucket); the client uses it to decide whether to render desk controls —
// and, when auth is configured but no session exists, a SIGN IN path.
//
// Shape is additive/backward-compatible ({ owner, authConfigured } callers
// keep working; `signedIn` is new):
//
//   auth unconfigured        → { owner: true,  authConfigured: false, signedIn: false }
//   configured, signed out   → { owner: false, authConfigured: true,  signedIn: false }
//   configured, non-owner    → { owner: false, authConfigured: true,  signedIn: true  }
//   configured, owner        → { owner: true,  authConfigured: true,  signedIn: true  }

import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getIntelRoleSignal } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelRole", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  return Response.json(await getIntelRoleSignal(), {
    headers: { "Cache-Control": "no-store" },
  });
}
