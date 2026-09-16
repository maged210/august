// AUGUST Market Intel — Idea Tracker persistence + the snapshot pass. SERVER ONLY.
// The pure engine lives in tracker.ts; this file owns Redis I/O and orchestration:
// load tracked set → fold CLOSE tombstones → batch quotes → evaluate →
// housekeeping → enforce caps → save. Idempotent and cheap.
//
// chore/terminal-cut: the TRACKED lane is RETIRED. Every open row was closed
// with reason "desk retired" on 2026-09-15 (one-shot, since deleted; preview
// and production share the one Upstash database), the brief pipeline that
// fed new ideas in is deleted, and nothing publishes this set any more. The
// pass keeps running inside the daily cron so the stored rows stay honestly
// settled (housekeeping, caps, tombstone folding); it no longer INGESTS —
// the brief store has no writer, so re-folding its last brief every night
// would only resurrect ideas the desk already retired.
//
// ACTUAL CADENCE: ONE scheduled run per day at 22:10 UTC (vercel.json →
// /api/cron/intel-track). The page-load pass behind GET /api/intel/tracker
// went with the desk.
//
// Storage: ONE JSON blob under the tracked namespace (single GET/SET per pass —
// atomic enough for the single-writer cron; every pass is a pure function of
// (stored set, current quotes) so last-write-wins converges). Bounded by
// TRACKED_CAP ideas × PRICE_HISTORY_CAP snapshots.

import { Redis } from "@upstash/redis";
import { getQuote } from "@/lib/markets";
import { logIntel } from "./store";
import {
  applyHousekeeping,
  applySnapshot,
  closeIdea,
  DEFAULT_STALE_DAYS,
  enforceCap,
  type TrackedIdea,
} from "./tracker";

const KEY = "august:intel:tracked:v1";
const LASTRUN_KEY = "august:intel:tracked:lastrun";
// INTEGRITY-1 — CLOSE tombstones (Redis hash, id → {at, reason}). A user
// CLOSE is NOT re-derivable from (stored set, quotes), so plain
// last-write-wins does NOT converge for it: a pass holding a stale blob
// across its quote batch would silently resurrect the idea. Every pass folds
// pending tombstones in after loading, and a tombstone is deleted only once
// the saved blob durably shows the idea CLOSED. No writer remains after the
// desk retirement; the fold drains whatever the one-shot close left behind.
const CLOSED_KEY = "august:intel:tracked:closed:v1";

type CloseTombstone = { at: number; reason: string };

function parseTombstone(raw: unknown): CloseTombstone | null {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof v !== "object" || v === null) return null;
    const t = v as CloseTombstone;
    return Number.isFinite(t.at) && typeof t.reason === "string" ? t : null;
  } catch {
    return null;
  }
}

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

/** The stored set. An ABSENT key is an empty set; a failed read or a
 * malformed blob THROWS — the pass must never mistake "could not read" for
 * "nothing there", save `[]` over the retired history and drain its
 * tombstones (chore/terminal-cut review finding). */
export async function loadTracked(): Promise<TrackedIdea[]> {
  const redis = getRedis();
  if (!redis) return [];
  const raw = await redis.get<string>(KEY);
  if (raw === null || raw === undefined || raw === "") return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) throw new Error("tracked blob is not an array");
  return parsed as TrackedIdea[];
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
  quoted?: number;
  transitions?: number;
  evicted?: number;
};

/** The snapshot pass — the daily cron's tracked-set settle. */
export async function runTrackerPass(): Promise<TrackerPassResult> {
  const redis = getRedis();
  if (!redis) return { configured: false, ran: false, skippedReason: "storage not configured", tracked: [] };

  const now = Date.now();

  let tracked: TrackedIdea[];
  try {
    tracked = await loadTracked();
  } catch (err) {
    // a read we cannot trust is a pass we do not run — never overwrite the
    // set from a blank the store didn't give us
    return {
      configured: true,
      ran: false,
      skippedReason: `tracked read failed: ${err instanceof Error ? err.message : String(err)}`,
      tracked: [],
    };
  }

  // ── fold pending CLOSE tombstones in (INTEGRITY-1) ─────────────────────────
  // Applied tombstones are pruned only AFTER this pass's save has made them
  // durable.
  let appliedTombstones: string[] = [];
  try {
    const stones = (await redis.hgetall<Record<string, unknown>>(CLOSED_KEY)) ?? {};
    for (const [id, raw] of Object.entries(stones)) {
      const stone = parseTombstone(raw);
      if (!stone) continue;
      const idx = tracked.findIndex((t) => t.id === id);
      if (idx === -1) {
        appliedTombstones.push(id); // idea evicted/gone — the tombstone is spent
        continue;
      }
      if (tracked[idx].status !== "CLOSED") {
        tracked[idx] = closeIdea(tracked[idx], stone.at, stone.reason);
      }
      appliedTombstones.push(id);
    }
  } catch {
    appliedTombstones = []; // best-effort — unfolded stones just wait for the next pass
  }

  // ── quotes: one batch across the live tickers ───────────────────────────────
  // INTEGRITY-1 — the cap used to slice a STABLE insertion-ordered list, so the
  // same tail tickers were starved every pass and their ARMED ideas could never
  // trigger. Evaluable ideas (ARMED with a numeric trigger, TRIGGERED with live
  // levels) now rank ahead of thesis-only ACTIVE, so every idea that CAN
  // transition gets its quote before the cap bites.
  const evaluable = new Set(
    tracked
      .filter(
        (t) =>
          (t.status === "ARMED" && t.statedLevels.trigger?.value != null) ||
          t.status === "TRIGGERED",
      )
      .map((t) => t.ticker),
  );
  const liveTickers = [...new Set(tracked.filter((t) => t.status !== "CLOSED").map((t) => t.ticker))]
    .sort((a, b) => Number(evaluable.has(b)) - Number(evaluable.has(a)))
    .slice(0, MAX_QUOTED_TICKERS);
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
  // prune only tombstones whose close is now durably in the saved blob (or
  // whose idea is gone) — a tombstone written mid-pass survives for the next one
  if (appliedTombstones.length > 0) {
    try {
      const durable = appliedTombstones.filter((id) => {
        const t = kept.find((k) => k.id === id);
        return !t || t.status === "CLOSED";
      });
      if (durable.length > 0) await redis.hdel(CLOSED_KEY, ...durable);
    } catch {
      /* best-effort — an unpruned stone is idempotent */
    }
  }
  try {
    await redis.set(LASTRUN_KEY, now);
  } catch {
    /* best-effort */
  }

  return { configured: true, ran: true, tracked: kept, quoted: quotes.size, transitions, evicted };
}
