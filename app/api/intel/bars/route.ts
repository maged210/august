import { type NextRequest } from "next/server";
import { getDailyBars } from "@/lib/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

// Daily OHLC candles for the chart dock (G3) — one symbol per call, riding
// lib/markets' 5-minute-cached Yahoo chart fetch (the existing free provider;
// no new data source). Public like /api/intel/quotes: the chart renders on the
// visitor terminal too.
//
// feat/v4-1-terminal — the payload states its own provenance so the client
// chip is read off the wire, not asserted: Yahoo's chart endpoint is a free,
// delayed feed for the index/ETF/futures proxies the desk charts, and this
// route caches it for five minutes on top. That is DELAYED under the
// DataTag vocabulary (components/DataTag.tsx), never LIVE. An empty `bars`
// array is the honest UNAVAILABLE state — the client draws nothing.
// (module-local: a route file may only export handlers + config)
const BARS_FRESHNESS = "delayed" as const;
const BARS_CACHE_MS = 300_000;

export async function GET(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("bars", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) return Response.json({ bars: [], freshness: BARS_FRESHNESS });

  const bars = await getDailyBars(symbol);
  return Response.json(
    {
      symbol,
      bars,
      freshness: BARS_FRESHNESS,
      source: { provider: "yahoo", interval: "1d", range: "3mo", cacheMs: BARS_CACHE_MS },
    },
    // bars move slowly — let the CDN absorb repeat clicks for a minute
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=60" } },
  );
}
