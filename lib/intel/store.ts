// AUGUST Market Intel — Upstash Redis store. SERVER ONLY. Mirrors the getRedis()
// pattern used across the app (lib/gmail.ts, watchers). NO new database: relational-
// style entities are Redis hashes + index sets under the `august:intel:` namespace.
// Degrades to no-op (returns empty) when Upstash isn't configured.

import { Redis } from "@upstash/redis";
import type {
  Chapter,
  DailyBrief,
  IntelJob,
  IntelSettings,
  IntelSource,
  IntelVideo,
  TranscriptSegment,
  VideoAnalysis,
  VideoStatus,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";

const NS = "august:intel:";
const K = {
  sources: NS + "sources",
  videos: NS + "videos",
  jobs: NS + "jobs",
  settings: NS + "settings",
  logs: NS + "logs",
  briefDates: NS + "briefdates",
  transcript: (v: string) => `${NS}transcript:${v}`,
  chapters: (v: string) => `${NS}chapters:${v}`,
  analysis: (v: string) => `${NS}analysis:${v}`,
  brief: (d: string) => `${NS}brief:${d}`,
  sourceVideos: (id: string) => `${NS}source:${id}:videos`,
  ticker: (sym: string) => `${NS}ticker:${sym.toUpperCase()}`,
};

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

export function intelStorageConfigured(): boolean {
  return getRedis() !== null;
}

const LOG_CAP = 500;

/** Structured processing log — NEVER store secrets or full transcripts. */
export async function logIntel(event: string, data?: Record<string, unknown>): Promise<void> {
  const redis = getRedis();
  const line = JSON.stringify({ t: Date.now(), event, ...(data ?? {}) });
  // Console for server logs regardless of Redis.
  console.log(`[intel] ${event}`, data ? JSON.stringify(data).slice(0, 300) : "");
  if (!redis) return;
  try {
    await redis.lpush(K.logs, line);
    await redis.ltrim(K.logs, 0, LOG_CAP - 1);
  } catch {
    /* best-effort */
  }
}

export async function getLogs(limit = 100): Promise<unknown[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.lrange(K.logs, 0, limit - 1);
    return raw.map((r) => {
      try {
        return typeof r === "string" ? JSON.parse(r) : r;
      } catch {
        return r;
      }
    });
  } catch {
    return [];
  }
}

// --- sources --------------------------------------------------------------
export async function listSources(): Promise<IntelSource[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const all = await redis.hgetall<Record<string, IntelSource>>(K.sources);
    return all ? Object.values(all).sort((a, b) => a.created - b.created) : [];
  } catch {
    return [];
  }
}
export async function getSource(id: string): Promise<IntelSource | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return (await redis.hget<IntelSource>(K.sources, id)) ?? null;
  } catch {
    return null;
  }
}
export async function saveSource(s: IntelSource): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hset(K.sources, { [s.id]: s });
}
export async function removeSource(id: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hdel(K.sources, id);
  // Debris fix: the per-source video index must not outlive the source.
  try {
    await redis.del(K.sourceVideos(id));
  } catch {
    /* best-effort */
  }
}

// --- videos ---------------------------------------------------------------
export async function listVideos(): Promise<IntelVideo[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const all = await redis.hgetall<Record<string, IntelVideo>>(K.videos);
    return all ? Object.values(all).sort((a, b) => b.publishedAt - a.publishedAt) : [];
  } catch {
    return [];
  }
}
export async function getVideo(videoId: string): Promise<IntelVideo | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return (await redis.hget<IntelVideo>(K.videos, videoId)) ?? null;
  } catch {
    return null;
  }
}
export async function saveVideo(v: IntelVideo): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  v.updated = Date.now();
  await redis.hset(K.videos, { [v.videoId]: v });
  if (v.sourceId) await redis.sadd(K.sourceVideos(v.sourceId), v.videoId);
  for (const t of v.tickers ?? []) await redis.sadd(K.ticker(t), v.videoId);
}
/** True if this video is already known (dedupe — no duplicate processing). */
export async function videoExists(videoId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    return (await redis.hexists(K.videos, videoId)) === 1;
  } catch {
    return false;
  }
}
export async function videosForTicker(sym: string): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    return (await redis.smembers(K.ticker(sym))) ?? [];
  } catch {
    return [];
  }
}

