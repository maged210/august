// Idea Tracker — page-facing read. Runs an OPPORTUNISTIC evaluation pass
// (server-side throttled to one per ~2 min) so the board is fresh on load even
// before any external schedule is wired, then returns the tracked set. The
// heavy-cadence path is the protected /api/cron/intel-track.
//
// OWNER-ONLY: tracked rows carry sourceRefs (videoId + channelTitle) and
// conflictKey (embeds the channel) — full attribution. The public consumes
// published ideas through /api/intel/feed, which is redacted.
import { runTrackerPass } from "@/lib/intel/trackerStore";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(): Promise<Response> {
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  try {
    const result = await runTrackerPass({ force: false });
    return Response.json(
      { configured: result.configured, ran: result.ran, tracked: result.tracked },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "tracker_failed";
    console.error("[intel/tracker]", msg);
    return Response.json({ configured: false, ran: false, tracked: [], error: msg }, { status: 500 });
  }
}
