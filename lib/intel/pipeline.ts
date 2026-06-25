// Intel pipeline orchestrator — SERVER ONLY. Glues the providers + store together:
// add a source, process a transcript (fast pass → full pass), enrich with live quotes,
// and sync channels for new uploads. Idempotent on videoId (no duplicate processing).

import type { IntelSource, IntelVideo, VideoAnalysis } from "./types";
import { ANALYSIS_VERSION } from "./types";
import { getQuote } from "@/lib/markets";
import {
  getAnalysis,
  getSource,
  getTranscript,
  getVideo,
  listSources,
  logIntel,
  saveAnalysis,
  saveChapters,
  saveSource,
  saveTranscript,
  saveVideo,
  videoExists,
} from "./store";
import { getVideoMeta, listChannelUploads, parseYouTubeUrl, resolveChannel } from "./youtube";
import { acquireTranscript, parseManualTranscript } from "./transcript";
import { detectChapters, templateForChannel } from "./chapters";
import { analyzeFastPass, analyzeFullPass, intelligenceConfigured } from "./extract";
import { etDateKey, isStale } from "./session";

const newId = (p: string) => `${p}${Math.random().toString(36).slice(2, 10)}`;

// --- add a source from any URL/handle/id ----------------------------------
export type AddResult =
  | { ok: true; source: IntelSource; video?: IntelVideo }
  | { ok: false; error: string };

export async function addSource(url: string): Promise<AddResult> {
  const ref = parseYouTubeUrl(url);
  if (ref.kind === "unknown") return { ok: false, error: "unrecognized_url" };

  if (ref.kind === "video") {
    const meta = await getVideoMeta(ref.videoId);
    if (!meta) return { ok: false, error: "video_not_found" };
    const src: IntelSource = {
      id: `v_${ref.videoId}`,
      type: "video",
      videoId: ref.videoId,
      channelId: meta.channelId,
      channelTitle: meta.author,
      title: meta.title || meta.author || ref.videoId,
      thumbnail: meta.thumbnail,
      url: `https://www.youtube.com/watch?v=${ref.videoId}`,
      enabled: true,
      templateId: templateForChannel(meta.author)?.id,
      created: Date.now(),
      lastChecked: Date.now(),
      lastProcessed: 0,
      status: "active",
    };
    await saveSource(src);
    const video = await upsertVideoFromMeta(src.id, ref.videoId);
    await logIntel("source_added", { type: "video", videoId: ref.videoId });
    return { ok: true, source: src, video: video ?? undefined };
  }

  // channel / handle / user / custom
  const ch = await resolveChannel(ref);
  if (!ch) return { ok: false, error: "channel_unresolved" };
  const src: IntelSource = {
    id: ch.channelId,
    type: "channel",
    channelId: ch.channelId,
    channelTitle: ch.title,
    title: ch.title || ch.channelId,
    thumbnail: ch.thumbnail,
    url: `https://www.youtube.com/channel/${ch.channelId}`,
    enabled: true,
    uploadsPlaylistId: ch.uploadsPlaylistId,
    templateId: templateForChannel(ch.title)?.id,
    created: Date.now(),
    lastChecked: 0,
    lastProcessed: 0,
    status: ch.uploadsPlaylistId ? "active" : "error",
    error: ch.uploadsPlaylistId ? undefined : "Add YOUTUBE_API_KEY to auto-discover uploads for this channel.",
  };
  await saveSource(src);
  await logIntel("source_added", { type: "channel", channelId: ch.channelId, hasUploads: !!ch.uploadsPlaylistId });
  return { ok: true, source: src };
}

async function upsertVideoFromMeta(sourceId: string, videoId: string): Promise<IntelVideo | null> {
  const meta = await getVideoMeta(videoId);
  if (!meta) return null;
  const existing = await getVideo(videoId);
  const publishedAt = meta.publishedAt ?? existing?.publishedAt ?? Date.now();
  const v: IntelVideo = {
    videoId,
    sourceId,
    channelId: meta.channelId ?? existing?.channelId,
    channelTitle: meta.author ?? existing?.channelTitle,
    title: meta.title || existing?.title || videoId,
    thumbnail: meta.thumbnail ?? existing?.thumbnail,
    publishedAt,
    durationSeconds: meta.durationSeconds ?? existing?.durationSeconds,
    liveState: meta.liveState ?? existing?.liveState ?? "uploaded",
    status: existing?.status ?? "metadata_saved",
    transcriptStatus: existing?.transcriptStatus ?? "pending",
    analysisVersion: existing?.analysisVersion,
    marketDate: existing?.marketDate,
    tickers: existing?.tickers,
    ideaCount: existing?.ideaCount,
    levelCount: existing?.levelCount,
    summary: existing?.summary,
    stale: isStale(publishedAt),
    created: existing?.created ?? Date.now(),
    updated: Date.now(),
  };
  await saveVideo(v);
  return v;
}

