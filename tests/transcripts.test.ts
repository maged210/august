// Transcript pipeline (CORE V2 P4) — pure intake validation, candidate
// normalization (the anti-fabrication filter between Claude and the draft
// queue), and the unconfigured-store no-op contract.

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_IDEAS_PER_TRANSCRIPT,
  MAX_SOURCE_CHARS,
  MAX_TRANSCRIPT_CHARS,
  aiConfigured,
  listTranscripts,
  normalizeCandidates,
  storeTranscript,
  transcriptsConfigured,
  updateTranscript,
  validateTranscriptBody,
} from "../lib/transcripts";

// --- validateTranscriptBody -------------------------------------------------

test("intake: trims text, collapses+caps the source label", () => {
  const r = validateTranscriptBody({ text: "  hello world  ", source: "  My   Video  " });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.text, "hello world");
    assert.equal(r.value.source, "My Video");
  }
});

test("intake: missing/empty/oversized text rejects", () => {
  assert.equal(validateTranscriptBody(null).ok, false);
  assert.equal(validateTranscriptBody({}).ok, false);
  assert.equal(validateTranscriptBody({ text: "   " }).ok, false);
  assert.equal(validateTranscriptBody({ text: "x".repeat(MAX_TRANSCRIPT_CHARS + 1) }).ok, false);
  assert.ok(validateTranscriptBody({ text: "x".repeat(MAX_TRANSCRIPT_CHARS) }).ok);
});

test("intake: non-string source degrades to empty, long source truncates", () => {
  const r1 = validateTranscriptBody({ text: "t", source: 42 });
  assert.ok(r1.ok && r1.value.source === "");
  const r2 = validateTranscriptBody({ text: "t", source: "s".repeat(MAX_SOURCE_CHARS + 50) });
  assert.ok(r2.ok && r2.value.source.length === MAX_SOURCE_CHARS);
});

// --- normalizeCandidates ----------------------------------------------------

const GOOD = {
  instrument: "NQ",
  thesis: "Fade the open drive into the pivot.",
  entry: "21,450",
  target: "21,320",
  riskLevel: "medium",
};

test("normalize: valid candidates pass, stamped draft/extracted", () => {
  const out = normalizeCandidates([GOOD]);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "draft");
  assert.equal(out[0].source, "extracted");
});

test("normalize: the pipeline can NEVER publish — status/source from the model are ignored", () => {
  const sneaky = { ...GOOD, status: "live", source: "manual" };
  const out = normalizeCandidates([sneaky]);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "draft");
  assert.equal(out[0].source, "extracted");
});

test("normalize: malformed rows are DROPPED, never repaired", () => {
  const out = normalizeCandidates([
    GOOD,
    { ...GOOD, instrument: "" }, // empty instrument
    { ...GOOD, riskLevel: "yolo" }, // unknown risk
    { ...GOOD, thesis: 42 }, // wrong type
    "not an object",
    null,
  ]);
  assert.equal(out.length, 1);
});

test("normalize: missing levels become empty strings (thesis-only ideas allowed)", () => {
  const out = normalizeCandidates([
    { instrument: "BTC", thesis: "Structure looks heavy.", riskLevel: "high" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].entry, "");
  assert.equal(out[0].target, "");
});

test("normalize: non-array input and empty arrays yield []", () => {
  assert.deepEqual(normalizeCandidates(undefined), []);
  assert.deepEqual(normalizeCandidates({ ideas: [GOOD] }), []); // the UNWRAPPED array is the contract
  assert.deepEqual(normalizeCandidates([]), []);
});

test("normalize: caps at MAX_IDEAS_PER_TRANSCRIPT", () => {
  const many = Array.from({ length: MAX_IDEAS_PER_TRANSCRIPT + 5 }, () => ({ ...GOOD }));
  assert.equal(normalizeCandidates(many).length, MAX_IDEAS_PER_TRANSCRIPT);
});

// --- unconfigured environments ----------------------------------------------

test("ai: missing key and masked [SENSITIVE] placeholders both read unconfigured", () => {
  assert.equal(aiConfigured(), false);
  process.env.ANTHROPIC_API_KEY = '"[SENSITIVE]"';
  assert.equal(aiConfigured(), false);
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  assert.equal(aiConfigured(), true);
  delete process.env.ANTHROPIC_API_KEY;
});

test("store: unconfigured Redis no-ops and never throws", async () => {
  assert.equal(transcriptsConfigured(), false);
  assert.equal(await storeTranscript("text", "src"), null);
  await updateTranscript("tr_x", { status: "processed" }); // must not throw
  assert.deepEqual(await listTranscripts(), []);
});
