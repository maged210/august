// Link → transcript intake (feature/ingest-transcripts) — the PURE half:
// reference parsing (what never reaches the provider), the status → failure
// map (every branch a distinct sentence, never an empty string), the billing
// header reader, and the key scrubber that keeps the provider key out of
// anything renderable.
//
// The network half is not mocked here: the branch's verification is a real
// end-to-end fetch against a live video, recorded in the PR.

delete process.env.TRANSCRIPT_PROVIDER_API_KEY;

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billedCredits,
  failureForStatus,
  fetchTranscript,
  languageUnavailableMessage,
  parseVideoRef,
  scrubKey,
  transcriptProviderConfigured,
  type FetchFailureKind,
} from "../lib/transcript-fetch";
import { recordMatchesVideo, validateTranscriptBody, type TranscriptRecord } from "../lib/transcripts";

// --- parseVideoRef ----------------------------------------------------------

const CANON = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

test("parseVideoRef: accepts every YouTube link shape and canonicalizes it", () => {
  for (const input of [
    "dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "youtube.com/watch?v=dQw4w9WgXcQ", // scheme-less
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ", // padded
  ]) {
    const r = parseVideoRef(input);
    assert.ok(r.ok, `expected ${input} to parse`);
    assert.equal(r.ref.videoId, "dQw4w9WgXcQ");
    assert.equal(r.ref.url, CANON, `expected ${input} to canonicalize`);
  }
});

test("parseVideoRef: extra query params don't break the id", () => {
  const r = parseVideoRef("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLabc");
  assert.ok(r.ok);
  assert.equal(r.ref.videoId, "dQw4w9WgXcQ");
  assert.equal(r.ref.url, CANON);
});

test("parseVideoRef: rejects non-videos with a readable reason, never a throw", () => {
  const cases: Array<[string, RegExp]> = [
    ["", /paste a youtube link/i],
    ["   ", /paste a youtube link/i],
    ["https://www.youtube.com/@stockmarketlive", /not a single video/i],
    ["https://www.youtube.com/playlist?list=PLabc", /not a single video/i],
    ["https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw", /not a single video/i],
    ["https://vimeo.com/12345", /not a youtube link/i],
    ["not a url at all", /not a youtube link/i],
    // a mistyped ID must be told it's a mistyped ID, not "not a YouTube link":
    // `new URL("https://dQw4w9WgXc")` parses fine as a hostname
    ["dQw4w9WgXc", /exactly 11 characters \(this one is 10\)/i], // one short
    ["dQw4w9WgXcQQ", /exactly 11 characters \(this one is 12\)/i], // one long
  ];
  for (const [input, re] of cases) {
    const r = parseVideoRef(input);
    assert.equal(r.ok, false, `expected ${JSON.stringify(input)} to be rejected`);
    if (!r.ok) assert.match(r.message, re);
  }
});

test("parseVideoRef: a bad ref never reaches the provider — fetchTranscript answers locally at zero cost", async () => {
  // no key set (see the delete at the top): a malformed ref must still be
  // reported as malformed, NOT as not_configured, and must cost nothing
  process.env.TRANSCRIPT_PROVIDER_API_KEY = "test-key-not-used";
  try {
    const r = await fetchTranscript("https://vimeo.com/12345");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.kind, "malformed_url");
      assert.equal(r.credits, 0);
    }
  } finally {
    delete process.env.TRANSCRIPT_PROVIDER_API_KEY;
  }
});

// --- failureForStatus -------------------------------------------------------

test("failureForStatus: every documented status maps to its own kind", () => {
  const expected: Array<[number, FetchFailureKind]> = [
    [206, "no_captions"],
    [400, "malformed_url"],
    [401, "unauthorized"],
    [402, "plan_required"],
    [403, "forbidden"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "provider_error"],
    [418, "provider_error"], // undocumented → still explained, never silent
  ];
  for (const [status, kind] of expected) {
    assert.equal(failureForStatus(status).kind, kind, `status ${status}`);
  }
});

test("failureForStatus: no branch returns an empty or duplicated message", () => {
  const statuses = [206, 400, 401, 402, 403, 404, 429, 500, 418];
  const seen = new Set<string>();
  for (const s of statuses) {
    const { message } = failureForStatus(s);
    assert.ok(message.trim().length > 20, `status ${s} message too thin: ${JSON.stringify(message)}`);
    assert.equal(seen.has(message), false, `status ${s} duplicates another message`);
    seen.add(message);
  }
});

test("failureForStatus: 429 names BOTH causes — the provider conflates them", () => {
  const m = failureForStatus(429).message;
  assert.match(m, /rate limit/i);
  assert.match(m, /quota/i);
});

test("failureForStatus: 206 explains the cost of the AI fallback we deliberately don't take", () => {
  const m = failureForStatus(206).message;
  assert.match(m, /no captions/i);
  assert.match(m, /2 credits per minute/i);
});

// --- languageUnavailableMessage ----------------------------------------------
// Regression coverage for the 2026-09-09 bug: an English video came back as a
// 16.9k-char Arabic transcript because no `lang` was pinned on the request,
// and the provider substitutes silently (200, not an error) when a pinned
// language isn't available. This is the pure half of that fix — the network
// half (the actual live substitution) is verified live and recorded in the
// commit, per this file's no-mocking convention, at real provider cost.

