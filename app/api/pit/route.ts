// THE PIT (GAME-1) — one route, whole game. SIMULATED ONLY; every number
// derives from existing stores (live ideas, the tracked feed's since-call %,
// the quote pipeline). Resolution is LAZY: it runs when the player loads
// their state — no cron, no new data source.
//   GET  → { player, ideas (playable, visibility-hooked), daily, leaderboard }
//   POST → { action: "pick" | "daily" | "name", ... }
import { type NextRequest } from "next/server";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { resolveChatPrincipal } from "@/lib/user-scope";
import { listLiveIdeas, listIdeas } from "@/lib/ideas";
import { getPublicFeed } from "@/lib/intel/publishStore";
import { getQuoteWithSpark } from "@/lib/markets";
import {
  DAILY_RESOLVE_MINS,
  dailyCard,
  applyOutcome,
  etNow,
  getPlayer,
  newPlayer,
  pidFor,
  pitConfigured,
  pitVisibleIdeas,
  savePlayer,
  scorePick,
  topPlayers,
  validatePitName,
  type DailyPick,
  type PitPlayer,
} from "@/lib/pit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAILY_SYMBOLS = ["SPY", "QQQ", "BTC-USD"] as const;

function withCookie(res: Response, setCookie: string | null): Response {
  if (setCookie) res.headers.append("Set-Cookie", setCookie);
  return res;
}

// Mode 1 lazy resolution: a pick scores when a TRACKED card of the same
// ticker carries a since-call %; it pushes when the live idea has left the
// book (closed/invalidated) with nothing tracked to score against.
async function resolvePicks(p: PitPlayer): Promise<boolean> {
  const open = p.picks.filter((k) => k.status === "open");
  if (open.length === 0) return false;
  let changed = false;
  try {
    const [feed, all] = await Promise.all([getPublicFeed(), listIdeas()]);
    const byTicker = new Map(
      feed.ideas
        .filter((c) => c.pnl && c.pnl.kind === "since_called")
        .map((c) => [c.ticker.toUpperCase(), c.pnl as { pct: number }]),
    );
    const liveIds = new Set(all.filter((i) => i.status === "live").map((i) => i.id));
    for (const k of open) {
      const pnl = byTicker.get(k.ticker.toUpperCase());
      if (pnl) {
        k.status = "scored";
        k.pct = Math.round(scorePick(k.side, pnl.pct) * 100) / 100;
        applyOutcome(p, k.pct);
        changed = true;
      } else if (!liveIds.has(k.ideaId)) {
        k.status = "push"; // left the book untriggered — no score either way
        applyOutcome(p, 0);
        changed = true;
      }
    }
  } catch {
    /* resolution is best-effort — picks stay open */
  }
  return changed;
}

