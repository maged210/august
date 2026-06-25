// Send a reply — SERVER. THE ONLY ROUTE IN THE APP THAT SENDS MAIL.
//
// SAFETY MODEL (the whole point of this feature):
//   - This runs ONLY from the user's explicit tap in the Comms UI. There is NO LLM
//     tool that reaches it (lib/tools.ts has no send tool) and no model runs here.
//   - The body is sent VERBATIM — exactly the text the user confirmed. No model, no
//     rewrite, no "send after N seconds", no batching, no retry.
//   - The recipient + threading are re-derived SERVER-SIDE from messageId inside
//     lib/gmail.ts sendReply(), so the reply can only go back to the original
//     thread's sender — the client cannot redirect it elsewhere.
import { sendReply } from "@/lib/gmail";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 25_000; // a sane ceiling for a reply body

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("commsSend", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  let messageId = "";
  let body = "";
  try {
    const json = await req.json();
    messageId = typeof json?.messageId === "string" ? json.messageId : "";
    body = typeof json?.body === "string" ? json.body : "";
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad_request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!messageId) {
    return Response.json({ ok: false, error: "messageId_required" }, { status: 400 });
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return Response.json({ ok: false, error: "empty_body" }, { status: 400 });
  }
  if (body.length > MAX_BODY) {
    return Response.json({ ok: false, error: "body_too_long" }, { status: 413 });
  }

  // sendReply re-derives to/subject/threading from the original and dispatches the
  // body verbatim. It returns a structured result — surface failures, never retry.
  const result = await sendReply(messageId, trimmed);

  if (!result.ok) {
    // Map the few states that need a distinct client message; 502 for the rest.
    const status =
      result.error === "needs_send_consent" || result.error === "insufficient_scope"
        ? 403
        : result.error === "not_connected"
          ? 401
          : result.error === "message_not_found"
            ? 404
            : 502;
    return Response.json(result, { status });
  }

  console.log(`[comms/send] sent reply in-thread to=${result.to.slice(0, 60)}`);
  return Response.json(result);
}