// --- soft-duplicate videos (livestream + VOD re-upload sharing a title) -----
//
// The videos hash is keyed by videoId, so true duplicates can't exist — but a
// channel's livestream and its separately-uploaded VOD are two DISTINCT ids
// with the same title, published hours apart. One gets a transcript and
// analyzes; the twin sits forever in "transcript pending". The merge below
// keeps the RICHER record and absorbs the twin so twins never persist.

/** Case/punctuation/whitespace-insensitive title key for soft-dup detection. */
export function normalizeVideoTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Two videos published within this window can be livestream/VOD twins. */
export const SOFT_DUP_WINDOW_MS = 48 * 3_600_000;

/** Richness order for the merge decision: analyzed > transcript_ready > pending. */
const STATUS_RICHNESS: Record<VideoStatus, number> = {
  analyzed: 7,
  preliminary: 6,
  analyzing: 5,
  transcript_ready: 4,
  transcript_pending: 3,
  metadata_saved: 2,
  discovered: 1,
  failed: 0,
};

export function videoStatusRichness(s: VideoStatus): number {
  return STATUS_RICHNESS[s] ?? 0;
}

/** Same channel + same normalized title + published within 48h → soft twins. */
export function isSoftDuplicate(a: IntelVideo, b: IntelVideo): boolean {
  if (a.videoId === b.videoId) return false;
  if (!a.channelId || !b.channelId || a.channelId !== b.channelId) return false;
  const na = normalizeVideoTitle(a.title);
  if (!na || na !== normalizeVideoTitle(b.title)) return false;
  return Math.abs(a.publishedAt - b.publishedAt) <= SOFT_DUP_WINDOW_MS;
}

/** PURE merge decision: the richer-status record is kept. Ties keep the older
 *  record (then the lexicographically smaller id) — deterministic. Returns
 *  null when the pair is not a soft duplicate. */
export function decideVideoMerge(
  a: IntelVideo,
  b: IntelVideo,
): { keep: IntelVideo; absorb: IntelVideo } | null {
  if (!isSoftDuplicate(a, b)) return null;
  const ra = videoStatusRichness(a.status);
  const rb = videoStatusRichness(b.status);
  if (ra !== rb) return ra > rb ? { keep: a, absorb: b } : { keep: b, absorb: a };
  if (a.created !== b.created) return a.created < b.created ? { keep: a, absorb: b } : { keep: b, absorb: a };
  return a.videoId < b.videoId ? { keep: a, absorb: b } : { keep: b, absorb: a };
}

/** Absorb a soft-duplicate twin into the kept record:
 *   - union the ticker sets onto the keeper,
 *   - move any transcript/chapters/analysis blobs the keeper LACKS (never
 *     deletes the only copy of real data), then drop the twin's blobs,
 *   - repoint source:<id>:videos membership from the twin to the keeper,
 *   - remove the twin from ticker index sets and delete its video row.
 *  Returns the (updated) kept record. */
