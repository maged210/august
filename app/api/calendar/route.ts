// THE NEXT PRINT (CountdownRow's feed) — this week's high-impact USD
// calendar, big-four classified, still ahead of now. feat/v4-2-today deleted
// the computation nothing rendered: the 15-minute NQ reaction on released
// prints and the FRED `actual` backfill (with lib/calendar-actuals and the
// daily pass's warm step). If either is ever wanted again, it is a render
// decision first — see git history for the code.
import { getCalendarWeek, eventState } from "@/lib/calendar-feed";
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
    return Response.json(
      { ok: true, events },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    console.error("[calendar]", err instanceof Error ? err.message : err);
    return Response.json({ ok: false, error: "calendar_failed" }, { status: 502 });
  }
}
