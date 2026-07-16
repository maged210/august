// Store a browser push subscription. The client POSTs PushSubscription.toJSON()
// here after the user enables notifications. Subscriptions are stored server-side
// in Upstash (keyed by endpoint → dedupe + multi-device); nothing secret is here.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { pushConfigured, saveSubscription, type PushSub } from "@/lib/push";
import { resolveUserOr401 } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("push", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  // Session → namespace (stage 2): a device subscribes for THIS user (also in
  // the middleware matcher; this is the in-route defense-in-depth).
  const user = await resolveUserOr401();
  if (!user.ok) return user.response;

  // Not configured (no Upstash / no VAPID) → 501 so the client can report cleanly.
  if (!pushConfigured()) return new Response("Push not configured", { status: 501 });

  let sub: PushSub;
  try {
    sub = (await req.json()) as PushSub;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  // Validate the essential PushSubscription fields before storing.
  if (
    !sub ||
    typeof sub.endpoint !== "string" ||
    !sub.keys ||
    typeof sub.keys.p256dh !== "string" ||
    typeof sub.keys.auth !== "string"
  ) {
    return new Response("Invalid subscription.", { status: 400 });
  }

  await saveSubscription(user.email, {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    expirationTime: sub.expirationTime ?? null,
  });

  return Response.json({ ok: true }, { status: 201 });
}
