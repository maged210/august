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
  NO_TRIGGER_REASON,
  WITHDRAWN_MARK,
  bookPassConflict,
  createIdea,
  entryConflict,
  entryLanguage,
  evaluateLiveIdea,
  inboxBuckets,
  needsLevelReason,
  readEntry,
  getIdea,
  ideasConfigured,
  listIdeas,
  listLiveIdeas,
  mergeIdeaRecords,
  mergeIdeas,
  parseEntryTrigger,
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

// --- ADMIN-1 delta: MERGE semantics (pure) ----------------------------------

function mkIdea(over: Partial<Idea>): Idea {
  return {
    id: "idea_keep01", instrument: "NVDA", thesis: "keeper thesis",
    entry: "180", target: "200", riskLevel: "medium", status: "live",
    source: "manual", createdAt: 1000, updatedAt: 2000, ...over,
  };
}

test("merge: keeper keeps its levels/status; twin's thesis folds into history", () => {
  const keep = mkIdea({ thesisHistory: ["oldest keeper thesis"] });
  const absorb = mkIdea({
    id: "idea_twin01", entry: "178", target: "210", thesis: "twin thesis",
    thesisHistory: ["twin history"], status: "draft",
  });
  const merged = mergeIdeaRecords(keep, absorb, 5000);
  assert.notEqual(merged, "mismatch");
  const m = merged as Idea;
  assert.equal(m.id, "idea_keep01");
  assert.equal(m.entry, "180"); // the keeper's levels stand
  assert.equal(m.target, "200");
  assert.equal(m.status, "live");
  assert.equal(m.thesis, "keeper thesis");
  assert.deepEqual(m.thesisHistory, ["oldest keeper thesis", "twin history", "twin thesis"]);
  assert.equal(m.updatedAt, 5000);
});

test("merge: different tickers refuse; self-merge refuses; case-insensitive match", () => {
  const keep = mkIdea({});
  assert.equal(mergeIdeaRecords(keep, mkIdea({ id: "idea_x", instrument: "TSLA" })), "mismatch");
  assert.equal(mergeIdeaRecords(keep, keep), "mismatch");
  const ok = mergeIdeaRecords(keep, mkIdea({ id: "idea_y", instrument: " nvda " }));
  assert.notEqual(ok, "mismatch");
});

test("merge: history is capped and never duplicates the keeper's live thesis", () => {
  const keep = mkIdea({ thesisHistory: Array.from({ length: 9 }, (_, i) => `k${i}`) });
  const absorb = mkIdea({
    id: "idea_twin02", thesis: "keeper thesis", // twin somehow carries the same text
    thesisHistory: ["t0", "t1"],
  });
  const m = mergeIdeaRecords(keep, absorb, 1) as Idea;
  assert.ok(m.thesisHistory!.length <= 10);
  assert.ok(!m.thesisHistory!.includes("keeper thesis")); // live thesis never in history
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
  assert.equal(await mergeIdeas("idea_a", "idea_b"), null);
});

// --- INTEGRITY-1 · parseEntryTrigger / entryConflict / evaluateLiveIdea ------

test("parseEntryTrigger: crossing language adjacent to a number parses; ranges take the far edge", () => {
  assert.deepEqual(parseEntryTrigger("Break above $9.45"), { kind: "level", dir: "above", level: 9.45 });
  assert.deepEqual(parseEntryTrigger("Drop under $197.25"), { kind: "level", dir: "below", level: 197.25 });
  assert.deepEqual(parseEntryTrigger("break below $1,117.50"), { kind: "level", dir: "below", level: 1117.5 });
  assert.deepEqual(parseEntryTrigger("below 72"), { kind: "level", dir: "below", level: 72 });
  // range: fully cleared — above takes the high edge, below the low edge
  assert.deepEqual(parseEntryTrigger("breaking above $9.24–$9.25 resistance; stock at/near $10"), {
    kind: "level",
    dir: "above",
    level: 9.25,
  });
});

