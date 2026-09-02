// Web Push — SERVER ONLY. VAPID config + the device-subscription store; the
// VAPID PRIVATE key never reaches the browser (only NEXT_PUBLIC_VAPID_PUBLIC_KEY
// is, deliberately, the public half). Degrades gracefully: with no Upstash or
// no VAPID env, every function is a no-op and the push UI reports "not
// configured".
//
// web-push runs on Node (crypto for VAPID JWT signing + aes128gcm payload
// encryption) — the routes that import this MUST be `runtime = "nodejs"`,
// never Edge. (The daily cron route that sends THE CALL push is nodejs.)
//
// STORE v2 (feature/pwa-push): ONE hash keyed by endpoint; each record
// carries its owner PRINCIPAL in the Pit's cid vocabulary (u:<email> |
// v:<visitorId>; dev fallback v:dev-local) — so ANONYMOUS devices subscribe
// too (the aug_vid principal), claimVisitor folds a device into the account
// by rewriting its descriptor (claimPushSubscriptions), and THE CALL's daily
// push can personalize per principal (their take, their record). The old
// per-email hashes (august:push:subs*) are dead but untouched; devices
// converge into v2 via the client's silent re-sync on load.

import webpush from "web-push";
import { Redis } from "@upstash/redis";

// PushSubscription.toJSON() shape from the browser. expirationTime is informational.
export type PushSub = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
};

/** the Pit's principal descriptor — "u:<email>" | "v:<visitorId>" */
export type PushPrincipal = string;

export type StoredPushSub = { sub: PushSub; principal: PushPrincipal; at: number };

const SUBS_V2 = "august:push:subs:v2";

/** The minimal store surface — injectable so node:test drives every path
 *  without Redis (house pattern). */
export type PushKv = {
  hset(key: string, fields: Record<string, unknown>): Promise<unknown>;
  hget(key: string, field: string): Promise<unknown>;
  hdel(key: string, field: string): Promise<unknown>;
  hgetall(key: string): Promise<unknown>;
};

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    _redis = url && token && url.startsWith("https://") ? new Redis({ url, token }) : null;
  } catch {
    _redis = null;
  }
  return _redis;
}

let _vapidReady = false;
// Configure web-push once. Returns false if VAPID env is incomplete (callers
// then report not-configured rather than throwing). subject must be mailto:/https:.
function ensureVapid(): boolean {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return false;
  if (!_vapidReady) {
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      _vapidReady = true;
    } catch (err) {
      console.error("[push] setVapidDetails failed:", err instanceof Error ? err.message : err);
      return false;
    }
  }
  return true;
}

/** VAPID configured + web-push initialized — senders check before dispatching. */
export function vapidReady(): boolean {
  return ensureVapid();
}

/** True when both the subscription store (Upstash) and the VAPID keypair are set. */
export function pushConfigured(): boolean {
  return (
    getRedis() !== null &&
    !!process.env.VAPID_SUBJECT &&
    !!process.env.VAPID_PUBLIC_KEY &&
    !!process.env.VAPID_PRIVATE_KEY
  );
}

/** email → descriptor for the legacy per-user callers (watchers, brief cron).
 *  null email = the single-user dev fallback, which subscribes as v:dev-local
 *  (pidFor's vocabulary); in production a null email stores nothing so this
 *  targets nothing — correct and harmless. */
export function emailDescriptor(email: string | null): PushPrincipal {
  return email ? `u:${email}` : "v:dev-local";
}

