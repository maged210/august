// Trade Ideas (CORE V2) — pure validators, redaction, relative time, and the
// unconfigured-store no-op contract. Node 23+ (native TS type-stripping), run
// via `npm test` (tests are ENUMERATED in package.json — this file is listed).

// Pin the no-Redis path BEFORE the store module reads env (lazy, but be safe —
// the threads/user-scope suites set the same precedent).
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDEA_RISKS,
  IDEA_SIDES,
  MAX_INSTRUMENT_CHARS,
  MAX_LEVEL_CHARS,
  MAX_THESIS_CHARS,
  createIdea,
  getIdea,
  ideasConfigured,
  listIdeas,
  listLiveIdeas,
  relativeTime,
  suggestSide,
  toPublicIdea,
  updateIdea,
  validateIdeaCreate,
  validateIdeaPatch,
  type Idea,
} from "../lib/ideas";

const T0 = 1_754_000_000_000; // fixed epoch — deterministic clocks

const FULL: Idea = {
  id: "idea_abc123",
  instrument: "NQ",
  thesis: "Breadth divergence into the pivot; fade the open drive.",
  entry: "21,450",
  target: "21,320",
  riskLevel: "medium",
  status: "live",
  source: "extracted",
  createdAt: T0,
  updatedAt: T0 + 60_000,
};

// --- toPublicIdea -----------------------------------------------------------

test("toPublicIdea: strips status and source (provenance never reaches the wire)", () => {
  const pub = toPublicIdea(FULL);
  assert.deepEqual(Object.keys(pub).sort(), [
    "createdAt",
    "entry",
    "id",
    "instrument",
    "riskLevel",
    "target",
    "thesis",
    "updatedAt",
  ]);
  assert.equal((pub as Record<string, unknown>).status, undefined);
  assert.equal((pub as Record<string, unknown>).source, undefined);
});

// --- relativeTime -----------------------------------------------------------

test("relativeTime: honest coarse buckets", () => {
  assert.equal(relativeTime(T0 - 30_000, T0), "just now");
  assert.equal(relativeTime(T0 - 5 * 60_000, T0), "5m ago");
  assert.equal(relativeTime(T0 - 2 * 3_600_000, T0), "2h ago");
  assert.equal(relativeTime(T0 - 3 * 86_400_000, T0), "3d ago");
  assert.equal(relativeTime(T0 - 2 * 7 * 86_400_000, T0), "2w ago");
});

test("relativeTime: a future timestamp clamps to 'just now' (never negative)", () => {
  assert.equal(relativeTime(T0 + 60_000, T0), "just now");
});

test("relativeTime: past a month falls back to the plain date", () => {
  const out = relativeTime(T0 - 40 * 86_400_000, T0);
  assert.match(out, /^[A-Z][a-z]{2} \d{1,2}$/);
});

// --- validateIdeaCreate -----------------------------------------------------

test("create: minimal valid body defaults to draft/manual, empty levels allowed", () => {
  const r = validateIdeaCreate({ instrument: "  NQ ", thesis: " fade it ", riskLevel: "low" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.instrument, "NQ");
    assert.equal(r.value.thesis, "fade it");
    assert.equal(r.value.entry, "");
    assert.equal(r.value.target, "");
    assert.equal(r.value.status, "draft");
    assert.equal(r.value.source, "manual");
  }
});

test("create: whitespace collapses in instrument/levels, thesis keeps its body", () => {
  const r = validateIdeaCreate({
    instrument: "ES   mini",
    thesis: "line one\nline two",
    entry: " break  of   600 ",
    target: "620",
    riskLevel: "high",
  });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.instrument, "ES mini");
    assert.equal(r.value.entry, "break of 600");
    assert.equal(r.value.thesis, "line one\nline two");
  }
});

