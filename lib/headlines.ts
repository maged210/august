// HEADLINES (UX2-T2) — the home brief's news block. FREE PUBLIC RSS ONLY
// (the single sanctioned exception to "zero new data sources"): 2–3 quality
// feeds fetched server-side, parsed with a minimal tolerant XML read (no new
// dependencies, no scraping), merged newest-first and cached in-process for
// ~15 minutes.
//
// L11 (fix/route-failure-honesty) — a feed that fails is NAMED, never silently
// dropped. Some feeds down serves what survived AND says who is missing; every
// feed down is `unavailable` with each publisher's own cause. The one thing
// this module will not do is answer a blackout with an empty list, which the
// front page renders as a quiet news day.

import { causeOf, wireDown, wireOk, type SourceFailure, type WireRead } from "@/lib/wire";

export type Headline = {
  title: string;
  link: string;
  publisher: string;
  /** epoch ms; 0 when the feed omitted/garbled pubDate (sorts last) */
  publishedAt: number;
};

// PUBLIC-LANGUAGE P1 (2026-08-16): MarketWatch removed as a source entirely.
// Two feeds remain, both behind the desk filter below. Candidates from the
// same publishers' existing RSS sets, flagged for owner sign-off, are listed
// at the gate — none wired without it.
const FEEDS: Array<{ url: string; publisher: string }> = [
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", publisher: "CNBC" },
  { url: "https://finance.yahoo.com/news/rssindex", publisher: "Yahoo Finance" },
];

const CACHE_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_PER_FEED = 8;
const MAX_TOTAL = 15;
const MAX_TITLE_CHARS = 200;

// the failures ride WITH the rows they are missing from — see readHeadlines
let _cache: { at: number; rows: Headline[]; failed: SourceFailure[] } | null = null;

// --- minimal, tolerant RSS parsing (pure — exported for tests) --------------

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return Number.isFinite(c) && c > 31 && c < 0x10000 ? String.fromCharCode(c) : "";
    })
    // hex entities (&#x2019; — MarketWatch/Dow Jones encode apostrophes this way)
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const c = parseInt(n, 16);
      return Number.isFinite(c) && c > 31 && c < 0x10000 ? String.fromCharCode(c) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

/** PURE. Parse an RSS 2.0 document into headlines; malformed items drop. */
export function parseRss(xml: string, publisher: string): Headline[] {
  const out: Headline[] = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const item of items.slice(0, MAX_PER_FEED)) {
    const title = tagText(item, "title").slice(0, MAX_TITLE_CHARS);
    const link = tagText(item, "link");
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const t = Date.parse(tagText(item, "pubDate"));
    out.push({ title, link, publisher, publishedAt: Number.isFinite(t) ? t : 0 });
  }
  return out;
}

// GROOM 2026-08-16 — the front page is a trading desk, not a money column.
// Personal-finance verticals (retirement planning, benefits, advice-column
// first person, household credit) drop before the merge. MarketWatch's
// markets-only feed (mw_marketpulse) was probed as the cleaner fix but is a
// stale archive (2025 pubDates) — the filter covers every feed instead.
const CHUM = [
  /\b401\s?\(?k\)?\b/i,
  /\broth\b|\bIRA\b/,
  /\bmedicaid\b|\bmedicare\b|\bsocial security\b/i,
  /\bretir(?:e|ed|ee|ees|ement|ing)\b/i,
  /\bestate plan|inheritance|\bheirs?\b|\bwill and testament\b/i,
  /\bmortgage|\brefinanc|\bcredit card|\bcredit score|\bstudent loan/i,
  /\bfinancial (?:advis[eo]r|planner)\b|\bCPA\b/,
  /\bnest egg\b|\bnet worth\b|\bsavings account\b/i,
  /\bmy (?:husband|wife|mother|father|mom|dad|family|kids?|son|daughter|bonus|paycheck)\b/i,
  /\b(?:I'?m|I am|we'?re) \d{2}\b/i,
  /\bshould (?:I|you|we)\b|\bhow much (?:do|should|can) (?:I|you|we)\b/i,
  /\bmoneywise\b|\bmoney (?:mistakes?|moves?|habits?|tips?|lessons?)\b/i,
];

