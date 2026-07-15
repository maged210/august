// AUGUST Market Intel — publish store + public feed assembly. SERVER ONLY.
// The pure logic lives in publish.ts; this file owns Redis I/O and the joins:
// published entries ⋈ live tracker rows ⋈ live-ish quotes → redacted feed.
//
// Storage: ONE JSON blob (like tracked:v1) — single GET/SET per mutation,
// single-writer in practice (mutations are owner-gated). Bounded by
// PUBLISHED_CAP entries.

import { Redis } from "@upstash/redis";
import { getQuoteWithSpark } from "@/lib/markets";
import { listSources, listVideos, logIntel } from "./store";
import { loadTracked } from "./trackerStore";
import { storeIdentityStrings } from "./redact";
import {
  applyPublish,
  applyUnpublish,
  buildFeedCards,
  PUBLIC_ATTRIBUTION,
  refreshSnapshots,
  type FeedCard,
  type FeedQuote,
  type PublishedEntry,
  type PublishSnapshot,
} from "./publish";
import type { TrackedStatus } from "./tracker";

const KEY = "august:intel:published:v1";

/** In-process feed cache TTL — the feed is public and read-heavy; the join +
 *  quote batch runs at most once per window per instance. */
const FEED_TTL_MS = 45_000;

/** Quote at most this many tickers per feed build (the shared markets budget —
 *  same ceiling as /api/intel/quotes). */
const MAX_FEED_QUOTES = 20;

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

export async function loadPublished(): Promise<PublishedEntry[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.get<string>(KEY);
    if (!raw) return [];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as PublishedEntry[]) : [];
  } catch {
    return [];
  }
}

async function savePublished(entries: PublishedEntry[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(KEY, JSON.stringify(entries));
}

export type PublishMutationResult =
  | { ok: true; already: boolean; count: number }
  | { ok: false; error: "storage_unconfigured" | "tracked_not_found" };

/** Publish a tracked idea (idempotent). Invalidates the feed cache. */
export async function publishTracked(trackedId: string): Promise<PublishMutationResult> {
  if (!getRedis()) return { ok: false, error: "storage_unconfigured" };
  const [entries, tracked] = await Promise.all([loadPublished(), loadTracked()]);
  const res = applyPublish(entries, tracked, trackedId, Date.now());
  if (!res.ok) return { ok: false, error: "tracked_not_found" };
  if (!res.already) {
    await savePublished(res.entries);
    for (const ev of res.evicted) {
      await logIntel("publish_cap_evicted", { trackedId: ev.trackedId, ticker: ev.snapshot.ticker });
    }
    const snap = res.entries.find((e) => e.trackedId === trackedId)?.snapshot;
    await logIntel("idea_published", { trackedId, ticker: snap?.ticker });
    _feedCache = null;
  }
  return { ok: true, already: res.already, count: res.entries.length };
}

export type UnpublishResult =
  | { ok: true; removed: boolean; count: number }
  | { ok: false; error: "storage_unconfigured" };

/** Unpublish (idempotent). Invalidates the feed cache. */
export async function unpublishTracked(trackedId: string): Promise<UnpublishResult> {
  if (!getRedis()) return { ok: false, error: "storage_unconfigured" };
  const entries = await loadPublished();
  const { entries: next, removed } = applyUnpublish(entries, trackedId);
  if (removed) {
    await savePublished(next);
    await logIntel("idea_unpublished", { trackedId });
    _feedCache = null;
  }
  return { ok: true, removed, count: next.length };
}

export type PublishedRow = {
  trackedId: string;
  publishedAt: number;
  /** the tracker row still exists */
  live: boolean;
  /** live tracker status when live, else the snapshot's last known status */
  status: TrackedStatus;
  snapshot: PublishSnapshot;
};

/** Owner-facing listing — published entries joined with live tracker state so
 *  the desk UI can mark published rows and see what survives eviction. */
export async function listPublishedWithState(): Promise<PublishedRow[]> {
  const [entries, tracked] = await Promise.all([loadPublished(), loadTracked()]);
  const byId = new Map(tracked.map((t) => [t.id, t]));
  return entries
    .map((e) => {
      const live = byId.get(e.trackedId);
      return {
        trackedId: e.trackedId,
        publishedAt: e.publishedAt,
        live: !!live,
        status: live?.status ?? e.snapshot.lastKnownStatus,
        snapshot: e.snapshot,
      };
    })
    .sort((a, b) => b.publishedAt - a.publishedAt || (a.trackedId < b.trackedId ? -1 : 1));
}

// ── the public feed ───────────────────────────────────────────────────────────

export type PublicFeed = {
  ok: true;
  attribution: typeof PUBLIC_ATTRIBUTION;
  generatedAt: number;
  count: number;
  ideas: FeedCard[];
};

let _feedCache: { at: number; payload: PublicFeed } | null = null;

/** Assemble (or serve the cached) public feed. Everything in the payload has
 *  been through the whitelist build + deep key strip in buildFeedCards — the
 *  serialized JSON carries zero source attribution. */
export async function getPublicFeed(): Promise<PublicFeed> {
  const now = Date.now();
  if (_feedCache && now - _feedCache.at < FEED_TTL_MS) return _feedCache.payload;

  // Identity strings for the prose scrub (channel/video names the LLM may
  // have written INTO thesis/level/status prose — key deletion can't catch
  // those). A store hiccup never blocks the feed — it just scrubs with what
  // the cards themselves know (nothing: they carry no identity fields).
  const identitiesP = Promise.all([listSources(), listVideos()])
    .then(([s, v]) => storeIdentityStrings(s, v))
    .catch((): string[] => []);
  const [entries, tracked, identities] = await Promise.all([loadPublished(), loadTracked(), identitiesP]);

  // Opportunistic write-back: keep each snapshot's lastKnownStatus fresh while
  // its tracker row is still alive, so eviction later shows real last state.
  const byId = new Map(tracked.map((t) => [t.id, t]));
  const refreshed = refreshSnapshots(entries, byId);
  if (refreshed.changed) {
    try {
      await savePublished(refreshed.entries);
    } catch {
      /* best-effort */
    }
  }

  // First pass orders the cards; quote the top tickers in that order (≤20).
  const ordered = buildFeedCards(refreshed.entries, tracked);
  const symbols: string[] = [];
  for (const c of ordered) {
    const sym = c.ticker.toUpperCase();
    if (!symbols.includes(sym)) symbols.push(sym);
    if (symbols.length >= MAX_FEED_QUOTES) break;
  }
  const quotes: Record<string, FeedQuote> = {};
  const settled = await Promise.allSettled(symbols.map((s) => getQuoteWithSpark(s)));
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      const q = r.value;
      quotes[symbols[i]] = { price: q.price, prevClose: q.prevClose, chgPct: q.chgPct, closes: q.closes };
    }
  });

  const ideas = buildFeedCards(refreshed.entries, tracked, quotes, identities);
  const payload: PublicFeed = {
    ok: true,
    attribution: PUBLIC_ATTRIBUTION,
    generatedAt: now,
    count: ideas.length,
    ideas,
  };
  _feedCache = { at: now, payload };
  return payload;
}
