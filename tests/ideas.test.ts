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
  entryConflict,
  evaluateLiveIdea,
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
