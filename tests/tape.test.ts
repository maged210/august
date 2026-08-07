// lib/tape pure helpers — validators + redaction (G3 round 4). Mirrors
// tests/ideas.test.ts: node:test over the pure layer only; the store is
// best-effort Upstash and stays untested here (no network in tests).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TAPE_NOTE_CHARS,
  MAX_TAPE_SYMBOL_CHARS,
  toPublicTapeEntry,
  validateTapeCreate,
  validateTapePatch,
  type TapeEntry,
} from "../lib/tape";
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
