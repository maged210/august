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
  applyConflictRule,
  applyEntryRule,
  applyIdeaFloor,
  normalizeCandidates,
  stopMasqueradingAsEntry,
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

test("normalize: a stated side rides through; an invalid side drops the row (UX4)", () => {
  const out = normalizeCandidates([
    { ...GOOD, side: "long" },
    { ...GOOD, side: "sideways" }, // not a side — dropped, never repaired
    GOOD, // no side — passes with the field absent
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].side, "long");
  assert.ok(!("side" in out[1]));
});

test("entry rule (F6): an entry-less call is not an idea — it demotes to a tape note", () => {
  const { ideas, tape } = applyEntryRule(
    normalizeCandidates([
      GOOD,
      { ...GOOD, instrument: "XLE", entry: "", side: "short", thesis: "Strategic reserve refill chatter." },
    ]),
    [],
  );
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].instrument, "NQ"); // the stated-entry idea survives
  assert.equal(tape.length, 1);
  assert.equal(tape[0].symbol, "XLE");
  assert.equal(tape[0].kind, "note");
  assert.equal(tape[0].sentiment, "bear"); // side → sentiment
  assert.equal(tape[0].status, "draft");
  assert.equal(tape[0].source, "extracted");
  assert.equal(tape[0].note, "Strategic reserve refill chatter.");
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

// --- INTEGRITY-1 · the conflict rule ----------------------------------------

test("conflict rule: side vs entry-language disagreement lands in REVIEW, never draft-to-live", () => {
  const out = applyConflictRule(
    normalizeCandidates([
      { ...GOOD, entry: "break above 21,450", side: "short" }, // mismatch
      { ...GOOD, instrument: "SPY", entry: "Break above 772–772.50 for bulls; break below 766–767 for bears" }, // two-sided
      { ...GOOD, instrument: "HOOD", entry: "falls under $95.30", side: "short" }, // agreement
    ]),
  );
  assert.equal(out.length, 3);
  assert.equal(out[0].status, "review");
  assert.equal(out[1].status, "review");
  assert.equal(out[2].status, "draft");
});


// --- fix/extractor-quality · THE STOP IS NOT THE ENTRY ----------------------
// Live evidence from the 2026-09-09 run: the model emitted
// "above 36.70 support (stop below 36.70)" for a call whose $36.70 was the
// STOP. Graded literally that arms a trigger the speaker never gave.

test("stop-as-entry: the same number as trigger AND stop is contested, not clean", () => {
  assert.equal(stopMasqueradingAsEntry("above 36.70 support (stop below 36.70)"), true);
  // the stop's number moved in front of the word — the shape seen on the rerun
  assert.equal(stopMasqueradingAsEntry("above 36.70 support (stop below); options at $45 strike"), true);
  // a stop carrying its own, different level is the normal healthy shape
  assert.equal(stopMasqueradingAsEntry("break above $50; stop below $47"), false);
  assert.equal(stopMasqueradingAsEntry("long above 9,450; stop below 9,400"), false);
  assert.equal(stopMasqueradingAsEntry("above 775.50"), false);
  assert.equal(stopMasqueradingAsEntry("watch for continuation"), false);
});

test("stop-as-entry: a decimal stop is read whole — $36.70 is not 36", () => {
  // the clause boundary must not cut at the decimal point, or the guard
  // compares 36 against a 36.70 trigger and waves it through
  assert.equal(stopMasqueradingAsEntry("above $36.70 (stop below $36.70)"), true);
  assert.equal(stopMasqueradingAsEntry("above $36.70; stop below $30.10"), false);
});

test("stop-as-entry: such a row lands in REVIEW rather than going out as a clean draft", () => {
  const out = applyConflictRule(
    normalizeCandidates([
      { ...GOOD, instrument: "OKLO", entry: "above 36.70 support (stop below 36.70)", side: "long" },
      { ...GOOD, instrument: "ORCL", entry: "break above 156.75", side: "long" },
    ]),
  );
  assert.equal(out[0].status, "review");
  assert.equal(out[1].status, "draft");
});

