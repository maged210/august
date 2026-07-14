// Per-user data isolation (stage 2) — deterministic unit tests over the PURE
// parts of lib/user-scope: key scoping (the single-user fallback contract +
// injection guards), watchlist validation, and seed idempotency driven through
// a mock KV. No Redis, no network, no next-auth: getSessionEmail and friends
// dynamic-import "@/auth" only when CALLED, and nothing here calls them.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  AuthRequiredError,
  FEEDS_KEY,
  ONBOARDED_FLAG,
  OWNER_EMAIL,
  USERS_INDEX_KEY,
  USER_SEED,
  WATCHLIST_KEY,
  WATCHLIST_MAX,
  ensureUserSeededWith,
  getFeedPrefs,
  getFeedPrefsWith,
  getOnboardedWith,
  getWatchlist,
  normalizeEmail,
  scopeKey,
  setFeedPrefs,
  setFeedPrefsWith,
  setOnboardedWith,
  setWatchlist,
  validateFeedPrefs,
  validateWatchlist,
  type PrefsKv,
  type SeedKv,
} from "../lib/user-scope";

// Pin the store paths below to the no-Redis branch regardless of the shell env.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

// ── scopeKey: the single-user fallback contract ─────────────────────────────

test("scopeKey: null email returns the legacy key BYTE FOR BYTE", () => {
  for (const key of [
    "august:profile",
    "august:summaries",
    "august:threads:index",
    "august:threads:t:th_abc123",
    "august:gmail:tokens",
    "august:brief:2026-07-14",
    "august:push:subs",
    "august:watchers",
    "august:watchlist",
  ]) {
    assert.equal(scopeKey(null, key), key);
  }
});

test("scopeKey: an email namespaces under user:{email}:{legacyKey}", () => {
  assert.equal(
    scopeKey("viv@example.com", "august:profile"),
    "user:viv@example.com:august:profile",
  );
  assert.equal(
    scopeKey("viv@example.com", "august:threads:t:th_1"),
    "user:viv@example.com:august:threads:t:th_1",
  );
});

test("scopeKey: emails are lowercased and trimmed before keying", () => {
  assert.equal(
    scopeKey("  Viv@Example.COM  ", "august:profile"),
    "user:viv@example.com:august:profile",
  );
});

test("scopeKey: rejects empty legacy keys", () => {
  assert.throws(() => scopeKey(null, ""), /empty_key/);
  assert.throws(() => scopeKey("viv@example.com", ""), /empty_key/);
});

// ── normalizeEmail: injection guards ────────────────────────────────────────

test("normalizeEmail: lowercases and trims a normal address", () => {
  assert.equal(normalizeEmail(" MagedMilek@Gmail.com "), "magedmilek@gmail.com");
});

test("normalizeEmail: rejects whitespace and control characters anywhere", () => {
  for (const bad of [
    "a b@example.com", // interior space
    "a\tb@example.com", // tab
    "a\nb@example.com", // newline — a key-structure smuggle attempt
    "a\rb@example.com",
    "a\x00b@example.com", // NUL
    "a\x1fb@example.com", // unit separator
    "a\x7fb@example.com", // DEL
  ]) {
    assert.throws(() => normalizeEmail(bad), /invalid_email/, JSON.stringify(bad));
  }
});

test("normalizeEmail: rejects empty, @-less, and absurdly long input", () => {
  assert.throws(() => normalizeEmail(""), /invalid_email/);
  assert.throws(() => normalizeEmail("   "), /invalid_email/);
  assert.throws(() => normalizeEmail("not-an-email"), /invalid_email/);
  assert.throws(() => normalizeEmail("a@" + "b".repeat(260) + ".com"), /invalid_email/);
});

test("scopeKey: invalid emails can never reach a key", () => {
  assert.throws(() => scopeKey("evil\nuser:x@y.com", "august:profile"), /invalid_email/);
  assert.throws(() => scopeKey("  ", "august:profile"), /invalid_email/);
});

// ── owner + error type sanity ────────────────────────────────────────────────

test("OWNER_EMAIL defaults to the owner and is normalized", () => {
  // The suite runs without OWNER_EMAIL set, so the default applies.
  assert.equal(OWNER_EMAIL, OWNER_EMAIL.toLowerCase());
  assert.ok(OWNER_EMAIL.includes("@"));
});

test("AuthRequiredError carries a stable code and name", () => {
  const err = new AuthRequiredError();
  assert.equal(err.name, "AuthRequiredError");
  assert.equal(err.code, "auth_required");
  assert.ok(err instanceof Error);
});

// ── watchlist validation ─────────────────────────────────────────────────────

test("validateWatchlist: uppercases, trims, and dedupes", () => {
  assert.deepEqual(validateWatchlist([" spy ", "qqq", "SPY"]), ["SPY", "QQQ"]);
});

