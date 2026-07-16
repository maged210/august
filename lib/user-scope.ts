// Per-user data isolation — STAGE 2 of the multi-user conversion. SERVER ONLY.
//
// THE RULE: every personal Redis key goes through scopeKey(). When auth is
// unconfigured (the single-user fallback — today's production reality) the
// caller resolves a null email and scopeKey returns the LEGACY key unchanged,
// byte for byte: zero behavior change. With a signed-in session, personal keys
// live under `user:{email}:{legacyKey}`.
//
// Redis only — no database. The intel desk (`august:intel:*`) is deliberately
// NOT namespaced: its brief/ideas are shared reading for every signed-in user;
// only its MUTATING routes are owner-gated (checkIntelMutateAllowed below).
//
// The OWNER's pre-multi-user data is migrated on first login — COPIED, never
// moved: the legacy keys stay behind untouched as a safety net (and as the
// live store for the unconfigured fallback). See migrateOwnerLegacyData.
//
// IMPORTANT for the module graph: this file never statically imports "@/auth"
// (next-auth). auth.ts calls ensureUserSeeded via a dynamic import from its
// signIn event, and the session readers below dynamic-import "@/auth" at call
// time — no static cycle, and the pure parts (scopeKey, validateWatchlist,
// ensureUserSeededWith) stay importable by the node:test suite.

import { Redis } from "@upstash/redis";

// ---------------------------------------------------------------------------
// Owner
// ---------------------------------------------------------------------------

const DEFAULT_OWNER = "magedmilek@gmail.com";

function safeNormalize(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return normalizeEmail(raw);
  } catch {
    return null;
  }
}

/** The instance owner — the account whose legacy single-user data migrates into
 *  its namespace and the only account allowed to MUTATE the shared intel desk.
 *  Override with OWNER_EMAIL in .env.local (documented in .env.local.example). */
export const OWNER_EMAIL: string = safeNormalize(process.env.OWNER_EMAIL) ?? DEFAULT_OWNER;

// ---------------------------------------------------------------------------
// Email normalization + key scoping (PURE — unit-tested)
// ---------------------------------------------------------------------------

const EMAIL_MAX = 254; // RFC 5321 ceiling — anything longer is garbage

/** Lowercase + trim, and REJECT anything that could smuggle key structure:
 *  empty, overlong, whitespace anywhere, control characters, or no "@".
 *  Every key builder goes through this — no un-normalized email ever reaches
 *  a Redis key. Throws on invalid input (callers treat that as "no user"). */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX) throw new Error("invalid_email");
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(email)) throw new Error("invalid_email");
  if (!email.includes("@")) throw new Error("invalid_email");
  return email;
}

/** THE namespacing function. null email = single-user fallback → the legacy
 *  key UNCHANGED (today's behavior, exactly). Otherwise `user:{email}:{key}`. */
export function scopeKey(email: string | null, legacyKey: string): string {
  if (!legacyKey) throw new Error("empty_key");
  if (email === null) return legacyKey;
  return `user:${normalizeEmail(email)}:${legacyKey}`;
}

// ---------------------------------------------------------------------------
// Session → email (wraps auth(); dynamic import, see header note)
// ---------------------------------------------------------------------------

/** Thrown by requireSessionEmail when auth IS configured but there is no
 *  session. Personal routes are already 401'd by the middleware — this is
 *  defense-in-depth so library code can never silently fall back to the
 *  legacy (shared) keys for an unauthenticated request. */
export class AuthRequiredError extends Error {
  readonly code = "auth_required";
  constructor() {
    super("auth_required");
    this.name = "AuthRequiredError";
  }
}

async function readSession(): Promise<{ configured: boolean; email: string | null }> {
  const { auth, authConfigured } = await import("@/auth");
  if (!authConfigured) return { configured: false, email: null };
  try {
    const session = await auth();
    const raw = session?.user?.email;
    return { configured: true, email: raw ? normalizeEmail(raw) : null };
  } catch {
    // auth() failure or a malformed session email — treat as "no session".
    return { configured: true, email: null };
  }
}

/** The session email (lowercased), or null when auth is unconfigured OR there
 *  is no session. Use for soft/optional personalization only — personal STORES
 *  must use requireSessionEmail so "signed out" can never alias to "legacy". */
export async function getSessionEmail(): Promise<string | null> {
  return (await readSession()).email;
}

