// Intel pipeline orchestrator — SERVER ONLY. Glues the providers + store together:
// add a source, process a transcript (fast pass → full pass), enrich with live quotes,
// and sync channels for new uploads. Idempotent on videoId (no duplicate processing).

import type { IntelSource, IntelVideo, OptionIdea, VideoAnalysis } from "./types";
import { ANALYSIS_VERSION } from "./types";
import { getQuote } from "@/lib/markets";
import { computeOptionMetrics, findContract, getOptionChain, quoteFromContract, spreadPct, type ChainResult } from "./options";
import { dte } from "./dates";
import {
  decideVideoMerge,
  getAnalysis,
  getSource,
  getTranscript,
  getVideo,
  listSources,
  listVideos,
  logIntel,
  mergeVideoTwins,
  normalizeVideoTitle,
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
    // Debris fix: an already-known video KEEPS its source. Re-adding a channel
    // video as a one-off must not retarget it to v_<id> (the old channel's
    // source:<id>:videos set is only ever SADDed, so retargeting stranded ids).
    sourceId: existing?.sourceId ?? sourceId,
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
  // Discovery-time dedup: a livestream and its VOD re-upload share a channel,
  // title, and ~publish window but have distinct ids — absorb such twins NOW
  // so they never persist (the richer record wins; see store.decideVideoMerge).
  return absorbSoftTwins(v);
}

/** Merge any soft-duplicate twins of `v` that already exist in the library.
 *  Returns the surviving record (which may be the pre-existing twin when it is
 *  the richer of the pair). Best-effort — a failure never blocks discovery. */
async function absorbSoftTwins(v: IntelVideo): Promise<IntelVideo> {
  if (!v.channelId) return v;
  try {
    let current = v;
    const key = normalizeVideoTitle(current.title);
    if (!key) return current;
    for (const other of await listVideos()) {
      const decision = decideVideoMerge(current, other);
      if (!decision) continue;
      current = await mergeVideoTwins(decision.keep, decision.absorb);
    }
    return current;
  } catch {
    return v;
  }
}

/** One-shot idempotent sweep over the whole library: group by channel +
 *  normalized title, merge every soft-duplicate pair. Runs at the start of
 *  every sync — a clean library makes it a read-only pass. */
export async function sweepVideoTwins(): Promise<number> {
  const all = await listVideos();
  const groups = new Map<string, IntelVideo[]>();
  for (const v of all) {
    if (!v.channelId) continue;
    const key = `${v.channelId}|${normalizeVideoTitle(v.title)}`;
    const g = groups.get(key);
    if (g) g.push(v);
    else groups.set(key, [v]);
  }
  let merges = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const absorbed = new Set<string>();
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        if (absorbed.has(g[i].videoId) || absorbed.has(g[j].videoId)) continue;
        const decision = decideVideoMerge(g[i], g[j]);
        if (!decision) continue;
        await mergeVideoTwins(decision.keep, decision.absorb);
        absorbed.add(decision.absorb.videoId);
        merges++;
      }
    }
  }
  if (merges) await logIntel("video_twin_sweep", { merged: merges });
  return merges;
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
  // Options enrichment is best-effort and isolated — if the (keyless, delayed)
  // provider is down or a symbol is unsupported, the creator-quoted idea is left
  // intact and only current/contract data is omitted.
  try {
    await enrichOptions(a, quotes);
  } catch {
    /* enrichment is additive; never let it fail the analysis */
  }
  return a;
}

