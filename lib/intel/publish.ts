// AUGUST Market Intel — publish/dissemination PURE logic. No I/O, no Redis, no
// fetch (persistence + quote joins live in publishStore.ts). The owner curates
// which TRACKED ideas get published; the public consumes published ideas with
// ALL source attribution redacted — a feed card must read as AUGUST's idea,
// never the source channel's.
//
// ANTI-HALLUCINATION LAW (inherited from tracker.ts, binding here too):
// - A published card carries ONLY levels the source actually stated and price
//   facts the tracker actually observed. Absent data serializes as absent.
// - P&L-like figures come exclusively from the tracker's pnlView (stated
//   trigger, or honest "since first mention") — never recomputed here.
// - An evicted tracker row renders from the publish-time snapshot with its
//   last known status and an explicit stale marker — it never pretends to be
//   live.

import type { Direction, TimeHorizon } from "./types";
import {
  mfeMaeView,
  pnlView,
  type MfeMaeView,
  type PnlView,
  type PriceSnap,
  type StatusEntry,
  type TrackedIdea,
  type TrackedLevel,
  type TrackedStatus,
} from "./tracker";
import { deepOmitKeys, SOURCE_KEYS } from "./redact";

/** Hard cap on published entries — oldest-out beyond this (caller logs). */
export const PUBLISHED_CAP = 200;

/** The ONLY attribution the public feed ever carries. */
export const PUBLIC_ATTRIBUTION = "AUGUST DESK" as const;

/** Keys that must never appear ANYWHERE in a serialized feed payload — the
 *  brief attribution/evidence set plus the tracker's internal linkage fields
 *  (sourceRefs carries videoId+channelTitle; conflictKey embeds the channel). */
export const FEED_FORBIDDEN_KEYS = [
  ...SOURCE_KEYS,
  "sourceRefs",
  "conflictKey",
  "ideaIds",
] as const;

// ── published entries ─────────────────────────────────────────────────────────

/** The redaction-safe core captured at publish time, so a card survives
 *  tracker eviction. Whitelist-built — never spread from a TrackedIdea. */
export type PublishSnapshot = {
  ticker: string;
  direction: Direction;
  timeframe: TimeHorizon;
  thesis: string;
  statedLevels: {
    trigger: TrackedLevel | null;
    invalidation: TrackedLevel | null;
    targets: TrackedLevel[];
  };
  /** tracking start (the tracked idea's createdAt) — "first mention" */
  firstMentionAt: number;
  /** lifecycle state when published */
  statusAtPublish: TrackedStatus;
  /** refreshed opportunistically while the tracker row is live, so an evicted
   *  card shows the freshest state we actually observed */
  lastKnownStatus: TrackedStatus;
};

export type PublishedEntry = {
  trackedId: string;
  publishedAt: number;
  snapshot: PublishSnapshot;
};

/** Build the publish-time snapshot from a live tracked idea (whitelist only —
 *  no sourceRefs, no conflictKey, no idea ids beyond the tracked id itself). */
export function snapshotFromTracked(t: TrackedIdea): PublishSnapshot {
  return {
    ticker: t.ticker,
    direction: t.direction,
    timeframe: t.timeframe,
    thesis: t.thesis,
    statedLevels: {
      trigger: t.statedLevels.trigger ? { ...t.statedLevels.trigger } : null,
      invalidation: t.statedLevels.invalidation ? { ...t.statedLevels.invalidation } : null,
      targets: t.statedLevels.targets.map((x) => ({ ...x })),
    },
    firstMentionAt: t.createdAt,
    statusAtPublish: t.status,
    lastKnownStatus: t.status,
  };
}

export type ApplyPublishResult =
  | { ok: true; entries: PublishedEntry[]; already: boolean; evicted: PublishedEntry[] }
  | { ok: false; error: "tracked_not_found" };

/** Publish a tracked idea. Idempotent — republishing keeps the original entry
 *  (and its publishedAt) untouched. Beyond PUBLISHED_CAP the oldest published
 *  entries fall out (returned so the caller can log them). Never mutates. */
export function applyPublish(
  entries: PublishedEntry[],
  tracked: TrackedIdea[],
  trackedId: string,
  now: number,
): ApplyPublishResult {
  if (entries.some((e) => e.trackedId === trackedId)) {
    return { ok: true, entries, already: true, evicted: [] };
  }
  const t = tracked.find((x) => x.id === trackedId);
  if (!t) return { ok: false, error: "tracked_not_found" };

  let next = [...entries, { trackedId, publishedAt: now, snapshot: snapshotFromTracked(t) }];
  const evicted: PublishedEntry[] = [];
  while (next.length > PUBLISHED_CAP) {
    const oldest = next.reduce((m, e) => (e.publishedAt < m.publishedAt ? e : m), next[0]);
    evicted.push(oldest);
    next = next.filter((e) => e !== oldest);
  }
  return { ok: true, entries: next, already: false, evicted };
}

/** Unpublish. Idempotent — removing an absent id reports removed:false. */
export function applyUnpublish(
  entries: PublishedEntry[],
  trackedId: string,
): { entries: PublishedEntry[]; removed: boolean } {
  const next = entries.filter((e) => e.trackedId !== trackedId);
  return { entries: next, removed: next.length !== entries.length };
}

/** Refresh each entry's lastKnownStatus from the live tracker rows (so a later
 *  eviction shows the freshest state actually observed). Pure — returns the
 *  same array when nothing changed. */