/** Resolve the namespace owner for a personal store:
 *    - auth unconfigured  → null  (single-user fallback: legacy keys)
 *    - session present    → the normalized email
 *    - configured, no session → throws AuthRequiredError (middleware already
 *      401s these routes; this guarantees no silent legacy fallback). */
export async function requireSessionEmail(): Promise<string | null> {
  const { configured, email } = await readSession();
  if (!configured) return null;
  if (!email) throw new AuthRequiredError();
  return email;
}

/** Route helper: resolve requireSessionEmail() or produce the 401 response.
 *  Keeps the try/catch out of every personal route handler. */
export async function resolveUserOr401(): Promise<
  { ok: true; email: string | null } | { ok: false; response: Response }
> {
  try {
    return { ok: true, email: await requireSessionEmail() };
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return {
        ok: false,
        response: Response.json({ error: "auth_required" }, { status: 401 }),
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Intel mutation gate (the desk's DATA stays shared; WRITES are owner-only)
// ---------------------------------------------------------------------------

export type IntelGate = { ok: true } | { ok: false; status: 401 | 403 };

/** Owner check for the MUTATING intel routes (sources add/remove, sync,
 *  transcript, reprocess, brief generation, settings). ONLY enforced when auth
 *  is configured — unconfigured keeps today's open single-user behavior.
 *  Reads stay public regardless. */
export async function checkIntelMutateAllowed(): Promise<IntelGate> {
  const { configured, email } = await readSession();
  if (!configured) return { ok: true };
  if (!email) return { ok: false, status: 401 };
  if (email !== OWNER_EMAIL) return { ok: false, status: 403 };
  return { ok: true };
}

/** Route helper mirroring resolveUserOr401 for the intel mutation gate. */
export async function gateIntelMutationOrRespond(): Promise<Response | null> {
  const gate = await checkIntelMutateAllowed();
  if (gate.ok) return null;
  return Response.json(
    { ok: false, error: gate.status === 401 ? "auth_required" : "owner_only" },
    { status: gate.status },
  );
}

// ---------------------------------------------------------------------------
// Intel ATTRIBUTION gate — the READ boundary (source privacy)
// ---------------------------------------------------------------------------
//
// Deliberately SEPARATE from checkIntelMutateAllowed. The write gate answers
// "may this caller CHANGE the desk?"; this one answers "may this caller SEE who
// is watched?" — channel/video attribution, the source roster, the video
// library, the cited-answer path. This is THE one definition of ownerView:
// lib/intel/redact.ts's intelOwnerView() is a thin re-export of it, so every
// attribution surface (overview, briefs, briefs/[date], export, ask, sources,
// videos) inherits these semantics without restating them.
//
// The two gates agree on every input EXCEPT ONE: auth unconfigured IN
// PRODUCTION.
//
//   WHY: the single-user fallback resolves "no auth env → you are the owner".
//   That is right for WRITES (a solo deploy with no auth configured must still
//   be usable by the person running it) and right for READS in dev/test (the
//   desk works out of the box, byte-identical to pre-multi-user behavior).
//   But in a DEPLOYED environment that same rule means one missing env var —
//   AUTH_SECRET dropped from the deploy, an env group unlinked, a fresh
//   preview built without secrets — silently serves full source attribution to
//   the entire public. Source privacy is the product's promise; a config
//   accident must never be the thing that breaks it.
//
//   SO: privacy fails CLOSED. Production + unconfigured auth → redacted, until
//   auth is actually configured. Losing attribution in your own deploy is a
//   visible, recoverable annoyance; leaking who you watch is neither.
//
//   Scoped to the READ boundary on purpose — the write gate's semantics are
//   unchanged (see checkIntelMutateAllowed above).

/** PURE derivation of the attribution/read boundary — kept pure (like
 *  deriveIntelRole) so all five paths are unit-testable without a session or
 *  an env mutation. `production` is NODE_ENV === "production" at call time.
 *
 *    unconfigured, dev/test    → ok      (single-user fallback, unchanged)
 *    unconfigured, PRODUCTION  → 403     (FAIL CLOSED — see the note above)
 *    configured, signed out    → 401
 *    configured, non-owner     → 403
 *    configured, owner         → ok                                          */
export function deriveIntelAttributionGate(read: {
  configured: boolean;
  email: string | null;
  production: boolean;
}): IntelGate {
  if (!read.configured) return read.production ? { ok: false, status: 403 } : { ok: true };
  if (!read.email) return { ok: false, status: 401 };
  if (read.email !== OWNER_EMAIL) return { ok: false, status: 403 };
  return { ok: true };
}

/** Session-backed attribution gate. NODE_ENV is read at CALL time, never
 *  captured at module load — the test suite drives the pure derivation. */
export async function checkIntelAttributionAllowed(): Promise<IntelGate> {
  return deriveIntelAttributionGate({
    ...(await readSession()),
    production: process.env.NODE_ENV === "production",
  });
}

/** THE owner-view resolver: may this caller see source attribution?
 *  ALWAYS async — see the contract note on redact.ts's intelOwnerView. */
export async function resolveIntelOwnerView(): Promise<boolean> {
  return (await checkIntelAttributionAllowed()).ok;
}

/** Route helper for attribution-bearing READ surfaces that serve nothing at all
 *  to a non-owner (the source roster, the video library, the cited-answer
 *  path) — as opposed to the surfaces that serve a redacted view instead. */
export async function gateIntelAttributionOrRespond(): Promise<Response | null> {
  const gate = await checkIntelAttributionAllowed();
  if (gate.ok) return null;
  return Response.json(
    { ok: false, error: gate.status === 401 ? "auth_required" : "owner_only" },
    { status: gate.status },
  );
}

/** The role-signal payload GET /api/intel/role serves. Booleans ONLY — no
 *  identity values (no email, no name) ever ride this shape. */
export type IntelRoleSignal = {
  owner: boolean;
  authConfigured: boolean;
  /** a session exists at all — false covers BOTH "signed out" and
   *  "auth unconfigured" (there is no session system to be signed into) */
  signedIn: boolean;
};

/** PURE derivation of the role signal from a session read — kept out of the
 *  route module so the four gate paths stay unit-testable (route files may
 *  only export route fields). Must stay in lockstep with
 *  checkIntelMutateAllowed: owner === gate.ok for every input.
 *
 *    auth unconfigured        → { owner: true,  authConfigured: false, signedIn: false }
 *    configured, signed out   → { owner: false, authConfigured: true,  signedIn: false }
 *    configured, non-owner    → { owner: false, authConfigured: true,  signedIn: true  }
 *    configured, owner        → { owner: true,  authConfigured: true,  signedIn: true  } */
export function deriveIntelRole(read: {
  configured: boolean;
  email: string | null;
}): IntelRoleSignal {
  if (!read.configured) return { owner: true, authConfigured: false, signedIn: false };
  return {
    owner: read.email === OWNER_EMAIL,
    authConfigured: true,
    signedIn: read.email !== null,
  };
}

/** Session-backed role signal — the one reader behind GET /api/intel/role and
 *  the /feed page's owner-only OPEN DESK link. */
export async function getIntelRoleSignal(): Promise<IntelRoleSignal> {
  return deriveIntelRole(await readSession());
}

// ---------------------------------------------------------------------------
// Redis (the standard lazy best-effort client, as in every other store)
// ---------------------------------------------------------------------------

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

// ---------------------------------------------------------------------------
// Seeding — first-login defaults + the known-users index
// ---------------------------------------------------------------------------

export const USER_SEED = {
  watchlist: ["SPY", "QQQ", "BRK-B", "NVDA", "TSLA"],
  feeds: { gmail: false, rss: true, markets: true },
} as const;

/** Set of every email that has ever been seeded — the brief/watcher crons
 *  iterate this (never a Redis SCAN). Updated by ensureUserSeeded. */
export const USERS_INDEX_KEY = "users:index";

export const WATCHLIST_KEY = "august:watchlist";
export const FEEDS_KEY = "august:feeds";
const SEEDED_FLAG = "seeded"; // → user:{email}:seeded
const MIGRATED_FLAG = "migrated"; // → user:{email}:migrated

/** The minimal Redis surface seeding needs — lets tests drive it with a mock
 *  (method syntax on purpose: keeps the real Upstash client assignable). */
export type SeedKv = {
  set(key: string, value: unknown, opts?: { nx: true }): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
};

/** Idempotent core of first-login seeding (pure over the injected KV):
 *    - registers the email in users:index (idempotent SADD)
 *    - takes the user:{email}:seeded flag via SET NX; if already held → no-op
 *    - seeds watchlist + feed defaults, each SET NX so an existing value is
 *      NEVER overwritten (matters for the owner, whose migration may race). */
export async function ensureUserSeededWith(
  kv: SeedKv,
  email: string,
): Promise<{ seeded: boolean }> {
  const e = normalizeEmail(email);
  await kv.sadd(USERS_INDEX_KEY, e);
  const took = await kv.set(scopeKey(e, SEEDED_FLAG), new Date().toISOString(), { nx: true });
  if (took === null) return { seeded: false }; // NX lost → already seeded
  await kv.set(scopeKey(e, WATCHLIST_KEY), [...USER_SEED.watchlist], { nx: true });
  await kv.set(scopeKey(e, FEEDS_KEY), USER_SEED.feeds, { nx: true });
  return { seeded: true };
}

/** First-login bootstrap, called from auth.ts's signIn event (and lazily from
 *  /api/watchlist so accounts that signed in before stage 2 get backfilled).
 *  Best-effort: a Redis failure logs and never blocks sign-in. For the OWNER
 *  it also runs the one-time legacy-data migration. */
export async function ensureUserSeeded(email: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const e = normalizeEmail(email);
    const { seeded } = await ensureUserSeededWith(redis, e);
    if (seeded) console.log(`[user-scope] seeded new user namespace for ${e}`);
    if (e === OWNER_EMAIL) await migrateOwnerLegacyData(e); // self-guarded, one-time
  } catch (err) {
    console.error(
      "[user-scope] ensureUserSeeded failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Every seeded user (sorted for stable cron ordering). Empty when Redis is
 *  unconfigured or nobody has signed in yet. */
export async function listKnownUsers(): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const members = await redis.smembers<string[]>(USERS_INDEX_KEY);
    return (members ?? [])
      .filter((m): m is string => typeof m === "string" && m.includes("@"))
      .sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Owner migration — COPY legacy single-user data into the owner's namespace
// ---------------------------------------------------------------------------
//
// DESIGN: copy, never move. The legacy keys remain the live store for the
// unconfigured fallback and a safety net if anything here goes wrong — nothing
// below ever DELs or overwrites. Each destination is copy-IF-ABSENT so a
// re-run (or a crash mid-way) can never clobber data the owner has since
// written in their namespace. The user:{owner}:migrated flag is set only
// AFTER the copy pass, so a crash mid-migration simply retries next login.

type CopyStatus = "copied" | "exists" | "absent" | "error";

async function copyValue(redis: Redis, src: string, dest: string): Promise<CopyStatus> {
  try {
    if (await redis.exists(dest)) return "exists";
    const v = await redis.get<unknown>(src);
    if (v === null || v === undefined) return "absent";
    const ttl = await redis.ttl(src); // -1 = no expiry, -2 = gone
    if (ttl > 0) await redis.set(dest, v, { ex: ttl });
    else await redis.set(dest, v);
    return "copied";
  } catch {
    return "error";
  }
}

async function copyList(redis: Redis, src: string, dest: string): Promise<CopyStatus> {
  try {
    if (await redis.exists(dest)) return "exists";
    const items = await redis.lrange<unknown>(src, 0, -1);
    if (!items || items.length === 0) return "absent";
    await redis.rpush(dest, ...items); // lrange is head→tail; rpush preserves order
    return "copied";
  } catch {
    return "error";
  }
}

async function copyHash(redis: Redis, src: string, dest: string): Promise<CopyStatus> {
  try {
    if (await redis.exists(dest)) return "exists";
    const all = await redis.hgetall<Record<string, unknown>>(src);
    if (!all || Object.keys(all).length === 0) return "absent";
    await redis.hset(dest, all);
    return "copied";
  } catch {
    return "error";
  }
}

const LEGACY_THREADS_INDEX = "august:threads:index";
const legacyThreadBlob = (id: string) => `august:threads:t:${id}`;

async function copyThreads(redis: Redis, email: string): Promise<string> {
  try {
    const ids = await redis.zrange<string[]>(LEGACY_THREADS_INDEX, 0, -1);
    if (!ids || ids.length === 0) return "absent";
    let copied = 0;
    for (const id of ids) {
      try {
        const raw = await redis.get<unknown>(legacyThreadBlob(id));
        if (raw === null || raw === undefined) continue;
        const thread = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
          updatedAt?: number;
        };
        const destBlob = scopeKey(email, legacyThreadBlob(id));
        if (!(await redis.exists(destBlob))) {
          await redis.set(destBlob, typeof raw === "string" ? raw : JSON.stringify(raw));
        }
        await redis.zadd(scopeKey(email, LEGACY_THREADS_INDEX), {
          score: Number(thread?.updatedAt) || Date.now(),
          member: id,
        });
        copied++;
      } catch {
        /* per-thread best-effort */
      }
    }
    return copied ? `copied(${copied})` : "absent";
  } catch {
    return "error";
  }
}

// Today's (and yesterday's) morning-brief day-cache — ephemeral but personal.
function briefDateKeys(): string[] {
  const tz = "America/New_York";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", {
    timeZone: tz,
  });
  return [`august:brief:${today}`, `august:brief:${yesterday}`];
}

/** One-time, owner-only: copy every legacy personal store into the owner's
 *  namespace. Legacy keys are LEFT INTACT (see the design note above). */
export async function migrateOwnerLegacyData(email: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  let e: string;
  try {
    e = normalizeEmail(email);
  } catch {
    return;
  }
  if (e !== OWNER_EMAIL) return;

  try {
    if (await redis.exists(scopeKey(e, MIGRATED_FLAG))) return; // already done
  } catch {
    return; // can't even read the flag — don't guess
  }

  const results: string[] = [];
  const note = (key: string, status: string) => results.push(`${key}=${status}`);

  note("profile", await copyValue(redis, "august:profile", scopeKey(e, "august:profile")));
  note("summaries", await copyList(redis, "august:summaries", scopeKey(e, "august:summaries")));
  note("threads", await copyThreads(redis, e));
  note(
    "gmail-tokens",
    await copyValue(redis, "august:gmail:tokens", scopeKey(e, "august:gmail:tokens")),
  );
  for (const key of briefDateKeys()) {
    note(key.slice("august:".length), await copyValue(redis, key, scopeKey(e, key)));
  }
  note("push-subs", await copyHash(redis, "august:push:subs", scopeKey(e, "august:push:subs")));
  note("watchers", await copyHash(redis, "august:watchers", scopeKey(e, "august:watchers")));

  try {
    await redis.set(scopeKey(e, MIGRATED_FLAG), new Date().toISOString());
    console.log(`[user-scope] owner migration complete for ${e}: ${results.join(" ")}`);
  } catch (err) {
    // Flag write failed — the copy pass is idempotent, so next login retries.
    console.error(
      "[user-scope] owner migration flag write failed (will retry next login):",
      err instanceof Error ? err.message : err,
    );
  }
}

// ---------------------------------------------------------------------------
// Watchlist — the FIRST truly per-user store (no legacy equivalent existed:
// the landing's WATCHING pills were hardcoded — UI wiring lands in stage 3)
// ---------------------------------------------------------------------------

export const WATCHLIST_MAX = 12;
/** Yahoo-style tickers: letters/digits plus . ^ = - (BRK-B, ^VIX, NQ=F, BTC-USD). */
export const WATCHLIST_SYMBOL_RE = /^[A-Z0-9.^=-]{1,12}$/;

/** PURE. Uppercase + trim each symbol, dedupe, enforce 1–12 entries and the
 *  per-symbol charset. Returns null on ANY invalid input (never partial). */
export function validateWatchlist(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") return null;
    const sym = raw.trim().toUpperCase();
    if (!WATCHLIST_SYMBOL_RE.test(sym)) return null;
    if (!out.includes(sym)) out.push(sym);
  }
  if (out.length < 1 || out.length > WATCHLIST_MAX) return null;
  return out;
}

/** The user's watchlist; the seed default when absent/invalid/unconfigured. */
export async function getWatchlist(email: string | null): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [...USER_SEED.watchlist];
  try {
    const stored = await redis.get<unknown>(scopeKey(email, WATCHLIST_KEY));
    return validateWatchlist(stored) ?? [...USER_SEED.watchlist];
  } catch {
    return [...USER_SEED.watchlist];
  }
}

export type SetWatchlistResult =
  | { ok: true; symbols: string[] }
  | { ok: false; error: "invalid_symbols" | "storage_unconfigured" | "write_failed" };

export async function setWatchlist(
  email: string | null,
  symbols: unknown,
): Promise<SetWatchlistResult> {
  const valid = validateWatchlist(symbols);
  if (!valid) return { ok: false, error: "invalid_symbols" };
  const redis = getRedis();
  if (!redis) return { ok: false, error: "storage_unconfigured" };
  try {
    await redis.set(scopeKey(email, WATCHLIST_KEY), valid);
    return { ok: true, symbols: valid };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}

// ---------------------------------------------------------------------------
// Feed prefs + the onboarded flag (stage 3 — the /welcome setup screen)
// ---------------------------------------------------------------------------
//
// Feed prefs mirror the watchlist store exactly: seeded at first login
// (ensureUserSeededWith above), read/written through /api/feeds, seed default
// when absent/invalid/unconfigured. The onboarded flag records that the user
// has SEEN /welcome (Start or Skip both set it) — it gates the one-time
// post-sign-in nudge, nothing else. Both cores take an injected KV so the
// node:test suite can round-trip them without Redis.

export type FeedPrefs = { gmail: boolean; rss: boolean; markets: boolean };

/** The minimal Redis surface the prefs/flag stores need (method syntax on
 *  purpose, as with SeedKv: keeps the real Upstash client assignable). */
export type PrefsKv = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
};

/** PURE. Exactly three booleans, extra keys stripped, anything else → null
 *  (never partial — same contract as validateWatchlist). */
export function validateFeedPrefs(input: unknown): FeedPrefs | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (
    typeof o.gmail !== "boolean" ||
    typeof o.rss !== "boolean" ||
    typeof o.markets !== "boolean"
  ) {
    return null;
  }
  return { gmail: o.gmail, rss: o.rss, markets: o.markets };
}

