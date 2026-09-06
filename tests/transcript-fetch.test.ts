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
  assertLanguage,
  billedCredits,
  failureForStatus,
  fetchTranscript,
  isEnglish,
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

// --- language gate (regression: i9dVorpqWpI returned Arabic) ----------------
//
// The bug: an English video came back as a 16,935-char ARABIC transcript. We
// sent no `lang`, and the provider chose `ar` despite availableLangs being
// ["en","ar"]. Pinning lang=en is only half the fix — the provider documents
// that an UNAVAILABLE language silently falls back to "the first available
// language" with a 200, so the response has to be checked.

test("isEnglish: accepts every English tag shape, rejects other languages", () => {
  for (const ok of ["en", "en-US", "en-GB", "EN", "EN_us", "en_AU", " en "]) {
    assert.equal(isEnglish(ok), true, `expected ${JSON.stringify(ok)} to be English`);
  }
  for (const no of ["ar", "es", "eng", "de", "fr", "", null, undefined]) {
    assert.equal(isEnglish(no), false, `expected ${JSON.stringify(no)} NOT to be English`);
  }
  // "en-x" IS English by design — the check is on the primary subtag, so any
  // en-* region or variant passes. Asserted positively rather than skipped.
  assert.equal(isEnglish("en-x"), true);
});

test("isEnglish: a non-string tag is false, never a throw", () => {
  // the gate runs OUTSIDE the fetch try/catch, so a throw here would escape as
  // a bodyless 500 — the silent failure this feature exists to prevent
  for (const junk of [42, {}, [], true, ["en"], { lang: "en" }]) {
    assert.doesNotThrow(() => isEnglish(junk));
    assert.equal(isEnglish(junk), false, `expected ${JSON.stringify(junk)} NOT to be English`);
  }
});

test("assertLanguage: English passes through", () => {
  assert.equal(assertLanguage("en", ["en"]), null);
  assert.equal(assertLanguage("en-US", ["en-US", "ar"]), null);
});

test("assertLanguage: THE REGRESSION — Arabic on an en/ar video is refused, and says so", () => {
  const f = assertLanguage("ar", ["en", "ar"]);
  assert.ok(f, "an Arabic transcript must never be accepted");
  assert.equal(f.kind, "wrong_language");
  assert.match(f.message, /no english transcript/i);
  assert.match(f.message, /"ar"/); // names what actually came back
  assert.match(f.message, /box was left unchanged/i); // and that nothing was loaded
});

test("assertLanguage: names the other tracks so the refusal is diagnosable", () => {
  const f = assertLanguage("ar", ["en", "ar", "es"]);
  assert.ok(f);
  assert.match(f.message, /ar, es/); // English filtered out of the "tracks" list
  assert.equal(/\ben\b/.test(f.message.split("tracks:")[1] ?? ""), false);
});

