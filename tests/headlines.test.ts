// Headlines (UX2-T2) — the pure RSS parse/merge helpers. The fetch/cache layer
// is best-effort by construction and isn't exercised here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeskHeadline, mergeHeadlines, parseRss, readHeadlines, type Headline } from "../lib/headlines";

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

// --- L11: a dead feed is NAMED, never dropped (fix/route-failure-honesty) ---
//
// readHeadlines fetches over the network and caches ~15 min in-process off
// Date.now, so each case would otherwise read the previous one's answer. No
// test hook was added to the library for that: these cases step a fake clock
// past CACHE_MS before every read, which expires the cache exactly the way
// fifteen real minutes would. fetch and Date.now are both restored after.

type Reply = { status?: number; xml?: string; throws?: string };

const CACHE_STEP_MS = 15 * 60_000 + 1;
let clock = Date.parse("2026-09-18T13:30:00Z");

const feed = (title: string, when = "Fri, 18 Sep 2026 13:00:00 GMT") =>
  `<rss version="2.0"><channel><title>F</title>` +
  `<item><title>${title}</title><link>https://ex.com/${encodeURIComponent(title)}</link><pubDate>${when}</pubDate></item>` +
  `</channel></rss>`;

const EMPTY_FEED = `<rss version="2.0"><channel><title>F</title></channel></rss>`;

async function readWith(replies: { cnbc: Reply; yahoo: Reply }, opts: { step?: boolean } = {}) {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  if (opts.step !== false) clock += CACHE_STEP_MS; // expire whatever the last case cached
  Date.now = () => clock;
  globalThis.fetch = (async (input: unknown) => {
    const r = String(input).includes("cnbc") ? replies.cnbc : replies.yahoo;
    if (r.throws) throw new Error(r.throws);
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => r.xml ?? "" } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    return await readHeadlines();
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
}

test("readHeadlines: every feed down is UNAVAILABLE with each publisher's cause, never an empty list", async () => {
  const r = await readWith({ cnbc: { status: 403 }, yahoo: { throws: "getaddrinfo ENOTFOUND" } });
  assert.equal(r.state, "unavailable");
  const reason = r.state === "unavailable" ? r.reason : "";
  assert.ok(reason.trim().length > 0, "a blackout is never reported without a reason");
  assert.ok(reason.includes("CNBC") && reason.includes("403"), reason);
  assert.ok(reason.includes("Yahoo Finance") && reason.includes("ENOTFOUND"), reason);
});

test("readHeadlines: one feed down is PARTIAL — the survivor's rows AND the dead publisher named", async () => {
  const r = await readWith({ cnbc: { xml: feed("Nasdaq futures slip before the open") }, yahoo: { status: 429 } });
  assert.equal(r.state, "ok");
  if (r.state !== "ok") return; // narrowing; the assert above already threw
  assert.deepEqual(r.rows.map((h) => h.title), ["Nasdaq futures slip before the open"]);
  assert.deepEqual(r.failed.map((f) => f.source), ["Yahoo Finance"]);
  assert.ok(r.failed[0].reason.includes("429"), r.failed[0].reason);
});

test("readHeadlines: the cached PARTIAL still names the dead feed — survivors are never served alone", async () => {
  const live = await readWith({ cnbc: { xml: feed("Oil steadies after OPEC+ surprise") }, yahoo: { status: 500 } });
  // inside the 15-min window: no fetch may run, so a throwing stub proves the
  // answer came from the cache — and it must carry the failure, not just rows
  const cached = await readWith({ cnbc: { throws: "no fetch" }, yahoo: { throws: "no fetch" } }, { step: false });
  assert.equal(live.state, "ok");
  assert.equal(cached.state, "ok");
  if (live.state !== "ok" || cached.state !== "ok") return;
  assert.deepEqual(cached.rows.map((h) => h.title), live.rows.map((h) => h.title));
  assert.deepEqual(cached.failed.map((f) => f.source), ["Yahoo Finance"]);
});

test("readHeadlines: every feed healthy is ok with an EMPTY failed list", async () => {
  const r = await readWith({ cnbc: { xml: feed("Fed minutes land at 2pm") }, yahoo: { xml: feed("Treasury yields jump", "Fri, 18 Sep 2026 12:00:00 GMT") } });
  assert.equal(r.state, "ok");
  if (r.state !== "ok") return;
  assert.deepEqual(r.rows.map((h) => h.publisher), ["CNBC", "Yahoo Finance"]);
  assert.deepEqual(r.failed, []);
});

test("readHeadlines: healthy feeds that published nothing are zero rows, NOT unreachable", async () => {
  const r = await readWith({ cnbc: { xml: EMPTY_FEED }, yahoo: { xml: EMPTY_FEED } });
  assert.equal(r.state, "ok"); // the distinction the branch exists for
  if (r.state !== "ok") return;
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.failed, []);
});
