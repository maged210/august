import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, getOrigin } from "@/lib/gmail";

// OAuth callback. Google redirects here with ?code & ?state. We verify the CSRF
// state against the cookie, exchange the code for tokens SERVER-SIDE (the client
// secret never leaves the server), store the tokens in Upstash, then redirect
// back to the app. The browser never sees a token.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "g_oauth_state";

function back(origin: string, status: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/?comms=${status}#comms`);
  // One-shot: clear the state cookie regardless of outcome.
  res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: Request): Promise<Response> {
  const origin = getOrigin(req);
  const url = new URL(req.url);

  // Google reports user-declined consent or config errors via ?error.
  const oauthError = url.searchParams.get("error");
  if (oauthError) return back(origin, "denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back(origin, "invalid");

  // CSRF: the state must match the cookie we set when starting the flow.
  const cookieStore = await cookies();
  const expected = cookieStore.get(STATE_COOKIE)?.value;
  if (!expected || expected !== state) return back(origin, "state_mismatch");

  const result = await exchangeCode(origin, code);
  if (!result.ok) return back(origin, `error_${result.error}`);

  return back(origin, "connected");
}
