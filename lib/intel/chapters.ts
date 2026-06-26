// Chapter detection + normalization + channel templates. Chapters drive the
// chapter-FIRST processing: high-priority segments ("Favorite Setups & Predictions")
// are extracted before the rest. We store BOTH the creator's original title and our
// normalized category, and we NEVER claim a chapter is creator-defined when AUGUST
// inferred it from transcript cues.

import type { Chapter, ChapterCategory, ChapterPriority, TranscriptSegment } from "./types";

type Rule = { re: RegExp; category: ChapterCategory; priority: ChapterPriority };

// Order matters — first match wins. High-priority "actionable" segments first.
const RULES: Rule[] = [
  { re: /\b(favou?rite setups?|best setups?|top setups?|top plays?|tomorrow'?s? (plays|setups?|game ?plan)|game ?plan|trade ideas?)\b/i, category: "favorite_setups", priority: "high" },
  { re: /\b(predictions?|my call|market predictions?)\b/i, category: "predictions", priority: "high" },
  { re: /\b(watch ?list|stocks? to watch|stocks? i'?m watching|on watch)\b/i, category: "watchlist", priority: "high" },
  { re: /\b(options? flow|unusual options?|flow)\b/i, category: "options_flow", priority: "medium" },
  { re: /\b(earnings)\b/i, category: "earnings", priority: "medium" },
  { re: /\b(econ(omic)?( calendar| data)?|cpi|ppi|jobs|nfp|fomc|fed|powell)\b/i, category: "economic_calendar", priority: "medium" },
  { re: /\b(technical|charts?|key levels?|levels?|support|resistance)\b/i, category: "technical_analysis", priority: "medium" },
  { re: /\b(macro|overnight|headlines?|news)\b/i, category: "macro_news", priority: "medium" },
  { re: /\b(outlook|what to expect|market outlook|the plan)\b/i, category: "market_outlook", priority: "medium" },
  { re: /\b(recap|today'?s? action|wrap[- ]?up|market recap)\b/i, category: "market_recap", priority: "low" },
  { re: /\b(risk management|position sizing)\b/i, category: "risk_management", priority: "medium" },
  { re: /\b(sponsor|promo(tion)?|brought to you|use code|ad break|advertisement)\b/i, category: "advertisement", priority: "low" },
  { re: /\b(closing|final thoughts?|conclusion|sign off)\b/i, category: "closing_comments", priority: "low" },
  { re: /\b(intro(duction)?|welcome|good (morning|evening))\b/i, category: "unrelated", priority: "low" },
];

export function normalizeChapterTitle(title: string): { category: ChapterCategory; priority: ChapterPriority } {
  for (const r of RULES) if (r.re.test(title)) return { category: r.category, priority: r.priority };
  return { category: "unrelated", priority: "low" };
}

export const HIGH_PRIORITY_CATEGORIES: ChapterCategory[] = ["favorite_setups", "predictions", "watchlist"];
export function isHighPriority(c: ChapterCategory): boolean {
  return HIGH_PRIORITY_CATEGORIES.includes(c);
}

// --- channel templates (learned recurring structure) ----------------------
export type ChannelTemplate = {
  id: string;
  channelMatch: RegExp; // matches channel title
  highPriority: string[];
  frequentInstruments?: string[];
};

export const CHANNEL_TEMPLATES: ChannelTemplate[] = [
  {
    id: "stockedup",
    channelMatch: /stocked ?up/i,
    highPriority: ["Favorite Setups & Predictions", "Favorite Setups", "Predictions", "Stocks to Watch", "Tomorrow's Game Plan"],
    frequentInstruments: ["SPY", "QQQ", "NQ", "ES"],
  },
];

export function templateForChannel(title?: string): ChannelTemplate | undefined {
  if (!title) return undefined;
  return CHANNEL_TEMPLATES.find((t) => t.channelMatch.test(title));
}

// --- build chapters from creator metadata ---------------------------------
export function chaptersFromDescription(
  desc: { title: string; startSeconds: number }[],
  totalSeconds: number,
): Chapter[] {
  const sorted = [...desc].sort((a, b) => a.startSeconds - b.startSeconds);
  return sorted.map((c, i) => {
    const { category, priority } = normalizeChapterTitle(c.title);
    return {
      title: c.title,
      normalizedCategory: category,
      startSeconds: c.startSeconds,
      endSeconds: i < sorted.length - 1 ? sorted[i + 1].startSeconds : totalSeconds || c.startSeconds + 600,
      order: i,
      priority,
      detection: "description",
      detectionConfidence: 0.9,
      creatorDefined: true,
    };
  });
}

// --- infer chapters from verbal cues (NO creator metadata) ----------------
const CUES: { re: RegExp; category: ChapterCategory; priority: ChapterPriority }[] = [
  { re: /\b(my favou?rite setups?|favou?rite setups?|here are my (favou?rite )?setups?)\b/i, category: "favorite_setups", priority: "high" },
  { re: /\b(my top plays?|top setups? for|tomorrow'?s? game ?plan)\b/i, category: "favorite_setups", priority: "high" },
  { re: /\b(my predictions?|here are my predictions?|i'?m predicting)\b/i, category: "predictions", priority: "high" },
  { re: /\b(stocks? i'?m watching( tomorrow)?|my watch ?list|on my watch ?list)\b/i, category: "watchlist", priority: "high" },
];

export function inferChaptersFromTranscript(segments: TranscriptSegment[]): Chapter[] {
  const found: Chapter[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    for (const cue of CUES) {
      if (cue.re.test(s.text)) {
        found.push({
          title: `AUGUST-detected: ${cue.category.replace("_", " ")}`,
          normalizedCategory: cue.category,
          startSeconds: s.startSeconds,
          endSeconds: segments[Math.min(i + 12, segments.length - 1)].endSeconds || s.startSeconds,
          order: found.length,
          priority: cue.priority,
          detection: "transcript_cue",
          detectionConfidence: 0.45,
          creatorDefined: false, // load-bearing: NEVER claim the creator made this
        });
        break;
      }
    }
  }
  // dedupe overlapping cue chapters (keep first of each category run)
  return found.filter((c, i) => i === 0 || c.startSeconds - found[i - 1].startSeconds > 30);
}

/** Detect chapters: prefer creator metadata; else infer; else none. */
export function detectChapters(
  descriptionChapters: { title: string; startSeconds: number }[] | undefined,
  segments: TranscriptSegment[],
  totalSeconds: number,
): Chapter[] {
  if (descriptionChapters && descriptionChapters.length >= 2) {
    return chaptersFromDescription(descriptionChapters, totalSeconds);
  }
  return inferChaptersFromTranscript(segments);
}

/** Segments overlapping a chapter window (for chapter-scoped extraction). */
export function segmentsInChapter(segments: TranscriptSegment[], ch: Chapter): TranscriptSegment[] {
  // When timestamps are absent (all 0), fall back to all segments for the single chapter case.
  const hasTs = segments.some((s) => s.startSeconds > 0 || s.endSeconds > 0);
  if (!hasTs) return segments;
  return segments.filter((s) => s.startSeconds < ch.endSeconds && s.endSeconds > ch.startSeconds);
}
