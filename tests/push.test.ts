// feature/pwa-push — the subscription store v2, the daily-call sender, and
// the composed body per state. No Redis, no network: injected kv + transport.

// Pin the no-Redis path BEFORE any lazy client reads env.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimPushSubscriptions,
  deleteSubscription,
  dispatch,
  listAllSubscriptions,
  listSubscriptionsFor,
  saveSubscription,
  type PushKv,
  type PushSub,
  type StoredPushSub,
} from "../lib/push";
import { composeCallPush, flushCallPush, registerCallPush, type FlushDeps } from "../lib/call-push";
import { emitCallSettled } from "../lib/call-events";
import type { CallState, CallTally } from "../lib/call";

function fakePushKv(): PushKv & { data: Map<string, Record<string, unknown>> } {
  const data = new Map<string, Record<string, unknown>>();
  return {
    data,
    async hset(key, fields) {
      const h = data.get(key) ?? {};
      Object.assign(h, fields);
      data.set(key, h);
    },
    async hget(key, field) {
      return data.get(key)?.[field] ?? null;
    },
    async hdel(key, field) {
      const h = data.get(key);
      if (h) delete h[field];
    },
    async hgetall(key) {
      return data.get(key) ?? null;
    },
  };
}

function fakeFlushKv() {
  const data = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  return {
    data,
    lists,
    async set(k: string, v: unknown, opts?: { nx?: true }) {
      if (opts?.nx && data.has(k)) return null;
      data.set(k, v);
      return "OK";
    },
    async lpush(k: string, v: unknown) {
      lists.set(k, [v, ...(lists.get(k) ?? [])]);
    },
    async ltrim(k: string, start: number, stop: number) {
      lists.set(k, (lists.get(k) ?? []).slice(start, stop + 1));
    },
    async lrange(k: string, start: number, stop: number) {
      return (lists.get(k) ?? []).slice(start, stop + 1);
    },
  };
}

const sub = (endpoint: string): PushSub => ({
  endpoint: `https://push.example/${endpoint}`,
  keys: { p256dh: "p", auth: "a" },
});

const tally = (w: number, l: number): CallTally => ({ wins: w, losses: l, pushes: 0 });

const state = (over: Partial<CallState>): CallState => ({
  configured: true,
  now: 0,
  record: { august: tally(2, 2), you: tally(3, 1) },
  active: null,
  noCall: null,
  settled: null,
  ...over,
});

const SETTLED = {
  forDate: "2026-09-02",
  side: "HIGHER" as const,
  result: "HIGHER" as const,
  closePct: 0.42,
  augustWin: true,
  youSide: "LOWER" as const,
  youWin: false,
  disagree: null,
};

// --- store ------------------------------------------------------------------

test("subscribe/unsubscribe: principal-keyed upsert, endpoint delete, claim folds v:->u:", async () => {
  const kv = fakePushKv();
  assert.ok(await saveSubscription("v:dev-1", sub("one"), { kv }));
  assert.ok(await saveSubscription("v:dev-1", sub("one"), { kv })); // idempotent upsert
  assert.ok(await saveSubscription("u:o@x.com", sub("two"), { kv }));
  assert.equal((await listAllSubscriptions({ kv })).length, 2);
  assert.equal((await listSubscriptionsFor("v:dev-1", { kv })).length, 1);
  // claim: the anonymous device follows the account
  assert.equal(await claimPushSubscriptions("v:dev-1", "u:o@x.com", { kv }), 1);
  assert.equal((await listSubscriptionsFor("v:dev-1", { kv })).length, 0);
  assert.equal((await listSubscriptionsFor("u:o@x.com", { kv })).length, 2);
  // unsubscribe by endpoint
  assert.ok(await deleteSubscription(sub("two").endpoint, { kv }));
  assert.equal((await listAllSubscriptions({ kv })).length, 1);
});