test("parseEntryTrigger: no crossable trigger → null (holds/watch/trendline language)", () => {
  assert.equal(parseEntryTrigger("holds support around $25"), null);
  assert.equal(parseEntryTrigger("Bouncing off support"), null);
  assert.equal(parseEntryTrigger("watch for continued market weakness"), null);
  // "below" a trendline, no adjacent number — the later target number must NOT be read as the trigger
  assert.equal(
    parseEntryTrigger("confirmation break below short-term uptrend; gap fill target ~$57.70–$56"),
    null,
  );
});

test("parseEntryTrigger: two-sided calls are two_sided, never collapsed to one direction", () => {
  // the SPY row that started this — verbatim
  assert.deepEqual(
    parseEntryTrigger("Break above 772–772.50 for bulls; break below 766–767 for bears"),
    { kind: "two_sided" },
  );
  // keyword-only two-sidedness (only one side carries a number)
  assert.deepEqual(
    parseEntryTrigger(
      "after earnings report; break above downtrend resistance OR break below $107 for put-selling/DCA",
    ),
    { kind: "two_sided" },
  );
});

test("entryConflict: side and trigger direction must agree", () => {
  // two-sided → conflict regardless of side
  assert.equal(
    entryConflict(undefined, "Break above 772–772.50 for bulls; break below 766–767 for bears"),
    "two_sided",
  );
  // stated side against the entry language → mismatch
  assert.equal(entryConflict("short", "break above $50"), "side_mismatch");
  assert.equal(entryConflict("long", "falls under $95.30"), "side_mismatch");
  // agreement (incl. language suggestSide can't read but the parser can) → clean
  assert.equal(entryConflict("short", "Drop under $197.25"), null);
  assert.equal(entryConflict("long", "Break above $9.45"), null);
  // unparseable entry with a stated side is NOT a conflict — it's NEEDS_LEVEL territory
  assert.equal(entryConflict("long", "holds support around $25"), null);
});

const EVAL_NOW = 1_750_000_000_000;
const fresh = { entry: "break above $100", updatedAt: EVAL_NOW - 86_400_000, evaluation: undefined };

test("evaluateLiveIdea: ARMED → TRIGGERED when the daily close crosses the stated trigger", () => {
  const armed = evaluateLiveIdea(fresh, 99, EVAL_NOW);
  assert.equal(armed.state, "ARMED");
  const fired = evaluateLiveIdea(fresh, 101, EVAL_NOW);
  assert.equal(fired.state, "TRIGGERED");
  assert.equal(fired.level, 100);
  assert.equal(fired.dir, "above");
  // below-direction crossing
  const short = evaluateLiveIdea({ ...fresh, entry: "below 72" }, 71.5, EVAL_NOW);
  assert.equal(short.state, "TRIGGERED");
});

test("evaluateLiveIdea: TRIGGERED is sticky — a fired call never un-fires", () => {
  const fired = evaluateLiveIdea(fresh, 101, EVAL_NOW);
  const later = evaluateLiveIdea({ ...fresh, evaluation: fired }, 90, EVAL_NOW + 86_400_000);
  assert.equal(later.state, "TRIGGERED");
  assert.equal(later.at, fired.at); // the crossing record stays frozen
});

test("evaluateLiveIdea: STALE lands at the horizon on the UNtriggered book only", () => {
  const old = { ...fresh, updatedAt: EVAL_NOW - 4 * 86_400_000 }; // 4d > 3d default
  assert.equal(evaluateLiveIdea(old, 99, EVAL_NOW).state, "STALE");
  // crossing beats staleness — a fired old idea is performance history, not stale
  assert.equal(evaluateLiveIdea(old, 101, EVAL_NOW).state, "TRIGGERED");
  // fresh + uncrossed stays ARMED
  assert.equal(evaluateLiveIdea(fresh, 99, EVAL_NOW).state, "ARMED");
});

test("evaluateLiveIdea: no crossable trigger → NEEDS_LEVEL, stated plainly", () => {
  const e = evaluateLiveIdea({ ...fresh, entry: "holds support around $25" }, 30, EVAL_NOW);
  assert.equal(e.state, "NEEDS_LEVEL");
  assert.equal(e.level, null);
  assert.match(e.reason, /no crossable trigger/);
});

