// Auth middleware — gates the PERSONAL API surface only. Stage 1 of the
// multi-user conversion: identity at the edge; data namespacing is stage 2,
// signed-out page UX is stage 3 (no page is hard-gated here — the deck stays
// browsable signed out).
//
// GATED (signed out → 401 {"error":"auth_required"}):
//   /api/chat            Anthropic spend + the user's context
//   /api/memory          the user's memory store
//   /api/threads(/[id])  conversation persistence
//   /api/day             Google Calendar today-view
//   /api/comms/*         Gmail draft + send
//   /api/inbox           Gmail inbox digest
//   /api/brief           GET returns the personal cached brief body (calendar
//                        + inbox digest), so BOTH methods are gated — not
//                        just the on-demand compile POST
//   /api/speak           ElevenLabs quota
//   /api/deepgram-token  Deepgram STT grant mint
//
// NOT gated (public data or separately protected):
//   /api/cron/*  (CRON_SECRET)  ·  /api/markets  ·  /api/quakes
//   /api/intel/* (reads/quotes/desk)  ·  /api/command  ·  /api/flights
//   /api/push/*  (stage 2)  ·  /api/auth/*  ·  every page route
//
// UNCONFIGURED (no AUTH_SECRET / Google client): pass everything through with
// a one-time console.warn — the single-user dev fallback documented in
// .env.local.example. Nothing 401s until auth is actually configured.

import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import type { NextAuthRequest } from "next-auth";
import { auth, authConfigured } from "@/auth";

let warnedUnconfigured = false;

// auth(fn) augments the request with the decoded session (req.auth) and uses
// fn's response verbatim — no config.callbacks.authorized is defined, so no
// built-in redirect behavior interferes with these JSON 401s. The explicit
// param types pin auth()'s middleware overload (not the route-handler one).
const guard = auth((req: NextAuthRequest, _event: NextFetchEvent) => {
  if (!req.auth?.user) {
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
export const config = {
  matcher: [
    "/api/chat/:path*",
    "/api/memory/:path*",
    "/api/threads/:path*",
    "/api/day/:path*",
    "/api/comms/:path*",
    "/api/inbox/:path*",
    "/api/brief/:path*",
    "/api/speak/:path*",
    "/api/deepgram-token/:path*",
  ],
};
