// THE CALL engine (lib/call) — deterministic direction, lock timing, settle
// math, non-trading days, records, thesis cache-on-flip, take-after-lock.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callDirection,
  canTake,
  claimCallRecord, // type-presence only; store claim runs against real Redis
  disagreeLine,
  EMPTY_TALLY,
  fmtClosePct,
  fmtRecord,
  foldTally,
  hitRate,
  lockTs,
  nextWeekday,
  passTarget,
  readCallState,
  regimeFingerprint,
  runCallPass,
  settleAgainstBars,
  shouldRegenerateThesis,
  takeSide,
  getThesis,
  type CallKv,
  type CallVote,
} from "../lib/call";
import type { RegimeRead, RegimeVote } from "../lib/regime";
import type { DailyBar } from "../lib/markets";

void claimCallRecord;

// --- helpers ----------------------------------------------------------------

const read = (label: RegimeRead["label"], votes: Array<[string, -1 | 0 | 1]>): RegimeRead => ({
  label,
  because: votes.map(([input, vote]): RegimeVote => ({ input, value: "x", vote })),
  agreement: null,
});

/** EDT daily bar closing at 16:00 ET on the given date. */
const bar = (date: string, close: number): DailyBar => ({
  t: Date.parse(`${date}T16:00:00-04:00`) / 1000,
  o: close,
  h: close,
  l: close,
  c: close,
});

function fakeKv(): CallKv & { data: Map<string, unknown>; sets: Map<string, Set<string>> } {
  const data = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();
  return {
    data,
    sets,
    async get(k) {
      return data.has(k) ? data.get(k)! : null;
    },
    async set(k, v, opts) {
      if (opts?.nx && data.has(k)) return null;
      data.set(k, v);
      return "OK";
    },
    async del(k) {
      data.delete(k);
    },
    async sadd(k, m) {
      if (!sets.has(k)) sets.set(k, new Set());
      sets.get(k)!.add(m);
    },
    async srem(k, m) {
      sets.get(k)?.delete(m);
    },
    async smembers(k) {
      return [...(sets.get(k) ?? [])];
    },
    async expire() {},
  };
}

// 2026-08-31 is a Monday; 2026-09-01 Tuesday; 2026-09-04 Friday.
const MON = "2026-08-31";
const TUE = "2026-09-01";
const WED = "2026-09-02";
const FRI = "2026-09-04";
const SAT = "2026-09-05";
const SUN = "2026-09-06";
const passAt = (date: string) => Date.parse(`${date}T21:05:00Z`); // the cron moment

// --- direction --------------------------------------------------------------

test("direction: deterministic sign of the regime vote sum; dead-even = no call", () => {
  assert.equal(callDirection(read("RISK ON", [["a", 1], ["b", 1], ["c", 1]])), "HIGHER");
  assert.equal(callDirection(read("RISK OFF", [["a", -1], ["b", -1], ["c", 0]])), "LOWER");
  // NEUTRAL follows its lean
  assert.equal(callDirection(read("NEUTRAL", [["a", 1], ["b", 0]])), "HIGHER");
  assert.equal(callDirection(read("NEUTRAL", [["a", -1], ["b", 0]])), "LOWER");
  // THE NEUTRAL RULE: dead even or unavailable → no call
  assert.equal(callDirection(read("NEUTRAL", [["a", 1], ["b", -1]])), null);
  assert.equal(callDirection(read("UNAVAILABLE", [])), null);
  // same read, same answer — no randomness anywhere
  const r = read("RISK ON", [["a", 1], ["b", 1]]);
  assert.equal(callDirection(r), callDirection(r));
});

test("fingerprint: flips on label or a VOTE flip, never on value drift", () => {
  const a = read("RISK ON", [["VIX LEVEL", 1], ["INDEX TREND (1mo)", 1]]);
  const b = read("RISK ON", [["VIX LEVEL", 1], ["INDEX TREND (1mo)", 1]]);
  b.because[0].value = "different value, same vote";
  assert.equal(regimeFingerprint(a), regimeFingerprint(b));
  const c = read("RISK ON", [["VIX LEVEL", 0], ["INDEX TREND (1mo)", 1]]);
  assert.notEqual(regimeFingerprint(a), regimeFingerprint(c));
  const d = read("NEUTRAL", [["VIX LEVEL", 1], ["INDEX TREND (1mo)", 1]]);
  assert.notEqual(regimeFingerprint(a), regimeFingerprint(d));
});