export async function mergeVideoTwins(keep: IntelVideo, absorb: IntelVideo): Promise<IntelVideo> {
  const redis = getRedis();
  if (!redis) return keep;

  // union tickers (saveVideo below re-indexes the keeper into the ticker sets)
  const tickers = [...new Set([...(keep.tickers ?? []), ...(absorb.tickers ?? [])])];
  if (tickers.length) keep.tickers = tickers;

  // move blobs the keeper lacks; delete the twin's either way
  for (const kb of [K.transcript, K.chapters, K.analysis]) {
    try {
      const twinVal = await redis.get<unknown>(kb(absorb.videoId));
      if (twinVal === null || twinVal === undefined) continue;
      const keepVal = await redis.get<unknown>(kb(keep.videoId));
      if (keepVal === null || keepVal === undefined) {
        await redis.set(kb(keep.videoId), typeof twinVal === "string" ? twinVal : JSON.stringify(twinVal));
      }
      await redis.del(kb(absorb.videoId));
    } catch {
      /* best-effort per blob */
    }
  }

  // repoint the per-source index: the twin's set loses the twin, gains the keeper
  try {
    if (absorb.sourceId) {
      await redis.srem(K.sourceVideos(absorb.sourceId), absorb.videoId);
      await redis.sadd(K.sourceVideos(absorb.sourceId), keep.videoId);
    }
  } catch {
    /* best-effort */
  }

  // drop the twin from the ticker index sets, then the row itself
  for (const t of absorb.tickers ?? []) {
    try {
      await redis.srem(K.ticker(t), absorb.videoId);
    } catch {
      /* best-effort */
    }
  }
  await redis.hdel(K.videos, absorb.videoId);
  await saveVideo(keep);
  await logIntel("video_twins_merged", {
    kept: keep.videoId,
    absorbed: absorb.videoId,
    title: keep.title.slice(0, 80),
  });
  return keep;
}

// --- transcript + chapters + analysis (JSON blobs) ------------------------
export async function saveTranscript(videoId: string, segs: TranscriptSegment[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(K.transcript(videoId), JSON.stringify(segs));
}
export async function getTranscript(videoId: string): Promise<TranscriptSegment[] | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<string>(K.transcript(videoId));
    return raw ? (typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as TranscriptSegment[])) : null;
  } catch {
    return null;
  }
}
export async function saveChapters(videoId: string, ch: Chapter[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(K.chapters(videoId), JSON.stringify(ch));
}
export async function getChapters(videoId: string): Promise<Chapter[] | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<string>(K.chapters(videoId));
    return raw ? (typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as Chapter[])) : null;
  } catch {
    return null;
  }
}
export async function saveAnalysis(videoId: string, a: VideoAnalysis): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(K.analysis(videoId), JSON.stringify(a));
}
export async function getAnalysis(videoId: string): Promise<VideoAnalysis | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<string>(K.analysis(videoId));
    if (!raw) return null;
    const a = (typeof raw === "string" ? JSON.parse(raw) : raw) as VideoAnalysis;
    // Back-compat: analyses stored before pass 3 have no optionIdeas. Backfill so the
    // required-array type stays honest and every consumer can iterate safely.
    a.optionIdeas ??= [];
    return a;
  } catch {
    return null;
  }
}

// --- jobs -----------------------------------------------------------------
export async function saveJob(j: IntelJob): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  j.updated = Date.now();
  await redis.hset(K.jobs, { [j.id]: j });
}
export async function listJobs(): Promise<IntelJob[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const all = await redis.hgetall<Record<string, IntelJob>>(K.jobs);
    return all ? Object.values(all).sort((a, b) => b.updated - a.updated) : [];
  } catch {
    return [];
  }
}
export async function getJob(id: string): Promise<IntelJob | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return (await redis.hget<IntelJob>(K.jobs, id)) ?? null;
  } catch {
    return null;
  }
}

// --- briefs ---------------------------------------------------------------
export async function saveBrief(b: DailyBrief): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(K.brief(b.date), JSON.stringify(b));
  await redis.zadd(K.briefDates, { score: Date.parse(b.date) || Date.now(), member: b.date });
}
export async function getBrief(date: string): Promise<DailyBrief | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<string>(K.brief(date));
    return raw ? (typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as DailyBrief)) : null;
  } catch {
    return null;
  }
}
export async function listBriefDates(limit = 30): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const dates = await redis.zrange<string[]>(K.briefDates, 0, limit - 1, { rev: true });
    return dates ?? [];
  } catch {
    return [];
  }
}

// --- settings -------------------------------------------------------------
export async function getSettings(): Promise<IntelSettings> {
  const redis = getRedis();
  if (!redis) return DEFAULT_SETTINGS;
  try {
    const raw = await redis.get<string>(K.settings);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { ...DEFAULT_SETTINGS, ...(parsed as Partial<IntelSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export async function saveSettings(s: IntelSettings): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(K.settings, JSON.stringify(s));
}
