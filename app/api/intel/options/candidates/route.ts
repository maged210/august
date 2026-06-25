// AUGUST options-contract CANDIDATES for a directional thesis. SERVER-generated, NOT
// creator recommendations and NOT advice. Only returns contracts when the (delayed,
// keyless) provider has usable data; otherwise an honest status + zero candidates.
// Selection honors the stored OptionCandidateSettings; ranking is transparent.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getSettings } from "@/lib/intel/store";
import { generateCandidates, type CandidateThesis } from "@/lib/intel/candidates";
import { rankOption } from "@/lib/intel/options-rank";
import type { OptionDirection, OptionIdea } from "@/lib/intel/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  const direction = String(body.direction ?? "") as OptionDirection;
  if (!symbol) return Response.json({ error: "symbol_required" }, { status: 400 });
  if (direction !== "bullish" && direction !== "bearish") {
    return Response.json({ status: "unsupported_symbol", candidates: [], note: "Candidates need a directional (bullish/bearish) thesis." });
  }

  const settings = await getSettings();
  const thesis: CandidateThesis = {
    underlyingSymbol: symbol,
    direction,
    timeHorizon: (typeof body.timeHorizon === "string" ? body.timeHorizon : "unspecified") as OptionIdea["timeHorizon"],
    catalysts: Array.isArray(body.catalysts) ? body.catalysts.filter((c): c is string => typeof c === "string").slice(0, 6) : [],
    underlyingTrigger: num(body.trigger),
    underlyingInvalidation: num(body.invalidation),
    underlyingTargets: Array.isArray(body.targets) ? body.targets.filter((t): t is number => typeof t === "number") : [],
    sourceChapterId: null,
    sourceSegmentIds: [],
    sourceStartSeconds: 0,
    sourceEndSeconds: 0,
  };

  const res = await generateCandidates(thesis, settings.options);
  const ranked = res.candidates
    .map((c) => {
      const r = rankOption(c, { sourcesForSymbol: 1, newest: 0, publishedAt: 0 });
      return { ...c, rankScore: r.score, rankFactors: r.factors };
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  return Response.json({
    symbol,
    direction,
    status: res.status,
    delayed: res.delayed,
    note: res.note,
    settings: settings.options,
    candidates: ranked,
  });
}
