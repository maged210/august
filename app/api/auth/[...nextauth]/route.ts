// NextAuth v5 route handler — serves /api/auth/session, /csrf, /signin,
// /signout, /callback/google, /providers, /error.
//
// NO CONFLICT with the Comms Gmail flow: /api/auth/google and
// /api/auth/google/callback are static routes, which Next.js always prefers
// over this catch-all; NextAuth's own Google callback lives at the distinct
// /api/auth/callback/google. Both flows coexist under /api/auth.

import type { NextRequest } from "next/server";
import { handlers, authConfigured } from "@/auth";

export const runtime = "nodejs";

// Honest unconfigured mode instead of @auth/core's MissingSecret 500 page.
// /session answers a VALID signed-out response (200 null — NextAuth's own
// no-session shape) so no production path ever sees a 5xx from this route;
// the landing's `j?.user?.email` check hides the chip either way. The other
// NextAuth endpoints (signin/csrf/...) simply don't exist until AUTH-1: 404.
async function unconfigured(req: NextRequest): Promise<Response> {
  if (new URL(req.url).pathname.endsWith("/session")) {
    return Response.json(null, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "auth_not_configured" }, { status: 404 });
}

export const GET = authConfigured ? handlers.GET : unconfigured;
export const POST = authConfigured ? handlers.POST : unconfigured;
