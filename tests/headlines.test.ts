// Headlines (UX2-T2) — the pure RSS parse/merge helpers. The fetch/cache layer
// is best-effort by construction and isn't exercised here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeskHeadline, mergeHeadlines, parseRss, type Headline } from "../lib/headlines";

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

test("isDeskHeadline: personal-finance chum drops, market headlines survive", () => {
  const chum = [
    "What the results of a primary race may mean for Social Security",
    "I'm a retired CPA with $1.2 million in my 401(k) — what now?",
    "My bonus was $42,000. Should I pay off my mortgage?",
    "Medicaid rules could cost you the family home",
    "Moneywise staff confesses worst money mistakes — from ignoring subscriptions on",
    "How much do I need in my nest egg to retire at 55?",
  ];
  const desk = [
    "Nvidia slides 3% as chip export rules tighten",
    "Fed minutes to test the rally in rate-sensitive tech",
    "Oil steadies after OPEC+ output surprise",
    "Treasury yields jump on hot jobless claims print",
  ];
  for (const title of chum) assert.equal(isDeskHeadline({ title, link: "https://x.com/a" }), false, title);
  for (const title of desk) assert.equal(isDeskHeadline({ title, link: "https://x.com/a" }), true, title);
  assert.equal(isDeskHeadline({ title: "Markets wrap", link: "https://www.marketwatch.com/personal-finance/story" }), false);
});
