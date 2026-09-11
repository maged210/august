// ACCOUNT DELETION (chore/ship-ready). SERVER ONLY.
//
// A signed-in user must be able to delete their account and have it actually
// happen. This module is the whole list, traced key by key out of the stores
// rather than guessed, and it reports what it did so the caller can show the
// truth instead of a green tick.
//
// THE IDENTIFIERS IN PLAY, because the stores disagree about what a user is:
//   email          — the account namespace: `user:{email}:…` and the auth records
//   cid / pid      — the principal: `u:{email}` for an account (the PIT, THE
//                    CALL and the ask lane all key by this)
//   aug_vid        — the anonymous device id. A device that was CLAIMED left
//                    markers keyed by the DEVICE, carrying the email in the
//                    VALUE, so those are found by scanning values, not keys.
//
// WHAT IT CANNOT REACH, stated rather than silently skipped (see the return
// value's `unreachable`): anything held in the user's own browser. The
// aug_vid cookie is cleared by the route on the way out, but localStorage
// (theme, an in-progress PIT run, the `aug-claimed` marker that holds the raw
// email) is the browser's, not the server's. Host request logs at Vercel are
// likewise outside this application.

import { Redis } from "@upstash/redis";
import { normalizeEmail } from "@/lib/user-scope";

export type DeleteReport = {
  ok: boolean;
  /** every key actually removed, for the confirmation screen and the log */
  deleted: string[];
  /** set/hash/zset members removed rather than whole keys */
  membersRemoved: string[];
  /** things this deletion provably cannot reach, each with the reason */
  unreachable: string[];
  error?: string;
};

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    return url && token && url.startsWith("https://") ? new Redis({ url, token }) : null;
  } catch {
    return null;
  }
}

/** SCAN every key matching a pattern. The store has no index for the
 *  token/ask/per-day keys, and a missed key is a record that outlives the
 *  account, so a full cursor walk is the honest cost of the feature. */
async function scanAll(redis: Redis, match: string, cap = 5000): Promise<string[]> {
  const out: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = (await redis.scan(cursor, { match, count: 500 })) as [string, string[]];
    out.push(...batch);
    cursor = String(next);
  } while (cursor !== "0" && out.length < cap);
  return [...new Set(out)];
}

/**
 * Delete everything belonging to one account.
 *
 * `visitorId` is the caller's OWN aug_vid when they have one — it lets the
 * sweep clear that device's markers directly. Devices the user claimed from
 * some OTHER browser are still found, by scanning the claim markers' VALUES
 * for this email, because those keys are named after the device and not the
 * account.
 */
