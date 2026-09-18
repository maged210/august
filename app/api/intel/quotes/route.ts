import { type NextRequest } from "next/server";
import { getQuoteWithSpark } from "@/lib/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Thin wrapper over the cached getQuoteWithSpark (yahooChart, 60s TTL).
// Used by the terminal AND the front page through lib/quote-book. Max 20
// symbols per call.
//
// EVERY quote carries its own `asOf` — the moment that price came off the
// wire, cache hits and serve-stale-on-error hits included (fix/quote-age).
// Without it a cached price is indistinguishable from a fresh one, and the
// consumers' per-symbol staleness policy has nothing honest to measure: they
// age each price from ITS OWN asOf, never from when this response arrived.
export async function GET(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);

  if (!symbols.length) return Response.json({ quotes: {} });

  const settled = await Promise.allSettled(symbols.map((s) => getQuoteWithSpark(s)));
  const quotes: Record<
    string,
    { price: number; prevClose: number; chgPct: number; closes: number[]; asOf: number }
  > = {};
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      const q = r.value;
      quotes[symbols[i]] = { price: q.price, prevClose: q.prevClose, chgPct: q.chgPct, closes: q.closes, asOf: q.asOf };
    }
  });

  // the Date header is this server's clock at send time: the client reads it
  // to age each asOf on the SERVER's timeline, so a skewed device clock can
  // neither hide a stale price nor blank a fresh one
  return Response.json({ quotes }, { headers: { "Cache-Control": "no-store" } });
}
