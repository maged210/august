// Daily brief — cross-video synthesis. SERVER ONLY. Ranks ideas with a TRANSPARENT,
// shown scoring (no black-box "AI score"), detects consensus/conflict across channels,
// and writes the narrative sections with the direct Anthropic SDK GROUNDED ONLY in the
// structured items (never inventing new tickers/levels). Falls back to a structured,
// non-narrative brief when the model key is absent.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, USER_NAME } from "@/lib/persona";
import type {
  BriefIdea,
  ConsensusItem,
  DailyBrief,
  IntelCatalyst,
  IntelLevel,
  IntelSettings,
  IntelVideo,
  OptionBriefIdea,
  OptionIdea,
  OptionsProviderStatus,
  RankFactor,
  TradeIdea,
  VideoAnalysis,
} from "./types";
import { getAnalysis, getSettings, listVideos, saveBrief } from "./store";
import { etDateKey, marketSession } from "./session";
import { rankOption } from "./options-rank";
import { generateCandidates, type CandidateThesis } from "./candidates";
import { getOptionChain } from "./options";

const MODEL = "claude-sonnet-4-6";

function rank(idea: TradeIdea, sourcesForTicker: number, newest: number, publishedAt: number): { score: number; factors: RankFactor[] } {
  const factors: RankFactor[] = [];
  let score = 0;
  const add = (factor: string, weight: number, note: string) => {
    score += weight;
    factors.push({ factor, weight, note });
  };
  add("multi-source", Math.min(sourcesForTicker - 1, 2) * 1.5, `${sourcesForTicker} source(s) mention ${idea.ticker}`);
  add("explicitness", idea.explicitness === "explicit" ? 2 : 0, idea.explicitness);
  add("specificity", (idea.entry.value !== null ? 1 : 0) + (idea.invalidation.value !== null ? 1 : 0), "entry/invalidation given");
  add("catalyst", idea.catalysts.length ? 1 : 0, idea.catalysts.length ? "has catalyst" : "no catalyst");
  add("creator-favorite", idea.creatorDesignation.isFavoriteSetup ? 2 : 0, idea.creatorDesignation.isFavoriteSetup ? "designated favorite" : "—");
  const recencyBonus = newest > 0 ? (publishedAt / newest) * 1 : 0;
  add("recency", Number(recencyBonus.toFixed(2)), "newer commentary weighted higher");
  add("confidence", Math.min(idea.confidence, 1) * 1.5, `model confidence ${idea.confidence.toFixed(2)} (NOT a profit estimate)`);
  if (idea.enriched?.invalidated) add("invalidated", -3, "price has crossed invalidation");
  return { score: Number(score.toFixed(2)), factors };
}

function buildConsensus(all: { idea: TradeIdea; channelTitle: string; videoId: string }[]): ConsensusItem[] {
  const byTicker = new Map<string, typeof all>();
  for (const a of all) {
    const arr = byTicker.get(a.idea.ticker) ?? [];
    arr.push(a);
    byTicker.set(a.idea.ticker, arr);
  }
  const out: ConsensusItem[] = [];
  for (const [ticker, items] of byTicker) {
    const channels = new Set(items.map((i) => i.channelTitle));
    const dirs = new Set(items.map((i) => i.idea.direction).filter((d) => d === "bullish" || d === "bearish"));
    const agreement: ConsensusItem["agreement"] = channels.size < 2 ? "single" : dirs.size > 1 ? "conflict" : "agree";
    out.push({
      ticker,
      direction: items[0].idea.direction,
      sources: items.map((i) => ({ channelTitle: i.channelTitle, videoId: i.videoId, startSeconds: i.idea.sourceStartSeconds, explicitness: i.idea.explicitness })),
      agreement,
      note:
        agreement === "conflict"
          ? "Sources disagree on direction — not combined into one call."
          : agreement === "agree"
            ? "Multiple sources align."
            : "Single source.",
    });
  }
  // multi-source + conflicts first
  return out.sort((a, b) => (b.sources.length - a.sources.length) || (a.agreement === "conflict" ? -1 : 1));
}

