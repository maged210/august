// THE COUNTDOWN ROW's feed (R4 F2) — this week's high-impact USD calendar,
// big-four classified, with an HONEST reaction line attached to released
// events (NQ=F 5m bars; null when the bars don't cover the window — the
// card omits the line rather than estimate). Vetted before shipping; the
// free feed carries no `actual` — the client states that, never a beat/miss.
import { getCalendarWeek, eventState, reactionAfter } from "@/lib/calendar-feed";
import { getHistory } from "@/lib/markets";
import { lastSession } from "@/lib/levels";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("headlines", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  try {
    const rows = await getCalendarWeek();
    const now = Date.now();
    const events = rows
      .filter((e) => e.impact === "High" || e.cls !== null)
      .map((e) => ({ ...e, state: eventState(e.ts, now) }))
      .filter((e) => e.state !== "past")
      .sort((a, b) => a.ts - b.ts);

    // reaction lines for released prints — only when bars genuinely cover
    const anyReleased = events.some((e) => e.state === "released");
    let reactions: Record<number, number | null> = {};
    if (anyReleased) {
      const today = await getHistory("NQ=F", "yahoo", "1D").catch(() => []);
      const bars = today.length >= 5 ? today : lastSession(await getHistory("NQ=F", "yahoo", "1W").catch(() => []));
      reactions = Object.fromEntries(
        events.filter((e) => e.state === "released").map((e) => [e.ts, reactionAfter(bars, e.ts, 15)]),
      );
    }
    return Response.json(
      { ok: true, events: events.map((e) => ({ ...e, reaction15m: e.state === "released" ? (reactions[e.ts] ?? null) : null })) },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    console.error("[calendar]", err instanceof Error ? err.message : err);
    return Response.json({ ok: false, error: "calendar_failed" }, { status: 502 });
  }
}