test("parseEntryTrigger: unit-qualified numbers are NOT price levels (adversarial-review guards)", () => {
  assert.equal(parseEntryTrigger("over $100M revenue run-rate confirms the thesis"), null);
  assert.equal(parseEntryTrigger("reclaims the 50-day moving average"), null);
  assert.equal(parseEntryTrigger("above the 200dma"), null);
  assert.equal(parseEntryTrigger("holds above the 21-day EMA"), null);
  assert.equal(parseEntryTrigger("down over 30% from highs, buy the washout"), null);
  assert.equal(parseEntryTrigger("above 5% yield"), null);
  assert.equal(parseEntryTrigger("loses 2024 support"), null); // a year, not a price
  // …but the desk's thousands shorthand IS a price
  assert.deepEqual(parseEntryTrigger("above 21.5k"), { kind: "level", dir: "above", level: 21500 });
});

test("parseEntryTrigger: inline stop language is a stop, not a second entry direction", () => {
  assert.deepEqual(parseEntryTrigger("long above 9,450; stop below 9,400"), {
    kind: "level",
    dir: "above",
    level: 9450,
  });
  assert.deepEqual(parseEntryTrigger("reclaims 190; cut it below 182"), {
    kind: "level",
    dir: "above",
    level: 190,
  });
  // regression: "break out above X" is an entry — 'out' must not read as risk language
  assert.deepEqual(parseEntryTrigger("break out above $15.37"), {
    kind: "level",
    dir: "above",
    level: 15.37,
  });
});

// INTEGRITY follow-up (2026-09-01) — the book pass carries THE CALL's
// bar-finality gate: getQuote prices are LIVE until the session ends, and the
// cron route is pinged all day; a mid-session spike must never mark a sticky
// TRIGGERED "at a daily close" that has not printed yet.
test("book pass: refuses to evaluate before the session close, runs after", async () => {
  const { runBookPass } = await import("../lib/ideas-eval");
  // 14:00 ET on a weekday — the market is live, quotes are moving
  const intraday = Date.parse("2026-09-01T14:00:00-04:00");
  const gated = await runBookPass(intraday);
  assert.equal(gated.ran, false);
  assert.equal(gated.live, 0);
  // 18:10 ET (the 22:10 UTC cron in EDT) — session over, the pass runs
  // (no Redis here, so it evaluates an empty book — ran:true is the point)
  const evening = Date.parse("2026-09-01T18:10:00-04:00");
  const ran = await runBookPass(evening);
  assert.equal(ran.ran, true);
});

// ── DESK-INBOX (feature/desk-inbox) — deny, quote guard, inbox buckets ──────

test("deny: a denial must state its reason; the reason travels only with a denial", async () => {
  const { validateIdeaPatch } = await import("../lib/ideas");
  const ok = validateIdeaPatch({ status: "denied", denyReason: "not_a_call" });
  assert.ok(ok.ok);
  assert.equal(validateIdeaPatch({ status: "denied" }).ok, false); // reason required
  assert.equal((validateIdeaPatch({ status: "denied" }) as { error: string }).error, "deny_reason_required");
  assert.equal(validateIdeaPatch({ status: "denied", denyReason: "meh" }).ok, false);
  assert.equal(validateIdeaPatch({ denyReason: "stale" }).ok, false); // free-floating reason refused
  assert.equal((validateIdeaPatch({ denyReason: "stale" }) as { error: string }).error, "deny_reason_without_denied");
  // all four chips are valid
  for (const r of ["no_level", "not_a_call", "duplicate", "stale"]) {
    assert.ok(validateIdeaPatch({ status: "denied", denyReason: r }).ok, r);
  }
});