async function narrate(brief: Omit<DailyBrief, "posture" | "whatChanged" | "whatMattersTomorrow" | "read60" | "bullCase" | "bearCase" | "watchAtOpen" | "invalidation" | "grounded">): Promise<Partial<DailyBrief>> {
  const key = process.env.ANTHROPIC_API_KEY;
  // Model input is anonymized: channel/video names never go in (source COUNTS only),
  // so the generated free text can't leak attribution into redacted briefs.
  const struct = {
    topIdeas: brief.topIdeas.slice(0, 10).map((i) => ({ ticker: i.ticker, direction: i.direction, horizon: i.timeHorizon, thesis: i.thesis, entry: i.entry.text, invalidation: i.invalidation.text, favorite: i.creatorDesignation.isFavoriteSetup })),
    consensus: brief.consensus.slice(0, 12).map((c) => ({ ticker: c.ticker, agreement: c.agreement, sourceCount: c.sources.length })),
    levels: brief.levels.slice(0, 16).map((l) => ({ instrument: l.instrument, level: l.level ?? l.levelText, type: l.type })),
    catalysts: brief.catalysts.slice(0, 16).map((c) => ({ name: c.name, when: c.eventTime, importance: c.importance })),
    risks: brief.risks.slice(0, 10),
  };
  if (!key) {
    return {
      posture: "AI narrative offline — structured intelligence only.",
      read60: `${brief.topIdeas.length} ideas, ${brief.consensus.length} tickers across sources. Review the cards below.`,
      whatChanged: "",
      whatMattersTomorrow: "",
      bullCase: "",
      bearCase: "",
      watchAtOpen: "",
      invalidation: "",
      grounded: false,
    };
  }
  const tool = {
    name: "write_brief",
    description: "Write the briefing narrative grounded ONLY in the structured items provided.",
    input_schema: {
      type: "object" as const,
      properties: {
        posture: { type: "string" }, whatChanged: { type: "string" }, whatMattersTomorrow: { type: "string" },
        read60: { type: "string", description: "A 2-3 sentence executive summary." },
        bullCase: { type: "string" }, bearCase: { type: "string" }, watchAtOpen: { type: "string" }, invalidation: { type: "string" },
      },
      required: ["posture", "read60", "whatChanged", "whatMattersTomorrow", "bullCase", "bearCase", "watchAtOpen", "invalidation"],
    },
  };
  try {
    const c = new Anthropic({ apiKey: key });
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT + `\n\nYou are writing a market-prep briefing for ${USER_NAME} from creators' video analysis. Ground EVERY statement in the structured items below — do not introduce a ticker, level, or catalyst not present. Never name a specific channel, creator, or video — refer to sources only generically ("one source", "3 sources agree"). Where sources conflict, say so; never merge contradictory calls. This is decision-support, not financial advice.`,
      messages: [{ role: "user", content: `Structured intelligence for ${brief.date}:\n${JSON.stringify(struct, null, 2)}\n\nCall write_brief.` }],
      tools: [tool],
      tool_choice: { type: "tool", name: "write_brief" },
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (block && block.type === "tool_use") return { ...(block.input as Partial<DailyBrief>), grounded: true };
  } catch (e) {
    console.error("[intel.brief] narrate failed:", e instanceof Error ? e.message : e);
  }
  return { posture: "", read60: "", grounded: false };
}

// --- options brief section (additive) -------------------------------------
type FlatOption = { idea: OptionIdea; channelTitle: string; videoTitle: string };

function promote(f: FlatOption, sourcesForSymbol: number, newest: number, publishedAt: number): OptionBriefIdea {
  const r = rankOption(f.idea, { sourcesForSymbol, newest, publishedAt });
  return { ...f.idea, channelTitle: f.channelTitle, videoTitle: f.videoTitle, rankScore: r.score, rankFactors: r.factors };
}