// --- dates + lock -----------------------------------------------------------

test("dates: next weekday skips weekends; the pass only generates for literal tomorrow", () => {
  assert.equal(nextWeekday(MON), TUE);
  assert.equal(nextWeekday(FRI), "2026-09-07"); // Monday
  assert.equal(nextWeekday(SAT), "2026-09-07");
  assert.equal(nextWeekday(SUN), "2026-09-07");
  // Fri/Sat passes generate nothing; Sunday's pass opens Monday
  assert.equal(passTarget(MON), TUE);
  assert.equal(passTarget(FRI), null);
  assert.equal(passTarget(SAT), null);
  assert.equal(passTarget(SUN), "2026-09-07");
});

test("lock: 09:30 ET on the call's date, DST-correct; takes refuse after", () => {
  for (const date of [TUE, "2026-12-15"]) {
    const t = lockTs(date);
    const back = new Date(t).toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    assert.equal(back, "09:30", `lock for ${date}`);
    assert.equal(canTake(date, t - 1), true);
    assert.equal(canTake(date, t), false);
    assert.equal(canTake(date, t + 60_000), false);
  }
});

// --- settle math ------------------------------------------------------------

test("settle: up, down, unchanged — close vs prior close, tie is a push", () => {
  const bars = [bar(MON, 100), bar(TUE, 101)];
  const up = settleAgainstBars(TUE, "HIGHER", bars)!;
  assert.equal(up.result, "HIGHER");
  assert.equal(up.augustWin, true);
  assert.ok(Math.abs(up.closePct! - 1) < 1e-9);
  const down = settleAgainstBars(TUE, "HIGHER", [bar(MON, 100), bar(TUE, 99)])!;
  assert.equal(down.result, "LOWER");
  assert.equal(down.augustWin, false);
  const flat = settleAgainstBars(TUE, "HIGHER", [bar(MON, 100), bar(TUE, 100)])!;
  assert.equal(flat.result, "FLAT");
  assert.equal(flat.augustWin, null); // push — counted for neither side
});

test("settle: non-trading days and thin data refuse honestly", () => {
  // no bar for the date, no later bar → not determinable yet (feed lag / future)
  assert.equal(settleAgainstBars(TUE, "HIGHER", [bar(MON, 100)]), null);
  // no bar for the date but a LATER bar → the date never traded → NO_SESSION
  const voided = settleAgainstBars(TUE, "HIGHER", [bar(MON, 100), bar(WED, 102)])!;
  assert.equal(voided.result, "NO_SESSION");
  assert.equal(voided.augustWin, null);
  // first bar in the window (no prior close held) → refuse rather than guess
  assert.equal(settleAgainstBars(MON, "HIGHER", [bar(MON, 100), bar(TUE, 101)]), null);
  assert.equal(settleAgainstBars(TUE, "HIGHER", []), null);
});

// --- records ----------------------------------------------------------------

test("records: hit rate = wins / settled, pushes excluded; starts empty, never seeded", () => {
  let t = { ...EMPTY_TALLY };
  assert.equal(hitRate(t), null); // 0–0 → no fake 0%
  assert.equal(fmtRecord(t), "0–0");
  t = foldTally(t, true);
  t = foldTally(t, false);
  t = foldTally(t, true);
  t = foldTally(t, null); // push
  assert.deepEqual(t, { wins: 2, losses: 1, pushes: 1 });
  assert.ok(Math.abs(hitRate(t)! - 2 / 3) < 1e-9);
  assert.equal(fmtRecord(t), "2–1");
});

test("close line: never a fabricated flat", () => {
  assert.equal(fmtClosePct(0.42), "+0.4%");
  assert.equal(fmtClosePct(-0.42), "-0.4%");
  assert.equal(fmtClosePct(0.04), "+0.04%"); // 1dp would lie "0.0"
  assert.equal(fmtClosePct(-0.04), "-0.04%");
  assert.equal(fmtClosePct(0), "0.0%");
});