test("dispatch: 404/410 prunes the dead subscription, other errors keep it", async () => {
  const kv = fakePushKv();
  await saveSubscription("u:o@x.com", sub("live"), { kv });
  await saveSubscription("u:o@x.com", sub("gone"), { kv });
  await saveSubscription("u:o@x.com", sub("flaky"), { kv });
  const targets = await listAllSubscriptions({ kv });
  const transport = async (s: PushSub) => {
    if (s.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    if (s.endpoint.endsWith("/flaky")) throw Object.assign(new Error("boom"), { statusCode: 500 });
  };
  const r = await dispatch(targets, { title: "t" }, { kv, transport });
  assert.deepEqual(
    { total: r.total, sent: r.sent, pruned: r.pruned, failed: r.failed },
    { total: 3, sent: 1, pruned: 1, failed: 1 },
  );
  const left = await listAllSubscriptions({ kv });
  assert.equal(left.length, 2); // gone pruned; flaky kept for retry
  assert.ok(!left.some((s: StoredPushSub) => s.sub.endpoint.endsWith("/gone")));
});

// --- the body, per state ----------------------------------------------------

test("compose: the spec body — settle, verdicts, records, tomorrow's call", () => {
  const msg = composeCallPush(
    state({
      settled: SETTLED,
      active: { forDate: "2026-09-03", side: "HIGHER", lockTs: 0, locked: false, youSide: null, thesis: null },
    }),
  )!;
  assert.equal(msg.title, "THE CALL");
  assert.equal(msg.body, "NQ CLOSED +0.4% · AUGUST ✓ · YOU ✗ · YOU 3–1 · AUGUST 2–2 · TOMORROW: AUGUST HIGHER");
});

test("compose: no take omits the YOU verdict; records always show", () => {
  const msg = composeCallPush(
    state({
      settled: { ...SETTLED, youSide: null, youWin: null },
      active: { forDate: "2026-09-03", side: "LOWER", lockTs: 0, locked: false, youSide: null, thesis: null },
      record: { august: tally(1, 0), you: tally(0, 0) },
    }),
  )!;
  assert.equal(msg.body, "NQ CLOSED +0.4% · AUGUST ✓ · YOU 0–0 · AUGUST 1–0 · TOMORROW: AUGUST LOWER");
});

test("compose: flat push, dead-even tomorrow, weekend next-call, and silence", () => {
  const flat = composeCallPush(
    state({
      settled: { ...SETTLED, result: "FLAT", closePct: 0, augustWin: null, youWin: null },
      noCall: { reason: "dead_even", nextDate: "2026-09-03" },
    }),
  )!;
  assert.equal(flat.body, "NQ CLOSED FLAT · PUSH · YOU 3–1 · AUGUST 2–2 · TOMORROW: NO CALL — the regime is dead even");
  const friday = composeCallPush(
    state({
      settled: { ...SETTLED, forDate: "2026-09-04" },
      noCall: { reason: "no_session", nextDate: "2026-09-07" },
    }),
  )!;
  assert.ok(friday.body.endsWith("NEXT CALL MON"));
  // silence: no settle today, and a NO_SESSION void
  assert.equal(composeCallPush(state({})), null);
  assert.equal(composeCallPush(state({ settled: { ...SETTLED, result: "NO_SESSION", closePct: null, augustWin: null, youWin: null } })), null);
});

// --- the flush: idempotent, personalized, pruning --------------------------

test("flush: one send per day (NX marker), personalized per principal, logged", async () => {
  registerCallPush();
  const kv = fakeFlushKv();
  const pushKv = fakePushKv();
  await saveSubscription("v:me", sub("mine"), { kv: pushKv });
  await saveSubscription("u:o@x.com", sub("owner"), { kv: pushKv });
  const bodies: string[] = [];
  const deps: FlushDeps = {
    kv,
    pushKv,
    transport: async (_s, body) => {
      bodies.push(JSON.parse(body).body);
    },
    readState: async (cid) =>
      state({
        settled: cid === "v:me" ? SETTLED : { ...SETTLED, youSide: null, youWin: null },
        active: { forDate: "2026-09-03", side: "HIGHER", lockTs: 0, locked: false, youSide: null, thesis: null },
      }),
    now: Date.parse("2026-09-02T22:10:00Z"), // the pass moment, same ET day as the settle
  };

  await emitCallSettled({ forDate: "2026-09-02", side: "HIGHER", result: "HIGHER", closePct: 0.42, augustWin: true });
  const entry = await flushCallPush(deps);
  assert.ok(entry);
  assert.equal(entry!.recipients, 2);
  assert.equal(entry!.sent, 2);
  assert.equal(bodies.length, 2);
  assert.ok(bodies.some((b) => b.includes("· YOU ✗ ·"))); // the taker's body
  assert.ok(bodies.some((b) => !b.includes("YOU ✗"))); // the non-taker's body
  assert.equal(kv.lists.get("august:push:calllog")!.length, 1);

  // the same day never sends twice — even re-emitted
  await emitCallSettled({ forDate: "2026-09-02", side: "HIGHER", result: "HIGHER", closePct: 0.42, augustWin: true });
  assert.equal(await flushCallPush(deps), null);
  assert.equal(bodies.length, 2);

  // nothing stashed → nothing sent; a NO_SESSION void is silent
  assert.equal(await flushCallPush(deps), null);
  await emitCallSettled({ forDate: "2026-09-03", side: "HIGHER", result: "NO_SESSION", closePct: null, augustWin: null });
  assert.equal(await flushCallPush(deps), null);

  // a LAG-HEALED settle (settled on a later day than its own) stays silent —
  // its moment passed; the card carried it
  await emitCallSettled({ forDate: "2026-09-01", side: "HIGHER", result: "HIGHER", closePct: 1, augustWin: true });
  assert.equal(await flushCallPush(deps), null); // deps.now is Sep 2
  assert.equal(bodies.length, 2);
});

test("flush: a dead device is pruned during the daily send", async () => {
  registerCallPush();
  const kv = fakeFlushKv();
  const pushKv = fakePushKv();
  await saveSubscription("v:me", sub("dead"), { kv: pushKv });
  const deps: FlushDeps = {
    kv,
    pushKv,
    transport: async () => {
      throw Object.assign(new Error("gone"), { statusCode: 410 });
    },
    readState: async () => state({ settled: SETTLED }),
    now: Date.parse("2026-09-04T22:10:00Z"),
  };
  await emitCallSettled({ forDate: "2026-09-04", side: "HIGHER", result: "HIGHER", closePct: 0.42, augustWin: true });
  const entry = await flushCallPush(deps);
  assert.equal(entry!.pruned, 1);
  assert.equal((await listAllSubscriptions({ kv: pushKv })).length, 0);
});