async function buildOptions(
  analyses: VideoAnalysis[],
  vById: Map<string, IntelVideo>,
  settings: IntelSettings,
  newest: number,
): Promise<DailyBrief["options"] | undefined> {
  const flat: FlatOption[] = [];
  for (const a of analyses) {
    const v = vById.get(a.videoId);
    for (const idea of a.optionIdeas ?? []) flat.push({ idea, channelTitle: v?.channelTitle ?? "unknown", videoTitle: v?.title ?? "" });
  }
  if (!flat.length) return undefined;

  const sourcesPerSym = new Map<string, Set<string>>();
  for (const f of flat) {
    const set = sourcesPerSym.get(f.idea.underlyingSymbol) ?? new Set();
    set.add(f.channelTitle);
    sourcesPerSym.set(f.idea.underlyingSymbol, set);
  }
  const pubOf = (videoId?: string) => (videoId ? vById.get(videoId)?.publishedAt ?? 0 : 0);
  const rankAll = (items: FlatOption[]) =>
    items
      .map((f) => promote(f, sourcesPerSym.get(f.idea.underlyingSymbol)?.size ?? 1, newest, pubOf(f.idea.videoId)))
      .sort((a, b) => b.rankScore - a.rankScore);

  const bestCreatorPlays = rankAll(flat.filter((f) => f.idea.origin === "creator_explicit"));
  const directionalOnly = rankAll(flat.filter((f) => f.idea.origin === "directional_only"));

  // Probe the provider once (keyless Yahoo is reachable but DELAYED → honest status).
  let providerStatus: OptionsProviderStatus = "missing_configuration";
  const probeSym = flat[0]?.idea.underlyingSymbol ?? "SPY";
  try {
    providerStatus = (await getOptionChain(probeSym)).status;
  } catch {
    providerStatus = "provider_error";
  }

  // AUGUST candidates: only when the provider returns usable data. Bounded to a few
  // top directional theses so the brief (and cron) stay responsive.
  const augustCandidates: OptionBriefIdea[] = [];
  if (providerStatus === "delayed" || providerStatus === "connected") {
    const thesisSources = [...directionalOnly, ...bestCreatorPlays.filter((p) => !p.creatorSpecifiedContract)]
      .filter((p) => p.direction === "bullish" || p.direction === "bearish")
      .slice(0, 4);
    for (const p of thesisSources) {
      const t: CandidateThesis = {
        underlyingSymbol: p.underlyingSymbol,
        direction: p.direction,
        timeHorizon: p.timeHorizon,
        catalysts: p.catalysts,
        underlyingTrigger: p.underlyingTrigger,
        underlyingInvalidation: p.underlyingInvalidation,
        underlyingTargets: p.underlyingTargets,
        sourceChapterId: p.sourceChapterId,
        sourceSegmentIds: p.sourceSegmentIds,
        sourceStartSeconds: p.sourceStartSeconds,
        sourceEndSeconds: p.sourceEndSeconds,
        videoId: p.videoId,
      };
      try {
        const res = await generateCandidates(t, settings.options);
        for (const c of res.candidates) {
          const r = rankOption(c, { sourcesForSymbol: sourcesPerSym.get(c.underlyingSymbol)?.size ?? 1, newest, publishedAt: pubOf(c.videoId) });
          augustCandidates.push({ ...c, channelTitle: p.channelTitle, videoTitle: p.videoTitle, rankScore: r.score, rankFactors: r.factors });
        }
      } catch {
        /* candidate generation is best-effort */
      }
    }
    augustCandidates.sort((a, b) => b.rankScore - a.rankScore);
  }

  const optionsRisk = [...new Set(flat.flatMap((f) => f.idea.risks))].slice(0, 12);

  // Cross-channel consensus on option underlyings (parallel to the trade-idea consensus):
  // do multiple channels agree on a direction for the same symbol, or conflict?
  const toDir = (d: OptionIdea["direction"]): ConsensusItem["direction"] =>
    d === "bullish" || d === "bearish" || d === "neutral" || d === "watch" ? d : "neutral";
  const bySym = new Map<string, FlatOption[]>();
  for (const f of flat) {
    const arr = bySym.get(f.idea.underlyingSymbol) ?? [];
    arr.push(f);
    bySym.set(f.idea.underlyingSymbol, arr);
  }
  const consensus: ConsensusItem[] = [];
  for (const [symbol, items] of bySym) {
    const channels = new Set(items.map((i) => i.channelTitle));
    const dirs = new Set(items.map((i) => i.idea.direction).filter((d) => d === "bullish" || d === "bearish"));
    const agreement: ConsensusItem["agreement"] = channels.size < 2 ? "single" : dirs.size > 1 ? "conflict" : "agree";
    consensus.push({
      ticker: symbol,
      direction: toDir(items[0].idea.direction),
      sources: items.map((i) => ({ channelTitle: i.channelTitle, videoId: i.idea.videoId ?? "", startSeconds: i.idea.sourceStartSeconds, explicitness: i.idea.explicitness })),
      agreement,
      note: agreement === "conflict" ? "Sources disagree on options direction — not combined." : agreement === "agree" ? "Multiple sources align on this underlying." : "Single source.",
    });
  }
  consensus.sort((a, b) => b.sources.length - a.sources.length || (a.agreement === "conflict" ? -1 : 1));

  return { bestCreatorPlays, augustCandidates, directionalOnly, optionsRisk, providerStatus, consensus };
}