test("quote guard: the NOW bug — a >3x quote/level gap refuses to evaluate", async () => {
  const { evaluateLiveIdea } = await import("../lib/ideas");
  const now = Date.now();
  const idea = { entry: "below $1,117.50", updatedAt: now, evaluation: undefined };
  // pre-guard this fired sticky TRIGGERED (137.11 <= 1117.50); now it refuses
  const e = evaluateLiveIdea(idea, 137.11, now);
  assert.equal(e.state, "QUOTE_SUSPECT");
  assert.equal(e.level, 1117.5);
  assert.equal(e.price, 137.11);
  assert.match(e.reason, /3×|3x/);
  // the other direction too (quote 3x ABOVE the level)
  const hi = evaluateLiveIdea({ entry: "above $40", updatedAt: now, evaluation: undefined }, 137.11, now);
  assert.equal(hi.state, "QUOTE_SUSPECT");
  // exactly 3x is NOT suspect (strict >3x) — a volatile-but-real gap evaluates
  const edge = evaluateLiveIdea({ entry: "above $300", updatedAt: now, evaluation: undefined }, 100, now);
  assert.notEqual(edge.state, "QUOTE_SUSPECT");
  // a sane gap still evaluates normally
  const sane = evaluateLiveIdea({ entry: "above $223.50", updatedAt: now, evaluation: undefined }, 142.9, now);
  assert.equal(sane.state, "ARMED");
  // sticky TRIGGERED precedence is untouched (performance history never un-fires)
  const prior = { state: "TRIGGERED", level: 100, dir: "above", price: 101, at: now - 1, reason: "x" } as const;
  const kept = evaluateLiveIdea({ entry: "above $100", updatedAt: now, evaluation: prior as never }, 500, now);
  assert.equal(kept.state, "TRIGGERED");
});

test("inbox buckets: pending / needs-level (incl. suspect + unparsed-fresh) / review", async () => {
  const { inboxBuckets, inboxCount } = await import("../lib/ideas");
  const base = { thesis: "t", target: "", riskLevel: "medium" as const, source: "extracted" as const, createdAt: 1, updatedAt: 1 };
  const mk = (id: string, over: Record<string, unknown>) => ({ id, instrument: id.toUpperCase(), entry: "", status: "live", ...base, ...over }) as never;
  const ideas = [
    mk("d1", { status: "draft", createdAt: 5 }),
    mk("d2", { status: "draft", createdAt: 9 }),
    mk("r1", { status: "review", reviewReason: "side_mismatch" }),
    mk("nl1", { entry: "watch the range", evaluation: { state: "NEEDS_LEVEL", level: null, dir: null, price: null, at: 1, reason: "x" } }),
    mk("qs1", { entry: "below $1,117.50", evaluation: { state: "QUOTE_SUSPECT", level: 1117.5, dir: "below", price: 137, at: 1, reason: "x" } }),
    mk("fresh", { entry: "no crossable words here" }), // no evaluation yet — parse decides
    mk("armed", { entry: "above $100", evaluation: { state: "ARMED", level: 100, dir: "above", price: 90, at: 1, reason: "x" } }),
    mk("closed", { status: "closed" }),
    mk("denied", { status: "denied", denyReason: "stale" }),
  ];
  const b = inboxBuckets(ideas);
  assert.deepEqual(b.pending.map((i: { id: string }) => i.id), ["d2", "d1"]); // newest first
  assert.deepEqual(b.review.map((i: { id: string }) => i.id), ["r1"]);
  assert.deepEqual(new Set(b.needsLevel.map((i: { id: string }) => i.id)), new Set(["nl1", "qs1", "fresh"]));
  assert.equal(inboxCount(ideas), 6); // armed/closed/denied never queue
});

test("buildLevelEntry: every written level round-trips through the parser EXACTLY", async () => {
  const { buildLevelEntry, parseEntryTrigger } = await import("../lib/ideas");
  // the review's finding: 2dp formatting fabricated levels nobody stated
  const cases: Array<["above" | "below", number]> = [
    ["below", 223.5], ["below", 1117.5], ["above", 310], ["above", 2024], // $-guard beats YEAR_LIKE
    ["above", 0.0945], ["above", 0.004], ["below", 9.456], ["above", 21500],
  ];
  for (const [dir, level] of cases) {
    const entry = buildLevelEntry(dir, level);
    const back = parseEntryTrigger(entry);
    assert.ok(back && back.kind === "level", `${entry} must parse`);
    assert.equal(back.kind === "level" && back.dir, dir, entry);
    assert.equal(back.kind === "level" && back.level, level, `${entry} must read back exactly ${level}`);
  }
  assert.equal(buildLevelEntry("below", 1117.5), "below $1,117.5");
  assert.equal(buildLevelEntry("above", 0.0945), "above $0.0945");
});

