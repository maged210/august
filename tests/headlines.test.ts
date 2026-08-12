// Headlines (UX2-T2) — the pure RSS parse/merge helpers. The fetch/cache layer
// is best-effort by construction and isn't exercised here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeHeadlines, parseRss, type Headline } from "../lib/headlines";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Feed</title>
<item><title>Fed holds &amp; markets pop &#x2019;again&#8217; they say</title><link>https://ex.com/a</link><pubDate>Wed, 12 Aug 2026 14:00:00 GMT</pubDate></item>
<item><title><![CDATA[CPI comes in hot <again>]]></title><link>https://ex.com/b</link><pubDate>Wed, 12 Aug 2026 13:00:00 GMT</pubDate></item>
<item><title>No link — dropped</title><link>not-a-url</link></item>
<item><title></title><link>https://ex.com/c</link></item>
<item><title>Undated survives, sorts last</title><link>https://ex.com/d</link><pubDate>garbage</pubDate></item>
</channel></rss>`;

test("parseRss: decodes entities/CDATA, requires title + http link, tolerates bad dates", () => {
  const rows = parseRss(RSS, "TestWire");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].title, "Fed holds & markets pop ’again’ they say");
  assert.equal(rows[0].publisher, "TestWire");
  assert.ok(rows[0].publishedAt > 0);
  assert.equal(rows[1].title, "CPI comes in hot <again>");
  assert.equal(rows[2].publishedAt, 0); // garbled pubDate → 0, never NaN
});

test("parseRss: non-RSS input yields [] (a broken feed contributes nothing)", () => {
  assert.deepEqual(parseRss("<html>not a feed</html>", "X"), []);
  assert.deepEqual(parseRss("", "X"), []);
});

test("mergeHeadlines: newest first, near-duplicate titles collapse, cap honored", () => {
  const mk = (title: string, at: number, publisher = "A"): Headline => ({
    title,
    link: `https://ex.com/${at}`,
    publisher,
    publishedAt: at,
  });
  const merged = mergeHeadlines(
    [
      [mk("Fed holds rates!", 100), mk("Old story", 10)],
      [mk("fed holds RATES", 90, "B"), mk("Fresh take", 200, "B")],
    ],
    3,
  );
  assert.deepEqual(
    merged.map((h) => h.title),
    ["Fresh take", "Fed holds rates!", "Old story"],
  ); // the B-duplicate at 90 collapsed into the A-copy at 100
});
