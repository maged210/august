import { getSectors } from "@/lib/markets";
import { getEquityFng, type FngReading } from "@/lib/intel/fng";
import { getWatchlistEarnings, type EarningsEvent } from "@/lib/intel/earnings";
import { loadTracked } from "@/lib/intel/trackerStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/intel/desk — the fold-ins payload (SPEC-wiring §4 endpoint #1):
//   { fng, sectors, earnings, watchlistSize } — each part INDEPENDENTLY
// nullable; a partial failure never blanks the others and never 500s the
// route. Caching lives below this route (fng 30min in-process + Redis stale,
// sectors 15min cached("sectors"), earnings 6h Redis per ET date), so the
// client's 5-min poll is absorbed by server TTLs.

// markets.ts sector names → the design's 4-letter codes (SPEC-wiring §2.6)
const SECTOR_CODE: Record<string, string> = {
  "Technology": "TECH",
  "Comm. Svcs.": "COMM",
  "Cons. Disc.": "DISC",
  "Financials": "FINL",
  "Industrials": "INDU",
  "Materials": "MATL",
  "Real Estate": "REIT",
  "Health Care": "HLTH",
  "Cons. Staples": "STPL",
  "Utilities": "UTIL",
  "Energy": "ENGY",
};

/** mirrors trackerStore's MAX_QUOTED_TICKERS (SPEC-wiring §2.7 watchlist cap) */
const MAX_WATCHLIST = 25;

export async function GET(): Promise<Response> {
  // watchlist = distinct tickers of live (non-CLOSED) tracked ideas.
  // loadTracked never throws (degrades to []) — Redis-less boxes get an
  // empty watchlist, which short-circuits earnings to [].
  const tracked = await loadTracked();
  const watchlist = [
    ...new Set(tracked.filter((t) => t.status !== "CLOSED").map((t) => t.ticker.toUpperCase())),
  ].slice(0, MAX_WATCHLIST);

  const [fngR, sectorsR, earningsR] = await Promise.allSettled([
    getEquityFng(),
    getSectors(),
    getWatchlistEarnings(watchlist),
  ]);

  const fng: FngReading | null = fngR.status === "fulfilled" ? fngR.value : null;
  // an empty sector list (all 11 ETFs failed) is a hidden strip, not fake zeros
  const sectors =
    sectorsR.status === "fulfilled" && sectorsR.value.length > 0
      ? sectorsR.value.map((s) => ({
          code: SECTOR_CODE[s.name] ?? s.etf,
          name: s.name,
          etf: s.etf,
          chgPct: s.chgPct,
        }))
      : null;
  const earnings: EarningsEvent[] | null = earningsR.status === "fulfilled" ? earningsR.value : null;

  return Response.json(
    { fng, sectors, earnings, watchlistSize: watchlist.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
