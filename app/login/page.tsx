// /login — one decision on the page. Server component: the session is read
// server-side (already signed in → straight back to the deck) and the
// "Continue with Google" button submits a server action that starts the
// NextAuth v5 Google flow (identity-only scopes — see auth.ts).
//
// Design language: the home landing's face (Geist, the gold dot wordmark,
// the day/night palettes) — styles live in globals.css under .login-page.
// When auth isn't configured, the page says so honestly instead of showing
// a button that can't work.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signIn, authConfigured, authMissing } from "@/auth";

export const metadata: Metadata = { title: "AUGUST — sign in" };

// Always render per-request: the configured/unconfigured state and the
// already-signed-in redirect must reflect the RUNTIME env, never a value
// baked in at build time (a build without AUTH_SECRET would otherwise
// prerender the "not configured" note permanently).
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (authConfigured) {
    const session = await auth();
    if (session?.user) redirect("/");
  }

  return (
    <main className="login-page">
      <div className="lp-card">
        <div className="lp-brand">
          <span className="lp-dot" aria-hidden />
          <span className="lp-wordmark">AUGUST</span>
        </div>
        <p className="lp-copy">Your private intelligence companion.</p>
        {authConfigured ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button type="submit" className="lp-google">
              Continue with Google
            </button>
          </form>
        ) : (
          <p className="lp-note">
            Sign-in isn&apos;t configured on this instance — missing{" "}
            {authMissing.join(", ")}. Running in single-user mode;{" "}
            <a className="lp-back" href="/">
              continue to AUGUST
            </a>
            .
          </p>
        )}
      </div>
    </main>
  );
}
