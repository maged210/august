// Owner console push controls (feature/pwa-push). GET — the delivery log
// (last 14 daily sends + tests). POST {action:"test"} — a test notification
// to the OWNER's own subscriptions only (the account principal, plus the dev
// fallback so local testing works). Guarded by lib/admin's dual gate like
// every console route; never a broadcast (that stays behind PUSH_SEND_SECRET).
import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { composeCallPush, logTestSend, readCallPushLog } from "@/lib/call-push";
import { readCallState, type CallState } from "@/lib/call";
import { listSubscriptionsFor, dispatch, pushConfigured, vapidReady } from "@/lib/push";
import { OWNER_EMAIL } from "@/lib/user-scope";
import { etDate } from "@/lib/pit";
import type { RegimeRead } from "@/lib/regime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_REGIME = async (): Promise<RegimeRead> => ({ label: "UNAVAILABLE", because: [], agreement: null });

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  return Response.json({ ok: true, configured: pushConfigured(), log: await readCallPushLog() });
}

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  if (!pushConfigured() || !vapidReady()) {
    return Response.json({ ok: false, error: "push_not_configured" }, { status: 501 });
  }

  // the owner's devices: the account principal, plus the dev fallback
  // identity ONLY outside production (the aug_vid cookie is client-supplied,
  // so "v:dev-local" is forgeable — a prod test send must never reach it)
  const cids = [`u:${OWNER_EMAIL}`, ...(process.env.NODE_ENV === "production" ? [] : ["v:dev-local"])];
  const perCid = await Promise.all(cids.map((c) => listSubscriptionsFor(c)));
  const subs = perCid.flat();
  if (subs.length === 0) {
    return Response.json({ ok: false, error: "no_owner_subscriptions" }, { status: 404 });
  }

  // a REAL body when today has one (the exact message subscribers got or
  // would get); a plainly-marked wire check otherwise — never fabricated.
  // readonly: a stubbed-regime read must never bootstrap-write a day record.
  let state: CallState | null = null;
  try {
    state = await readCallState(`u:${OWNER_EMAIL}`, { readRegime: NO_REGIME, readonly: true });
  } catch {
    state = null;
  }
  const composed = state ? composeCallPush(state) : null;
  const payload = composed
    ? { ...composed, title: "THE CALL · TEST", url: "/", tag: "call-test" }
    : { title: "THE CALL · TEST", body: "the wire works — today carries no settled call to show", url: "/", tag: "call-test" };

  const r = await dispatch(subs, payload);
  await logTestSend({
    day: etDate(),
    recipients: perCid.filter((list) => list.length > 0).length,
    devices: r.total,
    sent: r.sent,
    pruned: r.pruned,
    failed: r.failed,
    at: Date.now(),
  });
  return Response.json({ ok: true, result: { devices: r.total, sent: r.sent, pruned: r.pruned, failed: r.failed } });
}
