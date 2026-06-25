// Options chain for a symbol — delayed, keyless (reuses the existing Yahoo source).
// Honest provider status; NO Greeks (this provider doesn't supply them). The rest of
// Intel works without this — only live-contract data + candidates depend on it.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getOptionChain } from "@/lib/intel/options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) return Response.json({ error: "symbol_required" }, { status: 400 });
  const expParam = url.searchParams.get("expiration");
  const expiration = expParam && /^\d+$/.test(expParam) ? Number(expParam) : undefined;

  const chain = await getOptionChain(symbol, expiration);
  return Response.json({
    symbol,
    provider: "yahoo",
    greeksAvailable: false, // surfaced honestly to the client
    ...chain,
  });
}
