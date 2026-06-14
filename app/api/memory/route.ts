// Memory control plane. The client calls this in the background after each
// exchange (never blocking the reply) and to wipe memory via /forget.
// All Upstash + model work happens server-side.
import { updateMemoryFromExchange, clearMemory } from "@/lib/memory";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("memory", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const action = b.action;

  if (action === "forget") {
    await clearMemory();
    return new Response(null, { status: 204 });
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
    await updateMemoryFromExchange({ sessionId, userText, assistantText });
    return new Response(null, { status: 204 });
  }

  return new Response("Unknown action.", { status: 400 });
}