// --- enrichment (live quotes, kept separate from creator-quoted values) ---
async function enrich(a: VideoAnalysis): Promise<VideoAnalysis> {
  const syms = [...new Set([...a.tradeIdeas.map((t) => t.ticker), ...a.levels.map((l) => l.instrument)])];
  const quotes = new Map<string, { price: number; chgPct: number } | null>();
  await Promise.all(
    syms.map(async (s) => {
      const q = await getQuote(s).catch(() => null);
      quotes.set(s, q ? { price: q.price, chgPct: q.chgPct } : null);
    }),
  );
  const now = Date.now();
  for (const t of a.tradeIdeas) {
    const q = quotes.get(t.ticker);
    if (!q) continue;
    let triggered: boolean | null = null;
    let invalidated: boolean | null = null;
    if (t.entry.value !== null) {
      triggered = t.direction === "bullish" ? q.price >= t.entry.value : t.direction === "bearish" ? q.price <= t.entry.value : null;
    }
    if (t.invalidation.value !== null) {
      invalidated = t.direction === "bullish" ? q.price < t.invalidation.value : t.direction === "bearish" ? q.price > t.invalidation.value : null;
    }
    t.enriched = { price: q.price, priceAsOf: now, chgPct: q.chgPct, triggered, invalidated };
  }
  for (const l of a.levels) {
    const q = quotes.get(l.instrument);
    if (!q || l.level === null) continue;
    l.crossed = ["resistance", "breakout", "target"].includes(l.type) ? q.price >= l.level : ["support", "breakdown", "invalidation"].includes(l.type) ? q.price <= l.level : null;
  }
  return a;
}

// --- process a video using a supplied (manual) transcript -----------------
export type ProcessResult =
  | { ok: true; analysis: VideoAnalysis; preliminary?: VideoAnalysis }
  | { ok: false; error: string };

