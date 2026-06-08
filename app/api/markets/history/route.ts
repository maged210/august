import { getHistory } from "@/lib/markets";

// OHLC candles for the main price chart. Cached per (symbol, kind, timeframe)
// inside lib/markets.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sym = url.searchParams.get("sym") || "QQQ";
  const kind = url.searchParams.get("kind") || "yahoo";
  const tf = url.searchParams.get("tf") || "1D";
  try {
    const candles = await getHistory(sym, kind, tf);
    return new Response(JSON.stringify({ sym, kind, tf, candles }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    return new Response(JSON.stringify({ error: msg, candles: [] }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
