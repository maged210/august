// Unit tests for the intel store's surviving pure logic. Runs on Node's built-in
// test runner with native TypeScript type-stripping (Node 23+/24). No test
// framework dependency is added. Run with `npm test` (which adds
// tests/ts-resolve.mjs — a tiny in-thread resolve hook that lets extensionless
// relative imports resolve to ".ts" and maps the "@/" path alias to the repo
// root under the native runner). Functions that touch live APIs/Redis are
// covered by tsc + the production build, not unit tests.
//
// chore/terminal-cut: the owner desk and its brief pipeline (youtube,
// transcript, chapters, dates, options, options-rank, normalize, candidates,
// extract, pipeline, brief, collapse, selQuotes, redact, publish) are DELETED
// and their tests went with them. What remains is what the app still runs:
// the session helpers, the store's video soft-dedup helpers, and the
// attribution-gate derivation in lib/user-scope.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isStale, marketSession, etDateKey } from "../lib/intel/session.ts";
import type { IntelVideo } from "../lib/intel/types.ts";
import { deriveIntelAttributionGate, OWNER_EMAIL } from "../lib/user-scope.ts";
import { decideVideoMerge, isSoftDuplicate, normalizeVideoTitle, SOFT_DUP_WINDOW_MS } from "../lib/intel/store.ts";

const T0 = Date.UTC(2026, 0, 5, 15);

// --- session helpers (session.ts) ------------------------------------------

test("isStale: yesterday is stale, now is not", () => {
  assert.equal(isStale(Date.now() - 3 * 86_400_000), true);
  assert.equal(isStale(Date.now()), false);
});
test("marketSession + etDateKey are well-formed", () => {
  assert.ok(["premarket", "regular", "afterhours", "closed"].includes(marketSession()));
  assert.match(etDateKey(), /^\d{4}-\d{2}-\d{2}$/);
});

// --- video soft-dedup (store.ts pure helpers) --------------------------------
const mkVideo = (over: Partial<IntelVideo> = {}): IntelVideo => ({
  videoId: "v_orig",
  sourceId: "UC1",
  channelId: "UC1",
  channelTitle: "Chan",
  title: "Morning LIVE: SPY levels 6/25",
  publishedAt: T0,
  liveState: "uploaded",
  status: "transcript_pending",
  transcriptStatus: "pending",
  created: T0,
  updated: T0,
  ...over,
});

test("normalizeVideoTitle: case/punctuation/whitespace/emoji-insensitive key", () => {
  assert.equal(normalizeVideoTitle("  Morning LIVE: SPY levels — 6/25!! \u{1F534}"), normalizeVideoTitle("morning live spy levels 6 25"));
  assert.notEqual(normalizeVideoTitle("SPY levels 6/25"), normalizeVideoTitle("SPY levels 6/26"));
  assert.equal(normalizeVideoTitle("\u{1F534}\u{1F534}"), ""); // symbols-only titles never match anything
});

test("decideVideoMerge: richer status wins regardless of argument order", () => {
  const analyzed = mkVideo({ videoId: "vA", status: "analyzed" });
  const pending = mkVideo({ videoId: "vB", status: "transcript_pending", publishedAt: T0 + 3_600_000 });
  assert.equal(decideVideoMerge(analyzed, pending)?.keep.videoId, "vA");
  assert.equal(decideVideoMerge(pending, analyzed)?.keep.videoId, "vA");
  const ready = mkVideo({ videoId: "vC", status: "transcript_ready" });
  assert.equal(decideVideoMerge(ready, pending)?.keep.videoId, "vC"); // analyzed > transcript_ready > pending
  const older = mkVideo({ videoId: "vD", created: T0 - 1 });
  assert.equal(decideVideoMerge(older, mkVideo({ videoId: "vE" }))?.keep.videoId, "vD"); // tie → older record
});