test("assertLanguage: an unreported language is refused, not assumed English", () => {
  const f = assertLanguage(null, ["en"]);
  assert.ok(f, "a missing lang tag must not be treated as English");
  assert.equal(f.kind, "wrong_language");
  assert.match(f.message, /didn't say which language/i);
});

test("assertLanguage: survives a missing or malformed availableLangs", () => {
  for (const langs of [null, []]) {
    const f = assertLanguage("ar", langs);
    assert.ok(f);
    assert.match(f.message, /no english transcript/i);
    assert.equal(/tracks:/.test(f.message), false, "no empty 'tracks:' clause");
  }
});

test("wrong_language is a distinct failure kind with its own message", () => {
  const f = assertLanguage("ar", ["en", "ar"]);
  assert.ok(f);
  // it must not collide with any status-derived failure
  for (const s of [206, 400, 401, 402, 403, 404, 429, 500]) {
    assert.notEqual(f.message, failureForStatus(s).message);
  }
});

// --- THE WIRING (stubbed fetch) ---------------------------------------------
//
// The tests above cover the pure helpers, which is not enough: with only those,
// deleting the `lang=en` query param OR the assertLanguage call leaves the suite
// fully green and the Arabic bug back. These two stub global fetch so the pin
// and the gate are each asserted where they actually live.

type StubCall = { url: string; init?: RequestInit };

/** Replace global fetch for one test; returns the calls it saw + a restore fn. */
function stubFetch(handler: (url: string) => { status?: number; headers?: Record<string, string>; body: unknown }) {
  const calls: StubCall[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const { status = 200, headers = {}, body } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const TRANSCRIPT_BODY = (lang: string, availableLangs: string[]) => ({
  content: "Iran fired missiles and drones at US military bases in Kuwait today.",
  lang,
  availableLangs,
});

test("WIRING: the request pins lang=en — deleting the param fails this test", async () => {
  process.env.TRANSCRIPT_PROVIDER_API_KEY = "test-key";
  const stub = stubFetch((url) =>
    url.includes("/v1/transcript")
      ? { headers: { "x-billable-requests": "1" }, body: TRANSCRIPT_BODY("en", ["en"]) }
      : { body: { title: "T", channel: { name: "C" }, uploadDate: "2026-01-01T00:00:00.000Z", duration: 60 } },
  );
  try {
    const r = await fetchTranscript("https://www.youtube.com/watch?v=i9dVorpqWpI");
    assert.equal(r.ok, true);
    const transcriptCall = stub.calls.find((c) => c.url.includes("/v1/transcript"));
    assert.ok(transcriptCall, "no transcript request was made");
    const q = new URL(transcriptCall.url).searchParams;
    assert.equal(q.get("lang"), "en", "the transcript request MUST pin lang=en");
    assert.equal(q.get("mode"), "native", "and must not let the provider fall back to paid AI generation");
    // the key travels in a header, never the query string
    assert.equal(transcriptCall.url.includes("test-key"), false);
  } finally {
    stub.restore();
    delete process.env.TRANSCRIPT_PROVIDER_API_KEY;
  }
});

test("WIRING: THE BUG — a 200 carrying Arabic is refused, not returned", async () => {
  // Exactly the shape the provider really sent for i9dVorpqWpI. The provider
  // documents that an unavailable language falls back to "the first available
  // language" with a 200, so this is reachable even WITH lang=en pinned.
  // Deleting the assertLanguage call fails this test.
  process.env.TRANSCRIPT_PROVIDER_API_KEY = "test-key";
  let metadataCalled = false;
  const stub = stubFetch((url) => {
    if (url.includes("/v1/transcript")) {
      return { headers: { "x-billable-requests": "1" }, body: TRANSCRIPT_BODY("ar", ["en", "ar"]) };
    }
    metadataCalled = true;
    return { body: {} };
  });
  try {
    const r = await fetchTranscript("https://www.youtube.com/watch?v=i9dVorpqWpI");
    assert.equal(r.ok, false, "an Arabic transcript must NEVER be returned as success");
    if (!r.ok) {
      assert.equal(r.kind, "wrong_language");
      assert.match(r.message, /"ar"/);
      assert.equal(r.credits, 1, "the failed transcript call is still billed and reported");
    }
    assert.equal(metadataCalled, false, "a refusal must not go on to buy metadata — that would cost 2 credits");
  } finally {
    stub.restore();
    delete process.env.TRANSCRIPT_PROVIDER_API_KEY;
  }
});

test("WIRING: an English 200 passes the gate and reports its language", async () => {
  process.env.TRANSCRIPT_PROVIDER_API_KEY = "test-key";
  const stub = stubFetch((url) =>
    url.includes("/v1/transcript")
      ? { headers: { "x-billable-requests": "1" }, body: TRANSCRIPT_BODY("en-US", ["en"]) }
      : { body: { title: "The Stock Market", channel: { name: "StockedUp" }, uploadDate: "2026-06-20T00:00:00.000Z", duration: 900 } },
  );
  try {
    const r = await fetchTranscript("https://www.youtube.com/watch?v=i9dVorpqWpI");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.lang, "en-US", "the reported language is the provider's, surfaced for the result line");
      assert.equal(r.meta?.channel, "StockedUp");
      assert.equal(r.credits, 2); // 1 transcript + 1 metadata
    }
  } finally {
    stub.restore();
    delete process.env.TRANSCRIPT_PROVIDER_API_KEY;
  }
});

// The async 202 branch — large videos the provider queues as a job. It could
// not be exercised live (no test video was big enough to trigger a 202), so it
// is covered here instead: the gate must apply to the job's result exactly as
// it does to a synchronous one, or the async path becomes a hole the fix
// doesn't cover.

function stubJob(jobLang: unknown) {
  let polls = 0;
  return stubFetch((url) => {
    if (/\/v1\/transcript\/[^?]+$/.test(url)) {
      polls++;
      return {
        headers: { "x-billable-requests": "0" },
        body: { status: "completed", content: "Iran fired missiles at US bases today.", lang: jobLang, availableLangs: ["en", "ar"] },
      };
    }
    if (url.includes("/v1/transcript")) {
      return { status: 202, headers: { "x-billable-requests": "1" }, body: { jobId: "job_abc123" } };
    }
    return { body: { title: "T", channel: { name: "C" }, uploadDate: null, duration: null } };
  });
}

test("WIRING (async 202): a job returning Arabic is refused, same as the sync path", async () => {
  process.env.TRANSCRIPT_PROVIDER_API_KEY = "test-key";
  const stub = stubJob("ar");
  try {
    const r = await fetchTranscript("https://www.youtube.com/watch?v=i9dVorpqWpI");
    assert.equal(r.ok, false, "the gate must apply to the job path too");
    if (!r.ok) assert.equal(r.kind, "wrong_language");
    assert.ok(stub.calls.some((c) => /\/v1\/transcript\/job_abc123/.test(c.url)), "the job was polled");
  } finally {
    stub.restore();
    delete process.env.TRANSCRIPT_PROVIDER_API_KEY;
  }
});

test("WIRING (async 202): an English job passes, and a junk lang tag is refused not thrown", async () => {
  process.env.TRANSCRIPT_PROVIDER_API_KEY = "test-key";
  let stub = stubJob("en");
  try {
    const ok = await fetchTranscript("https://www.youtube.com/watch?v=i9dVorpqWpI");
    assert.equal(ok.ok, true, "a completed English job must be accepted");
  } finally {
    stub.restore();
  }
  // a non-string tag must become a clean refusal — the gate runs outside the
  // fetch try/catch, so a throw here would escape as a bodyless 500
  stub = stubJob(42);
  try {
    const junk = await fetchTranscript("https://www.youtube.com/watch?v=i9dVorpqWpI");
    assert.equal(junk.ok, false);
    if (!junk.ok) assert.equal(junk.kind, "wrong_language");
  } finally {
    stub.restore();
    delete process.env.TRANSCRIPT_PROVIDER_API_KEY;
  }
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