export async function deleteAccount(
  emailRaw: string,
  opts: { visitorId?: string | null } = {},
): Promise<DeleteReport> {
  const email = normalizeEmail(emailRaw);
  const report: DeleteReport = { ok: false, deleted: [], membersRemoved: [], unreachable: [] };
  if (!email) return { ...report, error: "no_email" };

  const redis = getRedis();
  if (!redis) return { ...report, error: "storage_not_configured" };

  const cid = `u:${email}`;
  const kill = async (key: string) => {
    try {
      const n = await redis.del(key);
      if (n) report.deleted.push(key);
    } catch {
      report.unreachable.push(`${key} — delete failed`);
    }
  };

  try {
    // ── 1. the auth records ────────────────────────────────────────────────
    // the email→id pointer is the only way to reach the user record and the
    // by-user-id indexes, so it is read BEFORE anything is removed
    let userId: string | null = null;
    try {
      const rec = (await redis.get(`august:auth:user:email:${email}`)) as { id?: string } | string | null;
      userId = typeof rec === "string" ? rec : (rec?.id ?? null);
    } catch {
      /* fall through — the scoped sweep below does not depend on it */
    }
    await kill(`august:auth:user:email:${email}`);
    if (userId) {
      await kill(`august:auth:user:${userId}`);
      await kill(`august:auth:user:account:by-user-id:${userId}`);
      await kill(`august:auth:user:session:by-user-id:${userId}`);
    } else {
      report.unreachable.push(
        "august:auth:user:{id} — the email→id pointer was already gone, so the user record could not be located",
      );
    }
    // magic-link tokens: the token half is random and unindexed, and the
    // adapter writes them with NO TTL, so they would otherwise outlive the
    // account forever. SCAN is the only way to find them.
    for (const k of await scanAll(redis, `august:auth:user:token:${email}:*`)) await kill(k);

    // ── 2. the account-scoped namespace ────────────────────────────────────
    for (const k of [
      `user:${email}:seeded`,
      `user:${email}:migrated`,
      `user:${email}:onboarded`,
      `user:${email}:august:watchlist`,
      `user:${email}:august:feeds`,
      `user:${email}:august:gmail:tokens`,
      `user:${email}:august:watchers`,
      `user:${email}:august:profile`,
      `user:${email}:august:summaries`,
      `user:${email}:august:push:subs`,
    ]) {
      await kill(k);
    }
    // threads: the index names the rows, so it is read before it is removed
    try {
      const ids = (await redis.zrange(`user:${email}:august:threads:index`, 0, -1)) as string[];
      for (const id of ids ?? []) await kill(`user:${email}:august:threads:t:${id}`);
    } catch {
      report.unreachable.push(`user:${email}:august:threads:t:* — the thread index could not be read`);
    }
    await kill(`user:${email}:august:threads:index`);
    for (const k of await scanAll(redis, `user:${email}:august:brief:*`)) await kill(k);
    // the account roster
    try {
      const n = await redis.srem("users:index", email);
      if (n) report.membersRemoved.push(`users:index → ${email}`);
    } catch {
      report.unreachable.push("users:index — membership could not be removed");
    }

    // ── 3. the principal-keyed stores (PIT, THE CALL, the ask lane) ────────
    await kill(`august:pit:v1:player:${cid}`);
    await kill(`august:call:v1:rec:${cid}`);
    for (const pattern of [
      `august:call:v1:take:*:${cid}`,
      `august:call:v1:folded:*:${cid}`,
      `aug:ask:v1:${cid}:*`,
      `aug:askcap:v1:*:${cid}`,
    ]) {
      for (const k of await scanAll(redis, pattern)) await kill(k);
    }
    // set/zset MEMBERSHIP — the key belongs to the day or the board, not to
    // the user, so the member comes out and the key stays
    for (const [key, kind] of [
      ["august:pit:v1:lb:best", "z"],
      ...(await scanAll(redis, "august:pit:v1:lb:day:*")).map((k) => [k, "z"] as const),
      ...(await scanAll(redis, "august:call:v1:takers:*")).map((k) => [k, "s"] as const),
      ...(await scanAll(redis, "aug:askstats:v1:top:*")).map((k) => [k, "z"] as const),
    ] as Array<[string, "z" | "s"]>) {
      try {
        const n = kind === "z" ? await redis.zrem(key, cid) : await redis.srem(key, cid);
        if (n) report.membersRemoved.push(`${key} → ${cid}`);
      } catch {
        report.unreachable.push(`${key} — membership for ${cid} could not be removed`);
      }
    }

    // ── 4. push subscriptions ──────────────────────────────────────────────
    // one shared hash keyed by endpoint; the principal is in the VALUE, so
    // every field is read and the matching ones removed
    try {
      const all = (await redis.hgetall("august:push:subs:v2")) as Record<string, { principal?: string }> | null;
      for (const [field, val] of Object.entries(all ?? {})) {
        if (val && val.principal === cid) {
          await redis.hdel("august:push:subs:v2", field);
          report.membersRemoved.push(`august:push:subs:v2 → ${field.slice(0, 40)}…`);
        }
      }
    } catch {
      report.unreachable.push("august:push:subs:v2 — subscriptions could not be swept");
    }

    // ── 5. the claimed-device markers ──────────────────────────────────────
    // These are named after the DEVICE and carry the account in the VALUE, so
    // they cannot be constructed from an email. Found by reading values. The
    // caller's own device is handled directly; other devices are found by the
    // scan, which is why this is not reported as a limit.
    const vid = (opts.visitorId ?? "").trim();
    if (vid) {
      await kill(`august:claim:v1:${vid}`);
      await kill(`august:call:v1:claimed:v:${vid}`);
      for (const k of await scanAll(redis, `visitor:${vid}:august:*`)) await kill(k);
    }
    for (const k of await scanAll(redis, "august:claim:v1:*")) {
      try {
        const v = await redis.get(k);
        if (typeof v === "string" && normalizeEmail(v) === email) await kill(k);
      } catch {
        /* a single unreadable marker must not abort the sweep */
      }
    }
    for (const k of await scanAll(redis, "august:call:v1:claimed:*")) {
      try {
        const v = await redis.get(k);
        if (typeof v === "string" && v === cid) await kill(k);
      } catch {
        /* same */
      }
    }

    // ── 6. what this cannot reach, said out loud ───────────────────────────
    report.unreachable.push(
      "your browser's own storage (theme, an in-progress PIT run, and the 'aug-claimed' marker that holds your email) — clear your browser data for this site",
    );
    report.unreachable.push(
      "host request logs at Vercel (IP and user agent), which expire on Vercel's schedule and are outside this application",
    );

    report.ok = true;
    return report;
  } catch (err) {
    return { ...report, ok: false, error: err instanceof Error ? err.message : "delete_failed" };
  }
}
