// THE COUNTDOWN ROW's feed (R4 F2) — this week's high-impact USD calendar,
// big-four classified, with an HONEST reaction line attached to released
// events (NQ=F 5m bars across the week — futures carry the full Globex
// session, so pre-market prints are covered; when a window isn't covered the
// card gets the REASON, never a fabricated 0). The free feed carries no
// `actual` — the client states that, never a beat/miss.
import { getCalendarWeek, eventState, reactionAfter, type ReactionResult, type ReactionWhy } from "@/lib/calendar-feed";
import { backfillActuals } from "@/lib/calendar-actuals";
import { getHistory } from "@/lib/markets";
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

    // reaction lines for released prints — 5m bars across the WEEK (Yahoo's
    // 1d range starts at midnight ET, which silently dropped prior-evening
    // prints); a window the bars don't cover ships its reason instead.
    const WHY: Record<ReactionWhy, string> = {
      no_bars: "no intraday bars",
      no_preprint_bar: "bars don't cover the print",
      window_incomplete: "bars don't cover the full 15m",
    };
    const released = events.filter((e) => e.state === "released");
    let reactions: Record<string, ReactionResult> = {};
    let actuals: Record<string, string> = {};
    if (released.length > 0) {
      // actuals for printed majors — the fixed FRED mapping, cache-first (the
      // 21:05 pass warms it); timeboxed so a slow FRED never stalls the row.
      const [bars, acts] = await Promise.all([
        getHistory("NQ=F", "yahoo", "5D").catch(() => []),
        Promise.race([
          backfillActuals(released),
          new Promise<Record<string, string>>((resolve) => setTimeout(() => resolve({}), 2500)),
        ]).catch(() => ({}) as Record<string, string>),
      ]);
      actuals = acts;
      reactions = Object.fromEntries(released.map((e) => [e.id, reactionAfter(bars, e.ts, 15)]));
    }
    return Response.json(
      {
        ok: true,
        events: events.map((e) => {
          const r = e.state === "released" ? reactions[e.id] : undefined;
          return {
            ...e,
            reaction15m: r?.ok ? r.pct : null,
            reactionWhy: r && !r.ok ? WHY[r.why] : null,
            actual: e.state === "released" ? (actuals[e.id] ?? null) : null,
          };
        }),
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    console.error("[calendar]", err instanceof Error ? err.message : err);
    return Response.json({ ok: false, error: "calendar_failed" }, { status: 502 });
  }
}
