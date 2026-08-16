// HEADLINES (UX2-T2) — the home brief's news block. FREE PUBLIC RSS ONLY
// (the single sanctioned exception to "zero new data sources"): 2–3 quality
// feeds fetched server-side, parsed with a minimal tolerant XML read (no new
// dependencies, no scraping), merged newest-first and cached in-process for
// ~15 minutes. A feed that fails or changes shape simply contributes nothing
// — the block renders whatever survived, or an honest empty state.

export type Headline = {
  title: string;
  link: string;
  publisher: string;
  /** epoch ms; 0 when the feed omitted/garbled pubDate (sorts last) */
  publishedAt: number;
};

const FEEDS: Array<{ url: string; publisher: string }> = [
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", publisher: "CNBC" },
  { url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", publisher: "MarketWatch" },
  { url: "https://finance.yahoo.com/news/rssindex", publisher: "Yahoo Finance" },
];

const CACHE_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_PER_FEED = 8;
const MAX_TOTAL = 15;
const MAX_TITLE_CHARS = 200;

let _cache: { at: number; rows: Headline[] } | null = null;

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

async function fetchFeed(url: string, publisher: string): Promise<Headline[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "AUGUST/0.0.6 (personal desk; rss reader)" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    return parseRss(await res.text(), publisher);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Top headlines, in-process cached ~15 min. [] when every feed failed. */
export async function getHeadlines(): Promise<Headline[]> {
  if (_cache && Date.now() - _cache.at < CACHE_MS) return _cache.rows;
  const lists = await Promise.all(FEEDS.map((f) => fetchFeed(f.url, f.publisher)));
  const rows = mergeHeadlines(lists.map((l) => l.filter(isDeskHeadline)));
  // don't cache a total blackout — retry on the next request instead
  if (rows.length > 0) _cache = { at: Date.now(), rows };
  return rows;
}