test("validateWatchlist: accepts the Yahoo-style special tickers", () => {
  assert.deepEqual(validateWatchlist(["BRK-B", "^VIX", "NQ=F", "BTC-USD", "BF.B"]), [
    "BRK-B",
    "^VIX",
    "NQ=F",
    "BTC-USD",
    "BF.B",
  ]);
});

test("validateWatchlist: the seed default validates unchanged", () => {
  assert.deepEqual(validateWatchlist([...USER_SEED.watchlist]), [...USER_SEED.watchlist]);
});

test("validateWatchlist: rejects bad shapes outright (never partial)", () => {
  assert.equal(validateWatchlist(null), null);
  assert.equal(validateWatchlist("SPY"), null); // not an array
  assert.equal(validateWatchlist([]), null); // below the 1 minimum
  assert.equal(validateWatchlist([42]), null); // non-string entry
  assert.equal(validateWatchlist(["SPY", ""]), null); // empty symbol
  assert.equal(validateWatchlist(["S P Y"]), null); // interior space
  assert.equal(validateWatchlist(["SPY;DROP"]), null); // charset violation
  assert.equal(validateWatchlist(["TOOLONGSYMBOL"]), null); // >12 chars
  const thirteen = Array.from({ length: WATCHLIST_MAX + 1 }, (_, i) => `S${i}`);
  assert.equal(validateWatchlist(thirteen), null); // >12 entries
});

test("watchlist store: unconfigured Redis serves the seed and refuses writes", async () => {
  assert.deepEqual(await getWatchlist(null), [...USER_SEED.watchlist]);
  assert.deepEqual(await getWatchlist("viv@example.com"), [...USER_SEED.watchlist]);
  const res = await setWatchlist(null, ["SPY"]);
  assert.deepEqual(res, { ok: false, error: "storage_unconfigured" });
  // Validation failures are reported BEFORE storage is consulted.
  const bad = await setWatchlist(null, ["S P Y"]);
  assert.deepEqual(bad, { ok: false, error: "invalid_symbols" });
});

// ── seeding: idempotency over a mock KV ──────────────────────────────────────

function mockKv() {
  const store = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();
  const writes: string[] = [];
  const kv: SeedKv = {
    async set(key: string, value: unknown, opts?: { nx: true }) {
      if (opts?.nx && store.has(key)) return null; // Upstash: NX lost → null
      store.set(key, value);
      writes.push(key);
      return "OK";
    },
    async sadd(key: string, member: string) {
      const s = sets.get(key) ?? new Set<string>();
      const added = s.has(member) ? 0 : 1;
      s.add(member);
      sets.set(key, s);
      return added;
    },
  };
  return { kv, store, sets, writes };
}

test("ensureUserSeededWith: first login seeds flag + watchlist + feeds + index", async () => {
  const { kv, store, sets } = mockKv();
  const r = await ensureUserSeededWith(kv, "  Viv@Example.COM ");
  assert.equal(r.seeded, true);

  assert.ok(store.has("user:viv@example.com:seeded"));
  assert.deepEqual(store.get("user:viv@example.com:august:watchlist"), [
    ...USER_SEED.watchlist,
  ]);
  assert.deepEqual(store.get("user:viv@example.com:august:feeds"), USER_SEED.feeds);
  assert.ok(sets.get(USERS_INDEX_KEY)?.has("viv@example.com")); // normalized member
});

test("ensureUserSeededWith: repeat logins are no-ops that never overwrite", async () => {
  const { kv, store } = mockKv();
  await ensureUserSeededWith(kv, "viv@example.com");

  // The user has since customized their watchlist…
  store.set("user:viv@example.com:" + WATCHLIST_KEY, ["AAPL"]);

  const again = await ensureUserSeededWith(kv, "VIV@EXAMPLE.COM"); // same account, any casing
  assert.equal(again.seeded, false);
  // …and re-seeding must NOT clobber it (flag short-circuits; values are SET NX).
  assert.deepEqual(store.get("user:viv@example.com:" + WATCHLIST_KEY), ["AAPL"]);
});

test("ensureUserSeededWith: rejects invalid emails before touching storage", async () => {
  const { kv, writes } = mockKv();
  await assert.rejects(() => ensureUserSeededWith(kv, "not an email"), /invalid_email/);
  assert.equal(writes.length, 0);
});

test("USER_SEED: the stage-2 defaults are exactly as specified", () => {
  assert.deepEqual([...USER_SEED.watchlist], ["SPY", "QQQ", "BRK-B", "NVDA", "TSLA"]);
  assert.deepEqual(USER_SEED.feeds, { gmail: false, rss: true, markets: true });
});

// ── feed prefs (stage 3): validation + round-trip over a mock KV ─────────────

function mockPrefsKv() {
  const store = new Map<string, unknown>();
  const kv: PrefsKv = {
    async get(key: string) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key: string, value: unknown) {
      store.set(key, value);
      return "OK";
    },
  };
  return { kv, store };
}

