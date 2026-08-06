// Admin gate for the trade-ideas pipeline (CORE V2).
//
// Two credentials funnel through ONE gate (route files must not hold logic —
// the lib/user-scope.ts:293 rule):
//   1. `Authorization: Bearer <ADMIN_TOKEN>` — the headless/API credential
//      (webhooks, curl, the /admin UI's token box). Compared timing-safe,
//      the cron-route pattern — extracted here instead of a sixth copy.
//   2. The signed-in OWNER session — the interactive credential, so the owner
//      uses /admin from a browser without pasting a token. Reuses the intel
//      mutation gate, which FAILS CLOSED in production when auth is
//      unconfigured (the pinned house contract).
// An unset ADMIN_TOKEN never opens anything: it only removes path 1.

import { timingSafeEqual } from "node:crypto";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";

/** PURE. Constant-time string compare (length leak is fine — tokens are long). */
export function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

/** PURE. Extract a Bearer token from the Authorization header, or null. */
export function bearerFrom(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/**
 * null = allowed; otherwise the error Response to return as-is.
 * Never throws; never opens on a missing token.
 */
export async function gateAdminOrRespond(req: Request): Promise<Response | null> {
  const token = process.env.ADMIN_TOKEN ?? "";
  const bearer = bearerFrom(req);
  if (token && bearer && tokensMatch(bearer, token)) return null;

  // A bearer was presented but wrong/unusable — reject it explicitly rather
  // than silently falling through to the cookie path (surprising for APIs).
  if (bearer) {
    return Response.json({ ok: false, error: "admin_token_invalid" }, { status: 401 });
  }

  // No bearer: the interactive owner-session path (401 signed-out / 403
  // non-owner, fail-closed in unconfigured production).
  return gateIntelMutationOrRespond();
}
