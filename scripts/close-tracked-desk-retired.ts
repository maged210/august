// ONE-SHOT (chore/terminal-cut, decision 1) — close every open tracked row
// with reason "desk retired". RUN ONCE PER STORE, THEN DELETE THIS FILE.
//
//   node --env-file=.env.local --import ./tests/ts-resolve.mjs scripts/close-tracked-desk-retired.ts
//
// Status: ran against the PREVIEW store (the creds in .env.local) on
// 2026-09-15 — 39 rows, 34 closed, 0 failures. Production has NOT run yet:
// point --env-file at a file carrying the production UPSTASH_REDIS_REST_URL /
// UPSTASH_REDIS_REST_TOKEN (never commit that file), run once, verify the
// "still open" count is 0, then `git rm` this script.
//
// Standalone on purpose: closeTracked() was deleted with the desk, so this
// reimplements its two writes with the same durability order — the CLOSE
// tombstone first (atomic HSET, the record no concurrent pass can clobber),
// then the blob. The daily cron pass folds and prunes the tombstones.
// Idempotent: a second run finds nothing open and writes nothing.
import { Redis } from "@upstash/redis";
import { closeIdea, type TrackedIdea } from "../lib/intel/tracker";

const KEY = "august:intel:tracked:v1";
const CLOSED_KEY = "august:intel:tracked:closed:v1";
const REASON = "desk retired";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set");
const redis = new Redis({ url, token });

async function load(): Promise<TrackedIdea[]> {
  const raw = await redis.get<string>(KEY);
  if (raw === null || raw === undefined || raw === "") return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) throw new Error("tracked blob is not an array — refusing to touch it");
  return parsed as TrackedIdea[];
}

const before = await load();
const byStatus: Record<string, number> = {};
for (const r of before) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
console.log(`store host: ${new URL(url).host}`);
console.log(`before: ${before.length} tracked rows`, byStatus);

const open = before.filter((r) => r.status !== "CLOSED");
if (open.length === 0) {
  console.log("nothing open — no writes");
} else {
  const now = Date.now();
  // 1. tombstones first — one HSET carrying every id (atomic per field)
  const stones: Record<string, string> = {};
  for (const r of open) stones[r.id] = JSON.stringify({ at: now, reason: REASON });
  await redis.hset(CLOSED_KEY, stones);
  // 2. the blob, re-read to shrink the window against a concurrent pass
  const fresh = await load();
  const openIds = new Set(open.map((r) => r.id));
  const next = fresh.map((r) => (openIds.has(r.id) && r.status !== "CLOSED" ? closeIdea(r, now, REASON) : r));
  await redis.set(KEY, JSON.stringify(next));
  console.log(`closed ${open.length} rows with reason "${REASON}"`);
}

const after = await load();
const stillOpen = after.filter((r) => r.status !== "CLOSED");
console.log(`after: ${after.length} rows, ${stillOpen.length} still open`);
if (stillOpen.length) console.log("still open:", stillOpen.map((r) => `${r.ticker}:${r.status}`));