test("create: rejections are total, never partial-defaults", () => {
  assert.equal(validateIdeaCreate(null).ok, false);
  assert.equal(validateIdeaCreate("x").ok, false);
  assert.equal(validateIdeaCreate({ thesis: "t", riskLevel: "low" }).ok, false); // no instrument
  assert.equal(validateIdeaCreate({ instrument: "NQ", riskLevel: "low" }).ok, false); // no thesis
  assert.equal(
    validateIdeaCreate({ instrument: "NQ", thesis: "t", riskLevel: "spicy" }).ok,
    false,
  );
  assert.equal(
    validateIdeaCreate({ instrument: "NQ", thesis: "t", riskLevel: "low", status: "LIVE" }).ok,
    false, // case matters — a typo must not publish
  );
  assert.equal(
    validateIdeaCreate({ instrument: "NQ", thesis: "t", riskLevel: "low", source: "webhook" }).ok,
    false,
  );
});

test("create: caps enforced at the boundary", () => {
  const at = (n: number) => "x".repeat(n);
  assert.ok(
    validateIdeaCreate({ instrument: at(MAX_INSTRUMENT_CHARS), thesis: "t", riskLevel: "low" }).ok,
  );
  assert.equal(
    validateIdeaCreate({ instrument: at(MAX_INSTRUMENT_CHARS + 1), thesis: "t", riskLevel: "low" })
      .ok,
    false,
  );
  assert.equal(
    validateIdeaCreate({ instrument: "NQ", thesis: at(MAX_THESIS_CHARS + 1), riskLevel: "low" }).ok,
    false,
  );
  assert.equal(
    validateIdeaCreate({
      instrument: "NQ",
      thesis: "t",
      riskLevel: "low",
      entry: at(MAX_LEVEL_CHARS + 1),
    }).ok,
    false,
  );
});

test("create: every declared risk level round-trips", () => {
  for (const risk of IDEA_RISKS) {
    const r = validateIdeaCreate({ instrument: "NQ", thesis: "t", riskLevel: risk });
    assert.ok(r.ok);
  }
});

// --- side (UX4) ---------------------------------------------------------------

test("side: create accepts each declared side; absent/null/empty stay absent", () => {
  for (const s of IDEA_SIDES) {
    const r = validateIdeaCreate({ instrument: "NQ", thesis: "t", riskLevel: "low", side: s });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.value.side, s);
  }
  for (const absent of [undefined, null, ""]) {
    const r = validateIdeaCreate({ instrument: "NQ", thesis: "t", riskLevel: "low", side: absent });
    assert.ok(r.ok);
    if (r.ok) assert.ok(!("side" in r.value)); // absent = no key, never a default
  }
});

test("side: unknown values reject the create (a typo must not publish a direction)", () => {
  const r = validateIdeaCreate({ instrument: "NQ", thesis: "t", riskLevel: "low", side: "up" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "side_invalid");
});

test("side: patch sets, rejects unknowns, and null clears (key present, value undefined)", () => {
  const set = validateIdeaPatch({ side: "short" });
  assert.ok(set.ok);
  if (set.ok) assert.equal(set.value.side, "short");
  assert.equal(validateIdeaPatch({ side: "bearish" }).ok, false);
  const clear = validateIdeaPatch({ side: null });
  assert.ok(clear.ok); // a clear-only patch is a real patch, not "empty"
  if (clear.ok) {
    assert.ok("side" in clear.value); // the key must survive so the store spread overwrites
    assert.equal(clear.value.side, undefined);
  }
});

test("side: toPublicIdea carries a stated side and omits an absent one", () => {
  const stated = toPublicIdea({ ...FULL, side: "long" });
  assert.equal(stated.side, "long");
  assert.ok(!("side" in toPublicIdea(FULL))); // absent stays absent on the wire
});

// --- ADMIN-1: stop · invalidated · archiveThesis · suggestSide ---------------

test("stop (ADMIN-1): create accepts/collapses, omits when absent; patch clears on null/empty", () => {
  const r = validateIdeaCreate({
    instrument: "NQ", thesis: "t", riskLevel: "low", stop: "  21,300  hard stop ",
  });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.stop, "21,300 hard stop");
  const absent = validateIdeaCreate({ instrument: "NQ", thesis: "t", riskLevel: "low" });
  assert.ok(absent.ok);
  if (absent.ok) assert.ok(!("stop" in absent.value));
  const set = validateIdeaPatch({ stop: "21,300" });
  assert.ok(set.ok);
  if (set.ok) assert.equal(set.value.stop, "21,300");
  for (const clearing of [null, "", "   "]) {
    const clear = validateIdeaPatch({ stop: clearing });
    assert.ok(clear.ok, JSON.stringify(clearing));
    if (clear.ok) {
      assert.ok("stop" in clear.value); // key present → the store spread clears
      assert.equal(clear.value.stop, undefined);
    }
  }
});