test("disagree line: names call-time inputs that voted the day's direction — no model", () => {
  const votes: CallVote[] = [
    { input: "INDEX TREND (1mo)", vote: 1 },
    { input: "VIX LEVEL", vote: -1 },
    { input: "DESK BOOK BIAS", vote: 1 },
  ];
  assert.equal(disagreeLine(votes, "HIGHER", true, false), "INDEX TREND and BOOK BIAS sided with AUGUST");
  assert.equal(disagreeLine(votes, "LOWER", false, true), "VIX sided with you");
  assert.equal(disagreeLine(votes, "LOWER", false, null), "VIX sided against AUGUST");
  assert.equal(
    disagreeLine([{ input: "VIX LEVEL", vote: 1 }], "LOWER", false, null),
    "no input saw it — the tape went against the whole read",
  );
  assert.equal(disagreeLine(votes, "FLAT", null, null), null);
});

// --- thesis cache-on-flip ---------------------------------------------------

test("thesis: ONE model call per regime flip — cached, never per view", async () => {
  const kv = fakeKv();
  let calls = 0;
  const gen = async () => {
    calls++;
    return `thesis ${calls}`;
  };
  const riskOn = read("RISK ON", [["VIX LEVEL", 1], ["INDEX TREND (1mo)", 1]]);
  assert.equal(await getThesis(riskOn, { kv, gen, now: 1 }), "thesis 1");
  assert.equal(await getThesis(riskOn, { kv, gen, now: 2 }), "thesis 1"); // view 2: cache
  assert.equal(await getThesis(riskOn, { kv, gen, now: 3 }), "thesis 1"); // view 3: cache
  assert.equal(calls, 1);
  const riskOff = read("RISK OFF", [["VIX LEVEL", -1], ["INDEX TREND (1mo)", -1]]);
  assert.equal(await getThesis(riskOff, { kv, gen, now: 4 }), "thesis 2"); // flip → one call
  assert.equal(calls, 2);
  // value drift with identical votes is NOT a flip
  const drifted = read("RISK OFF", [["VIX LEVEL", -1], ["INDEX TREND (1mo)", -1]]);
  drifted.because[0].value = "VIX 31.2 instead of 28.9";
  assert.equal(await getThesis(drifted, { kv, gen, now: 5 }), "thesis 2");
  assert.equal(calls, 2);
  // unavailable regime carries no thesis and spends nothing
  assert.equal(await getThesis(read("UNAVAILABLE", []), { kv, gen, now: 6 }), null);
  assert.equal(calls, 2);
  assert.equal(shouldRegenerateThesis(null, "x"), true);
  assert.equal(shouldRegenerateThesis({ fingerprint: "x" }, "x"), false);
});

test("thesis: a failed generation omits the line and the lock throttles retries", async () => {
  const kv = fakeKv();
  let calls = 0;
  const gen = async () => {
    calls++;
    return null; // model unavailable
  };
  const r = read("RISK ON", [["VIX LEVEL", 1], ["INDEX TREND (1mo)", 1]]);
  assert.equal(await getThesis(r, { kv, gen, now: 1 }), null);
  assert.equal(await getThesis(r, { kv, gen, now: 2 }), null); // lock held — no second spend
  assert.equal(calls, 1);
});

// --- the full loop: generate → take → lock → settle → records ---------------

