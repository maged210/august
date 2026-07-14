// The user's watchlist — the FIRST truly per-user store (stage 2). No legacy
// equivalent existed: the landing's WATCHING pills were hardcoded in
// components/surfaces/HomeLanding.tsx (UI wiring to this store is stage 3).
//
//   GET : the stored list, or the seed default (SPY QQQ BRK-B NVDA TSLA) when
//         absent. Also lazily backfills first-login seeding for accounts that
//         signed in before stage 2 shipped.
//   PUT : replace the list — 1-12 symbols, uppercased, validated per-symbol.
//
// Personal route: covered by the middleware matcher AND resolveUserOr401
// in-route (defense-in-depth). Unconfigured auth = single-user fallback → the
// legacy-shaped key (august:watchlist) exactly like every other store.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import {
  WATCHLIST_MAX,
  ensureUserSeeded,
  getWatchlist,
  resolveUserOr401,
  setWatchlist,
} from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("watchlist", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const user = await resolveUserOr401();
  if (!user.ok) return user.response;

  // Idempotent backfill (one Redis GET when already seeded): users who signed
  // in before stage 2 never ran the signIn-event seeding.
  if (user.email) await ensureUserSeeded(user.email);

  const symbols = await getWatchlist(user.email);
  return Response.json(
    { symbols, max: WATCHLIST_MAX },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(req: Request): Promise<Response> {
  const rl = await checkRateLimit("watchlist", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const user = await resolveUserOr401();
  if (!user.ok) return user.response;

  let symbols: unknown;
  try {
    symbols = ((await req.json()) as { symbols?: unknown })?.symbols;
  } catch {
    return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const result = await setWatchlist(user.email, symbols);
  if (!result.ok) {
    const status =
      result.error === "invalid_symbols" ? 400 : result.error === "storage_unconfigured" ? 501 : 502;
    return Response.json(result, { status });
  }
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
