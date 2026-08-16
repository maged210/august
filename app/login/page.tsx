// /login — one decision on the page (AUTH-1a: EMAIL MAGIC LINK, no OAuth).
// Server component: the session is read server-side (already signed in →
// straight back), and the email form submits a server action that starts the
// NextAuth v5 Resend flow. Sign-in is ADDITIVE (DESIGN_LAWS L10): the page
// says what an account adds and offers the way back without one.
//
// Design language: the home landing's face — styles live in globals.css
// under .login-page. When auth isn't configured, the page says so honestly.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signIn, authConfigured, authMissing } from "@/auth";

export const metadata: Metadata = { title: "AUGUST — sign in" };

// Always render per-request: the configured/unconfigured state and the
// already-signed-in redirect must reflect the RUNTIME env, never a value
// baked in at build time.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (authConfigured) {
    const session = await auth();
    if (session?.user?.email) redirect("/");
  }
  const sent = params.sent === "1";
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="login-page">
      <div className="lp-card">
        <div className="lp-brand">
          <span className="lp-dot" aria-hidden />
          <span className="lp-wordmark">AUGUST</span>
        </div>
        {sent ? (
          <>
            <p className="lp-copy">Check your inbox.</p>
            <p className="lp-note">
              A one-tap sign-in link is on its way. It expires in 24 hours; the
              tab can be closed.{" "}
              <a className="lp-back" href="/">
                back to AUGUST
              </a>
            </p>
          </>
        ) : authConfigured ? (
          <>
            <p className="lp-copy">
              One email, no password. Your threads, PIT career, and records
              follow you to every device.
            </p>
            {error ? (
              <p className="lp-note lp-err">
                That link didn&apos;t work (expired or already used) — request a
                fresh one below.
              </p>
            ) : null}
            <form
              className="lp-mail"
              action={async (formData: FormData) => {
                "use server";
                const email = String(formData.get("email") ?? "").trim();
                if (!email) return;
                await signIn("resend", { email, redirectTo: "/" });
              }}
            >
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                aria-label="Email address"
              />
              <button type="submit" className="lp-google">
                EMAIL ME A SIGN-IN LINK
              </button>
            </form>
            <p className="lp-note">
              No account needed to use AUGUST —{" "}
              <a className="lp-back" href="/">
                continue without signing in
              </a>
              .
            </p>
          </>
        ) : (
          <p className="lp-note">
            Sign-in isn&apos;t configured on this instance — missing{" "}
            {authMissing.join(", ")}. Running in anonymous mode;{" "}
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