test("loop: open → take → POST refused after lock → settle → both records fold", async () => {
  const kv = fakeKv();
  const riskOn = () => Promise.resolve(read("RISK ON", [["INDEX TREND (1mo)", 1], ["VIX LEVEL", 1]]));
  const gen = async () => "the tape leans on.";

  // Monday's 21:05 pass — nothing to settle, generates Tuesday's call
  const p1 = await runCallPass({ kv, now: passAt(MON), readRegime: riskOn, thesisGen: gen, bars: [] });
  assert.deepEqual(p1, { configured: true, settled: null, generated: "HIGHER" });

  // Monday evening: the card is OPEN for Tuesday
  const open = await readCallState("v:me", { kv, now: passAt(MON) + 3600_000, readRegime: riskOn, thesisGen: gen });
  assert.equal(open.active?.forDate, TUE);
  assert.equal(open.active?.side, "HIGHER");
  assert.equal(open.active?.locked, false);
  assert.equal(open.active?.youSide, null);
  assert.equal(open.active?.thesis, "the tape leans on.");
  assert.equal(open.settled, null);
  assert.deepEqual(open.record.you, EMPTY_TALLY); // never seeded

  // Tuesday 08:00 ET: the owner takes the other side
  const at0800 = lockTs(TUE) - 90 * 60_000;
  assert.deepEqual(await takeSide("v:me", "LOWER", { kv, now: at0800 }), { ok: true });
  assert.deepEqual(await takeSide("v:me", "HIGHER", { kv, now: at0800 + 1000 }), {
    ok: false,
    error: "already_taken", // one record per identity per trading day
  });
  assert.deepEqual(await takeSide("v:you", "bananas", { kv, now: at0800 }), { ok: false, error: "bad_side" });

  const taken = await readCallState("v:me", { kv, now: at0800 + 2000, readRegime: riskOn, thesisGen: gen });
  assert.equal(taken.active?.youSide, "LOWER");

  // 09:30 ET: locked — the server refuses new takes
  assert.deepEqual(await takeSide("v:other", "HIGHER", { kv, now: lockTs(TUE) + 1 }), {
    ok: false,
    error: "locked",
  });
  const locked = await readCallState("v:other", { kv, now: lockTs(TUE) + 1, readRegime: riskOn, thesisGen: gen });
  assert.equal(locked.active?.locked, true);
  assert.equal(locked.active?.youSide, null);

  // Tuesday's 21:05 pass: NQ closed +1% → AUGUST ✓, owner ✗; Wednesday generates
  const p2 = await runCallPass({
    kv,
    now: passAt(TUE),
    readRegime: riskOn,
    thesisGen: gen,
    bars: [bar(MON, 100), bar(TUE, 101)],
  });
  assert.equal(p2.settled, "HIGHER");
  assert.equal(p2.generated, "HIGHER");

  const settled = await readCallState("v:me", { kv, now: passAt(TUE) + 60_000, readRegime: riskOn, thesisGen: gen });
  assert.equal(settled.settled?.forDate, TUE);
  assert.equal(settled.settled?.augustWin, true);
  assert.equal(settled.settled?.youWin, false);
  assert.equal(settled.settled?.disagree, "INDEX TREND and VIX sided with AUGUST");
  assert.deepEqual(settled.record.august, { wins: 1, losses: 0, pushes: 0 });
  assert.deepEqual(settled.record.you, { wins: 0, losses: 1, pushes: 0 });
  // the next call is already OPEN on the same card
  assert.equal(settled.active?.forDate, WED);
  // a non-taker's record never moves
  const other = await readCallState("v:other", { kv, now: passAt(TUE) + 60_000, readRegime: riskOn, thesisGen: gen });
  assert.deepEqual(other.record.you, EMPTY_TALLY);
});

test("loop: a flat close is a push — nobody's record moves except pushes", async () => {
  const kv = fakeKv();
  const riskOn = () => Promise.resolve(read("RISK ON", [["INDEX TREND (1mo)", 1], ["VIX LEVEL", 1]]));
  await runCallPass({ kv, now: passAt(MON), readRegime: riskOn, thesisGen: async () => null, bars: [] });
  await takeSide("v:me", "LOWER", { kv, now: lockTs(TUE) - 1000 });
  const p = await runCallPass({
    kv,
    now: passAt(TUE),
    readRegime: riskOn,
    thesisGen: async () => null,
    bars: [bar(MON, 100), bar(TUE, 100)],
  });
  assert.equal(p.settled, "FLAT");
  const s = await readCallState("v:me", { kv, now: passAt(TUE) + 1000, readRegime: riskOn, thesisGen: async () => null });
  assert.deepEqual(s.record.august, { wins: 0, losses: 0, pushes: 1 });
  assert.deepEqual(s.record.you, { wins: 0, losses: 0, pushes: 1 });
  assert.equal(hitRate(s.record.august), null); // pushes never fake a rate
});