/** The user's feed prefs from the injected KV; seed default when absent/invalid. */
export async function getFeedPrefsWith(kv: PrefsKv, email: string | null): Promise<FeedPrefs> {
  try {
    const stored = await kv.get(scopeKey(email, FEEDS_KEY));
    return validateFeedPrefs(stored) ?? { ...USER_SEED.feeds };
  } catch {
    return { ...USER_SEED.feeds };
  }
}

export type SetFeedPrefsResult =
  | { ok: true; prefs: FeedPrefs }
  | { ok: false; error: "invalid_prefs" | "storage_unconfigured" | "write_failed" };

export async function setFeedPrefsWith(
  kv: PrefsKv,
  email: string | null,
  input: unknown,
): Promise<SetFeedPrefsResult> {
  const prefs = validateFeedPrefs(input);
  if (!prefs) return { ok: false, error: "invalid_prefs" };
  try {
    await kv.set(scopeKey(email, FEEDS_KEY), prefs);
    return { ok: true, prefs };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}

/** The user's feed prefs; the seed default when Redis is unconfigured. */
export async function getFeedPrefs(email: string | null): Promise<FeedPrefs> {
  const redis = getRedis();
  if (!redis) return { ...USER_SEED.feeds };
  return getFeedPrefsWith(redis, email);
}

export async function setFeedPrefs(
  email: string | null,
  input: unknown,
): Promise<SetFeedPrefsResult> {
  const prefs = validateFeedPrefs(input);
  if (!prefs) return { ok: false, error: "invalid_prefs" };
  const redis = getRedis();
  if (!redis) return { ok: false, error: "storage_unconfigured" };
  return setFeedPrefsWith(redis, email, prefs);
}

export const ONBOARDED_FLAG = "onboarded"; // → user:{email}:onboarded

export async function getOnboardedWith(kv: PrefsKv, email: string): Promise<boolean> {
  try {
    return Boolean(await kv.get(scopeKey(email, ONBOARDED_FLAG)));
  } catch {
    return true; // can't read the flag — fail toward "no nudge", never a nag loop
  }
}

export async function setOnboardedWith(kv: PrefsKv, email: string): Promise<void> {
  await kv.set(scopeKey(email, ONBOARDED_FLAG), new Date().toISOString());
}

/** Has this account been through /welcome? null email (single-user fallback)
 *  and missing Redis both report TRUE — the nudge only ever fires for a real
 *  signed-in account with somewhere to store the flag. */
export async function getOnboarded(email: string | null): Promise<boolean> {
  if (!email) return true;
  const redis = getRedis();
  if (!redis) return true;
  return getOnboardedWith(redis, email);
}

/** Best-effort — a Redis failure never blocks finishing (or skipping) setup. */
export async function setOnboarded(email: string | null): Promise<void> {
  if (!email) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await setOnboardedWith(redis, email);
  } catch {
    /* best-effort */
  }
}
