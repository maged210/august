import { getMarkets } from "@/lib/markets";

// Live market data. Sources are cached per-TTL inside lib/markets.ts, so polling
// this route frequently does not hammer the free upstream APIs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const markets = await getMarkets();
    return new Response(JSON.stringify(markets), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
