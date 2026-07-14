// AUGUST sign-in — NextAuth v5 (5.0.0-beta.31), identity only.
//
// SCOPE DISCIPLINE (binding): this Google login requests IDENTITY ONLY —
// `openid email profile`. It is deliberately SEPARATE from the Comms
// Gmail/Calendar opt-in flow (lib/gmail.ts + /api/auth/google[/callback]),
// which keeps its own consent screen, scopes, and Upstash token store. The
// SAME Google Cloud OAuth client can carry both flows: just add NextAuth's
// redirect URI (/api/auth/callback/google) next to the Comms one in the
// console. Signing in never grants mail access.
//
// SESSIONS are stateless JWTs (no adapter, no DB) — the cookie is the whole
// session, exposing only { name, email, picture } from the Google profile.
//
// UNCONFIGURED MODE: when AUTH_SECRET or the Google client is absent the app
// keeps working as a single-user instance — middleware passes personal routes
// through (one console.warn), the landing hides its sign-in chip, and /login
// states honestly that auth isn't configured. Nothing crashes.

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// AUTH_GOOGLE_ID/SECRET are next-auth v5's native names; fall back to the
// existing Comms client (GOOGLE_CLIENT_ID/SECRET) so one client serves both.
const clientId = process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID ?? "";
const clientSecret =
  process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "";
const secret = process.env.AUTH_SECRET ?? "";

/** Env vars still needed before sign-in can turn on (empty when configured). */
export const authMissing: string[] = [
  ...(secret ? [] : ["AUTH_SECRET"]),
  ...(clientId ? [] : ["AUTH_GOOGLE_ID (or GOOGLE_CLIENT_ID)"]),
  ...(clientSecret ? [] : ["AUTH_GOOGLE_SECRET (or GOOGLE_CLIENT_SECRET)"]),
];

/** True when sign-in is fully configured; false = single-user fallback. */
export const authConfigured = authMissing.length === 0;

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: secret || undefined,
  // Deployed behind Vercel's proxy (and localhost in dev) — the forwarded
  // host is the real host. Required for the callback URL to resolve.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Google({
      clientId,
      clientSecret,
      // Identity ONLY — Gmail/Calendar scopes live exclusively in the
      // separate Comms opt-in flow. Never widen this.
      authorization: { params: { scope: "openid email profile" } },
    }),
  ],
});
