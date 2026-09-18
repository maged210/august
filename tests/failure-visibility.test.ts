// DESIGN_LAWS L9 — FAILURE IS A STATE, NOT AN ABSENCE.
//
// The pure surfaces of fix/failure-visibility: what a failed extraction TELLS
// the console, what the ask card says it answered without, and how repeated
// attempts at one video collapse. The Redis/Anthropic paths in the same branch
// are covered by tsc + the production build, per this suite's standing rule.

import { test } from "node:test";
import assert from "node:assert/strict";

// lib/transcripts reads ANTHROPIC_API_KEY at call time, never at import — but
// keep the suite honest about its environment the way transcripts.test.ts does
delete process.env.ANTHROPIC_API_KEY;

import { extractionFailure } from "../lib/transcripts.ts";
import { degradedNote } from "../lib/ask-stream.ts";
import { markRepeats } from "../lib/transcript-repeats.ts";

// --- 1. the extraction failure carries the CAUSE ---------------------------

test("L9: a failed extraction reports the provider's own words, never a category", () => {
  const real =
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"This API key is not scoped to a workspace"}}';
  const out = extractionFailure(new Error(real), "tr_abc123");

  // the whole point of the branch: the message the caller reads IS the cause
  assert.equal(out.error, real);
  assert.notEqual(out.error, "extraction_failed", "the category must not stand in for the cause");
  assert.ok(out.error.includes("not scoped to a workspace"), "the actionable half survives");

  // the machine-readable kind stays stable for callers that branch on it
  assert.equal(out.code, "extraction_failed");
  assert.equal(out.ok, false);
  assert.equal(out.transcriptId, "tr_abc123");
});

test("L9: a non-Error throw still produces a readable cause, never an empty one", () => {
  assert.equal(extractionFailure("boom", "tr_1").error, "boom");
  assert.equal(extractionFailure({ toString: () => "weird" }, "tr_1").error, "weird");
  // the one case with nothing to say says THAT, rather than rendering blank
  assert.equal(extractionFailure(new Error(""), "tr_1").error, "extraction failed with no message");
  assert.equal(extractionFailure(new Error("   "), "tr_1").error, "extraction failed with no message");
  // and it is still a failure, not an absence
  assert.equal(extractionFailure(new Error(""), "tr_1").ok, false);
});

// --- 2. the ask card says what it answered WITHOUT -------------------------

test("L9: degraded grounding is named on the card, and silence means nothing was missing", () => {
  assert.equal(degradedNote(null), null, "no header = the desk had everything");
  assert.equal(degradedNote(""), null);
  assert.equal(degradedNote("nonsense"), null, "an unknown name is not a claim about the answer");

  assert.equal(
    degradedNote("memory"),
    "Answered without what it remembers about you — that source didn't respond.",
  );
  assert.equal(
    degradedNote("markets,desk"),
    "Answered without live market data and its own desk read — that source didn't respond.",
  );
  // three reads as a list, and repeats/casing/spacing don't double it up
  assert.equal(
    degradedNote(" MEMORY , markets ,memory, command "),
    "Answered without what it remembers about you, live market data and the command deck — that source didn't respond.",
  );
});

// --- 3. eight rows, two videos ---------------------------------------------

const row = (id: string, videoId?: string) => ({ id, videoId, receivedAt: 0 });

test("L9/dedupe: repeated attempts collapse under the newest, with the full count", () => {
  // newest-first, exactly as listTranscripts returns them
  const rows = [
    row("tr_8", "AAA"),
    row("tr_7", "AAA"),
    row("tr_6", "BBB"),
    row("tr_5", "AAA"),
    row("tr_4", "BBB"),
  ];
  const marked = markRepeats(rows);

  // the newest attempt on each video is the row that stands
  assert.equal(marked[0].repeatOf, null, "tr_8 is the head for AAA");
  assert.equal(marked[2].repeatOf, null, "tr_6 is the head for BBB");
  // every older attempt points at its head — nothing is dropped
  assert.deepEqual(
    marked.filter((m) => m.repeatOf !== null).map((m) => [m.id, m.repeatOf]),
    [
      ["tr_7", "tr_8"],
      ["tr_5", "tr_8"],
      ["tr_4", "tr_6"],
    ],
  );
  // the count is the whole history of that video, heads included
  assert.equal(marked[0].attempts, 3);
  assert.equal(marked[2].attempts, 2);
  // the list still holds every row: collapsing is a rendering decision, not a
  // deletion
  assert.equal(marked.length, rows.length);
});

test("L9/dedupe: a hand-pasted row is never grouped with anything", () => {
  const marked = markRepeats([row("tr_3"), row("tr_2", ""), row("tr_1", "   ")]);
  assert.deepEqual(
    marked.map((m) => [m.repeatOf, m.attempts]),
    [
      [null, 1],
      [null, 1],
      [null, 1],
    ],
    "no videoId means no identity — two different transcripts must not merge",
  );
});
