// THE ASK LANE (lib/ask) — normalization, per-identity cache keys, day caps,
// and the console stats. Injected KV, no Redis, no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  askCacheKey,
  askCapFor,
  normalizeAsk,
  readAskStats,
  recordAskStat,
  takeAskBudget,
  ASK_CAP_ANON_DEFAULT,
  ASK_CAP_USER_DEFAULT,
  type AskKv,
} from "../lib/ask";

function fakeKv(): AskKv & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const hashes = new Map<string, Record<string, number>>();
  const zsets = new Map<string, Map<string, number>>();
  return {
    data,
    async incr(k) {
      const n = (Number(data.get(k)) || 0) + 1;
      data.set(k, n);
      return n;
    },
    async expire() {},
    async get(k) {
      return data.get(k) ?? null;
    },
    async set(k, v) {
      data.set(k, v);
    },
    async hincrby(k, f, by) {
      const h = hashes.get(k) ?? {};
      h[f] = (h[f] ?? 0) + by;
      hashes.set(k, h);
      data.set(k, h);
      return h[f];
    },
    async zincrby(k, by, m) {
      const z = zsets.get(k) ?? new Map();
      z.set(m, (z.get(m) ?? 0) + by);
      zsets.set(k, z);
      return z.get(m);
    },
    async hgetall(k) {
      return hashes.get(k) ?? null;
    },
    async zrange(k) {
      const z = zsets.get(k) ?? new Map();
      const sorted = [...z.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      return sorted.flatMap(([m, s]) => [m, s]);
    },
  };
}

test("normalize: case, whitespace, and trailing punctuation collapse to one ask", () => {
  assert.equal(normalizeAsk("What moved the tape?"), "what moved the tape");
  assert.equal(normalizeAsk("  what   MOVED the tape?!  "), "what moved the tape");
  assert.equal(normalizeAsk("what moved the tape."), "what moved the tape");
  // identical normalized asks share a key; different identities never do
  assert.equal(askCacheKey("v:a", "What moved the tape?"), askCacheKey("v:a", "what  moved the tape"));
  assert.notEqual(askCacheKey("v:a", "what moved the tape"), askCacheKey("u:b@x.com", "what moved the tape"));
  assert.notEqual(askCacheKey("v:a", "what moved the tape"), askCacheKey("v:a", "what moved the vix"));
});

test("caps: anon 20 / signed-in 100 by default, env-tunable, cap enforced at the boundary", async () => {
  assert.equal(askCapFor("v:someone", {}), ASK_CAP_ANON_DEFAULT);
  assert.equal(askCapFor("u:o@x.com", {}), ASK_CAP_USER_DEFAULT);
  assert.equal(askCapFor("v:someone", { anon: "3" }), 3);
  assert.equal(askCapFor("u:o@x.com", { user: "7" }), 7);
  assert.equal(askCapFor("v:someone", { anon: "garbage" }), ASK_CAP_ANON_DEFAULT);

  const kv = fakeKv();
  const now = Date.parse("2026-09-02T15:00:00Z");
  for (let i = 1; i <= 3; i++) {
    const r = await takeAskBudget(kv, "v:me", 3, now);
    assert.equal(r.allowed, true, `ask ${i} under the cap`);
  }
  const over = await takeAskBudget(kv, "v:me", 3, now);
  assert.equal(over.allowed, false);
  assert.equal(over.used, 4);
  // a different identity has its own budget
  assert.equal((await takeAskBudget(kv, "v:other", 3, now)).allowed, true);
});

test("stats: asks, cache hits, per-identity top 5", async () => {
  const kv = fakeKv();
  const now = Date.parse("2026-09-02T15:00:00Z");
  await recordAskStat(kv, "v:a", "model", now);
  await recordAskStat(kv, "v:a", "cache", now);
  await recordAskStat(kv, "v:a", "model", now);
  await recordAskStat(kv, "u:o@x.com", "model", now);
  const s = (await readAskStats(kv, now))!;
  assert.ok(s, "configured KV answers with stats");
  assert.equal(s.asks, 4);
  assert.equal(s.cacheHits, 1);
  assert.deepEqual(s.top[0], { cid: "v:a", asks: 3 });
  assert.deepEqual(s.top[1], { cid: "u:o@x.com", asks: 1 });
});

test("stats: an unreachable KV reads as NULL, never zeros posing as quiet", async () => {
  const broken = {
    async incr() { throw new Error("down"); },
    async expire() { throw new Error("down"); },
    async get() { throw new Error("down"); },
    async set() { throw new Error("down"); },
    async hincrby() { throw new Error("down"); },
    async zincrby() { throw new Error("down"); },
    async hgetall() { throw new Error("down"); },
    async zrange() { throw new Error("down"); },
  };
  assert.equal(await readAskStats(broken, Date.parse("2026-09-02T15:00:00Z")), null);
});
