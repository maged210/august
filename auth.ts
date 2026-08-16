// AUGUST sign-in — NextAuth v5, AUTH-1a: EMAIL MAGIC LINK ONLY (Resend).
// No passwords, no OAuth. Identity only — sign-in adds continuity across
// devices and never gates content (DESIGN_LAWS L10; the wall is PARKED).
//
// USER RECORD lives in the Upstash adapter under august:auth:* — id, email,
// emailVerified. isOwner is DERIVED (email === OWNER_EMAIL from
// lib/user-scope), never stored; ADMIN_TOKEN survives as break-glass only.
//
// SESSIONS are stateless JWTs; the adapter exists for the email provider's
// verification tokens + the user record. The cookie exposes only { email }.
//
// DEV MODE: with no Resend key outside production, the magic link prints to
// the server console instead of sending mail — the full flow works locally.
//
// UNCONFIGURED MODE (production without AUTH_SECRET/Resend): the app keeps
// working as before — /api/auth/session answers 200 null via the route's
// honest fallback, prompts hide, nothing crashes.

import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { UpstashRedisAdapter } from "@auth/upstash-redis-adapter";
import { Redis } from "@upstash/redis";
import { OWNER_EMAIL } from "@/lib/user-scope";

const secret = process.env.AUTH_SECRET ?? "";
const resendKey = process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY ?? "";
const from = process.env.AUTH_EMAIL_FROM ?? "AUGUST <onboarding@resend.dev>";

const storeUrl = process.env.UPSTASH_REDIS_REST_URL ?? "";
const storeToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
const store =
  storeUrl.startsWith("https://") && storeToken ? new Redis({ url: storeUrl, token: storeToken }) : null;

/** Dev fallback: no mail service, the link prints to the console. */
const devMagicLink = process.env.NODE_ENV !== "production" && !resendKey;

/** Env vars still needed before sign-in can turn on (empty when configured). */
export const authMissing: string[] = [
  ...(secret ? [] : ["AUTH_SECRET"]),
  ...(resendKey || devMagicLink ? [] : ["AUTH_RESEND_KEY"]),
  ...(store ? [] : ["UPSTASH_REDIS_REST_URL/TOKEN"]),
];

/** True when sign-in is fully configured; false = anonymous-only fallback. */
export const authConfigured = authMissing.length === 0;

/** PURE. The one owner check — derived, never stored. */
export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === OWNER_EMAIL;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: secret || undefined,
  trustHost: true,
  adapter: store ? UpstashRedisAdapter(store, { baseKeyPrefix: "august:auth:" }) : undefined,
  session: { strategy: "jwt" },
  providers: [
    Resend({
      apiKey: resendKey || "dev-unsent",
      from,
      ...(devMagicLink
        ? {
            async sendVerificationRequest({ identifier, url }: { identifier: string; url: string }) {
              console.log(`[auth dev] magic link for ${identifier}:\n${url}`);
            },
          }
        : {}),
    }),
  ],
  pages: { signIn: "/login", verifyRequest: "/login?sent=1", error: "/login" },
  callbacks: {
    session({ session }) {
      // identity only: email is the whole payload; isOwner derives everywhere
      return session;
    },
  },
});
