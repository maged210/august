// lib/tape pure helpers — validators + redaction (G3 round 4). Mirrors
// tests/ideas.test.ts: node:test over the pure layer. The store's READ path is
// covered too (fix/route-failure-honesty), through an injected kv — still no
// network in tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TAPE,
  MAX_TAPE_NOTE_CHARS,
  MAX_TAPE_SYMBOL_CHARS,
  readLiveTape,
  readTape,
  toPublicTapeEntry,
  validateTapeCreate,
  validateTapePatch,
  type TapeEntry,
  type TapeKv,
} from "../lib/tape";
import { wireBody } from "../lib/wire";
import { normalizeTapeCandidates } from "../lib/transcripts";

const GOOD = {
  symbol: "SPX",
  note: "Buy 7600 SPX Put",
  kind: "sweep",
  sentiment: "bear",
};

// --- validateTapeCreate ------------------------------------------------------

test("tape create: minimal valid body defaults draft/desk", () => {
  const r = validateTapeCreate(GOOD);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.symbol, "SPX");
    assert.equal(r.value.status, "draft");
    assert.equal(r.value.source, "desk");
    assert.equal(r.value.expiry, undefined);
    assert.equal(r.value.premium, undefined);
  }
});

test("tape create: symbol upper-cases and collapses whitespace", () => {
  const r = validateTapeCreate({ ...GOOD, symbol: "  nv da " });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.symbol, "NV DA");
});

test("tape create: optional expiry/premium survive; empty strings drop", () => {
  const r = validateTapeCreate({ ...GOOD, expiry: "0DTE", premium: "$1.2M" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.expiry, "0DTE");
    assert.equal(r.value.premium, "$1.2M");
  }
  const r2 = validateTapeCreate({ ...GOOD, expiry: "", premium: "  " });
  assert.ok(r2.ok);
  if (r2.ok) {
    assert.equal(r2.value.expiry, undefined);
    assert.equal(r2.value.premium, undefined);
  }
});

test("tape create: rejects missing/oversize fields and unknown enums", () => {
  assert.equal(validateTapeCreate(null).ok, false);
  assert.equal(validateTapeCreate({ ...GOOD, symbol: "" }).ok, false);
  assert.equal(validateTapeCreate({ ...GOOD, symbol: "X".repeat(MAX_TAPE_SYMBOL_CHARS + 1) }).ok, false);
  assert.equal(validateTapeCreate({ ...GOOD, note: "" }).ok, false);
  assert.equal(validateTapeCreate({ ...GOOD, note: "x".repeat(MAX_TAPE_NOTE_CHARS + 1) }).ok, false);
  assert.equal(validateTapeCreate({ ...GOOD, kind: "yolo" }).ok, false);
  assert.equal(validateTapeCreate({ ...GOOD, sentiment: "moon" }).ok, false);
  assert.equal(validateTapeCreate({ ...GOOD, status: "published" }).ok, false);
  assert.equal(validateTapeCreate({ ...GOOD, source: "twitter" }).ok, false);
  assert.equal(validateTapeCreate({ ...GOOD, ts: -5 }).ok, false);
});

test("tape create: explicit live status + stated ts pass through", () => {
  const r = validateTapeCreate({ ...GOOD, status: "live", ts: 1700000000000 });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.status, "live");
    assert.equal(r.value.ts, 1700000000000);
  }
});

// --- validateTapePatch -------------------------------------------------------

test("tape patch: single-field approve flips status; empty patch rejected", () => {
  const r = validateTapePatch({ status: "live" });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, { status: "live" });
  assert.equal(validateTapePatch({}).ok, false);
});

test("tape patch: source and ts are immutable (unknown keys ignored → empty)", () => {
  assert.equal(validateTapePatch({ source: "desk" }).ok, false);
  assert.equal(validateTapePatch({ ts: 123 }).ok, false);
});