function parseStored(raw: unknown): StoredPushSub | null {
  try {
    const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as StoredPushSub;
    if (!v || typeof v.principal !== "string") return null;
    const s = v.sub;
    if (!s || typeof s.endpoint !== "string" || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string")
      return null;
    return v;
  } catch {
    return null;
  }
}

/** Store (upsert) a device subscription for this principal, keyed by endpoint
 *  (natural dedupe; re-subscribing overwrites; a device that later signs in
 *  re-syncs and the record moves to the account descriptor). */
export async function saveSubscription(
  cid: PushPrincipal,
  sub: PushSub,
  opts?: { kv?: PushKv | null },
): Promise<boolean> {
  const kv = opts?.kv !== undefined ? opts.kv : getRedis();
  if (!kv || !cid) return false;
  try {
    await kv.hset(SUBS_V2, {
      [sub.endpoint]: {
        sub: {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          expirationTime: sub.expirationTime ?? null,
        },
        principal: cid,
        at: Date.now(),
      } satisfies StoredPushSub,
    });
    return true;
  } catch (err) {
    console.error("[push] saveSubscription failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Remove a subscription by endpoint (the unsubscribe verb, and the prune on
 *  404/410). The endpoint is an unguessable capability URL minted by the push
 *  service — knowing it IS ownership, exactly as the push services themselves
 *  treat it. */
export async function deleteSubscription(
  endpoint: string,
  opts?: { kv?: PushKv | null },
): Promise<boolean> {
  const kv = opts?.kv !== undefined ? opts.kv : getRedis();
  if (!kv || !endpoint) return false;
  try {
    await kv.hdel(SUBS_V2, endpoint);
    return true;
  } catch (err) {
    console.error("[push] deleteSubscription failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Every stored device, with its principal. */
export async function listAllSubscriptions(opts?: { kv?: PushKv | null }): Promise<StoredPushSub[]> {
  const kv = opts?.kv !== undefined ? opts.kv : getRedis();
  if (!kv) return [];
  try {
    const all = (await kv.hgetall(SUBS_V2)) as Record<string, unknown> | null;
    return all ? Object.values(all).map(parseStored).filter((s): s is StoredPushSub => s !== null) : [];
  } catch (err) {
    console.error("[push] listAllSubscriptions failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** This principal's devices. */
export async function listSubscriptionsFor(
  cid: PushPrincipal,
  opts?: { kv?: PushKv | null },
): Promise<StoredPushSub[]> {
  return (await listAllSubscriptions(opts)).filter((s) => s.principal === cid);
}

/** AUTH-1a claim — a device that subscribed anonymously follows the account:
 *  every v:<vid> record is rewritten to u:<email>. Idempotent, best-effort. */
export async function claimPushSubscriptions(
  fromCid: PushPrincipal,
  toCid: PushPrincipal,
  opts?: { kv?: PushKv | null },
): Promise<number> {
  const kv = opts?.kv !== undefined ? opts.kv : getRedis();
  if (!kv || fromCid === toCid) return 0;
  try {
    const mine = (await listAllSubscriptions({ kv })).filter((s) => s.principal === fromCid);
    for (const s of mine) {
      await kv.hset(SUBS_V2, { [s.sub.endpoint]: { ...s, principal: toCid } });
    }
    return mine.length;
  } catch (err) {
    console.error("[push] claimPushSubscriptions failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

// --- sending ----------------------------------------------------------------

export type PushPayload = { title: string; body?: string; url?: string; tag?: string };
export type SendResult = {
  configured: boolean;
  total: number;
  sent: number;
  pruned: number;
  failed: number;
};

/** One physical send — injectable for tests. Throws with {statusCode} on
 *  push-service errors, exactly like web-push. */
export type PushTransport = (sub: PushSub, body: string) => Promise<void>;

const webpushTransport: PushTransport = async (sub, body) => {
  await webpush.sendNotification(sub as webpush.PushSubscription, body, {
    TTL: 12 * 3600, // the daily call is stale by the next session — don't retry past it
    urgency: "normal",
  });
};

/** The shared dispatch loop: 404/410 (Gone) prunes the subscription from the
 *  v2 store; other errors (400/401/403/413/429/5xx) keep it and are logged. */
export async function dispatch(
  targets: StoredPushSub[],
  payload: PushPayload,
  opts?: { kv?: PushKv | null; transport?: PushTransport },
): Promise<SendResult> {
  const transport = opts?.transport ?? webpushTransport;
  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;
  let failed = 0;
  await Promise.all(
    targets.map(async ({ sub }) => {
      try {
        await transport(sub, body);
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await deleteSubscription(sub.endpoint, opts); // Gone → prune
          pruned++;
        } else {
          failed++;
          console.error("[push] send failed", code, (err as { body?: string })?.body);
        }
      }
    }),
  );
  return { configured: true, total: targets.length, sent, pruned, failed };
}

/** Fan out to one principal's devices (watchers + the brief cron use the
 *  email form via sendToAll below; THE CALL's sender targets cids directly). */
export async function sendToPrincipal(
  cid: PushPrincipal,
  payload: PushPayload,
  opts?: { kv?: PushKv | null; transport?: PushTransport },
): Promise<SendResult> {
  if (!opts?.transport && !ensureVapid()) return { configured: false, total: 0, sent: 0, pruned: 0, failed: 0 };
  return dispatch(await listSubscriptionsFor(cid, opts), payload, opts);
}

/** Legacy per-user signature kept for lib/watchers + the brief cron. */
export async function sendToAll(email: string | null, payload: PushPayload): Promise<SendResult> {
  return sendToPrincipal(emailDescriptor(email), payload);
}

/** Every stored device (deduped by construction — one hash). Used by the
 *  PUSH_SEND_SECRET-guarded test endpoint. */
export async function sendBroadcast(payload: PushPayload): Promise<SendResult> {
  if (!ensureVapid()) return { configured: false, total: 0, sent: 0, pruned: 0, failed: 0 };
  return dispatch(await listAllSubscriptions(), payload);
}
