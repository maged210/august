// Unit tests for Market Intel's pure logic. Runs on Node's built-in test runner with
// native TypeScript type-stripping (Node 23+/24): `node --test tests/`. No test
// framework dependency is added. Modules under test import only relative ./types, so
// they resolve without the "@/" path alias (functions that touch live APIs/Redis are
// covered by tsc + the production build, not unit tests).

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseYouTubeUrl, parseDescriptionChapters } from "../lib/intel/youtube.ts";
import { parseManualTranscript } from "../lib/intel/transcript.ts";
import { normalizeChapterTitle } from "../lib/intel/chapters.ts";
import { isStale, marketSession, etDateKey } from "../lib/intel/session.ts";

test("parseYouTubeUrl: watch URL → video id", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/watch?v=Eo_B71QWJa8"), { kind: "video", videoId: "Eo_B71QWJa8" });
});
test("parseYouTubeUrl: youtu.be short link", () => {
  assert.deepEqual(parseYouTubeUrl("https://youtu.be/m4J0RwYTT_E"), { kind: "video", videoId: "m4J0RwYTT_E" });
});
test("parseYouTubeUrl: /live/ URL", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/live/m4J0RwYTT_E"), { kind: "video", videoId: "m4J0RwYTT_E" });
});
test("parseYouTubeUrl: channel id", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"), { kind: "channelId", channelId: "UCabcdefghijklmnopqrstuv" });
});
test("parseYouTubeUrl: @handle", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/@StockedUp"), { kind: "handle", handle: "StockedUp" });
});
test("parseYouTubeUrl: bare video id", () => {
  assert.deepEqual(parseYouTubeUrl("Eo_B71QWJa8"), { kind: "video", videoId: "Eo_B71QWJa8" });
});
test("parseYouTubeUrl: junk → unknown", () => {
  assert.equal(parseYouTubeUrl("hello world").kind, "unknown");
});

test("parseManualTranscript: preserves timestamps (two-line YT format)", () => {
  const r = parseManualTranscript("0:00\nGood morning traders\n0:12\nSPY looks weak today");
  assert.equal(r.status, "available");
  assert.equal(r.segments?.length, 2);
  assert.equal(r.segments?.[0].startSeconds, 0);
  assert.equal(r.segments?.[1].startSeconds, 12);
  assert.match(r.segments?.[1].text ?? "", /SPY looks weak/);
});
test("parseManualTranscript: inline timestamps with hours", () => {
  const r = parseManualTranscript("1:02:03 closing thoughts here");
  assert.equal(r.segments?.[0].startSeconds, 3723);
});
test("parseManualTranscript: plain prose chunks + flags missing timestamps", () => {
  const r = parseManualTranscript("word ".repeat(200).trim());
  assert.equal(r.status, "available");
  assert.ok((r.segments?.length ?? 0) >= 2);
  assert.match(r.note ?? "", /No timestamps/);
});
test("parseManualTranscript: empty → unavailable", () => {
  assert.equal(parseManualTranscript("").status, "unavailable");
});

test("normalizeChapterTitle: favorite setups → high priority", () => {
  const n = normalizeChapterTitle("Favorite Setups & Predictions");
  assert.equal(n.category, "favorite_setups");
  assert.equal(n.priority, "high");
});
test("normalizeChapterTitle: sponsor → low/advertisement", () => {
  assert.equal(normalizeChapterTitle("Sponsor — use code AUGUST").category, "advertisement");
});
test("normalizeChapterTitle: unknown → unrelated/low", () => {
  assert.equal(normalizeChapterTitle("Random musings").priority, "low");
});

test("parseDescriptionChapters: extracts ordered chapters", () => {
  const ch = parseDescriptionChapters("0:00 Intro\n5:18 Tomorrow's Catalysts\n10:48 Favorite Setups & Predictions");
  assert.equal(ch.length, 3);
  assert.equal(ch[2].startSeconds, 648);
  assert.equal(ch[2].title, "Favorite Setups & Predictions");
});
test("parseDescriptionChapters: a single timestamp is not enough", () => {
  assert.equal(parseDescriptionChapters("3:30 just one line").length, 0);
});

test("isStale: yesterday is stale, now is not", () => {
  assert.equal(isStale(Date.now() - 3 * 86_400_000), true);
  assert.equal(isStale(Date.now()), false);
});
test("marketSession + etDateKey are well-formed", () => {
  assert.ok(["premarket", "regular", "afterhours", "closed"].includes(marketSession()));
  assert.match(etDateKey(), /^\d{4}-\d{2}-\d{2}$/);
});
