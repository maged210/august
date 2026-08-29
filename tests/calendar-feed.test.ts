// lib/calendar-feed — R4 F2: classification, states, honest reaction math.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEvent, eventState, parseCalRow, reactionAfter } from "../lib/calendar-feed";
import type { Candle } from "../lib/markets";

test("classify: the big four; weekly claims are NOT the jobs report", () => {
  assert.equal(classifyEvent("CPI m/m"), "CPI");
  assert.equal(classifyEvent("Core CPI m/m"), "CPI");
  assert.equal(classifyEvent("FOMC Meeting Minutes"), "FOMC");
  assert.equal(classifyEvent("Federal Funds Rate"), "FOMC");
  assert.equal(classifyEvent("Non-Farm Employment Change"), "JOBS");
  assert.equal(classifyEvent("Unemployment Rate"), "JOBS");
  assert.equal(classifyEvent("Advance GDP q/q"), "GDP");
  assert.equal(classifyEvent("Unemployment Claims"), null);
  assert.equal(classifyEvent("Flash Manufacturing PMI"), null);
});

test("classify: member speeches are NOT the FOMC; chair remarks are", () => {
  // live-feed titles, 2026-08-26/28 — a Low-impact Barkin speech rendered as
  // a big-four "FOMC" card before this guard
  assert.equal(classifyEvent("FOMC Member Barkin Speaks"), null);
  assert.equal(classifyEvent("FOMC Member Hammack Speaks"), null);
  assert.equal(classifyEvent("Fed Chairman Warsh Speaks"), "FOMC");
  assert.equal(classifyEvent("Fed Chair Powell Speaks"), "FOMC");
  // both GDP series classify GDP — the CARD shows the full title, the class
  // only drives inclusion
  assert.equal(classifyEvent("Prelim GDP q/q"), "GDP");
  assert.equal(classifyEvent("Prelim GDP Price Index q/q"), "GDP");
});

test("ids: series+timestamp, stable, distinct at shared timestamps", () => {
  // the real Wed 08:30 collision: two GDP series print at the same second
  const at = "2026-08-26T08:30:00-04:00";
  const gdp = parseCalRow({ title: "Prelim GDP q/q", country: "USD", date: at, impact: "High" })!;
  const gdpPi = parseCalRow({ title: "Prelim GDP Price Index q/q", country: "USD", date: at, impact: "Medium" })!;
  assert.equal(gdp.ts, gdpPi.ts); // same timestamp…
  assert.notEqual(gdp.id, gdpPi.id); // …distinct identity — keys never collide
  // stable: the same row parses to the same id every time
  assert.equal(gdp.id, parseCalRow({ title: "Prelim GDP q/q", country: "USD", date: at, impact: "High" })!.id);
  assert.equal(gdp.id, `Prelim GDP q/q@${Date.parse(at)}`);
});

test("state: distant >48h, imminent <48h, released ≤12h old, past after", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0);
  assert.equal(eventState(now + 60 * 3600_000, now), "distant");
  assert.equal(eventState(now + 10 * 3600_000, now), "imminent");
  assert.equal(eventState(now - 2 * 3600_000, now), "released");
  assert.equal(eventState(now - 20 * 3600_000, now), "past");
});

test("reaction: needs bars covering BOTH ends; never estimated", () => {
  const t0 = Date.UTC(2026, 7, 19, 18, 0) / 1000; // 14:00 ET print
  const bars: Candle[] = Array.from({ length: 12 }, (_, i) => ({
    time: t0 + i * 300, open: 100, high: 101, low: 99, close: 100 + i * 0.1,
  }));
  const r = reactionAfter(bars, t0 * 1000, 15);
  assert.ok(r !== null && Math.abs(r - 0.3) < 0.01); // +0.3% over 15m
  // bars end before t+15m → null
  assert.equal(reactionAfter(bars.slice(0, 2), t0 * 1000, 15), null);
  // no bar near the print → null
  assert.equal(reactionAfter(bars, (t0 - 7200) * 1000, 15), null);
});

test("parse: ET-offset ISO dates land as epoch ms; malformed refuses", () => {
  const e = parseCalRow({ title: "CPI m/m", country: "USD", date: "2026-09-10T08:30:00-04:00", impact: "High", forecast: "0.2%", previous: "0.3%" });
  assert.ok(e);
  assert.equal(e!.cls, "CPI");
  assert.equal(e!.ts, Date.parse("2026-09-10T08:30:00-04:00"));
  assert.equal(e!.forecast, "0.2%");
  assert.equal(parseCalRow({ title: "x" }), null);
  assert.equal(parseCalRow({ title: "x", date: "not a date" }), null);
  assert.equal(parseCalRow({ title: "x", date: "2026-09-10T08:30:00-04:00", forecast: "" })!.forecast, null);
});
