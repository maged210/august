// Idea Tracker — page-facing read. Runs an OPPORTUNISTIC evaluation pass
// (server-side throttled to one per ~2 min) so the board is fresh on load even
// before any external schedule is wired, then returns the tracked set. The
// heavy-cadence path is the protected /api/cron/intel-track.
//
// OWNER-ONLY: tracked rows carry sourceRefs (videoId + channelTitle) and
// conflictKey (embeds the channel) — full attribution. The public consumes
// published ideas through /api/intel/feed, which is redacted.
//
// This GET is a source-privacy READ boundary, so it rides the ATTRIBUTION gate,
// not the write gate: the write gate resolves "unconfigured → open" even in
// production, which would serve the full sourceRefs/conflictKey set to the
// public if a deploy lost AUTH_SECRET. Same class of surface as
// /api/intel/sources and /api/intel/videos, and gated the same way. (The pass
// this triggers is a server-side snapshot refresh, not a user mutation — the
// owner-only cadence path is the protected /api/cron/intel-track.)
import { runTrackerPass } from "@/lib/intel/trackerStore";
import { gateIntelAttributionOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(): Promise<Response> {
  const denied = await gateIntelAttributionOrRespond();
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
