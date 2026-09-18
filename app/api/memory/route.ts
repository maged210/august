// Memory control plane. The client calls this in the background after each
// exchange (never blocking the reply) and to wipe memory via /forget.
// All Upstash + model work happens server-side.
import { updateMemoryFromExchange, clearMemory } from "@/lib/memory";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { resolveChatPrincipal } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("memory", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  // HOTFIX (chat privacy): memory is chat-derived personal data. Anonymous
  // production traffic used to hit the LEGACY SHARED store — every visitor's
  // exchanges fed one global memory, /forget wiped it for everyone, and the
  // chat route leaked it back to strangers. Same per-visitor principal as
  // threads now; legacy remains only as the dev single-user fallback.
  const { principal, setCookie } = await resolveChatPrincipal(req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const action = b.action;

  if (action === "forget") {
    // L9 — 204 used to mean both "wiped" and "there is no store to wipe". The
    // caller renders what this says, so it has to be true.
    const wiped = await clearMemory(principal);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (setCookie) headers["Set-Cookie"] = setCookie;
    return new Response(JSON.stringify(wiped.ok ? { ok: true } : { ok: false, error: wiped.reason }), {
      status: wiped.ok ? 200 : 502,
      headers,
    });
  }

  if (action === "update") {
    const sessionId = typeof b.sessionId === "string" ? b.sessionId : "";
    const userText = typeof b.userText === "string" ? b.userText : "";
    const assistantText = typeof b.assistantText === "string" ? b.assistantText : "";
    if (!sessionId || !userText || !assistantText) {
      return new Response("Missing fields.", { status: 400 });
    }
    // The CLIENT fires this without awaiting, so the reply is never blocked. We
    // await here so the function stays alive until the write completes.
    const wrote = await updateMemoryFromExchange({ email: principal, sessionId, userText, assistantText });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (setCookie) headers["Set-Cookie"] = setCookie;
    return new Response(JSON.stringify(wrote.ok ? { ok: true } : { ok: false, error: wrote.reason }), {
      status: wrote.ok ? 200 : 502,
      headers,
    });
  }

  return new Response("Unknown action.", { status: 400 });
}
