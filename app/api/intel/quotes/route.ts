import { type NextRequest } from "next/server";
import { getQuoteWithSpark } from "@/lib/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Thin wrapper over the cached getQuoteWithSpark (yahooChart, 60s TTL).
// Used by the blotter to fetch live prices + sparkline closes for arbitrary
// tickers extracted from the brief. Max 20 symbols per call.
export async function GET(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);

  if (!symbols.length) return Response.json({ quotes: {} });

  const settled = await Promise.allSettled(symbols.map((s) => getQuoteWithSpark(s)));
  const quotes: Record<string, { price: number; prevClose: number; chgPct: number; closes: number[] }> = {};
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      const q = r.value;
      quotes[symbols[i]] = { price: q.price, prevClose: q.prevClose, chgPct: q.chgPct, closes: q.closes };
    }
  });

  return Response.json({ quotes }, { headers: { "Cache-Control": "no-store" } });
}