/** PURE. True when a headline belongs on a trading front page. */
export function isDeskHeadline(h: Pick<Headline, "title" | "link">): boolean {
  if (CHUM.some((re) => re.test(h.title))) return false;
  return !/\/personal-finance\/|\/retirement\/|\/taxes\/|\/real-estate\//i.test(h.link);
}

/** PURE. Merge feeds newest-first, de-dupe near-identical titles, cap. */
export function mergeHeadlines(lists: Headline[][], max: number = MAX_TOTAL): Headline[] {
  const seen = new Set<string>();
  const all = lists.flat().sort((a, b) => b.publishedAt - a.publishedAt);
  const out: Headline[] = [];
  for (const h of all) {
    const key = h.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

// --- the cached fetch --------------------------------------------------------

/** ONE feed's read: the items it published, or why it didn't answer. A 403
 *  from a publisher and a feed that published nothing are different facts and
 *  stay different all the way to the reader. */
async function fetchFeed(url: string, publisher: string): Promise<WireRead<Headline>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "AUGUST/0.0.6 (personal desk; rss reader)" },
      cache: "no-store",
    });
    if (!res.ok) return wireDown(`answered ${res.status}`);
    const body = await res.text();
    const rows = parseRss(body, publisher);
    // A 200 IS NOT AN ANSWER. Publishers behind a CDN serve consent walls,
    // challenge pages and "we'll be right back" HTML with a 200 and no feed in
    // them; parseRss finds no <item> and returns [], which is indistinguishable
    // from a publisher who genuinely posted nothing. Treating that as an answer
    // is how a whole publisher drops out of the list silently — so a body that
    // isn't a feed at all is a failure, while a real feed with no items today
    // stays an honest empty.
    if (rows.length === 0 && !/<(rss|feed|rdf:RDF)[\s>]/i.test(body)) {
      return wireDown("answered 200 with no feed in it");
    }
    return wireOk(rows);
  } catch (e) {
    // an AbortError's message says only that something was aborted — WE are
    // what aborted it, so the cause a reader gets is the timeout we imposed
    return wireDown(ctl.signal.aborted ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s` : causeOf(e));
  } finally {
    clearTimeout(timer);
  }
}

/** Top headlines with the feeds that didn't answer named beside them.
 *  `unavailable` ONLY when no feed answered at all. In-process cached ~15 min. */
export async function readHeadlines(): Promise<WireRead<Headline>> {
  if (_cache && Date.now() - _cache.at < CACHE_MS) return wireOk(_cache.rows, _cache.failed);

  const reads = await Promise.all(FEEDS.map((f) => fetchFeed(f.url, f.publisher)));
  const lists: Headline[][] = [];
  const failed: SourceFailure[] = [];
  reads.forEach((r, i) => {
    // the publisher name is what a reader is shown — "CNBC", not the feed URL
    if (r.state === "ok") lists.push(r.rows.filter(isDeskHeadline));
    else failed.push({ source: FEEDS[i].publisher, reason: r.reason });
  });

  // nothing answered. This used to return [] and the front page printed "No
  // headlines right now" — a total blackout reading as a slow news day.
  if (lists.length === 0 && failed.length > 0) {
    return wireDown(`no feed answered — ${failed.map((f) => `${f.source}: ${f.reason}`).join("; ")}`);
  }

  const rows = mergeHeadlines(lists);
  // don't cache an answer with nothing in it — retry on the next request
  // instead (unchanged rule; a blackout now returns above and never reaches
  // here). A PARTIAL is cached WITH its failures and never the rows alone:
  // serving fifteen minutes of survivors while dropping the names would
  // republish the exact clean-looking list this branch exists to remove, and a
  // shortened TTL would re-hit a publisher that is already rate-limiting us.
  if (rows.length > 0) _cache = { at: Date.now(), rows, failed };
  return wireOk(rows, failed);
}

/** Top headlines, in-process cached ~15 min. [] when every feed failed — the
 *  desk snapshot already states HEADLINES: unavailable for an empty list.
 *  Anything that must tell empty from unreachable reads readHeadlines(). */
export async function getHeadlines(): Promise<Headline[]> {
  const read = await readHeadlines();
  return read.state === "ok" ? read.rows : [];
}
