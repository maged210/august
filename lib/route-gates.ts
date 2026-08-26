// AUTH-1a B1 — the session-gate route list as DATA, pure and unit-tested.
//
// LAW (SCOPE RULING, DESIGN_LAWS L10): auth is ADDITIVE. Every route that
// serves anonymous visitors through the per-visitor principal (chat,
// memory — the chat-privacy-hotfix surface) must NEVER be middleware-gated:
// a missing visitor id gets minted, never refused. The middleware gates only
// the truly personal / spend surfaces that have no anonymous mode.
//
// middleware.ts consumes GATED at runtime; the smoke suite asserts the
// anonymous surface stays open. Editing this list is editing the contract.

/** Session-required route prefixes (signed out → 401). Personal integrations
 *  and paid-quota surfaces only. */
export const GATED: readonly string[] = [
  // (R1 A1: /api/day, /api/comms, /api/inbox routes were DELETED with their
  //  parked surfaces — rebuild from git when wanted. Voice retirement Aug 2026
  //  deleted /api/speak + /api/deepgram-token outright.)
  "/api/brief", // personal calendar+inbox brief (headlines are separate + public)
  "/api/push/subscribe", // per-user device subscriptions
];

/** Anonymous-capable principal routes — the hotfix surface. Listed here ONLY
 *  so the suite can assert they never appear in GATED. */
export const ANONYMOUS_SURFACE: readonly string[] = [
  "/api/chat",
  "/api/memory",
  "/api/pit",
  "/api/ideas",
  "/api/watchlist", // in-route guard decides; anonymous callers are tolerated
  "/api/feeds",
];

/** PURE. Does the session gate apply to this pathname? */
export function isGated(pathname: string): boolean {
  return GATED.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