export function refreshSnapshots(
  entries: PublishedEntry[],
  trackedById: Map<string, TrackedIdea>,
): { entries: PublishedEntry[]; changed: boolean } {
  let changed = false;
  const next = entries.map((e) => {
    const live = trackedById.get(e.trackedId);
    if (!live || live.status === e.snapshot.lastKnownStatus) return e;
    changed = true;
    return { ...e, snapshot: { ...e.snapshot, lastKnownStatus: live.status } };
  });
  return { entries: changed ? next : entries, changed };
}

// ── the public feed card ──────────────────────────────────────────────────────

/** Live-ish quote joined at feed-build time (real measured market data). */
export type FeedQuote = { price: number; prevClose: number; chgPct: number; closes: number[] };

export type FeedCard = {
  /** the tracked idea id */
  id: string;
  attribution: typeof PUBLIC_ATTRIBUTION;
  publishedAt: number;
  ticker: string;
  direction: Direction;
  timeframe: TimeHorizon;
  thesis: string;
  statedLevels: {
    trigger: TrackedLevel | null;
    invalidation: TrackedLevel | null;
    targets: TrackedLevel[];
  };
  firstMentionAt: number;
  status: TrackedStatus;
  /** tracker row present — history/pnl below are live tracker truth */
  live: boolean;
  /** tracker row evicted — rendered from the publish snapshot */
  evicted: boolean;
  /** tracker staleness, or evicted (an evicted card is always stale) */
  stale: boolean;
  /** the tracker holds conflicting stated triggers for this identity */
  conflict: boolean;
  statusHistory: StatusEntry[];
  /** bounded spark ring (tracker priceHistory); empty when evicted */
  priceHistory: PriceSnap[];
  extremes: { maxFavorable: number | null; maxAdverse: number | null } | null;
  lastQuote: { price: number; at: number } | null;
  /** the tracker's honest P&L view; null when the row is evicted */
  pnl: PnlView | null;
  mfeMae: MfeMaeView;
  quote: FeedQuote | null;
};

const STATUS_RANK: Record<TrackedStatus, number> = {
  TRIGGERED: 0,
  ARMED: 1,
  ACTIVE: 2,
  TARGET_HIT: 3,
  INVALIDATED: 3,
  CLOSED: 3,
};

/** Recency key: last observed transition for live rows, publish time otherwise. */
function recencyOf(card: FeedCard): number {
  const lastTransition = card.statusHistory[card.statusHistory.length - 1]?.at ?? 0;
  return Math.max(lastTransition, card.publishedAt);
}

function buildCard(e: PublishedEntry, live: TrackedIdea | undefined, quote: FeedQuote | null): FeedCard {
  if (live) {
    return {
      id: e.trackedId,
      attribution: PUBLIC_ATTRIBUTION,
      publishedAt: e.publishedAt,
      ticker: live.ticker,
      direction: live.direction,
      timeframe: live.timeframe,
      thesis: live.thesis,
      statedLevels: {
        trigger: live.statedLevels.trigger ? { ...live.statedLevels.trigger } : null,
        invalidation: live.statedLevels.invalidation ? { ...live.statedLevels.invalidation } : null,
        targets: live.statedLevels.targets.map((x) => ({ ...x })),
      },
      firstMentionAt: live.createdAt,
      status: live.status,
      live: true,
      evicted: false,
      stale: live.stale,
      conflict: live.conflictKey !== null,
      statusHistory: live.statusHistory.map((h) => ({ ...h })),
      priceHistory: live.priceHistory.map((p) => ({ ...p })),
      extremes: { ...live.extremes },
      lastQuote: live.lastQuote ? { ...live.lastQuote } : null,
      pnl: pnlView(live),
      mfeMae: mfeMaeView(live),
      quote,
    };
  }
  // Evicted from the tracker: render from the snapshot, honestly marked. No
  // live history/pnl exists — absent data stays absent.
  const s = e.snapshot;
  return {
    id: e.trackedId,
    attribution: PUBLIC_ATTRIBUTION,
    publishedAt: e.publishedAt,
    ticker: s.ticker,
    direction: s.direction,
    timeframe: s.timeframe,
    thesis: s.thesis,
    statedLevels: {
      trigger: s.statedLevels.trigger ? { ...s.statedLevels.trigger } : null,
      invalidation: s.statedLevels.invalidation ? { ...s.statedLevels.invalidation } : null,
      targets: s.statedLevels.targets.map((x) => ({ ...x })),
    },
    firstMentionAt: s.firstMentionAt,
    status: s.lastKnownStatus,
    live: false,
    evicted: true,
    stale: true,
    conflict: false,
    statusHistory: [],
    priceHistory: [],
    extremes: null,
    lastQuote: null,
    pnl: null,
    mfeMae: null,
    quote,
  };
}

/** Assemble the public feed cards: join published entries with live tracker
 *  state (snapshot fallback for evicted rows), attach quotes, strip every
 *  forbidden key defensively, and sort deterministically:
 *  TRIGGERED → ARMED → ACTIVE → terminal, each group newest-first, ties by id. */
export function buildFeedCards(
  entries: PublishedEntry[],
  tracked: TrackedIdea[],
  quotes: Record<string, FeedQuote> = {},
): FeedCard[] {
  const byId = new Map(tracked.map((t) => [t.id, t]));
  const cards = entries.map((e) =>
    buildCard(e, byId.get(e.trackedId), quotes[e.snapshot.ticker.toUpperCase()] ?? null),
  );
  cards.sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    const rec = recencyOf(b) - recencyOf(a);
    if (rec !== 0) return rec;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  // Belt-and-braces: the cards are whitelist-built, but the wire payload must
  // be PROVABLY attribution-free — strip the forbidden keys at any depth.
  return deepOmitKeys(cards, FEED_FORBIDDEN_KEYS);
}