// --- fix/extractor-quality · THE IDEA FLOOR ---------------------------------

const mk = (instrument: string, entry: string, target = "") => ({ ...GOOD, instrument, entry, target });

test("floor: keeps a readable trigger, and a stated price the grader can't yet read", () => {
  const { ideas, dropped } = applyIdeaFloor(
    normalizeCandidates([
      mk("ORCL", "break above 156.75"),
      mk("ENPH", "double bottom off $35 support"), // price stated, no direction → NEEDS LEVEL, still real
      mk("CAR", "confirmation break below short-term uptrend; gap fill target ~$57.70–$56"),
      mk("DKNG", "holds support around $25"),
    ]),
  );
  assert.equal(ideas.length, 4);
  assert.equal(dropped.length, 0);
});

test("floor: drops bare commentary — no level, no trigger, just a ticker named in passing", () => {
  const { ideas, dropped } = applyIdeaFloor(
    normalizeCandidates([
      mk("UGA", "continuing to move higher, still on the radar"),
      mk("CRAK", "continuing to move higher, still on the radar"),
      mk("UMAC", "watch for continuation out of recent push to new highs"),
      mk("BMNU", "watch for continued breakout"),
      mk("OKLO", "double bottom confirmed"),
      mk("SPXS", "watch for continued market weakness/confirmation of downside"),
      mk("ORCL", "break above 156.75"), // the one real idea survives
    ]),
  );
  assert.deepEqual(ideas.map((i) => i.instrument), ["ORCL"]);
  assert.equal(dropped.length, 6);
});

test("floor: a level stated only in the TARGET still counts — the row isn't destroyed", () => {
  // the inverse would be perverse: an emptier row (entry "") demotes to a tape
  // note and survives, so a row carrying MORE information must not be deleted
  const { ideas, dropped } = applyIdeaFloor(normalizeCandidates([mk("BBB", "on a pullback", "$52")]));
  assert.equal(ideas.length, 1);
  assert.equal(dropped.length, 0);
});

test("floor: a specific stated trigger with no number is kept — the owner's rule has two halves", () => {
  const { ideas, dropped } = applyIdeaFloor(
    normalizeCandidates([
      mk("AAA", "on a break of yesterday's high"),
      mk("BBB", "if it reclaims the 200-day"),
      mk("CCC", "watch for breakout above near-term key resistance"),
    ]),
  );
  assert.equal(ideas.length, 3);
  assert.equal(dropped.length, 0);
});

test("floor: a percentage, a unit or a bare year is not a price", () => {
  const { ideas, dropped } = applyIdeaFloor(
    normalizeCandidates([
      mk("AAA", "down 30% off the highs, watching"),
      mk("BBB", "back to the 2024 area, still on the radar"),
    ]),
  );
  assert.equal(ideas.length, 0);
  assert.equal(dropped.length, 2);
});

test("floor: a $-marked price inside the year band is a PRICE — gold and ETH survive", () => {
  // the grader's year guard must not double as an existence test, or every
  // $1,990–$2,039 idea is deleted before a human ever sees it
  const { ideas, dropped } = applyIdeaFloor(
    normalizeCandidates([mk("XAUUSD", "long gold near $1995"), mk("ETH", "buying $2010 area")]),
  );
  assert.equal(ideas.length, 2);
  assert.equal(dropped.length, 0);
});

test("floor: runs BEFORE the per-transcript cap, so commentary can't eat the idea budget", () => {
  const commentary = Array.from({ length: MAX_IDEAS_PER_TRANSCRIPT }, (_, n) =>
    mk(`C${n}`, "still on the radar"),
  );
  const real = [mk("ORCL", "break above 156.75"), mk("BTG", "break above $5.70")];
  const { ideas } = applyIdeaFloor(
    normalizeCandidates([...commentary, ...real], MAX_IDEAS_PER_TRANSCRIPT * 4),
  );
  assert.deepEqual(ideas.map((i) => i.instrument), ["ORCL", "BTG"]);
});