// Mode 2 lazy resolution: after the close (or on a later day), score each
// over/under against the line off the existing quote pipeline.
async function resolveDaily(p: PitPlayer): Promise<boolean> {
  const d = p.daily;
  if (!d || d.resolved || d.picks.length === 0) return false;
  const now = etNow();
  const closed = now.date > d.date || (now.date === d.date && now.mins >= DAILY_RESOLVE_MINS);
  if (!closed) return false;
  try {
    const results: boolean[] = [];
    for (const pick of d.picks) {
      const q = await getQuoteWithSpark(pick.sym);
      if (!q) return false; // no quote → try again next load
      // same-day resolve uses the live/close price; later days fall back to
      // the last close on record
      const settle = now.date === d.date ? q.price : q.closes[q.closes.length - 1];
      results.push(pick.dir === "over" ? settle > pick.line : settle < pick.line);
    }
    d.results = results;
    d.resolved = true;
    for (const won of results) applyOutcome(p, won ? 1 : -1); // ±1% per daily call
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("pit", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  if (!pitConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }
  const { principal, setCookie } = await resolveChatPrincipal(req);
  const pid = pidFor(principal);
  if (!pid) return Response.json({ ok: false, error: "no_player_identity" }, { status: 400 });

  const player = (await getPlayer(pid)) ?? newPlayer(pid);
  const changed = (await resolvePicks(player)) || (await resolveDaily(player));
  if (changed || player.updatedAt === player.createdAt) await savePlayer(player);

  // the daily card: target session + lock state (after-close picks play the
  // NEXT session against the latest close)
  const card = dailyCard();
  const daily = {
    date: card.date,
    locked: card.locked,
    already: player.daily?.date === card.date ? player.daily : null,
    symbols: [] as Array<{ sym: string; label: string; line: number | null }>,
  };
  for (const sym of DAILY_SYMBOLS) {
    const q = await getQuoteWithSpark(sym).catch(() => null);
    daily.symbols.push({
      sym,
      label: sym.replace("-USD", ""),
      line: q && Number.isFinite(q.prevClose) ? q.prevClose : null,
    });
  }

  const ideas = pitVisibleIdeas(await listLiveIdeas());
  const leaderboard = await topPlayers();
  return withCookie(
    Response.json(
      { ok: true, player, ideas, daily, leaderboard },
      { headers: { "Cache-Control": "no-store" } },
    ),
    setCookie,
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit("pit", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  if (!pitConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }
  const { principal, setCookie } = await resolveChatPrincipal(req);
  const pid = pidFor(principal);
  if (!pid) return Response.json({ ok: false, error: "no_player_identity" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "body_not_json" }, { status: 400 });
  }

  const player = (await getPlayer(pid)) ?? newPlayer(pid);

  if (body.action === "name") {
    const name = validatePitName(body.name);
    if (!name) return Response.json({ ok: false, error: "name_invalid" }, { status: 400 });
    player.name = name;
  } else if (body.action === "pick") {
    const ideaId = typeof body.ideaId === "string" ? body.ideaId : "";
    const side = body.side === "ride" || body.side === "fade" ? body.side : null;
    if (!ideaId || !side) return Response.json({ ok: false, error: "pick_invalid" }, { status: 400 });
    if (player.picks.some((k) => k.ideaId === ideaId)) {
      return Response.json({ ok: false, error: "already_picked" }, { status: 409 });
    }
    const idea = (await listLiveIdeas()).find((i) => i.id === ideaId);
    if (!idea) return Response.json({ ok: false, error: "idea_not_open" }, { status: 404 });
    player.picks.unshift({
      ideaId, ticker: idea.instrument, side, at: Date.now(), status: "open",
    });
  } else if (body.action === "daily") {
    const card = dailyCard();
    if (card.locked) {
      return Response.json({ ok: false, error: "daily_locked" }, { status: 409 });
    }
    if (player.daily?.date === card.date) {
      return Response.json({ ok: false, error: "already_played_today" }, { status: 409 });
    }
    const raw = Array.isArray(body.picks) ? body.picks : [];
    const picks: DailyPick[] = [];
    for (const r of raw.slice(0, DAILY_SYMBOLS.length)) {
      const o = (r ?? {}) as Record<string, unknown>;
      const sym = DAILY_SYMBOLS.find((s) => s === o.sym);
      const dir = o.dir === "over" || o.dir === "under" ? o.dir : null;
      if (!sym || !dir) continue;
      const q = await getQuoteWithSpark(sym).catch(() => null);
      if (!q || !Number.isFinite(q.prevClose)) continue;
      picks.push({ sym, dir, line: q.prevClose });
    }
    if (picks.length === 0) {
      return Response.json({ ok: false, error: "no_valid_picks" }, { status: 400 });
    }
    player.daily = { date: card.date, picks };
  } else {
    return Response.json({ ok: false, error: "unknown_action" }, { status: 400 });
  }

  const saved = await savePlayer(player);
  if (!saved) return Response.json({ ok: false, error: "save_failed" }, { status: 500 });
  return withCookie(
    Response.json({ ok: true, player }, { headers: { "Cache-Control": "no-store" } }),
    setCookie,
  );
}
