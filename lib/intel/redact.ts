// AUGUST Market Intel — source privacy. Internally every brief item keeps full
// provenance (channel, video, segment timestamps) so the owner can audit any
// claim; nothing that leaves the app may. redactBrief strips attribution while
// keeping the tradecraft — tickers, theses, levels, transparent ranking — so a
// brief reads clean without exposing who was watched. Fields are DELETED (not
// blanked): the wire shape simply omits them, and every cite in the render path
// already gates on `videoId`, so a redacted brief renders with no source row.

import type { ConsensusItem, DailyBrief } from "./types";

// Attribution + evidence keys, dropped wherever they occur on an idea-like item
// (BriefIdea, OptionBriefIdea, IntelLevel, IntelCatalyst all carry a subset).
const SOURCE_KEYS = [
  "channelTitle",
  "videoTitle",
  "videoId",
  "sourceSegmentIds",
  "sourceStartSeconds",
  "sourceEndSeconds",
  "sourceChapterId",
  "chapter",
] as const;

// The cast is deliberate: the nominal types require these fields, but consumers
// of a redacted brief must never read them — the API's `ownerView` flag is the
// contract for whether attribution exists at all.
function omitSource<T>(item: T): T {
  const out = { ...(item as Record<string, unknown>) };
  for (const k of SOURCE_KEYS) delete out[k];
  return out as T;
}

// Consensus keeps its analytical value (how many sources, how explicit, whether
// they agree) — just not WHO said it or where.
function redactConsensus(c: ConsensusItem): ConsensusItem {
  return {
    ...c,
    sources: c.sources.map((s) => ({ explicitness: s.explicitness })),
  } as ConsensusItem;
}

/** Strip all source attribution from a brief. Never mutates the input. */
export function redactBrief(brief: DailyBrief): DailyBrief {
  const out: DailyBrief = {
    ...brief,
    topIdeas: brief.topIdeas.map(omitSource),
    creatorFavorites: brief.creatorFavorites.map(omitSource),
    consensus: brief.consensus.map(redactConsensus),
    levels: brief.levels.map(omitSource),
    catalysts: brief.catalysts.map(omitSource),
    sourceVideoIds: [],
  };
  if (brief.options) {
    out.options = {
      ...brief.options,
      bestCreatorPlays: brief.options.bestCreatorPlays.map(omitSource),
      augustCandidates: brief.options.augustCandidates.map(omitSource),
      directionalOnly: brief.options.directionalOnly.map(omitSource),
      consensus: brief.options.consensus.map(redactConsensus),
    };
  }
  return out;
}

/** Server-side owner flag — attribution is visible only when this is set. */
export function intelOwnerView(): boolean {
  return process.env.INTEL_OWNER_VIEW === "true";
}
