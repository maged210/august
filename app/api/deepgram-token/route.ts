// Deepgram short-lived token mint. The raw DEEPGRAM_API_KEY is read ONLY here on
// the server and NEVER reaches the browser. The client calls POST to receive a
// short-lived grant JWT (usage::write scope) that is valid just long enough to
// open the streaming WebSocket; after connect, the socket stays open on its own.
//
//   GET  → { configured: boolean }            cheap availability probe, no mint
//   POST → { access_token, expires_in }        mints a grant token
//
// Token-based auth is Deepgram's current recommended browser flow (supersedes the
// legacy temporary-API-key endpoint). Ref:
//   https://developers.deepgram.com/guides/fundamentals/token-based-authentication
//   https://developers.deepgram.com/reference/auth/tokens/grant
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
// The JWT only needs to be valid at WebSocket-connect time, but a slightly longer
// TTL lets the client cache one token across a few back-to-back voice turns
// (each think→speak gap can exceed 30s) without re-minting. Still short-lived.
const TTL_SECONDS = 120;

// Cheap probe so the client can decide whether to offer Deepgram STT at all
// (without spending a mint). Never leaks the key — only whether one is present.
export function GET(): Response {
  const configured = !!process.env.DEEPGRAM_API_KEY;
  return Response.json(
    { configured },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("token", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const apiKey = process.env.DEEPGRAM_API_KEY;
  // Not configured → 501 so the client falls back to Web Speech / text cleanly.
  if (!apiKey) {
    return new Response("Deepgram not configured", { status: 501 });
  }

  let dgRes: Response;
  try {
    dgRes = await fetch(GRANT_URL, {
      method: "POST",
      headers: {
        // Server→grant uses the "Token" scheme with the secret key. (The browser
        // later uses the returned JWT, never this key.)
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: TTL_SECONDS }),
    });
  } catch (err) {
    // Log server-side; return a generic message so internal network/DNS detail
    // isn't disclosed to the unauthenticated caller. The client falls back on the
    // 502 status, not the body text.
    console.error("[deepgram-token] request failed:", err instanceof Error ? err.message : err);
    return new Response("Deepgram request failed", { status: 502 });
  }

  if (!dgRes.ok) {
    // Don't reflect Deepgram's upstream body (request IDs, account/quota strings) —
    // log it server-side and return a generic error.
    const detail = await dgRes.text().catch(() => "");
    console.error(`[deepgram-token] grant failed ${dgRes.status}: ${detail}`);
    return new Response("Deepgram grant failed", { status: 502 });
  }

  // Pass through only the two fields the client needs — never anything else.
  let access_token = "";
  let expires_in = 0;
  try {
    const j = (await dgRes.json()) as { access_token?: string; expires_in?: number };
    access_token = typeof j.access_token === "string" ? j.access_token : "";
    expires_in = typeof j.expires_in === "number" ? j.expires_in : 0;
  } catch {
    return new Response("Deepgram returned an unexpected response", { status: 502 });
  }
  if (!access_token) {
    return new Response("Deepgram returned no token", { status: 502 });
  }

  return Response.json(
    { access_token, expires_in },
    { headers: { "Cache-Control": "no-store" } },
  );
}