/** Generate (and store) the dated brief from all analyses for that market date. */
export async function generateBrief(date = etDateKey()): Promise<DailyBrief> {
  const videos = (await listVideos()).filter((v) => v.status === "analyzed" || v.status === "preliminary");
  const relevant = videos.filter((v) => (v.marketDate ?? etDateKey(new Date(v.publishedAt))) === date);
  const pool = relevant.length ? relevant : videos.slice(0, 8); // fall back to most recent if none match today

  const analyses = (await Promise.all(pool.map((v) => getAnalysis(v.videoId)))).filter(Boolean) as VideoAnalysis[];
  const vById = new Map<string, IntelVideo>(pool.map((v) => [v.videoId, v]));

  const flatIdeas: { idea: TradeIdea; channelTitle: string; videoId: string; videoTitle: string }[] = [];
  const levels: IntelLevel[] = [];
  const catalysts: IntelCatalyst[] = [];
  const risks: string[] = [];
  let newest = 0;
  for (const a of analyses) {
    const v = vById.get(a.videoId);
    newest = Math.max(newest, v?.publishedAt ?? 0);
    for (const idea of a.tradeIdeas) flatIdeas.push({ idea, channelTitle: v?.channelTitle ?? "unknown", videoId: a.videoId, videoTitle: v?.title ?? "" });
    levels.push(...a.levels);
    catalysts.push(...a.catalysts);
    risks.push(...a.risks);
  }

  const sourcesPerTicker = new Map<string, Set<string>>();
  for (const f of flatIdeas) {
    const set = sourcesPerTicker.get(f.idea.ticker) ?? new Set();
    set.add(f.channelTitle);
    sourcesPerTicker.set(f.idea.ticker, set);
  }

  const ranked: BriefIdea[] = flatIdeas
    .map((f) => {
      const v = vById.get(f.videoId);
      const r = rank(f.idea, sourcesPerTicker.get(f.idea.ticker)?.size ?? 1, newest, v?.publishedAt ?? 0);
      return { ...f.idea, channelTitle: f.channelTitle, videoId: f.videoId, videoTitle: f.videoTitle, rankScore: r.score, rankFactors: r.factors };
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  const consensus = buildConsensus(flatIdeas);
  const creatorFavorites = ranked.filter((i) => i.creatorDesignation.isFavoriteSetup);

  const settings = await getSettings();
  const options = await buildOptions(analyses, vById, settings, newest).catch(() => undefined);

  const partial = {
    date,
    generatedAt: Date.now(),
    marketSession: marketSession(),
    topIdeas: ranked.slice(0, 12),
    creatorFavorites,
    consensus,
    levels,
    catalysts,
    risks: [...new Set(risks)].slice(0, 12),
    sourceVideoIds: pool.map((v) => v.videoId),
    ...(options ? { options } : {}),
  };
  const narrative = await narrate(partial as Parameters<typeof narrate>[0]);

  const brief: DailyBrief = {
    ...partial,
    posture: narrative.posture ?? "",
    whatChanged: narrative.whatChanged ?? "",
    whatMattersTomorrow: narrative.whatMattersTomorrow ?? "",
    read60: narrative.read60 ?? "",
    bullCase: narrative.bullCase ?? "",
    bearCase: narrative.bearCase ?? "",
    watchAtOpen: narrative.watchAtOpen ?? "",
    invalidation: narrative.invalidation ?? "",
    grounded: !!narrative.grounded,
  };
  await saveBrief(brief);
  return brief;
}

/** Markdown export for a brief. Attribution renders only when present — the
 * export route always passes a redacted brief (see lib/intel/redact.ts), so
 * these channel mentions are effectively owner-side formatting only. */
export function briefToMarkdown(b: DailyBrief): string {
  const L: string[] = [];
  L.push(`# AUGUST Market Intel — ${b.date}`, "");
  if (b.read60) L.push(`> ${b.read60}`, "");
  if (b.posture) L.push(`**Posture:** ${b.posture}`, "");
  if (b.whatChanged) L.push(`**What changed:** ${b.whatChanged}`, "");
  if (b.whatMattersTomorrow) L.push(`**Tomorrow:** ${b.whatMattersTomorrow}`, "");
  if (b.bullCase) L.push(`**Bull case:** ${b.bullCase}`);
  if (b.bearCase) L.push(`**Bear case:** ${b.bearCase}`, "");
  if (b.creatorFavorites.length) {
    L.push("## Creator Favorites");
    for (const i of b.creatorFavorites) L.push(`- **${i.ticker}** (${i.direction}${i.channelTitle ? `, ${i.channelTitle}` : ""}) — ${i.thesis} | entry: ${i.entry.text} | invalidation: ${i.invalidation.text}`);
    L.push("");
  }
  L.push("## Top Ideas");
  for (const i of b.topIdeas) L.push(`- **${i.ticker}** ${i.direction} [${i.timeHorizon}] (${i.channelTitle ? `${i.channelTitle}, ` : ""}score ${i.rankScore}) — ${i.thesis}`);
  if (b.options && (b.options.bestCreatorPlays.length || b.options.augustCandidates.length || b.options.directionalOnly.length)) {
    const o = b.options;
    const legStr = (i: { legs: { action: string; optionType: string; strike: number | null; expiration: string | null }[] }) =>
      i.legs.map((l) => `${l.action} ${l.strike ?? "?"}${l.optionType[0].toUpperCase()}${l.expiration ? ` ${l.expiration}` : ""}`).join(" / ") || "no contract specified";
    L.push("", "## Tonight's Options Brief", `_Options provider: ${o.providerStatus} (delayed, no Greeks). Scores reflect fit + data quality, not expected profit._`);
    if (o.bestCreatorPlays.length) {
      L.push("", "### Creator Options Plays");
      for (const i of o.bestCreatorPlays) L.push(`- **${i.underlyingSymbol}** ${i.strategyType} (${i.channelTitle ? `${i.channelTitle}, ` : ""}score ${i.rankScore}) — ${legStr(i)}${i.quotedPremium !== null ? ` | creator premium ${i.quotedPremium}` : ""}`);
    }
    if (o.augustCandidates.length) {
      L.push("", "### AUGUST Options Candidates _(AUGUST-generated — not creator recommendations, not advice)_");
      for (const i of o.augustCandidates) L.push(`- **${i.underlyingSymbol}** ${i.strategyType} (score ${i.rankScore}) — ${legStr(i)}${i.maxLoss !== null ? ` | max loss ~$${i.maxLoss}` : ""}`);
    }
    if (o.directionalOnly.length) {
      L.push("", "### Directional Setups Without a Contract");
      for (const i of o.directionalOnly) L.push(`- **${i.underlyingSymbol}** ${i.direction}${i.channelTitle ? ` (${i.channelTitle})` : ""} — directional thesis; exact options contract not specified.`);
    }
  }
  L.push("", "## Levels");
  for (const l of b.levels) L.push(`- ${l.instrument}: ${l.level ?? l.levelText} (${l.type})`);
  L.push("", "## Catalysts");
  for (const c of b.catalysts) L.push(`- ${c.name}${c.eventTime ? ` @ ${c.eventTime}` : ""} (${c.importance})`);
  L.push("", `_Generated ${new Date(b.generatedAt).toISOString()} — decision-support, not financial advice._`);
  return L.join("\n");
}
