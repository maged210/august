// NQ LEVELS (COMMAND CENTER R2) — session levels for the real contract,
// computed server-side from bars the pipeline already fetches: prev H/L/C +
// pivot from daily bars, VWAP + overnight H/L from the 5m intraday series
// (A5-approved getHistory reuse; volume now captured instead of discarded).
// Symbol is LOCKED to NQ=F — this is a module's data feed, not a fan-out.
import { getDailyBars, getHistory } from "@/lib/markets";
import { computeLevels, levelsBias } from "@/lib/levels";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL = "NQ=F";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("bars", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  try {
    const [daily, intraday] = await Promise.all([
      getDailyBars(SYMBOL),
      getHistory(SYMBOL, "yahoo", "1D"),
    ]);
    const levels = computeLevels(daily, intraday);
    const bias = levelsBias(levels);
    return Response.json(
      { ok: true, symbol: SYMBOL, levels, bias },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch (err) {
    console.error("[intel/levels]", err instanceof Error ? err.message : err);
    return Response.json({ ok: false, error: "levels_failed" }, { status: 502 });
  }
}
