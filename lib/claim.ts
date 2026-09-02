// AUTH-1a — THE ACCOUNT CLAIM (DESIGN_LAWS L10). First sign-in from a device
// migrates its anonymous identity into the account: chat threads, memory,
// and the PIT player (records, XP, streaks, board names). One-way and
// idempotent: a claimed visitor id is marked and every later attempt no-ops.

import { Redis } from "@upstash/redis";
import { migrateThreads } from "./threads";
import { migrateMemory } from "./memory";
import { claimPitPlayer } from "./pit";
import { claimCallRecord } from "./call";
import { claimPushSubscriptions } from "./push";
import { normalizeEmail } from "./user-scope";

const MARKER = (vid: string) => `august:claim:v1:${vid}`;

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

export type ClaimResult =
  | { ok: true; already: boolean; threads: number }
  | { ok: false; error: string };

/** Migrate a visitor's whole anonymous identity into an account. */
export async function claimVisitor(emailRaw: string, visitorId: string): Promise<ClaimResult> {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "storage_not_configured" };
  const email = normalizeEmail(emailRaw);
  if (!email || !visitorId) return { ok: false, error: "claim_invalid" };
  try {
    const marked = await redis.get<string>(MARKER(visitorId));
    if (marked) return { ok: true, already: true, threads: 0 };
    const threads = await migrateThreads({ visitorId }, email);
    await migrateMemory({ visitorId }, email);
    await claimPitPlayer(`v:${visitorId}`, `u:${email}`);
    // THE CALL — the device's record + any live take follow the account
    await claimCallRecord(`v:${visitorId}`, `u:${email}`);
    // PWA push — the device's subscriptions follow too (the daily-call push
    // then personalizes with the account's record, not the orphaned visitor's)
    await claimPushSubscriptions(`v:${visitorId}`, `u:${email}`);
    await redis.set(MARKER(visitorId), email);
    return { ok: true, already: false, threads };
  } catch {
    return { ok: false, error: "claim_failed" };
  }
}