test("invalidated (ADMIN-1): a real status that never reaches the public wire shape", () => {
  assert.ok(validateIdeaPatch({ status: "invalidated" }).ok);
  const r = validateIdeaCreate({
    instrument: "NQ", thesis: "t", riskLevel: "low", status: "invalidated",
  });
  assert.ok(r.ok);
});

test("archiveThesis (ADMIN-1): boolean-only patch directive", () => {
  const ok = validateIdeaPatch({ thesis: "new read", archiveThesis: true });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.value.archiveThesis, true);
  assert.equal(validateIdeaPatch({ archiveThesis: "yes" }).ok, false);
});

test("toPublicIdea: stop rides the wire when present, absent stays absent; thesisHistory NEVER", () => {
  const pub = toPublicIdea({ ...FULL, stop: "21,300", thesisHistory: ["old take"] });
  assert.equal(pub.stop, "21,300");
  assert.ok(!("thesisHistory" in pub));
  assert.ok(!("stop" in toPublicIdea(FULL)));
});

test("suggestSide (ADMIN-1): the F6 entry-language rule, never guessing", () => {
  assert.equal(suggestSide("break above 21,450"), "long");
  assert.equal(suggestSide("clears $188 with volume"), "long");
  assert.equal(suggestSide("break below 74.50"), "short");
  assert.equal(suggestSide("rejection at 200"), "short");
  assert.equal(suggestSide("21,450"), null); // a bare level says nothing
  assert.equal(suggestSide(""), null);
  assert.equal(suggestSide("break above 100 then short the failure below 90"), null); // both → ambiguous
});

// --- validateIdeaPatch ------------------------------------------------------

test("patch: single-field patches pass; empty and unknown-only patches fail", () => {
  assert.ok(validateIdeaPatch({ status: "live" }).ok);
  assert.ok(validateIdeaPatch({ thesis: "updated" }).ok);
  assert.equal(validateIdeaPatch({}).ok, false);
  assert.equal(validateIdeaPatch({ nonsense: 1 }).ok, false);
});

test("patch: source is immutable (provenance is a fact, not an edit)", () => {
  const r = validateIdeaPatch({ source: "manual" });
  assert.equal(r.ok, false); // unknown-to-patch field → empty patch → rejected
});

test("patch: invalid member values reject rather than drop", () => {
  assert.equal(validateIdeaPatch({ status: "archived" }).ok, false);
  assert.equal(validateIdeaPatch({ riskLevel: "none" }).ok, false);
  assert.equal(validateIdeaPatch({ instrument: "" }).ok, false);
});

// --- unconfigured store: everything no-ops, nothing throws ------------------

test("store: unconfigured Redis serves empty/null and refuses writes", async () => {
  assert.equal(ideasConfigured(), false);
  assert.deepEqual(await listIdeas(), []);
  assert.deepEqual(await listLiveIdeas(), []);
  assert.equal(await getIdea("idea_abc123"), null);
  assert.equal(
    await createIdea({
      instrument: "NQ",
      thesis: "t",
      entry: "",
      target: "",
      riskLevel: "low",
      status: "draft",
      source: "manual",
    }),
    null,
  );
  assert.equal(await updateIdea("idea_abc123", { status: "live" }), null);
});
