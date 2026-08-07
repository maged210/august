import { type NextRequest } from "next/server";
import { getDailyBars } from "@/lib/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

// Daily OHLC candles for the chart dock (G3) — one symbol per call, riding
// lib/markets' 5-minute-cached Yahoo chart fetch (the existing free provider;
// no new data source). Public like /api/intel/quotes: the chart renders on the
// visitor terminal too.
export async function GET(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("bars", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) return Response.json({ bars: [] });

  const bars = await getDailyBars(symbol);
  return Response.json(
    { symbol, bars },
    // bars move slowly — let the CDN absorb repeat clicks for a minute
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=60" } },
  );
}