test("deny: a row cannot be BORN denied — denial is a resolution, not a creation", async () => {
  const { validateIdeaCreate } = await import("../lib/ideas");
  const res = validateIdeaCreate({ instrument: "X", thesis: "t", riskLevel: "low", status: "denied" });
  assert.equal(res.ok, false);
  assert.equal((res as { error: string }).error, "status_denied_at_create");
});

// --- feature/density-pass · THE FLAG-CLEARING VERB --------------------------
// The symbol gate can only ever say "I could not confirm this". Only a human
// can say "it is right", and until this verb existed there was no way to say
// it — a flagged row carried its note forever with no API to retire it.

test("clearSymbolNote: accepts only true — it retires a flag, it can never write one", () => {
  const ok = validateIdeaPatch({ clearSymbolNote: true });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.value.clearSymbolNote, true);
  // false, a string, or a note body are all refused: there is no path for a
  // caller to stamp a row as unconfirmed
  for (const bad of [false, "yes", 1, null, { note: "x" }]) {
    const r = validateIdeaPatch({ clearSymbolNote: bad });
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be refused`);
    if (!r.ok) assert.equal(r.error, "clear_symbol_note_invalid");
  }
});

test("clearSymbolNote: symbolNote itself is NOT patchable — the gate owns writing it", () => {
  // a patch carrying only symbolNote is an empty patch: the field is dropped
  const r = validateIdeaPatch({ symbolNote: "SPCE is actually fine, trust me" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "empty_patch");
});

test("clearSymbolNote: rides alongside a real edit without disturbing it", () => {
  const r = validateIdeaPatch({ status: "live", clearSymbolNote: true });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.status, "live");
    assert.equal(r.value.clearSymbolNote, true);
  }
});

// --- feat/v4-1b-integrity · THE PASS PARSER ---------------------------------
// Stop / invalidation language never yields an entry trigger, and a crossing
// that points against the stated side is a parse failure. AGI's entry is the
// known case: "stop consideration under $34.80" read as a BELOW 34.80 entry
// on a long, and the stop-out marked it TRIGGERED on SEP 16.

const AGI_ENTRY = "current levels; stop consideration under $34.80";
const lvl = (dir: "above" | "below", level: number) => ({ kind: "level", dir, level });

test("readEntry: stop clauses populate stop, never trigger — every stated form", () => {
  // the known case, verbatim from the live book
  assert.deepEqual(readEntry(AGI_ENTRY), { trigger: null, stop: { dir: "below", level: 34.8 }, rejected: null });
  assert.equal(parseEntryTrigger(AGI_ENTRY), null);
  // with the words in between, or none
  const stops: Array<[string, "above" | "below" | null, number]> = [
    ["stop consideration under $34.80", "below", 34.8],
    ["stop under $30", "below", 30],
    ["stop below 9,400", "below", 9400],
    ["stops under 12.50", "below", 12.5],
    ["stopped out under 30", "below", 30],
    ["invalidated below $30", "below", 30],
    ["invalidation below 28.50", "below", 28.5],
    ["invalidated if it closes below $30", "below", 30],
    ["cut it at 182", null, 182],
    ["cut it below 182", "below", 182],
    ["cut losses under 12", "below", 12],
    ["cut the position below 12", "below", 12],
    ["stop-loss $30", null, 30],
    ["stop loss at 28", null, 28],
    ["risk below 45", "below", 45],
    ["exit under 40", "below", 40],
    // named the stop AFTER the crossing
    ["under 34.80 is the stop", "below", 34.8],
    ["below 30 would be the stop", "below", 30],
    ["below $30 invalidates the setup", "below", 30],
    // a stop range takes the far edge, like a trigger range
    ["stop consideration under $33–$34", "below", 33],
    // a short's stop sits above
    ["stop above $52", "above", 52],
  ];
  for (const [entry, dir, level] of stops) {
    const r = readEntry(entry);
    assert.equal(r.trigger, null, `${entry} must not yield a trigger`);
    assert.deepEqual(r.stop, { dir, level }, `${entry} → stop`);
    assert.equal(parseEntryTrigger(entry), null, entry);
  }
});

test("readEntry: a stop clause beside a real entry takes only its own level", () => {
  const both: Array<[string, "above" | "below", number, "above" | "below" | null, number]> = [
    ["long above 9,450; stop below 9,400", "above", 9450, "below", 9400],
    ["long above 9,450 stop below 9,400", "above", 9450, "below", 9400], // no delimiter
    ["stop below 9,400 then long above 9,450", "above", 9450, "below", 9400], // stop first
    ["break above 50 stop below 45", "above", 50, "below", 45], // "stop" is 45's, not 50's
    ["reclaims 190; cut it at 182", "above", 190, null, 182],
    ["break above $50, stop $47", "above", 50, null, 47],
    ["stop at $47 — break above $50", "above", 50, null, 47],
    ["stop-loss $30, entry above $35", "above", 35, null, 30],
    ["break above $50; below $45 invalidates the setup", "above", 50, "below", 45],
    ["break above $50; stop on a break below 45", "above", 50, "below", 45],
    ["risk below 45; break above 50", "above", 50, "below", 45],
  ];
  for (const [entry, tDir, tLevel, sDir, sLevel] of both) {
    const r = readEntry(entry);
    assert.deepEqual(r.trigger, lvl(tDir, tLevel), `${entry} → trigger`);
    assert.deepEqual(r.stop, { dir: sDir, level: sLevel }, `${entry} → stop`);
  }
  // the extractor's contested shape still reads its trigger, so
  // stopMasqueradingAsEntry can still send it to REVIEW
  assert.deepEqual(parseEntryTrigger("above 36.70 support (stop below 36.70)"), lvl("above", 36.7));
});

test("readEntry: 'no stop', 'non-stop' and 'cuts through' are not stop language", () => {
  assert.deepEqual(readEntry("no stop; break above $50"), { trigger: lvl("above", 50), stop: null, rejected: null });
  assert.deepEqual(readEntry("break above $50 with no stop"), { trigger: lvl("above", 50), stop: null, rejected: null });
  assert.deepEqual(parseEntryTrigger("non-stop rally above $50"), lvl("above", 50));
  assert.deepEqual(parseEntryTrigger("cuts through resistance above $50"), lvl("above", 50));
  // a stop word whose clause names no price claims nothing past the clause
  assert.deepEqual(readEntry("stop at the 50-day, above 45 entry"), { trigger: lvl("above", 45), stop: null, rejected: null });
});

test("readEntry: every trigger form still parses (INTEGRITY-1's grammar, unchanged)", () => {
  const forms: Array<[string, "above" | "below", number]> = [
    ["above 37.35", "above", 37.35],
    ["over $5.70", "above", 5.7],
    ["over the 21.5k", "above", 21500],
    ["clears $1,117.50", "above", 1117.5],
    ["clear 88", "above", 88],
    ["reclaims 190", "above", 190],
    ["reclaim 190 to 192", "above", 192], // range with "to": the far edge
    ["break above 772–772.50", "above", 772.5],
    ["break out above $15.37", "above", 15.37],
    ["breaking above $9.24–$9.25 resistance", "above", 9.25],
    ["under $197.25", "below", 197.25],
    ["below 72", "below", 72],
    ["below the $8.40", "below", 8.4],
    ["loses 600", "below", 600],
    ["lose 600", "below", 600],
    ["loses $766 to $767", "below", 766],
    ["break below 766–767", "below", 766],
    ["holding below 768", "below", 768],
  ];
  for (const [entry, dir, level] of forms) {
    assert.deepEqual(parseEntryTrigger(entry), lvl(dir, level), entry);
    // …and with the side it agrees with
    assert.deepEqual(parseEntryTrigger(entry, dir === "above" ? "long" : "short"), lvl(dir, level), `${entry} + side`);
    assert.deepEqual(parseEntryTrigger(entry, "watch"), lvl(dir, level), `${entry} + watch`);
  }
  // the unit / year guards are unchanged
  for (const e of ["above the 200dma", "reclaims the 50-day moving average", "above 5% yield", "loses 2024 support"]) {
    assert.equal(parseEntryTrigger(e), null, e);
  }
});

test("readEntry: a crossing against the STATED side is a parse failure, not a trigger", () => {
  assert.deepEqual(readEntry("falls under $95.30", "long"), {
    trigger: null,
    stop: null,
    rejected: { dir: "below", level: 95.3, side: "long" },
  });
  assert.deepEqual(readEntry("break above $50", "short"), {
    trigger: null,
    stop: null,
    rejected: { dir: "above", level: 50, side: "short" },
  });
  assert.equal(parseEntryTrigger("falls under $95.30", "long"), null);
  // no stated side, or a watch: nothing to contradict
  assert.deepEqual(parseEntryTrigger("falls under $95.30"), lvl("below", 95.3));
  assert.deepEqual(parseEntryTrigger("falls under $95.30", "watch"), lvl("below", 95.3));
  // a two-sided entry stays two-sided whatever the side (it still goes to REVIEW)
  assert.deepEqual(parseEntryTrigger("Break above 772–772.50 for bulls; break below 766–767 for bears", "long"), {
    kind: "two_sided",
  });
  // a stop clause never makes the refusal: AGI with a stated long is plain stop language
  assert.deepEqual(readEntry(AGI_ENTRY, "long"), { trigger: null, stop: { dir: "below", level: 34.8 }, rejected: null });
});

test("entry language: stop clauses are cut before the side / two-sided rules read it", () => {
  assert.equal(entryLanguage(AGI_ENTRY).includes("34.80"), false);
  assert.equal(entryLanguage("stop consideration under $33–$34").includes("34"), false);
  assert.equal(entryLanguage("break above $50"), "break above $50");
  // INTEGRITY-1 read "long above 9,450; stop below 9,400" as two-sided (the
  // stop's "below") and would have demoted a clean long to REVIEW
  assert.equal(entryConflict("long", "long above 9,450; stop below 9,400"), null);
  assert.equal(entryConflict(undefined, "break above $50; stop on a break below 45"), null);
  assert.equal(suggestSide("reclaims 190; cut it below 182"), "long");
  assert.equal(suggestSide(AGI_ENTRY), null);
  // real two-sidedness is untouched
  assert.equal(entryConflict(undefined, "Break above 772–772.50 for bulls; break below 766–767 for bears"), "two_sided");
});

test("bookPassConflict: a refused crossing stays live for NEEDS_LEVEL; language conflicts still demote", () => {
  // the extractor's side-blind rule is unchanged: a contradicting draft goes to REVIEW
  assert.equal(entryConflict("short", "break above $50"), "side_mismatch");
  // the pass does not demote it — the parser refused the crossing
  assert.equal(bookPassConflict("short", "break above $50"), null);
  assert.equal(bookPassConflict("long", "falls under $95.30"), null);
  // entry LANGUAGE against the side, with no crossable level, still demotes
  assert.equal(bookPassConflict("short", "breakout continuation"), "side_mismatch");
  // two-sided still demotes
  assert.equal(bookPassConflict("long", "Break above 772–772.50 for bulls; break below 766–767 for bears"), "two_sided");
  // agreement is clean
  assert.equal(bookPassConflict("short", "Drop under $197.25"), null);
});

const PASS_NOW = Date.UTC(2026, 8, 17, 22, 12);

test("evaluateLiveIdea: the pass records WHY a row has no trigger", () => {
  const agi = evaluateLiveIdea({ entry: AGI_ENTRY, updatedAt: PASS_NOW - 86_400_000 }, 35.1, PASS_NOW);
  assert.equal(agi.state, "NEEDS_LEVEL");
  assert.equal(agi.level, null);
  assert.equal(agi.dir, null);
  assert.equal(agi.price, 35.1);
  assert.equal(agi.reason, "no crossable entry trigger: below 34.8 is stop language, and a stop never arms an entry trigger");
  // a crossing against the stated side — even one the price has crossed —
  // never evaluates; the refusal is the reason
  const hood = evaluateLiveIdea({ entry: "falls under $95.30", side: "long", updatedAt: PASS_NOW }, 90, PASS_NOW);
  assert.equal(hood.state, "NEEDS_LEVEL");
  assert.equal(hood.reason, "trigger below 95.3 points against the stated long — a parse failure, not evaluated (restate the level in the inbox)");
  // nothing crossable at all keeps the INTEGRITY-1 wording
  assert.equal(evaluateLiveIdea({ entry: "holds support around $25", updatedAt: PASS_NOW }, 24, PASS_NOW).reason, NO_TRIGGER_REASON);
  assert.equal(needsLevelReason(readEntry("")), NO_TRIGGER_REASON);
  // the agreeing side evaluates as before
  assert.equal(evaluateLiveIdea({ entry: "falls under $95.30", side: "short", updatedAt: PASS_NOW }, 90, PASS_NOW).state, "TRIGGERED");
});

test("evaluateLiveIdea: a sticky TRIGGERED stands only while the entry still states that trigger", () => {
  // AGI as stored on SEP 16: its stop read as the entry, fired on the stop-out
  const fired = { state: "TRIGGERED" as const, level: 34.8, dir: "below" as const, price: 34.45, at: Date.UTC(2026, 8, 16, 22, 12), reason: "close-pass price 34.45 ≤ stated trigger 34.8" };
  const agi = { entry: AGI_ENTRY, updatedAt: PASS_NOW - 3 * 86_400_000, evaluation: fired };
  const night1 = evaluateLiveIdea(agi, 35.1, PASS_NOW);
  assert.equal(night1.state, "NEEDS_LEVEL");
  assert.equal(night1.at, PASS_NOW);
  assert.ok(night1.reason.startsWith("no crossable entry trigger: below 34.8 is stop language"));
  assert.ok(night1.reason.includes(`${WITHDRAWN_MARK}the TRIGGERED below 34.8 of 2026-09-16 judged a trigger the entry does not state`), night1.reason);
  // the next night rewrites the price; the withdrawal stays on the record
  const night2 = evaluateLiveIdea({ ...agi, evaluation: night1 }, 35.4, PASS_NOW + 86_400_000);
  assert.equal(night2.state, "NEEDS_LEVEL");
  assert.equal(night2.reason, night1.reason);
  // …and a stop-out price can never re-fire it
  assert.equal(evaluateLiveIdea({ ...agi, evaluation: night1 }, 30, PASS_NOW + 86_400_000).state, "NEEDS_LEVEL");

  // a real crossing stays sticky — same record, untouched, whatever the price
  const intcFired = { state: "TRIGGERED" as const, level: 106.1, dir: "above" as const, price: 106.24, at: Date.UTC(2026, 8, 9, 22, 12), reason: "x" };
  const intc = evaluateLiveIdea({ entry: "break above 106.10", side: "long", updatedAt: 0, evaluation: intcFired }, 90, PASS_NOW);
  assert.equal(intc, intcFired);
  // a withdrawn trigger whose entry now reads a DIFFERENT level re-evaluates
  // against it, carrying the withdrawal note
  const moved = evaluateLiveIdea(
    { entry: "break above $40; stop consideration under $34.80", updatedAt: PASS_NOW, evaluation: fired },
    41,
    PASS_NOW,
  );
  assert.equal(moved.state, "TRIGGERED");
  assert.equal(moved.level, 40);
  assert.ok(moved.reason.includes(WITHDRAWN_MARK));
});

test("inbox buckets: a crossing refused against the stated side lands in NEEDS LEVEL before the pass sees it", () => {
  const row = (id: string, over: Partial<Idea>): Idea => ({ ...FULL, id, status: "live", evaluation: undefined, ...over });
  const b = inboxBuckets([
    row("refused", { side: "long", entry: "falls under $95.30" }),
    row("agrees", { side: "short", entry: "falls under $95.30" }),
    row("stop", { entry: AGI_ENTRY }),
  ]);
  assert.deepEqual(new Set(b.needsLevel.map((i) => i.id)), new Set(["refused", "stop"]));
});