test("decideVideoMerge: only same-channel same-title twins inside the 48h window", () => {
  const base = mkVideo({ videoId: "v1" });
  assert.equal(decideVideoMerge(base, mkVideo({ videoId: "v2", publishedAt: T0 + SOFT_DUP_WINDOW_MS + 1 })), null); // outside window
  assert.equal(decideVideoMerge(base, mkVideo({ videoId: "v3", channelId: "UC2" })), null); // different channel
  assert.equal(decideVideoMerge(base, mkVideo({ videoId: "v4", channelId: undefined })), null); // unknown channel never merges
  assert.equal(decideVideoMerge(base, mkVideo({ videoId: "v5", title: "totally different show" })), null);
  assert.equal(decideVideoMerge(base, base), null); // same id is not a twin
  assert.equal(isSoftDuplicate(base, mkVideo({ videoId: "v6", publishedAt: T0 + SOFT_DUP_WINDOW_MS })), true); // boundary inclusive
});

// ===========================================================================
// THE ATTRIBUTION BOUNDARY — who may see source attribution (user-scope's
// deriveIntelAttributionGate; the redact.ts consumer went with the desk, the
// derivation still guards lib/admin). Pure derivation, so all five paths are
// covered without a session or an env mutation.
// ===========================================================================

const NON_OWNER = "viv@example.com";

test("attribution gate: configured + owner session → full attribution", () => {
  assert.deepEqual(
    deriveIntelAttributionGate({ configured: true, email: OWNER_EMAIL, production: false }),
    { ok: true },
  );
  // production changes NOTHING once auth is actually configured
  assert.deepEqual(
    deriveIntelAttributionGate({ configured: true, email: OWNER_EMAIL, production: true }),
    { ok: true },
  );
});

test("attribution gate: configured + non-owner session → 403, in every environment", () => {
  for (const production of [false, true]) {
    assert.deepEqual(
      deriveIntelAttributionGate({ configured: true, email: NON_OWNER, production }),
      { ok: false, status: 403 },
      `non-owner must never see attribution (production=${production})`,
    );
  }
});

test("attribution gate: configured + signed out → 401, in every environment", () => {
  for (const production of [false, true]) {
    assert.deepEqual(
      deriveIntelAttributionGate({ configured: true, email: null, production }),
      { ok: false, status: 401 },
      `signed-out must never see attribution (production=${production})`,
    );
  }
});

test("attribution gate: unconfigured auth in dev/test → the single-user fallback (owner)", () => {
  // Byte-identical to pre-multi-user behavior: the desk works out of the box.
  assert.deepEqual(
    deriveIntelAttributionGate({ configured: false, email: null, production: false }),
    { ok: true },
  );
});

test("attribution gate: unconfigured auth in PRODUCTION → FAILS CLOSED (redacted)", () => {
  // The whole point of decision #4: a deployed environment that lost its auth
  // env vars (AUTH_SECRET dropped, env group unlinked, secretless preview
  // build) must NOT hand full source attribution to the public. Privacy is the
  // product's promise — a config accident can never be what breaks it.
  assert.deepEqual(
    deriveIntelAttributionGate({ configured: false, email: null, production: true }),
    { ok: false, status: 403 },
    "unconfigured auth in production must resolve to REDACTED, never to owner",
  );
});

test("attribution gate: ONLY unconfigured-in-production diverges from the single-user fallback", () => {
  // Pins the blast radius of the fail-closed rule: it changes exactly one input
  // and leaves every configured path alone.
  const inputs = [
    { configured: true, email: OWNER_EMAIL },
    { configured: true, email: NON_OWNER },
    { configured: true, email: null },
    { configured: false, email: null },
  ];
  const diverged = inputs.filter(
    (i) =>
      JSON.stringify(deriveIntelAttributionGate({ ...i, production: true })) !==
      JSON.stringify(deriveIntelAttributionGate({ ...i, production: false })),
  );
  assert.deepEqual(diverged, [{ configured: false, email: null }]);
});