export async function processManualTranscript(videoId: string, rawTranscript: string): Promise<ProcessResult> {
  if (!intelligenceConfigured()) return { ok: false, error: "ai_unconfigured" };
  let video = await getVideo(videoId);
  if (!video) {
    video = await upsertVideoFromMeta(`v_${videoId}`, videoId);
    if (!video) return { ok: false, error: "video_not_found" };
  }

  const parsed = parseManualTranscript(rawTranscript);
  if (parsed.status !== "available" || !parsed.segments?.length) {
    video.transcriptStatus = "unavailable";
    await saveVideo(video);
    return { ok: false, error: "transcript_unparseable" };
  }
  const segments = parsed.segments;
  await saveTranscript(videoId, segments);
  video.transcriptStatus = "available";
  video.transcriptSource = "manual";
  video.status = "analyzing";
  await saveVideo(video);

  const meta = await getVideoMeta(videoId).catch(() => null);
  const total = segments[segments.length - 1]?.endSeconds || meta?.durationSeconds || 0;
  const chapters = detectChapters(meta?.descriptionChapters, segments, total);
  await saveChapters(videoId, chapters);

  const opts = {
    videoId,
    channelTitle: video.channelTitle,
    marketDate: etDateKey(new Date(video.publishedAt)),
    publishedAt: new Date(video.publishedAt).toISOString(),
    stale: isStale(video.publishedAt),
  };

  // Fast pass (priority chapters) — publish a preliminary brief immediately.
  let preliminary: VideoAnalysis | undefined;
  try {
    const fp = await analyzeFastPass(segments, chapters, opts);
    if (fp) {
      preliminary = await enrich(fp);
      await saveAnalysis(videoId, preliminary);
      video.status = "preliminary";
      video.summary = preliminary.overallSummary;
      video.ideaCount = preliminary.tradeIdeas.length;
      video.levelCount = preliminary.levels.length;
      video.tickers = [...new Set(preliminary.tradeIdeas.map((t) => t.ticker))];
      video.analysisVersion = ANALYSIS_VERSION;
      video.marketDate = opts.marketDate;
      await saveVideo(video);
      await logIntel("fast_pass", { videoId, ideas: preliminary.tradeIdeas.length });
    }
  } catch (e) {
    await logIntel("fast_pass_error", { videoId, error: e instanceof Error ? e.message : String(e) });
  }

  // Full pass — entire transcript for context/contradictions.
  try {
    const full = await analyzeFullPass(segments, chapters, opts);
    if (full) {
      const enriched = await enrich(full);
      await saveAnalysis(videoId, enriched);
      video.status = "analyzed";
      video.summary = enriched.overallSummary || video.summary;
      video.ideaCount = enriched.tradeIdeas.length;
      video.levelCount = enriched.levels.length;
      video.tickers = [...new Set(enriched.tradeIdeas.map((t) => t.ticker))];
      video.analysisVersion = ANALYSIS_VERSION;
      video.marketDate = opts.marketDate;
      await saveVideo(video);
      await logIntel("full_pass", { videoId, ideas: enriched.tradeIdeas.length, levels: enriched.levels.length });
      const src = await getSource(video.sourceId);
      if (src) {
        src.lastProcessed = Date.now();
        await saveSource(src);
      }
      return { ok: true, analysis: enriched, preliminary };
    }
  } catch (e) {
    await logIntel("full_pass_error", { videoId, error: e instanceof Error ? e.message : String(e) });
  }

  if (preliminary) return { ok: true, analysis: preliminary, preliminary };
  video.status = "failed";
  video.error = "Extraction produced no analysis.";
  await saveVideo(video);
  return { ok: false, error: "extraction_failed" };
}

/** Re-run extraction from the stored transcript (e.g. after a version bump). */
export async function reprocessVideo(videoId: string): Promise<ProcessResult> {
  const segs = await getTranscript(videoId);
  if (!segs?.length) return { ok: false, error: "no_transcript" };
  // Rebuild the raw text from segments so processManualTranscript can re-run uniformly.
  const raw = segs.map((s) => `${Math.floor(s.startSeconds / 60)}:${String(Math.floor(s.startSeconds % 60)).padStart(2, "0")} ${s.text}`).join("\n");
  return processManualTranscript(videoId, raw);
}

// --- sync channels for new uploads (needs YOUTUBE_API_KEY) ----------------
export type SyncResult = { checked: number; discovered: number; details: string[] };

export async function syncSources(): Promise<SyncResult> {
  const sources = (await listSources()).filter((s) => s.enabled && s.type === "channel" && s.uploadsPlaylistId);
  let discovered = 0;
  const details: string[] = [];
  for (const s of sources) {
    s.lastChecked = Date.now();
    const uploads = await listChannelUploads(s.uploadsPlaylistId!, 10);
    for (const u of uploads) {
      if (await videoExists(u.videoId)) continue;
      await upsertVideoFromMeta(s.id, u.videoId);
      discovered++;
      details.push(`${s.title}: ${u.title}`);
    }
    await saveSource(s);
  }
  await logIntel("sync", { checked: sources.length, discovered });
  return { checked: sources.length, discovered, details };
}

/** Try an automatic transcript for a discovered video (best-effort). */
export async function tryAutoTranscript(videoId: string): Promise<{ ok: boolean; status: string }> {
  const r = await acquireTranscript(videoId);
  const video = await getVideo(videoId);
  if (video) {
    video.transcriptStatus = r.status;
    await saveVideo(video);
  }
  if (r.status === "available" && r.segments?.length) {
    const raw = r.segments.map((s) => `${Math.floor(s.startSeconds / 60)}:${String(Math.floor(s.startSeconds % 60)).padStart(2, "0")} ${s.text}`).join("\n");
    const res = await processManualTranscript(videoId, raw);
    return { ok: res.ok, status: r.status };
  }
  return { ok: false, status: r.status };
}

export async function getVideoBundle(videoId: string) {
  const [video, analysis] = await Promise.all([getVideo(videoId), getAnalysis(videoId)]);
  return { video, analysis };
}
