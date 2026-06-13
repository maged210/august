// Live Intel data — SERVER ONLY. Aggregates wire headlines from free RSS feeds
// and generates a short synthesis in AUGUST's voice.
//
// Sources (all free, keyless):
//   AP News        https://feeds.apnews.com/rss/apf-topnews
//   BBC            https://feeds.bbci.co.uk/news/rss.xml
//   The Guardian   https://www.theguardian.com/world/rss
//   Al Jazeera     https://www.aljazeera.com/xml/rss/all.xml
//   NPR            https://feeds.npr.org/1001/rss.xml
//   Reuters        https://feeds.reuters.com/reuters/topNews
//
// Synthesis: Anthropic SDK (same key as chat). Cached until headlines hash
// changes OR 15 min elapses. Outer Intel cache is 5 min — synthesis never
// races the model more than once per 5 min in practice.

import Anthropic from "@anthropic-ai/sdk";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// ---- TTL cache (same pattern as lib/markets.ts) -------------------------
type Entry = { exp: number; data: unknown };
const cache = new Map<string, Entry>();
async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.data as T;
  try {
    const data = await fetcher();
    cache.set(key, { exp: now + ttlMs, data });
    return data;
  } catch (e) {
    if (hit) return hit.data as T; // stale-on-error
    throw e;
  }
}

// ---- Types ---------------------------------------------------------------
export type Article = {
  source: string;
  headline: string;
  url: string;
  publishedAt: number; // ms epoch; 0 if unparseable
};

export type Intel = {
  articles: Article[];
  synthesis: string;
  briefLine: string;
  updatedAt: number;
};

// ---- RSS feeds -----------------------------------------------------------
const FEEDS: { name: string; url: string }[] = [
  { name: "AP", url: "https://feeds.apnews.com/rss/apf-topnews" },
  { name: "BBC", url: "https://feeds.bbci.co.uk/news/rss.xml" },
  { name: "GUARDIAN", url: "https://www.theguardian.com/world/rss" },
  { name: "AL JAZEERA", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "NPR", url: "https://feeds.npr.org/1001/rss.xml" },
  { name: "REUTERS", url: "https://feeds.reuters.com/reuters/topNews" },
];

// Minimal RSS 2.0 parser — no external deps needed.
function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? stripCdata(m[1]).trim() : "";
}

function isHttpUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

function parseRss(xml: string, sourceName: string): Article[] {
  const items: Article[] = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    if (items.length >= 4) break; // max 4 per feed
    const block = m[1];

    const title = extractTag(block, "title");
    if (!title) continue;

    // <link> in RSS 2.0 is text content; Atom uses href attribute
    let url = extractTag(block, "link");
    if (!isHttpUrl(url)) {
      const atomM = block.match(/<link[^>]+href="([^"]+)"/i);
      if (atomM) url = atomM[1];
    }
    if (!isHttpUrl(url)) {
      // fall back to <guid> if it looks like a URL
      const guid = extractTag(block, "guid");
      if (isHttpUrl(guid)) url = guid;
    }
    if (!isHttpUrl(url)) continue;

    const pubRaw = extractTag(block, "pubDate") || extractTag(block, "dc:date");
    const ts = pubRaw ? new Date(pubRaw).getTime() : 0;

    items.push({
      source: sourceName,
      headline: title,
      url,
      publishedAt: Number.isFinite(ts) ? ts : 0,
    });
  }
  return items;
}

async function fetchFeed(feed: { name: string; url: string }): Promise<Article[]> {
  return cached(`feed:${feed.name}`, 5 * 60_000, async () => {
    const res = await fetch(feed.url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, feed.name);
  });
}

// ---- Synthesis -----------------------------------------------------------
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// Stable string used as change-detection key — not cryptographic.
function headlineKey(articles: Article[]): string {
  return articles
    .slice(0, 12)
    .map((a) => a.headline)
    .join("|");
}

type SynthCache = { key: string; synthesis: string; briefLine: string; exp: number };
let synthCache: SynthCache | null = null;

async function getSynthesis(
  articles: Article[],
): Promise<{ synthesis: string; briefLine: string }> {
  const key = headlineKey(articles);
  const now = Date.now();
  if (synthCache && synthCache.key === key && synthCache.exp > now) {
    return { synthesis: synthCache.synthesis, briefLine: synthCache.briefLine };
  }

  const headlineBlock = articles
    .slice(0, 12)
    .map((a, i) => `${i + 1}. [${a.source}] ${a.headline}`)
    .join("\n");

  const msg = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `You are AUGUST — a private intelligence companion. Dry, economical, present-tense. No filler, no bullet lists.

WIRE HEADLINES RIGHT NOW (this is your only source material):
${headlineBlock}

RULES — non-negotiable:
1. Every claim must trace to a specific headline in the list above. Do not add context, history, geography, or events not explicitly stated in these headlines.
2. If only one source covers something, hedge it: "NPR reports…", "Al Jazeera notes…", "according to BBC…" — don't assert it as settled fact.
3. If the headlines are thin or unrelated, say so plainly rather than invent a through-line.
4. No elaboration beyond what the headline states. A headline about a crash is a crash — don't characterise who it implicates unless the headline says so.

Write 2–4 sentences in AUGUST's voice (calm, precise, occasionally wry) connecting the threads that are actually in this feed.

Then on a new line starting with "BRIEF:", write a single clause under 12 words drawn only from these headlines.`,
      },
    ],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
  const briefMatch = raw.match(/^BRIEF:\s*(.+)$/m);
  const briefLine = briefMatch
    ? briefMatch[1].trim()
    : raw.split(/[.!?]/)[0].trim() + ".";
  const synthesis = raw.replace(/^BRIEF:.*$/m, "").trim();

  synthCache = { key, synthesis, briefLine, exp: now + 15 * 60_000 };
  return { synthesis, briefLine };
}

// ---- Public API ----------------------------------------------------------
export async function getIntel(): Promise<Intel> {
  return cached("intel:all", 5 * 60_000, async () => {
    // Fetch all feeds concurrently; failures are silent (fulfilled with [])
    const results = await Promise.allSettled(FEEDS.map(fetchFeed));
    const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

    // Dedupe by URL, sort newest-first, cap at 12
    const seen = new Set<string>();
    const articles: Article[] = [];
    for (const a of all.sort((x, y) => y.publishedAt - x.publishedAt)) {
      if (!seen.has(a.url)) {
        seen.add(a.url);
        articles.push(a);
      }
      if (articles.length >= 12) break;
    }

    let synthesis = "Feeds loaded — synthesis pending.";
    let briefLine = "Wires are live.";

    if (articles.length > 0 && process.env.ANTHROPIC_API_KEY) {
      try {
        ({ synthesis, briefLine } = await getSynthesis(articles));
      } catch {
        synthesis = "Feeds loaded — synthesis temporarily unavailable.";
      }
    }

    return { articles, synthesis, briefLine, updatedAt: Date.now() } as Intel;
  });
}