test("loop: dead-even regime = NO CALL day; weekend = NO SESSION; surprise holiday voids", async () => {
  const kv = fakeKv();
  const deadEven = () => Promise.resolve(read("NEUTRAL", [["INDEX TREND (1mo)", 1], ["VIX LEVEL", -1]]));
  const p1 = await runCallPass({ kv, now: passAt(MON), readRegime: deadEven, thesisGen: async () => null, bars: [] });
  assert.equal(p1.generated, "no_call");
  const s = await readCallState(null, { kv, now: passAt(MON) + 1000, readRegime: deadEven, thesisGen: async () => null });
  assert.equal(s.active, null);
  assert.deepEqual(s.noCall, { reason: "dead_even", nextDate: WED });

  // Friday/Saturday passes generate nothing; the weekend card is NO SESSION
  const kv2 = fakeKv();
  const riskOn = () => Promise.resolve(read("RISK ON", [["INDEX TREND (1mo)", 1], ["VIX LEVEL", 1]]));
  const pFri = await runCallPass({ kv: kv2, now: passAt(FRI), readRegime: riskOn, thesisGen: async () => null, bars: [] });
  assert.equal(pFri.generated, null);
  const sat = await readCallState(null, { kv: kv2, now: passAt(SAT), readRegime: riskOn, thesisGen: async () => null });
  assert.equal(sat.active, null);
  assert.deepEqual(sat.noCall, { reason: "no_session", nextDate: "2026-09-07" });

  // a call for a day that never trades (holiday): later bar → NO_SESSION, records untouched
  const kv3 = fakeKv();
  await runCallPass({ kv: kv3, now: passAt(MON), readRegime: riskOn, thesisGen: async () => null, bars: [] });
  await takeSide("v:me", "LOWER", { kv: kv3, now: lockTs(TUE) - 1000 });
  const pv = await runCallPass({
    kv: kv3,
    now: passAt(WED),
    readRegime: riskOn,
    thesisGen: async () => null,
    bars: [bar(MON, 100), bar(WED, 102)], // Tuesday never printed
  });
  assert.equal(pv.settled, "NO_SESSION");
  const sv = await readCallState("v:me", { kv: kv3, now: passAt(WED) + 1000, readRegime: riskOn, thesisGen: async () => null });
  assert.deepEqual(sv.record.august, EMPTY_TALLY);
  assert.deepEqual(sv.record.you, EMPTY_TALLY);
});

test("loop: a bars-lag day settles on the NEXT pass instead of orphaning", async () => {
  const kv = fakeKv();
  const riskOn = () => Promise.resolve(read("RISK ON", [["INDEX TREND (1mo)", 1], ["VIX LEVEL", 1]]));
  await runCallPass({ kv, now: passAt(MON), readRegime: riskOn, thesisGen: async () => null, bars: [] });
  // Tuesday's pass: Yahoo lagging — Tuesday's bar missing, nothing later
  const p1 = await runCallPass({ kv, now: passAt(TUE), readRegime: riskOn, thesisGen: async () => null, bars: [bar(MON, 100)] });
  assert.equal(p1.settled, null); // stays unsettled, honestly
  assert.equal(p1.generated, "HIGHER"); // Wednesday still generates
  // Wednesday's pass: full bars — BOTH Tuesday and Wednesday settle
  const p2 = await runCallPass({
    kv,
    now: passAt(WED),
    readRegime: riskOn,
    thesisGen: async () => null,
    bars: [bar(MON, 100), bar(TUE, 99), bar(WED, 101)],
  });
  assert.equal(p2.settled, "HIGHER"); // Wednesday's (the last settled in the scan)
  const s = await readCallState(null, { kv, now: passAt(WED) + 1000, readRegime: riskOn, thesisGen: async () => null });
  // Tuesday was a LOWER close (loss) + Wednesday a HIGHER close (win)
  assert.deepEqual(s.record.august, { wins: 1, losses: 1, pushes: 0 });
});

test("pass is idempotent: a double run settles and generates nothing twice", async () => {
  const kv = fakeKv();
  const riskOn = () => Promise.resolve(read("RISK ON", [["INDEX TREND (1mo)", 1], ["VIX LEVEL", 1]]));
  const bars = [bar(MON, 100), bar(TUE, 101)];
  await runCallPass({ kv, now: passAt(MON), readRegime: riskOn, thesisGen: async () => null, bars: [] });
  await runCallPass({ kv, now: passAt(TUE), readRegime: riskOn, thesisGen: async () => null, bars });
  const again = await runCallPass({ kv, now: passAt(TUE), readRegime: riskOn, thesisGen: async () => null, bars });
  assert.equal(again.settled, null); // already settled — guarded
  assert.equal(again.generated, null); // NX — already generated
  const s = await readCallState(null, { kv, now: passAt(TUE) + 1000, readRegime: riskOn, thesisGen: async () => null });
  assert.deepEqual(s.record.august, { wins: 1, losses: 0, pushes: 0 }); // folded ONCE
});
