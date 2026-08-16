// Auth middleware — gates the PERSONAL API surface only. Stage 1 of the
// multi-user conversion: identity at the edge; data namespacing is stage 2,
// signed-out page UX is stage 3 (no page is hard-gated here — the deck stays
// browsable signed out).
//
// GATED (signed out → 401): lib/route-gates GATED — personal integrations
// and paid-quota surfaces only (/api/day, /api/comms, /api/inbox, /api/brief,
// /api/speak, /api/deepgram-token, /api/push/subscribe).
//
// NEVER GATED (AUTH-1a B1, the chat-privacy-hotfix surface): /api/chat,
// /api/threads, /api/memory, /api/pit — these serve anonymous visitors via
// per-visitor principals; a missing vid is MINTED, never refused. A session
// upgrades the principal; its absence changes nothing.
//
// NOT gated (public data or separately protected):
//   /api/cron/*  (CRON_SECRET)  ·  /api/markets  ·  /api/quakes
//   /api/intel/* (reads/quotes/desk; MUTATIONS are owner-gated in-route)
//   /api/command  ·  /api/flights  ·  /api/push/send (PUSH_SEND_SECRET)
//   /api/auth/*  ·  every page route
//
// UNCONFIGURED (no AUTH_SECRET / Google client): pass everything through with
// a one-time console.warn — the single-user dev fallback documented in
// .env.local.example. Nothing 401s until auth is actually configured.

import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import type { NextAuthRequest } from "next-auth";
import { auth, authConfigured } from "@/auth";
import { isGated } from "@/lib/route-gates";

let warnedUnconfigured = false;

// auth(fn) augments the request with the decoded session (req.auth) and uses
// fn's response verbatim — no config.callbacks.authorized is defined, so no
// built-in redirect behavior interferes with these JSON 401s. The explicit
// param types pin auth()'s middleware overload (not the route-handler one).
const guard = auth((req: NextAuthRequest, _event: NextFetchEvent) => {
  // AUTH-1a B1: the gate list is data (lib/route-gates) and unit-tested —
  // the anonymous principal surface (chat/threads/memory/pit) never 401s.
  // Auth is ADDITIVE: a session upgrades the principal; absence changes nothing.
  if (isGated(req.nextUrl.pathname) && !req.auth?.user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }
  return NextResponse.next();
});

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (!authConfigured) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[auth] sign-in not configured (AUTH_SECRET + Google client) — " +
          "personal API routes are open in single-user fallback mode.",
      );
    }
    return NextResponse.next();
  }
  return guard(req, event);
}

// Tight matcher: ONLY the personal API routes above — the middleware never
// runs on pages, assets, or the public data feeds. `:path*` matches zero or
// more segments, so `/api/chat` itself is covered.
// (kept in sync with lib/route-gates GATED — the matcher must be static; the
// runtime isGated() check is the authority, this only trims execution. The
// former chat/threads/memory/watchlist/feeds entries are GONE: those routes
// serve anonymous visitors via per-visitor principals — B1.)
export const config = {
  matcher: [
    "/api/brief/:path*",
    "/api/speak/:path*",
    "/api/deepgram-token/:path*",
    "/api/push/subscribe/:path*",
  ],
};
