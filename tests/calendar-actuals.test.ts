// lib/calendar-actuals — fix/whats-coming: the FRED mapping, vintage guard,
// display formatting, and cache behaviour (hits spend nothing).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchFredSeries,
  formatActual,
  observationMatchesEvent,
  backfillActuals,
  type ActualsStore,
  type FredFetcher,
} from "../lib/calendar-actuals";

test("mapping: the majors resolve; everything else keeps the disclaimer", () => {
  assert.equal(matchFredSeries("CPI m/m")!.series, "CPIAUCSL");
  assert.equal(matchFredSeries("Core CPI m/m")!.series, "CPILFESL");
  assert.equal(matchFredSeries("PCE Price Index m/m")!.series, "PCEPI");
  assert.equal(matchFredSeries("Core PCE Price Index m/m")!.series, "PCEPILFE");
  assert.equal(matchFredSeries("Advance GDP q/q")!.series, "A191RL1Q225SBEA");
  assert.equal(matchFredSeries("Prelim GDP q/q")!.series, "A191RL1Q225SBEA");
  assert.equal(matchFredSeries("Prelim GDP Price Index q/q")!.series, "A191RI1Q225SBEA");
  assert.equal(matchFredSeries("Non-Farm Employment Change")!.series, "PAYEMS");
  assert.equal(matchFredSeries("Unemployment Rate")!.series, "UNRATE");
  assert.equal(matchFredSeries("Retail Sales m/m")!.series, "RSAFS");
  assert.equal(matchFredSeries("PPI m/m")!.series, "PPIFIS");
  // deliberately unmapped — anchored titles refuse near-misses
  assert.equal(matchFredSeries("CPI y/y"), null);
  assert.equal(matchFredSeries("Unemployment Claims"), null);
  assert.equal(matchFredSeries("Goods Trade Balance"), null);
  assert.equal(matchFredSeries("Core Retail Sales m/m"), null);
});

test("format: feed-style values; toFixed's -0.0 never renders", () => {
  assert.equal(formatActual(0.24551, "pct1"), "0.2%");
  assert.equal(formatActual(-0.03, "pct1"), "0.0%");
  assert.equal(formatActual(1.5, "pct1"), "1.5%");
  assert.equal(formatActual(-0.58, "pct1"), "-0.6%");
  assert.equal(formatActual(-23, "thousands"), "-23K");
  assert.equal(formatActual(22.4, "thousands"), "22K");
  assert.equal(formatActual(-0.2, "thousands"), "0K");
});

test("vintage guard: only the printed period AND vintage pass", () => {
  const aug26 = Date.parse("2026-08-26T08:30:00-04:00");
  // monthly majors report the PRIOR month (pre-ingest FRED shows a further
  // month back, so the period alone refuses; realtime is not consulted)
  assert.equal(observationMatchesEvent({ date: "2026-07-01" }, aug26, "monthly"), true);
  assert.equal(observationMatchesEvent({ date: "2026-06-01" }, aug26, "monthly"), false);
  assert.equal(observationMatchesEvent({ date: "2026-08-01" }, aug26, "monthly"), false);
  // GDP estimates revise the SAME quarterly observation in place — the value
  // is only THIS print's when its vintage was published on/after the print
  // day. Real case (ALFRED, 2026): GDP Price Index Q2 was 6.3 on Aug 25 and
  // 6.4 on Aug 27; the period check alone would have served 6.3 as Wednesday's
  // "actual".
  assert.equal(observationMatchesEvent({ date: "2026-04-01", realtimeStart: "2026-08-26" }, aug26, "quarterly"), true);
  assert.equal(observationMatchesEvent({ date: "2026-04-01", realtimeStart: "2026-08-25" }, aug26, "quarterly"), false); // pre-ingest: previous estimate
  assert.equal(observationMatchesEvent({ date: "2026-04-01", realtimeStart: null }, aug26, "quarterly"), false); // unproven vintage → refuse
  assert.equal(observationMatchesEvent({ date: "2026-04-01" }, aug26, "quarterly"), false);
  const jul30 = Date.parse("2026-07-30T08:30:00-04:00");
  assert.equal(observationMatchesEvent({ date: "2026-04-01", realtimeStart: "2026-07-30" }, jul30, "quarterly"), true); // advance
  assert.equal(observationMatchesEvent({ date: "2026-01-01", realtimeStart: "2026-08-26" }, aug26, "quarterly"), false); // stale quarter
  assert.equal(observationMatchesEvent({ date: "garbage" }, aug26, "monthly"), false);
});