test("tape patch: field edits validate individually", () => {
  assert.equal(validateTapePatch({ note: "" }).ok, false);
  const r = validateTapePatch({ note: "Sold to open", sentiment: "neutral" });
  assert.ok(r.ok);
});

// --- toPublicTapeEntry -------------------------------------------------------

test("public tape entry: provenance (status/source) never on the wire", () => {
  const e: TapeEntry = {
    id: "tape_x",
    ts: 1,
    symbol: "SPX",
    note: "Buy 7600 SPX Put",
    expiry: "0DTE",
    kind: "sweep",
    sentiment: "bear",
    source: "extracted",
    status: "live",
    updatedAt: 2,
  };
  const p = toPublicTapeEntry(e) as Record<string, unknown>;
  assert.equal(p.status, undefined);
  assert.equal(p.source, undefined);
  assert.equal(p.updatedAt, undefined);
  assert.equal(p.symbol, "SPX");
  assert.equal(p.expiry, "0DTE");
  assert.equal(p.premium, undefined); // absent stays absent, not ""
});

// --- normalizeTapeCandidates -------------------------------------------------

test("tape candidates: valid rows pass, stamped draft/extracted", () => {
  const out = normalizeTapeCandidates([
    { symbol: "spx", note: "Buy 7600 SPX Put", expiry: "", premium: "", kind: "sweep", sentiment: "bear" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "draft");
  assert.equal(out[0].source, "extracted");
  assert.equal(out[0].symbol, "SPX");
});

test("tape candidates: a candidate can never smuggle live status", () => {
  const out = normalizeTapeCandidates([
    { symbol: "SPX", note: "n", kind: "note", sentiment: "bull", status: "live", source: "desk" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "draft");
  assert.equal(out[0].source, "extracted");
});

test("tape candidates: malformed rows dropped, non-arrays empty", () => {
  const out = normalizeTapeCandidates([
    { symbol: "", note: "x", kind: "note", sentiment: "bull" },
    "garbage",
    { symbol: "OK", note: "fine", kind: "block", sentiment: "neutral" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, "OK");
  assert.deepEqual(normalizeTapeCandidates(undefined), []);
  assert.deepEqual(normalizeTapeCandidates({}), []);
});

// --- readTape / readLiveTape -------------------------------------------------
// DESIGN_LAWS L11 — FAILURE IS A STATE, NOT AN ABSENCE. The store is injected
// (house pattern, cf. tests/push.test.ts): every branch is driven on purpose,
// with no network and no env dependence.

const entry = (id: string, ts: number, status: "draft" | "live" = "live"): TapeEntry => ({
  id,
  ts,
  symbol: "SPX",
  note: `row ${id}`,
  kind: "sweep",
  sentiment: "bear",
  source: "desk",
  status,
  updatedAt: ts,
});

/** A healthy store: the zset newest-first, blobs by key. */
function fakeTapeKv(entries: TapeEntry[]): TapeKv {
  const blobs = new Map(entries.map((e) => [`august:tape:v1:${e.id}`, JSON.stringify(e)]));
  const ids = [...entries].sort((a, b) => b.ts - a.ts).map((e) => e.id);
  return {
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async zrange(_key: string, start: number, stop: number) {
      return ids.slice(start, stop + 1);
    },
  };
}

/** A store that is there but cannot be talked to — the Redis outage. */
function deadTapeKv(message: string): TapeKv {
  return {
    async get() {
      throw new Error(message);
    },
    async zrange() {
      throw new Error(message);
    },
  };
}

test("L11: an unreachable tape store is unavailable WITH the cause, never an empty tape", async () => {
  const kv = deadTapeKv("fetch failed: ECONNRESET");
  const read = await readTape(undefined, MAX_TAPE, { kv });
  assert.equal(read.state, "unavailable");
  if (read.state === "unavailable") assert.doesNotMatch(read.reason, /ECONNRESET/, "the store's words stay off the public wire");

  // the public wire carries the same answer: a stated failure, not a clean list
  const live = await readLiveTape(50, { kv });
  assert.equal(live.state, "unavailable");
  const { body, status } = wireBody(live, "entries");
  assert.equal(status, 503);
  assert.equal(body.ok, false);
  // the ROUTE body is the public surface — it states the fact, never the store
  assert.doesNotMatch(String(body.error), /ECONNRESET/, "the 503 body carries no store internals");
  assert.ok(String(body.error).trim().length > 0, "but it does state something");
  assert.equal(body.entries, undefined, "a failure answers with the failure, not with rows");
});

test("L11: an unconfigured tape store is unavailable, NOT an empty ok", async () => {
  const read = await readTape(undefined, MAX_TAPE, { kv: null });
  assert.equal(read.state, "unavailable");
  if (read.state === "unavailable") assert.ok(read.reason.trim().length > 0, "the cause is never silence");

  const { body, status } = wireBody(await readLiveTape(50, { kv: null }), "entries");
  assert.equal(status, 503);
  assert.equal(body.ok, false);
  // the bug this replaces: no credentials read as "the desk said nothing today"
  assert.notDeepEqual(body, { ok: true, entries: [] });
});

test("L11: a healthy but genuinely empty tape is ok with zero rows", async () => {
  const read = await readLiveTape(50, { kv: fakeTapeKv([]) });
  assert.equal(read.state, "ok");
  if (read.state === "ok") {
    assert.deepEqual(read.rows, []);
    assert.deepEqual(read.failed, []);
  }
  const { body, status } = wireBody(read, "entries");
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, entries: [] });
  assert.equal(body.degraded, undefined, "nothing failed, so nothing is named");
});

test("L11: a healthy tape answers ok — live only, redacted, newest first, capped", async () => {
  const kv = fakeTapeKv([entry("a", 3), entry("b", 2), entry("c", 1), entry("d", 4, "draft")]);
  const read = await readLiveTape(2, { kv });
  assert.equal(read.state, "ok");
  if (read.state !== "ok") return;
  assert.deepEqual(
    read.rows.map((r) => r.id),
    ["a", "b"],
    "newest first, limit respected, the draft never on the wire",
  );
  const first = read.rows[0] as Record<string, unknown>;
  assert.equal(first.status, undefined, "provenance stays redacted through the read path");
  assert.equal(first.source, undefined);
  assert.deepEqual(read.failed, []);
});

test("L11: rows that didn't answer are NAMED, never quietly dropped from the list", async () => {
  const healthy = fakeTapeKv([entry("a", 3), entry("b", 2), entry("c", 1)]);
  const flaky: TapeKv = {
    zrange: healthy.zrange,
    async get(key: string) {
      if (key.endsWith(":b")) throw new Error("blob read timed out");
      return healthy.get(key);
    },
  };
  const read = await readLiveTape(50, { kv: flaky });
  assert.equal(read.state, "ok");
  if (read.state !== "ok") return;
  assert.deepEqual(read.rows.map((r) => r.id), ["a", "c"]);
  assert.equal(read.failed.length, 1);
  assert.equal(read.failed[0].source, "Upstash");
  assert.match(read.failed[0].reason, /1 of 3 rows didn't read/);

  const { body, status } = wireBody(read, "entries");
  assert.equal(status, 200, "rows exist, so the reader gets them");
  assert.ok(Array.isArray(body.degraded), "and the list says what is missing from it");
});

test("L11: every blob failing is the same blindness as the index failing", async () => {
  const healthy = fakeTapeKv([entry("a", 2), entry("b", 1)]);
  const read = await readTape("live", MAX_TAPE, {
    kv: {
      zrange: healthy.zrange,
      async get() {
        throw new Error("blob read timed out");
      },
    },
  });
  assert.equal(read.state, "unavailable");
  if (read.state === "unavailable") assert.doesNotMatch(read.reason, /timed out/, "the cause is logged, not published");
});
