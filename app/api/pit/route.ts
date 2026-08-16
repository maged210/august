// THE PIT (GAME-2 arcade) — identity + boards only; the game runs entirely
// client-side on a daily-seeded synthetic tape. No network mid-run: the
// client calls GET once on entry and POST once per finished run.
import { type NextRequest } from "next/server";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { resolveChatPrincipal } from "@/lib/user-scope";
import {
  applyDaily,
  applyProgress,
  applyRound,
  bestBoard,
  betterRating,
  dailyAttemptsLeft,
  etDate,
  getPlayer,
  levelFor,
  newPlayer,
  pidFor,
  pitConfigured,
  recordDailyScore,
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
      { ok: true, date, player, today, best, attemptsLeft: dailyAttemptsLeft(player, date) },
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
  } else if (body.action === "round") {
    // One POST per completed day: score + xp fold into the career; week/day
    // advance the map ghost. `final` names the run's ending — busted /
    // cleared / fund — and lands the run on the all-time board.
    applyRound(player, Number(body.score) || 0, Number(body.xp) || 0);
    player.level = levelFor(player.xp);
    const wk = Math.floor(Number(body.week));
    const dy = Math.floor(Number(body.day));
    if (wk >= 1 && wk <= 20 && dy >= 1 && dy <= 7) applyProgress(player, wk, dy);
    const fin =
      body.final === true ? "cleared" : // legacy client shape
      body.final === "margin" ? "busted" :
      typeof body.final === "string" && ["busted", "cleared", "fund"].includes(body.final) ? body.final :
      null;
    if (fin) {
      const pct = validateRunPct(body.careerPct);
      // the run is over — the cross-device active-run blob dies with it
      delete player.activeRun;
      delete player.activeRunAt;
      if (fin === "busted") player.runStreak = 0;
      else player.runStreak = (player.runStreak ?? 0) + 1;
      if (typeof body.rating === "string" && /^[A-F]\+?$/.test(body.rating)) {
        player.bestRating = betterRating(player.bestRating, body.rating);
      }
      const s = (body.stats ?? {}) as Record<string, unknown>;
      const clampInt = (v: unknown, max: number) =>
        Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
      const stats: RunStats = {
        trades: clampInt(s.trades, 999),
        wins: clampInt(s.wins, 999),
        bestTrade: validateRunPct(s.bestTrade) ?? 0,
        perfectDips: clampInt(s.perfectDips, 999),
      };
      if (pct !== null && !(await recordRun(player, pct, stats, etDate()))) {
        return Response.json({ ok: false, error: "save_failed" }, { status: 500 });
      }
      if (pct === null && !(await savePlayer(player))) {
        return Response.json({ ok: false, error: "save_failed" }, { status: 500 });
      }
    } else if (!(await savePlayer(player))) {
      return Response.json({ ok: false, error: "save_failed" }, { status: 500 });
    }
  } else if (body.action === "runState") {
    // AUTH-1a — sync the in-progress career for cross-device continuity.
    // null clears; anything else must be a bounded JSON blob. Anonymous
    // visitors may sync too (their pid is still their own namespace).
    if (body.run === null || body.run === undefined) {
      delete player.activeRun;
      delete player.activeRunAt;
    } else {
      let size = 0;
      try { size = JSON.stringify(body.run).length; } catch { size = Infinity; }
      if (size > 64_000) {
        return Response.json({ ok: false, error: "run_too_large" }, { status: 400 });
      }
      player.activeRun = body.run;
      player.activeRunAt = Date.now();
    }
    if (!(await savePlayer(player))) {
      return Response.json({ ok: false, error: "save_failed" }, { status: 500 });
    }
  } else if (body.action === "daily") {
    // DAILY PIT — 3 attempts per ET date; only the best posts to the board.
    const pct = validateRunPct(body.pct);
    if (pct === null) return Response.json({ ok: false, error: "run_invalid" }, { status: 400 });
    const date = etDate();
    const res = applyDaily(player, pct, date);
    if (!res) {
      return Response.json({ ok: false, error: "attempts_exhausted", attemptsLeft: 0 }, { status: 429 });
    }
    if (player.daily?.bestPct !== null && player.daily?.bestPct !== undefined) {
      const rank = await recordDailyScore(player.pid, player.daily.bestPct, date);
      if (rank !== null && (player.bestDailyRank === null || rank < player.bestDailyRank)) {
        player.bestDailyRank = rank;
      }
    }
    if (!(await savePlayer(player))) {
      return Response.json({ ok: false, error: "save_failed" }, { status: 500 });
    }
  } else {
    return Response.json({ ok: false, error: "unknown_action" }, { status: 400 });
  }

  const date = etDate();
  const [today, best] = await Promise.all([todayBoard(date), bestBoard()]);
  return withCookie(
    Response.json(
      { ok: true, date, player, today, best, attemptsLeft: dailyAttemptsLeft(player, date) },
      { headers: { "Cache-Control": "no-store" } },
    ),
    setCookie,
  );
}