test("validateFeedPrefs: normalizes exactly-three-booleans and strips extras", () => {
  assert.deepEqual(validateFeedPrefs({ gmail: true, rss: false, markets: true }), {
    gmail: true,
    rss: false,
    markets: true,
  });
  // Extra keys are stripped, never stored.
  assert.deepEqual(
    validateFeedPrefs({ gmail: false, rss: true, markets: true, evil: "x" }),
    { gmail: false, rss: true, markets: true },
  );
  // The seed default validates unchanged.
  assert.deepEqual(validateFeedPrefs({ ...USER_SEED.feeds }), { ...USER_SEED.feeds });
});

test("validateFeedPrefs: rejects bad shapes outright (never partial)", () => {
  assert.equal(validateFeedPrefs(null), null);
  assert.equal(validateFeedPrefs(undefined), null);
  assert.equal(validateFeedPrefs("gmail"), null);
  assert.equal(validateFeedPrefs([true, true, true]), null); // array, not object
  assert.equal(validateFeedPrefs({ gmail: true, rss: true }), null); // missing key
  assert.equal(validateFeedPrefs({ gmail: 1, rss: true, markets: true }), null); // truthy ≠ boolean
  assert.equal(validateFeedPrefs({ gmail: "true", rss: true, markets: true }), null);
});

test("feed prefs: round-trip through the KV under the scoped key", async () => {
  const { kv, store } = mockPrefsKv();
  const prefs = { gmail: true, rss: false, markets: true };

  const w = await setFeedPrefsWith(kv, "viv@example.com", prefs);
  assert.deepEqual(w, { ok: true, prefs });
  assert.deepEqual(store.get("user:viv@example.com:" + FEEDS_KEY), prefs);

  assert.deepEqual(await getFeedPrefsWith(kv, "viv@example.com"), prefs);
  // Another user's read is untouched by that write — seed default.
  assert.deepEqual(await getFeedPrefsWith(kv, "other@example.com"), { ...USER_SEED.feeds });
});

test("feed prefs: null email round-trips on the LEGACY key (single-user fallback)", async () => {
  const { kv, store } = mockPrefsKv();
  const prefs = { gmail: false, rss: false, markets: true };
  await setFeedPrefsWith(kv, null, prefs);
  assert.deepEqual(store.get(FEEDS_KEY), prefs); // exactly august:feeds, unscoped
  assert.deepEqual(await getFeedPrefsWith(kv, null), prefs);
});

test("feed prefs: absent or invalid stored values fall back to the seed", async () => {
  const { kv, store } = mockPrefsKv();
  assert.deepEqual(await getFeedPrefsWith(kv, "viv@example.com"), { ...USER_SEED.feeds });
  store.set("user:viv@example.com:" + FEEDS_KEY, { gmail: "yes" }); // corrupt
  assert.deepEqual(await getFeedPrefsWith(kv, "viv@example.com"), { ...USER_SEED.feeds });
});

test("feed prefs: invalid input is rejected before any write", async () => {
  const { kv, store } = mockPrefsKv();
  const r = await setFeedPrefsWith(kv, "viv@example.com", { gmail: 1, rss: true, markets: true });
  assert.deepEqual(r, { ok: false, error: "invalid_prefs" });
  assert.equal(store.size, 0);
});

test("feed prefs store: unconfigured Redis serves the seed and refuses writes", async () => {
  assert.deepEqual(await getFeedPrefs(null), { ...USER_SEED.feeds });
  assert.deepEqual(await getFeedPrefs("viv@example.com"), { ...USER_SEED.feeds });
  const res = await setFeedPrefs(null, { gmail: true, rss: true, markets: true });
  assert.deepEqual(res, { ok: false, error: "storage_unconfigured" });
  // Validation failures are reported BEFORE storage is consulted.
  const bad = await setFeedPrefs(null, { gmail: "x" });
  assert.deepEqual(bad, { ok: false, error: "invalid_prefs" });
});

// ── onboarded flag (stage 3): the /welcome one-time nudge gate ───────────────

test("onboarded flag: false until set, true after, under the scoped key", async () => {
  const { kv, store } = mockPrefsKv();
  assert.equal(await getOnboardedWith(kv, "viv@example.com"), false);

  await setOnboardedWith(kv, "viv@example.com");
  assert.equal(await getOnboardedWith(kv, "viv@example.com"), true);
  assert.ok(store.has("user:viv@example.com:" + ONBOARDED_FLAG));

  // Scoping holds: another account is still un-onboarded.
  assert.equal(await getOnboardedWith(kv, "other@example.com"), false);
});

test("onboarded flag: normalizes the email the same way every store does", async () => {
  const { kv } = mockPrefsKv();
  await setOnboardedWith(kv, "  Viv@Example.COM ");
  assert.equal(await getOnboardedWith(kv, "viv@example.com"), true);
});