function fakeStore(): ActualsStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(k) {
      return data.get(k) ?? null;
    },
    async set(k, v) {
      data.set(k, v);
    },
  };
}

test("backfill: fetch once, cache, and serve repeats from the cache", async () => {
  const now = Date.parse("2026-08-26T12:00:00-04:00");
  const ev = { id: "Prelim GDP q/q@1", title: "Prelim GDP q/q", ts: Date.parse("2026-08-26T08:30:00-04:00") };
  const store = fakeStore();
  let calls = 0;
  const fetcher: FredFetcher = async (_series, _units, realtimeStart) => {
    calls++;
    // quarterly fetches must open the vintage window from the day before the print
    assert.equal(realtimeStart, "2026-08-25");
    return { date: "2026-04-01", value: 1.5, realtimeStart: "2026-08-26" };
  };
  const first = await backfillActuals([ev], { store, fetcher, now });
  assert.deepEqual(first, { [ev.id]: "1.5%" });
  assert.equal(calls, 1);
  const second = await backfillActuals([ev], { store, fetcher, now });
  assert.deepEqual(second, { [ev.id]: "1.5%" });
  assert.equal(calls, 1); // cache hit — FRED not touched again
});

test("backfill: a pre-ingest quarterly value never masquerades as the print", async () => {
  // The 2026-08-26 GDP Price Index case: between the 08:30 print and FRED's
  // ingest, the latest observation is the SAME quarter still carrying the
  // advance estimate (6.3). Period-only checking served it as "actual".
  const now = Date.parse("2026-08-26T08:45:00-04:00");
  const ev = { id: "Prelim GDP Price Index q/q@1", title: "Prelim GDP Price Index q/q", ts: Date.parse("2026-08-26T08:30:00-04:00") };
  const store = fakeStore();
  let calls = 0;
  const preIngest: FredFetcher = async () => {
    calls++;
    return { date: "2026-04-01", value: 6.3, realtimeStart: "2026-08-25" }; // still the advance vintage
  };
  const res = await backfillActuals([ev], { store, fetcher: preIngest, now });
  assert.deepEqual(res, {}); // refused — disclaimer stays, no fabricated actual
  // and the refusal is negative-cached so the immediate retry spends nothing
  await backfillActuals([ev], { store, fetcher: preIngest, now });
  assert.equal(calls, 1);
});

test("backfill: unprinted, unmapped, and stale-vintage events never fill", async () => {
  const now = Date.parse("2026-08-26T12:00:00-04:00");
  const store = fakeStore();
  let calls = 0;
  const staleFetcher: FredFetcher = async () => {
    calls++;
    return { date: "2026-06-01", value: 0.4, realtimeStart: null }; // FRED hasn't ingested the print
  };
  const future = { id: "CPI m/m@f", title: "CPI m/m", ts: now + 3600_000 };
  const unmapped = { id: "Unemployment Claims@u", title: "Unemployment Claims", ts: now - 3600_000 };
  const stale = { id: "Core PCE Price Index m/m@s", title: "Core PCE Price Index m/m", ts: now - 3600_000 };
  const res = await backfillActuals([future, unmapped, stale], { store, fetcher: staleFetcher, now });
  assert.deepEqual(res, {});
  assert.equal(calls, 1); // only the printed+mapped event reached FRED
  // the stale miss is negative-cached: the immediate retry spends nothing
  await backfillActuals([stale], { store, fetcher: staleFetcher, now });
  assert.equal(calls, 1);
});
