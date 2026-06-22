// Fire a push notification to every stored device. PROTECTED by a secret header
// (x-push-secret === PUSH_SEND_SECRET) so only the owner (or a trusted backend /
// future cron) can spend pushes. This is the manual test endpoint AND the seam the
// Morning Brief / Watchers will call later. VAPID private key stays in lib/push.
import { timingSafeEqual } from "crypto";
import { pushConfigured, sendToAll, type PushPayload } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time secret comparison. Length is checked first (a length mismatch can't
// be a match anyway); the high-entropy secret makes the length leak immaterial.
function secretOk(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.PUSH_SEND_SECRET;
  // No secret configured → endpoint is disabled by design (never left open).
  if (!expected) return new Response("Push send disabled (no PUSH_SEND_SECRET).", { status: 501 });

  const provided = req.headers.get("x-push-secret") ?? "";
  if (!secretOk(provided, expected)) return new Response("Unauthorized", { status: 401 });

  if (!pushConfigured()) return new Response("Push not configured", { status: 501 });

  // Optional JSON body overrides the test defaults.
  let payload: PushPayload = { title: "AUGUST", body: "A test notification from AUGUST.", url: "/" };
  try {
    const body = (await req.json()) as Partial<PushPayload>;
    payload = {
      title: typeof body.title === "string" && body.title.trim() ? body.title : payload.title,
      body: typeof body.body === "string" ? body.body : payload.body,
      url: typeof body.url === "string" && body.url ? body.url : payload.url,
      tag: typeof body.tag === "string" ? body.tag : undefined,
    };
  } catch {
    /* no/!json body — use the defaults above */
  }

  const result = await sendToAll(payload);
  console.log(
    `[push] send → total=${result.total} sent=${result.sent} pruned=${result.pruned} failed=${result.failed}`,
  );
  return Response.json(result);
}
