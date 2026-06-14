import { NextResponse } from "next/server";
import { buildConsentUrl, getOrigin, oauthConfigured, storageConfigured } from "@/lib/gmail";

// Kicks off the Google OAuth consent flow. Generates a CSRF state nonce, stashes
// it in a short-lived httpOnly cookie, and redirects the browser to Google.
// Tokens are never touched here — only the callback exchanges the code.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "g_oauth_state";

export async function GET(req: Request): Promise<Response> {
  const origin = getOrigin(req);

  if (!oauthConfigured()) {
    return NextResponse.redirect(`${origin}/?comms=oauth_unconfigured`);
  }
  if (!storageConfigured()) {
    return NextResponse.redirect(`${origin}/?comms=storage_unconfigured`);
  }

  // CSRF protection: random state echoed back by Google and verified in the
  // callback against this cookie.
  const state = crypto.randomUUID();
  const consentUrl = buildConsentUrl(origin, state);

  const res = NextResponse.redirect(consentUrl);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // survives the top-level GET redirect back from Google
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 600, // 10 minutes to complete consent
  });
  return res;
}
