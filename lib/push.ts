// Web Push — SERVER ONLY. VAPID keypair + the device-subscription store live here;
// the VAPID PRIVATE key never reaches the browser (only NEXT_PUBLIC_VAPID_PUBLIC_KEY
// is, deliberately, the public half). Mirrors the lib/gmail.ts Redis pattern and
// degrades gracefully: with no Upstash or no VAPID env, every function is a no-op
// and the push UI reports "not configured".
//
// web-push runs on Node (crypto for VAPID JWT signing + aes128gcm payload
// encryption) — the routes that import this MUST be `runtime = "nodejs"`, never Edge.

import webpush from "web-push";
import { Redis } from "@upstash/redis";

// PushSubscription.toJSON() shape from the browser. expirationTime is informational.
export type PushSub = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
};

// One Redis hash, field = endpoint (the natural unique key) → subscription JSON.
// Dedupes automatically (re-subscribing the same device overwrites its field) and
// supports multiple devices (one field each).
const SUBS_KEY = "august:push:subs";

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

let _vapidReady = false;
// Configure web-push once. Returns false if VAPID env is incomplete (the send route
// then reports not-configured rather than throwing). subject must be mailto:/https:.
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

/** True when both the subscription store (Upstash) and the VAPID keypair are set. */
export function pushConfigured(): boolean {
  return (
    getRedis() !== null &&
    !!process.env.VAPID_SUBJECT &&
    !!process.env.VAPID_PUBLIC_KEY &&
    !!process.env.VAPID_PRIVATE_KEY
  );
}

/** Store (upsert) a device subscription, keyed by its endpoint. */
export async function saveSubscription(sub: PushSub): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.hset(SUBS_KEY, {
      [sub.endpoint]: {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        expirationTime: sub.expirationTime ?? null,
      } satisfies PushSub,
    });
  } catch (err) {
    console.error("[push] saveSubscription failed:", err instanceof Error ? err.message : err);
  }
}

/** All stored device subscriptions. */
export async function listSubscriptions(): Promise<PushSub[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const all = await redis.hgetall<Record<string, PushSub>>(SUBS_KEY);
    return all ? Object.values(all) : [];
  } catch (err) {
    console.error("[push] listSubscriptions failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Remove a dead subscription (called on a 404/410 from the push service). */
export async function removeSubscription(endpoint: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.hdel(SUBS_KEY, endpoint);
  } catch (err) {
    console.error("[push] removeSubscription failed:", err instanceof Error ? err.message : err);
  }
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string };
export type SendResult = {
  configured: boolean;
  total: number;
  sent: number;
  pruned: number;
  failed: number;
};

/** Fan out a notification to every stored device. web-push auto-encrypts the JSON
 *  payload; a 404/410 means the subscription is gone, so we prune it. Other errors
 *  (400/401/403/413/429/5xx) keep the subscription and are logged. */
export async function sendToAll(payload: PushPayload): Promise<SendResult> {
  if (!ensureVapid()) return { configured: false, total: 0, sent: 0, pruned: 0, failed: 0 };
  const subs = await listSubscriptions();
  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub as webpush.PushSubscription, body, {
          TTL: 60, // seconds the push service retains it if the device is offline
          urgency: "normal",
        });
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await removeSubscription(sub.endpoint); // Gone → prune
          pruned++;
        } else {
          failed++;
          console.error("[push] send failed", code, (err as { body?: string })?.body);
        }
      }
    }),
  );

  return { configured: true, total: subs.length, sent, pruned, failed };
}