test("languageUnavailableMessage: names English by its name, lists what IS available", () => {
  const m = languageUnavailableMessage("en", "ar", ["ar", "fr", "es"]);
  assert.match(m, /english isn't available/i);
  assert.match(m, /ar, fr, es/);
});

test("languageUnavailableMessage: a non-English requested code is named by its raw code", () => {
  const m = languageUnavailableMessage("fr", "en", ["en"]);
  assert.match(m, /^fr isn't available/);
});

test("languageUnavailableMessage: falls back to naming the substitute when availableLangs is empty", () => {
  const m = languageUnavailableMessage("en", "ar", []);
  assert.match(m, /english isn't available/i);
  assert.match(m, /substituted "ar" instead/);
});

test("languageUnavailableMessage: never returns an empty string", () => {
  assert.ok(languageUnavailableMessage("en", "unknown", []).trim().length > 10);
});

// --- billedCredits ----------------------------------------------------------

test("billedCredits: reads the header, and never yields NaN or a negative", () => {
  const h = (v: string | null) => (v === null ? new Headers() : new Headers({ "x-billable-requests": v }));
  assert.equal(billedCredits(h("1")), 1);
  assert.equal(billedCredits(h("12")), 12);
  assert.equal(billedCredits(h("0")), 0);
  assert.equal(billedCredits(h(null)), 0); // absent header
  assert.equal(billedCredits(h("banana")), 0); // garbage
  assert.equal(billedCredits(h("-4")), 0); // negative
  assert.equal(billedCredits(h("")), 0);
});

// --- scrubKey ---------------------------------------------------------------

test("scrubKey: removes the key from anything renderable", () => {
  const key = "sd_live_abcdef0123456789";
  assert.equal(scrubKey(`failed for ${key} sorry`, key), "failed for [redacted] sorry");
  assert.equal(scrubKey(`${key}${key}`, key), "[redacted][redacted]");
  assert.equal(scrubKey("nothing to do", key), "nothing to do");
});

test("scrubKey: a short or absent key is a no-op, never a mass replace", () => {
  assert.equal(scrubKey("a-b-c", undefined), "a-b-c");
  assert.equal(scrubKey("a-b-c", ""), "a-b-c");
  assert.equal(scrubKey("aaaa", "a"), "aaaa"); // 1-char key must not blank the string
});

test("fetchTranscript: no key configured is reported as such, at zero cost", async () => {
  assert.equal(transcriptProviderConfigured(), false);
  const r = await fetchTranscript(CANON);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, "not_configured");
    assert.equal(r.credits, 0);
    assert.match(r.message, /TRANSCRIPT_PROVIDER_API_KEY/);
  }
});

// --- duplicate guard --------------------------------------------------------

const rec = (over: Partial<TranscriptRecord>): TranscriptRecord => ({
  id: "tr_test",
  source: "",
  chars: 10,
  receivedAt: 0,
  status: "processed",
  ideaIds: [],
  ...over,
});

test("recordMatchesVideo: matches the explicit videoId", () => {
  assert.equal(recordMatchesVideo(rec({ videoId: "dQw4w9WgXcQ" }), "dQw4w9WgXcQ"), true);
  assert.equal(recordMatchesVideo(rec({ videoId: "dQw4w9WgXcQ" }), "AAAAAAAAAAA"), false);
});

test("recordMatchesVideo: falls back to the source label for pre-branch records", () => {
  // records written before this branch carry the id only inside the label
  assert.equal(
    recordMatchesVideo(rec({ source: "https://youtu.be/dQw4w9WgXcQ" }), "dQw4w9WgXcQ"),
    true,
  );
  assert.equal(recordMatchesVideo(rec({ source: "Some unrelated title" }), "dQw4w9WgXcQ"), false);
});

test("recordMatchesVideo: refuses a malformed id rather than matching loosely", () => {
  // "" would otherwise be `source.includes("")` === true and flag EVERY record
  assert.equal(recordMatchesVideo(rec({ source: "anything" }), ""), false);
  assert.equal(recordMatchesVideo(rec({ videoId: "" }), ""), false);
  assert.equal(recordMatchesVideo(rec({ source: "abc" }), "abc"), false); // too short to be an id
});

// --- videoId provenance through the intake ----------------------------------

test("intake body: keeps a well-formed videoId, drops junk", () => {
  const good = validateTranscriptBody({ text: "hi", videoId: "dQw4w9WgXcQ" });
  assert.ok(good.ok);
  if (good.ok) assert.equal(good.value.videoId, "dQw4w9WgXcQ");

  for (const junk of ["", "   ", "not-an-id", "dQw4w9WgXc", 42, null, {}]) {
    const r = validateTranscriptBody({ text: "hi", videoId: junk });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.value.videoId, "", `expected ${JSON.stringify(junk)} to be dropped`);
  }
});

test("intake body: a hand-pasted transcript still validates with no videoId", () => {
  const r = validateTranscriptBody({ text: "pasted by hand", source: "my label" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.videoId, "");
    assert.equal(r.value.text, "pasted by hand");
    assert.equal(r.value.source, "my label");
  }
});
