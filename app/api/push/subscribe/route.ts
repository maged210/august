// Device push subscriptions (feature/pwa-push). POST stores this device's
// PushSubscription.toJSON() under the caller's PRINCIPAL (the Pit's cid —
// signed-in u:<email>, anonymous v:<aug_vid>); DELETE removes by endpoint
// (the unsubscribe verb — the endpoint is an unguessable capability URL, so
// knowing it is ownership, the same trust model the push services use).
// Anonymous devices subscribe too; AUTH-1a's claim folds them into the
// account (claimPushSubscriptions). Rate-limited; nothing secret stored.
import { type NextRequest } from "next/server";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { deleteSubscription, pushConfigured, saveSubscription, type PushSub } from "@/lib/push";
import { resolveChatPrincipal } from "@/lib/user-scope";
import { pidFor } from "@/lib/pit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withCookie(res: Response, setCookie: string | null): Response {
  if (setCookie) res.headers.append("Set-Cookie", setCookie);
  return res;
}

export async function POST(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("push", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  if (!pushConfigured()) return new Response("Push not configured", { status: 501 });

  const { principal, setCookie } = await resolveChatPrincipal(req);
  const cid = pidFor(principal);
  if (!cid) return Response.json({ ok: false, error: "no_identity" }, { status: 400 });

  let sub: PushSub;
  try {
    sub = (await req.json()) as PushSub;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }
  if (
    !sub ||
    typeof sub.endpoint !== "string" ||
    !sub.endpoint.startsWith("https://") ||
    sub.endpoint.length > 1024 ||
    !sub.keys ||
    typeof sub.keys.p256dh !== "string" ||
    typeof sub.keys.auth !== "string"
  ) {
    return new Response("Invalid subscription.", { status: 400 });
  }

  const ok = await saveSubscription(cid, {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    expirationTime: sub.expirationTime ?? null,
  });
  if (!ok) return Response.json({ ok: false, error: "store_write_failed" }, { status: 502 });
  return withCookie(Response.json({ ok: true }, { status: 201 }), setCookie);
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("push", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  if (!pushConfigured()) return new Response("Push not configured", { status: 501 });

  let body: { endpoint?: unknown };
  try {
    body = (await req.json()) as { endpoint?: unknown };
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  if (!endpoint.startsWith("https://")) {
    return new Response("Invalid endpoint.", { status: 400 });
  }
  await deleteSubscription(endpoint);
  return Response.json({ ok: true });
}
