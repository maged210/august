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

// Honest unconfigured mode: a clean machine-readable 501 instead of
// @auth/core's MissingSecret 500 error page. The landing hides its session
// chip on any non-ok response from /api/auth/session.
async function unconfigured(_req: NextRequest): Promise<Response> {
  return Response.json({ error: "auth_not_configured" }, { status: 501 });
}

export const GET = authConfigured ? handlers.GET : unconfigured;
export const POST = authConfigured ? handlers.POST : unconfigured;
