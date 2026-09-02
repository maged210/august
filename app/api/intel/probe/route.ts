import { type NextRequest } from "next/server";
import { probeSymbol } from "@/lib/markets";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

// COMMAND-BAR ticker probe: one classified quote lookup so the bar's card can
// tell "the symbol does not exist" (Yahoo 404) apart from "the source failed"
// (429/5xx/timeout) — NO SUCH SYMBOL must never be fabricated for a real
// symbol. Rides yahooChart's 60s cache; adds no data source.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("ideas", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase().slice(0, 16);
  if (!symbol) return Response.json({ state: "no-such-symbol" });
  const r = await probeSymbol(symbol);
  return Response.json(r, { headers: { "Cache-Control": "no-store" } });
}
