// THE PIT (GAME-2 arcade) — identity + boards only; the game runs entirely
// client-side on a daily-seeded synthetic tape. No network mid-run: the
// client calls GET once on entry and POST once per finished run.
import { type NextRequest } from "next/server";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { resolveChatPrincipal } from "@/lib/user-scope";
import {
  bestBoard,
  etDate,
  getPlayer,
  newPlayer,
  pidFor,
  pitConfigured,
  recordRun,
  savePlayer,
  todayBoard,
  validatePitName,
  validateRunPct,
  type RunStats,
} from "@/lib/pit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withCookie(res: Response, setCookie: string | null): Response {
  if (setCookie) res.headers.append("Set-Cookie", setCookie);
  return res;
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

  const date = etDate();
  const player = (await getPlayer(pid)) ?? newPlayer(pid);
  const [today, best] = await Promise.all([todayBoard(date), bestBoard()]);
  return withCookie(
    Response.json(
      { ok: true, date, player, today, best },
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
    if (!(await savePlayer(player))) {
      return Response.json({ ok: false, error: "save_failed" }, { status: 500 });
    }
  } else if (body.action === "run") {
    const pct = validateRunPct(body.pct);
    if (pct === null) return Response.json({ ok: false, error: "run_invalid" }, { status: 400 });
    const s = (body.stats ?? {}) as Record<string, unknown>;
    const clampInt = (v: unknown, max: number) =>
      Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
    const stats: RunStats = {
      trades: clampInt(s.trades, 500),
      wins: clampInt(s.wins, 500),
      bestTrade: validateRunPct(s.bestTrade) ?? 0,
      perfectDips: clampInt(s.perfectDips, 500),
    };
    if (!(await recordRun(player, pct, stats, etDate()))) {
      return Response.json({ ok: false, error: "save_failed" }, { status: 500 });
    }
  } else {
    return Response.json({ ok: false, error: "unknown_action" }, { status: 400 });
  }

  const date = etDate();
  const [today, best] = await Promise.all([todayBoard(date), bestBoard()]);
  return withCookie(
    Response.json(
      { ok: true, date, player, today, best },
      { headers: { "Cache-Control": "no-store" } },
    ),
    setCookie,
  );
}
