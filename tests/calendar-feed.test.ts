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

const mkBar = (t0: number, offMin: number, open: number, close: number): Candle => ({
  time: t0 + offMin * 60, open, high: Math.max(open, close), low: Math.min(open, close), close,
});

test("reaction: pre-print anchor -> t+15m open; the impulse INSIDE the print bar counts", () => {
  const t0 = Date.UTC(2026, 7, 26, 12, 30) / 1000; // 08:30 ET print, pre-market bars present
  // The exact shape that rendered "-0.0%": flat tape into the print, the whole
  // move (-0.32%) inside the 08:30 bar, then drift. The old anchor (close of
  // the print bar) measured only the drift.
  const bars: Candle[] = [
    mkBar(t0, -15, 100, 100), mkBar(t0, -10, 100, 100), mkBar(t0, -5, 100, 100),
    mkBar(t0, 0, 100, 99.7), mkBar(t0, 5, 99.7, 99.66), mkBar(t0, 10, 99.66, 99.69),
    mkBar(t0, 15, 99.68, 99.72), mkBar(t0, 20, 99.72, 99.7),
  ];
  const r = reactionAfter(bars, t0 * 1000, 15);
  assert.ok(r.ok);
  // (open of the t+15m bar - close of the last pre-print bar) / anchor
  assert.ok(Math.abs(r.pct - -0.32) < 0.005);
});

test("reaction: honest refusals name the reason; never estimated", () => {
  const t0 = Date.UTC(2026, 7, 26, 12, 30) / 1000;
  // no bars at all
  assert.deepEqual(reactionAfter([], t0 * 1000, 15), { ok: false, why: "no_bars" });
  // bars begin AT the print — no pre-print trade to anchor on
  const noPre: Candle[] = [0, 5, 10, 15, 20].map((m) => mkBar(t0, m, 100, 100));
  assert.deepEqual(reactionAfter(noPre, t0 * 1000, 15), { ok: false, why: "no_preprint_bar" });
  // bars stop before t+15m (print near the session close)
  const cut: Candle[] = [-5, 0, 5].map((m) => mkBar(t0, m, 100, 100));
  assert.deepEqual(reactionAfter(cut, t0 * 1000, 15), { ok: false, why: "window_incomplete" });
  // a session-break gap right where the window ends is NOT covered
  const gapped: Candle[] = [...[-5, 0, 5].map((m) => mkBar(t0, m, 100, 100)), mkBar(t0, 90, 101, 101)];
  assert.deepEqual(reactionAfter(gapped, t0 * 1000, 15), { ok: false, why: "window_incomplete" });
  // 30m bars are too coarse to anchor a 15m window — refuse, don't approximate
  const coarse: Candle[] = [-30, 0, 30].map((m) => mkBar(t0, m, 100, 100));
  assert.deepEqual(reactionAfter(coarse, t0 * 1000, 15), { ok: false, why: "no_preprint_bar" });
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
