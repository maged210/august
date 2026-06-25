// Ask AUGUST — retrieval Q&A over PROCESSED videos. SERVER ONLY. Grounded: the model
// only sees the stored structured analyses (+ matched transcript snippets) and must cite
// videoId + timestamp. Never answers from outside the processed corpus.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/persona";
import { getAnalysis, listVideos, videosForTicker } from "./store";
import { extractTickerCandidates, normalizeTicker } from "./tickers";
import type { VideoAnalysis } from "./types";

const MODEL = "claude-sonnet-4-6";

export type AskResult = {
  answer: string;
  citations: { videoId: string; videoTitle: string; channelTitle: string; startSeconds: number; note: string }[];
  grounded: boolean;
};

export async function askIntel(question: string): Promise<AskResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  const videos = await listVideos();
  const byId = new Map(videos.map((v) => [v.videoId, v]));

  // Retrieve: videos mentioning a ticker in the question, else most-recent analyzed.
  const tickers = [...new Set(extractTickerCandidates(question).map(normalizeTicker))];
  let ids = new Set<string>();
  for (const t of tickers) for (const v of await videosForTicker(t)) ids.add(v);
  if (!ids.size) videos.filter((v) => v.status === "analyzed" || v.status === "preliminary").slice(0, 6).forEach((v) => ids.add(v.videoId));

  const analyses = (await Promise.all([...ids].slice(0, 8).map((id) => getAnalysis(id)))).filter(Boolean) as VideoAnalysis[];
  if (!analyses.length) return { answer: "I haven't processed any videos that cover that yet. Add a source and process a transcript first.", citations: [], grounded: false };
  if (!key) return { answer: "AI is not configured (ANTHROPIC_API_KEY). The matching processed videos are cited below.", citations: analyses.map((a) => ({ videoId: a.videoId, videoTitle: byId.get(a.videoId)?.title ?? "", channelTitle: byId.get(a.videoId)?.channelTitle ?? "", startSeconds: 0, note: a.overallSummary.slice(0, 120) })), grounded: false };

  const context = analyses.map((a) => ({
    videoId: a.videoId,
    title: byId.get(a.videoId)?.title,
    channel: byId.get(a.videoId)?.channelTitle,
    summary: a.overallSummary,
    ideas: a.tradeIdeas.map((t) => ({ ticker: t.ticker, direction: t.direction, thesis: t.thesis, at: t.sourceStartSeconds, explicit: t.explicitness })),
    levels: a.levels.map((l) => ({ instrument: l.instrument, level: l.level ?? l.levelText, type: l.type, at: l.sourceStartSeconds })),
    catalysts: a.catalysts.map((c) => ({ name: c.name, when: c.eventTime })),
  }));

  const tool = {
    name: "answer",
    description: "Answer the question grounded ONLY in the provided processed-video context, with citations.",
    input_schema: {
      type: "object" as const,
      properties: {
        answer: { type: "string" },
        citations: {
          type: "array",
          items: {
            type: "object",
            properties: { videoId: { type: "string" }, startSeconds: { type: "number" }, note: { type: "string" } },
            required: ["videoId", "startSeconds", "note"],
          },
        },
      },
      required: ["answer", "citations"],
    },
  };
  try {
    const c = new Anthropic({ apiKey: key });
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT + "\n\nAnswer ONLY from the processed-video context provided. If the context doesn't cover it, say so. Cite videoId + the timestamp where it was said. Where sources disagree, say so; never merge contradictory calls. Decision-support, not financial advice.",
      messages: [{ role: "user", content: `Question: ${question}\n\nCONTEXT (processed videos):\n${JSON.stringify(context, null, 2)}\n\nCall answer.` }],
      tools: [tool],
      tool_choice: { type: "tool", name: "answer" },
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (block && block.type === "tool_use") {
      const out = block.input as { answer: string; citations: { videoId: string; startSeconds: number; note: string }[] };
      return {
        answer: out.answer,
        citations: (out.citations ?? []).filter((ci) => byId.has(ci.videoId)).map((ci) => ({
          videoId: ci.videoId,
          videoTitle: byId.get(ci.videoId)?.title ?? "",
          channelTitle: byId.get(ci.videoId)?.channelTitle ?? "",
          startSeconds: ci.startSeconds,
          note: ci.note,
        })),
        grounded: true,
      };
    }
  } catch (e) {
    console.error("[intel.ask] failed:", e instanceof Error ? e.message : e);
  }
  return { answer: "Something went wrong answering that.", citations: [], grounded: false };
}