const isoFromEpochSec = (sec: number): string => {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

// Pick the provider expiration that matches the creator's resolved date, else the
// nearest one (so a contract from a delayed chain can still be located).
function bestExpirationEpoch(expirations: number[], targetISO: string | null): number | null {
  if (!expirations.length) return null;
  if (!targetISO) return expirations[0];
  const exact = expirations.find((e) => isoFromEpochSec(e) === targetISO);
  if (exact) return exact;
  const tMs = Date.parse(`${targetISO}T12:00:00Z`);
  return expirations.reduce((best, e) => (Math.abs(e * 1000 - tMs) < Math.abs(best * 1000 - tMs) ? e : best), expirations[0]);
}

// Enrich each OptionIdea with delayed contract data + honest options-risk notes,
// kept SEPARATE from anything the creator said (quotedPremium is never overwritten).
async function enrichOptions(a: VideoAnalysis, underQuotes: Map<string, { price: number; chgPct: number } | null>): Promise<void> {
  if (!a.optionIdeas.length) return;
  const now = Date.now();
  // group ideas by symbol so we fetch each chain at most once per expiration
  const chainCache = new Map<string, ChainResult>();
  const getChain = async (sym: string, epoch?: number): Promise<ChainResult> => {
    const key = `${sym}:${epoch ?? "near"}`;
    const hit = chainCache.get(key);
    if (hit) return hit;
    const c = await getOptionChain(sym, epoch).catch(() => null);
    const res = c ?? { status: "provider_error" as const, delayed: true, quoteTimestamp: null, expirations: [], expiration: null, underlyingPrice: null, calls: [], puts: [] };
    chainCache.set(key, res);
    return res;
  };

  for (const o of a.optionIdeas) {
    const sym = o.underlyingSymbol;
    const under = underQuotes.get(sym) ?? (await getQuote(sym).then((q) => (q ? { price: q.price, chgPct: q.chgPct } : null)).catch(() => null));

    // status from the underlying move (we never have intraday option triggers). This is a
    // point-in-time lifecycle read against the creator's stated trigger/target/invalidation
    // — no fabricated levels, and only as granular as the creator's own numbers allow.
    if (under) {
      const dir = o.direction;
      const px = under.price;
      const tgt = o.underlyingTargets[0] ?? null;
      if (o.underlyingInvalidation !== null && (dir === "bearish" ? px > o.underlyingInvalidation : px < o.underlyingInvalidation)) {
        o.status = "invalidated";
      } else if (tgt !== null && (dir === "bearish" ? px <= tgt : px >= tgt)) {
        o.status = "target_reached";
      } else if (o.underlyingTrigger !== null) {
        const trig = o.underlyingTrigger;
        const hit = dir === "bearish" ? px <= trig : px >= trig;
        if (hit) {
          // ran well past the trigger (>2%) with no target left → too extended to enter fresh
          const past = dir === "bearish" ? (trig - px) / Math.max(1, trig) : (px - trig) / Math.max(1, trig);
          o.status = tgt === null && past > 0.02 ? "too_extended" : "triggered";
        } else {
          o.status = Math.abs(px - trig) / Math.max(1, trig) <= 0.01 ? "approaching_trigger" : "waiting_for_trigger";
        }
      }
    }

    // locate a contract only when the creator named a strike + we can resolve expiration
    const primary = o.legs[0];
    const legExp = o.legs.find((l) => l.expiration)?.expiration ?? null;
    const d = dte(legExp, now);
    // a contract whose resolved expiration is already past is expired (terminal truth)
    if (d !== null && d < 0) o.status = "expired";
    let liquidityNote: string | null = null;
    let volNote: string | null = null;

    if (primary && primary.strike !== null) {
      const near = await getChain(sym);
      const epoch = bestExpirationEpoch(near.expirations, legExp);
      const chain = epoch && epoch !== near.expiration ? await getChain(sym, epoch) : near;
      if (chain.status === "delayed" || chain.status === "connected") {
        const side = primary.optionType === "put" ? chain.puts : chain.calls;
        const match = side.reduce<typeof side[number] | null>((best, c) => {
          if (primary.strike === null) return best;
          const dCur = best ? Math.abs(best.strike - primary.strike) : Infinity;
          return Math.abs(c.strike - primary.strike) < dCur ? c : best;
        }, null);
        if (match && Math.abs(match.strike - primary.strike) <= Math.max(1, primary.strike * 0.02)) {
          o.contractQuote = quoteFromContract(match, chain.delayed, chain.quoteTimestamp);
          // stamp the located contract symbol back onto the leg (we did not invent it)
          if (primary.contractSymbol === null) primary.contractSymbol = match.contractSymbol || null;
          const sp = spreadPct(match);
          const oi = match.openInterest ?? 0;
          liquidityNote =
            oi >= 1000 && (sp ?? 1) < 0.1 ? `Liquid: OI ${oi}, spread ${sp !== null ? `${(sp * 100).toFixed(0)}%` : "n/a"}.`
            : oi < 100 ? `Thin: OI ${oi}${sp !== null ? `, spread ${(sp * 100).toFixed(0)}%` : ""} — slippage risk.`
            : `OI ${oi}${sp !== null ? `, spread ${(sp * 100).toFixed(0)}%` : ""}.`;
          if (match.impliedVolatility !== null) volNote = `IV ~${(match.impliedVolatility * 100).toFixed(0)}% (delayed).`;

          // Recompute metrics from the live mid ONLY when the creator gave no premium —
          // keep it transparent that this uses current delayed pricing, not creator's.
          if (o.quotedPremium === null && match.mid !== null && o.breakevens.length === 0 && o.maxLoss === null) {
            const priced = o.legs.map((l) => ({ ...l, premium: l === primary ? match.mid : null }));
            const m = computeOptionMetrics(o.strategyType, priced);
            if (m.breakevens.length || m.maxLoss !== null) {
              o.breakevens = m.breakevens;
              o.maxProfit = m.maxProfit;
              o.maxLoss = m.maxLoss;
              o.riskRewardRatio = m.riskRewardRatio;
              o.risks = [...o.risks, "Breakeven/max-loss computed from current delayed market premium (creator did not state one)."];
            }
          }
        }
      }
    }

    // honest options-risk notes (only what we can actually support)
    o.optionsRisk = {
      liquidity: liquidityNote,
      thetaDecay: d !== null ? (d <= 2 ? `~${d}DTE — severe time decay; small underlying moves dominate.` : d <= 10 ? `~${d}DTE — meaningful theta into expiration.` : `~${d}DTE.`) : null,
      volatility: volNote,
      earnings: null, // not checked against an earnings calendar here — left null rather than guessed
      assignment: o.legs.some((l) => l.action === "sell") ? "Short leg carries early-assignment risk near/at the money or before ex-dividend." : null,
      staleness: o.contractQuote?.delayed ? "Contract quote is delayed (not live)." : null,
    };
  }
}

// --- process a video using a supplied (manual) transcript -----------------
export type ProcessResult =
  | { ok: true; analysis: VideoAnalysis; preliminary?: VideoAnalysis }
  | { ok: false; error: string };

/** How long an "analyzing" row locks out concurrent runs. Past this window a
 *  crashed run's stale lock is ignored rather than wedging the video forever. */
export const ANALYZING_LOCK_MS = 10 * 60_000;

/** PURE: is this video currently locked by an in-flight analysis run?
 *  Concurrent full_pass completions used to blob-overwrite each other
 *  (last-writer-wins), letting a truncated late finisher clobber a richer
 *  earlier result. */
export function isProcessingLocked(v: Pick<IntelVideo, "status" | "updated">, now = Date.now()): boolean {
  return v.status === "analyzing" && now - v.updated < ANALYZING_LOCK_MS;
}

/** PURE: a candidate analysis is strictly poorer than the stored one only when
 *  BOTH counts shrink — that is the truncation signature. Fewer ideas but more
 *  levels (or vice versa) is a legitimate re-extraction and may overwrite. */
export function isStrictlyPoorer(
  next: { ideas: number; levels: number },
  prev: { ideas: number; levels: number },
): boolean {
  return next.ideas < prev.ideas && next.levels < prev.levels;
}

/** PURE: the honest video-row patch when a processing run produced no usable
 *  analysis. With a surviving full analysis the row stays "analyzed" (the good
 *  data is still there) but carries the failure; otherwise the row is failed. */
export function failureRowPatch(
  reason: string | null,
  hadPriorFull: boolean,
): { status: IntelVideo["status"]; error: string } {
  const detail = reason ?? "Extraction produced no analysis.";
  return hadPriorFull
    ? { status: "analyzed", error: `Reprocess failed — kept the existing analysis. (${detail})` }
    : { status: "failed", error: detail };
}

export async function processManualTranscript(
  videoId: string,
  rawTranscript: string,
  procOpts?: { force?: boolean },
): Promise<ProcessResult> {
  if (!intelligenceConfigured()) return { ok: false, error: "ai_unconfigured" };
  let video = await getVideo(videoId);
  if (!video) {
    video = await upsertVideoFromMeta(`v_${videoId}`, videoId);
    if (!video) return { ok: false, error: "video_not_found" };
  }
  if (!procOpts?.force && isProcessingLocked(video)) {
    await logIntel("process_skipped_concurrent", { videoId });
    return { ok: false, error: "already_processing" };
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

  // Overwrite guard baseline: the FULL analysis that existed before this run.
  // A rerun may improve on it; a strictly-poorer (truncation-shaped) result
  // must never clobber it unless explicitly forced.
  const prior = await getAnalysis(videoId);
  const priorFull = prior && prior.pass === "full" ? prior : null;
  const guardedPoorer = (a: VideoAnalysis): boolean =>
    !procOpts?.force &&
    !!priorFull &&
    isStrictlyPoorer(
      { ideas: a.tradeIdeas.length, levels: a.levels.length },
      { ideas: priorFull.tradeIdeas.length, levels: priorFull.levels.length },
    );

  const stampRow = (a: VideoAnalysis, status: IntelVideo["status"]) => {
    video!.status = status;
    video!.summary = a.overallSummary || video!.summary;
    video!.ideaCount = a.tradeIdeas.length;
    video!.optionCount = a.optionIdeas.length;
    video!.levelCount = a.levels.length;
    video!.tickers = [...new Set(a.tradeIdeas.map((t) => t.ticker))];
    video!.analysisVersion = ANALYSIS_VERSION;
    video!.marketDate = opts.marketDate;
    video!.error = undefined; // a successful save clears any stale failure
  };

  // Fast pass (priority chapters) — publish a preliminary brief immediately.
  let preliminary: VideoAnalysis | undefined;
  try {
    const fp = await analyzeFastPass(segments, chapters, opts);
    if (fp) {
      const enrichedFp = await enrich(fp);
      if (guardedPoorer(enrichedFp)) {
        await logIntel("analysis_overwrite_skipped", {
          videoId, pass: "preliminary",
          next: { ideas: enrichedFp.tradeIdeas.length, levels: enrichedFp.levels.length },
          prev: { ideas: priorFull!.tradeIdeas.length, levels: priorFull!.levels.length },
        });
      } else {
        preliminary = enrichedFp;
        await saveAnalysis(videoId, preliminary);
        stampRow(preliminary, "preliminary");
        await saveVideo(video);
        await logIntel("fast_pass", { videoId, ideas: preliminary.tradeIdeas.length });
      }
    }
  } catch (e) {
    await logIntel("fast_pass_error", { videoId, error: e instanceof Error ? e.message : String(e) });
  }

  // Full pass — entire transcript for context/contradictions.
  let fullErr: string | null = null;
  try {
    const full = await analyzeFullPass(segments, chapters, opts);
    if (full) {
      const enriched = await enrich(full);
      if (guardedPoorer(enriched)) {
        // The stored analysis is strictly richer — keep it, say so, stay honest.
        await logIntel("analysis_overwrite_skipped", {
          videoId, pass: "full",
          next: { ideas: enriched.tradeIdeas.length, levels: enriched.levels.length },
          prev: { ideas: priorFull!.tradeIdeas.length, levels: priorFull!.levels.length },
        });
        stampRow(priorFull!, "analyzed");
        await saveVideo(video);
        return { ok: true, analysis: priorFull!, preliminary };
      }
      await saveAnalysis(videoId, enriched);
      stampRow(enriched, "analyzed");
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
    fullErr = e instanceof Error ? e.message : String(e);
    await logIntel("full_pass_error", { videoId, error: fullErr });
  }

  if (preliminary) return { ok: true, analysis: preliminary, preliminary };
  // No usable analysis came out of this run: record the honest outcome — the
  // real reason on the row, "failed" status unless a prior full analysis
  // survives (then the row stays analyzed but carries the failure note).
  const patch = failureRowPatch(fullErr, !!priorFull);
  video.status = patch.status;
  video.error = patch.error;
  await saveVideo(video);
  return { ok: false, error: "extraction_failed" };
}

/** Re-run extraction from the stored transcript (e.g. after a version bump). */
export async function reprocessVideo(videoId: string, procOpts?: { force?: boolean }): Promise<ProcessResult> {
  const segs = await getTranscript(videoId);
  if (!segs?.length) return { ok: false, error: "no_transcript" };
  // Rebuild the raw text from segments so processManualTranscript can re-run uniformly.
  const raw = segs.map((s) => `${Math.floor(s.startSeconds / 60)}:${String(Math.floor(s.startSeconds % 60)).padStart(2, "0")} ${s.text}`).join("\n");
  return processManualTranscript(videoId, raw, procOpts);
}

// --- row repair (one-shot, idempotent, derived ONLY from surviving blobs) --

export type RowRepair =
  | { kind: "recount"; patch: Pick<IntelVideo, "ideaCount" | "optionCount" | "levelCount"> }
  | { kind: "failed_extraction"; error: string };

/** PURE repair decision for one video row against its stored analysis blob.
 *  Two damage shapes the truncation-era pipeline left behind:
 *    - a row stamped analyzed whose blob is the total-failure signature (no
 *      summary, no claims/ideas/levels/catalysts — a real model reply always
 *      carries a summary) → the honest state is "failed";
 *    - row counts drifting from the blob (concurrent overwrites) → recount.
 *  Derives ONLY from the blob; a missing blob repairs nothing (never fabricate). */
export function deriveRowRepair(video: IntelVideo, analysis: VideoAnalysis | null): RowRepair | null {
  if (video.status !== "analyzed" && video.status !== "preliminary") return null;
  if (!analysis) return null;
  const ideas = analysis.tradeIdeas?.length ?? 0;
  const levels = analysis.levels?.length ?? 0;
  const options = analysis.optionIdeas?.length ?? 0;
  const claims = analysis.claims?.length ?? 0;
  const catalysts = analysis.catalysts?.length ?? 0;
  const totalFailure = !analysis.overallSummary && ideas === 0 && levels === 0 && options === 0 && claims === 0 && catalysts === 0;
  if (totalFailure) {
    return {
      kind: "failed_extraction",
      error: "AI extraction failed — every extraction call returned nothing (row was wrongly stamped analyzed). Reprocess to retry.",
    };
  }
  if (video.ideaCount !== ideas || video.levelCount !== levels || (video.optionCount ?? 0) !== options) {
    return { kind: "recount", patch: { ideaCount: ideas, optionCount: options, levelCount: levels } };
  }
  return null;
}

/** Idempotent sweep applying deriveRowRepair across the library. Runs from the
 *  same hygiene path as the twin sweep; a clean library is a read-only pass. */
export async function repairAnalysisRows(): Promise<number> {
  let repaired = 0;
  for (const v of await listVideos()) {
    if (v.status !== "analyzed" && v.status !== "preliminary") continue;
    const a = await getAnalysis(v.videoId);
    const r = deriveRowRepair(v, a);
    if (!r) continue;
    if (r.kind === "failed_extraction") {
      v.status = "failed";
      v.error = r.error;
      v.ideaCount = 0;
      v.optionCount = 0;
      v.levelCount = 0;
    } else {
      Object.assign(v, r.patch);
    }
    await saveVideo(v);
    await logIntel("analysis_row_repaired", { videoId: v.videoId, kind: r.kind });
    repaired++;
  }
  if (repaired) await logIntel("analysis_row_repair_sweep", { repaired });
  return repaired;
}

// --- sync channels for new uploads (needs YOUTUBE_API_KEY) ----------------
export type SyncResult = { checked: number; discovered: number; details: string[] };

export async function syncSources(): Promise<SyncResult> {
  // Idempotent hygiene pass first: merge any livestream/VOD twins already in
  // the library so discovery below starts from a clean slate, then repair any
  // analysis rows whose counts/status drifted from their stored blobs.
  try {
    await sweepVideoTwins();
    await repairAnalysisRows();
  } catch {
    /* best-effort — sync must not fail on hygiene */
  }
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
