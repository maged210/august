// AUGUST Market Intel — Idea Tracker persistence + the snapshot pass. SERVER ONLY.
// The pure engine lives in tracker.ts; this file owns Redis I/O and orchestration:
// load tracked set → ingest today's brief ideas → batch quotes → evaluate →
// housekeeping → enforce caps → save. Idempotent and cheap: designed for an
// external ~10–15 min pinger during market hours (see /api/cron/intel-track)
// AND an opportunistic throttled pass on page load (see /api/intel/tracker).
//
// Storage: ONE JSON blob under the tracked namespace (single GET/SET per pass —
// atomic enough for the single-writer cron; the page-load pass is throttled by
// a lastRun key so overlapping writers stay rare, and every pass is a pure
// function of (stored set, current brief, current quotes) so last-write-wins
// converges). Bounded by TRACKED_CAP ideas × PRICE_HISTORY_CAP snapshots.

import { Redis } from "@upstash/redis";
import { getQuote } from "@/lib/markets";
import { getBrief, listBriefDates, logIntel } from "./store";
import {
  applyHousekeeping,
  applySnapshot,
  DEFAULT_STALE_DAYS,
  enforceCap,
  upsertIdeas,
  type TrackedIdea,
} from "./tracker";
import type { BriefIdea } from "./types";
import { etDateKey } from "./session";

const KEY = "august:intel:tracked:v1";
const LASTRUN_KEY = "august:intel:tracked:lastrun";

/** Page-load passes are throttled to this; the cron passes force. */
const PASS_MIN_GAP_MS = 2 * 60_000;

/** Quote at most this many tickers per pass (respects the shared markets
 * ratelimit budget; getQuote is itself cached). */
const MAX_QUOTED_TICKERS = 25;

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

function staleDays(): number {
  const n = Number(process.env.TRACKER_STALE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_DAYS;
}

export async function loadTracked(): Promise<TrackedIdea[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.get<string>(KEY);
    if (!raw) return [];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as TrackedIdea[]) : [];
  } catch {
    return [];
  }
}

async function saveTracked(tracked: TrackedIdea[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(KEY, JSON.stringify(tracked));
}

export type TrackerPassResult = {
  configured: boolean;
  ran: boolean;
  skippedReason?: string;
  tracked: TrackedIdea[];
  ingested?: { added: number; merged: number; conflicts: number };
  quoted?: number;
  transitions?: number;
  evicted?: number;
};

/** The snapshot pass. force=true (cron) bypasses the page-load throttle. */
export async function runTrackerPass(opts: { force?: boolean } = {}): Promise<TrackerPassResult> {
  const redis = getRedis();
  if (!redis) return { configured: false, ran: false, skippedReason: "storage not configured", tracked: [] };

  const now = Date.now();

  // throttle opportunistic (page-load) passes
  if (!opts.force) {
    try {
      const last = await redis.get<number>(LASTRUN_KEY);
      if (last && now - Number(last) < PASS_MIN_GAP_MS) {
        return { configured: true, ran: false, skippedReason: "throttled", tracked: await loadTracked() };
      }
    } catch {
      /* proceed */
    }
  }

  let tracked = await loadTracked();

  // ── ingest: fold the latest brief's ideas into the tracked set ─────────────
  // Today's brief when it exists, else the most recent stored brief (weekend /
  // early-morning case). Ingestion is idempotent — contributed idea ids dedupe.
  let brief = await getBrief(etDateKey(new Date(now)));
  if (!brief) {
    const dates = await listBriefDates(1);
    if (dates[0]) brief = await getBrief(dates[0]);
  }
  let ingested: TrackerPassResult["ingested"];
  if (brief) {
    const seen = new Set<string>();
    const ideas: BriefIdea[] = [...(brief.creatorFavorites ?? []), ...(brief.topIdeas ?? [])].filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });
    const res = upsertIdeas(tracked, ideas, now);
    tracked = res.tracked;
    ingested = { added: res.added, merged: res.merged, conflicts: res.conflicts };
  }

  // ── quotes: one batch across the live tickers ───────────────────────────────
  const liveTickers = [...new Set(tracked.filter((t) => t.status !== "CLOSED").map((t) => t.ticker))].slice(
    0,
    MAX_QUOTED_TICKERS,
  );
  const settled = await Promise.allSettled(liveTickers.map((s) => getQuote(s)));
  const quotes = new Map<string, number>();
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) quotes.set(liveTickers[i], r.value.price);
  });

  // ── evaluate: snapshot + housekeeping per idea ──────────────────────────────
  let transitions = 0;
  tracked = tracked.map((t) => {
    let next = t;
    const price = quotes.get(t.ticker);
    if (price !== undefined) {
      const before = next.status;
      next = applySnapshot(next, { at: now, price });
      if (next.status !== before) transitions++;
    }
    const beforeHk = next.status;
    next = applyHousekeeping(next, now, { staleDays: staleDays() });
    if (next.status !== beforeHk) transitions++;
    return next;
  });

  // ── caps + save ─────────────────────────────────────────────────────────────
  const { kept, evicted, overflow } = enforceCap(tracked);
  if (overflow) await logIntel("tracker_cap_overflow", { size: kept.length });
  await saveTracked(kept);
  try {
    await redis.set(LASTRUN_KEY, now);
  } catch {
    /* best-effort */
  }

  if (ingested && (ingested.added || ingested.conflicts)) {
    await logIntel("tracker_ingest", ingested as unknown as Record<string, unknown>);
  }

  return { configured: true, ran: true, tracked: kept, ingested, quoted: quotes.size, transitions, evicted };
}
