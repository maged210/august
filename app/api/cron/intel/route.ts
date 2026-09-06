// Market Intel tick — PROTECTED by CRON_SECRET (same pattern as
// /api/cron/brief). Discovers new uploads (needs YOUTUBE_API_KEY), auto-tries
// transcripts, and regenerates today's brief. Cheap + idempotent; safe to call
// repeatedly.
//
// NOT SCHEDULED. vercel.json declares exactly one cron — /api/cron/intel-track
// at 22:10 UTC — and no external pinger drives this route (confirmed with the
// owner 2026-09-04: the cron-job.org account has zero jobs and no execution
// history). This route has therefore never run on a schedule; the intel brief
// pipeline is MANUAL-ONLY and has been since 2026-07-15, which is why the
// newest stored video and the newest brief are months apart.
//
// The route stays because the desk's SYNC and GENERATE BRIEF buttons exercise
// the same lib functions and this is the one place they run together. If
// automatic ingest is wanted, adding a crons entry here is the change — but
// nothing in this repository schedules it today, so no comment may claim it
// does. (fix/p0-live-trust)
import { timingSafeEqual } from "node:crypto";
import { syncSources, tryAutoTranscript } from "@/lib/intel/pipeline";
import { generateBrief } from "@/lib/intel/brief";
import { listVideos } from "@/lib/intel/store";
import { youtubeApiConfigured } from "@/lib/intel/youtube";
import { intelligenceConfigured } from "@/lib/intel/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (!tokensMatch(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
      return new Response("Unauthorized", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return new Response("CRON_SECRET not configured", { status: 503 });
  }

  const out: Record<string, unknown> = {};
  try {
    if (youtubeApiConfigured()) {
      const sync = await syncSources();
      out.sync = sync;
      // best-effort auto transcript for freshly-discovered videos awaiting one
      const pending = (await listVideos()).filter((v) => v.transcriptStatus === "pending").slice(0, 3);
      let auto = 0;
      for (const v of pending) {
        const r = await tryAutoTranscript(v.videoId);
        if (r.ok) auto++;
      }
      out.autoTranscribed = auto;
    } else {
      out.sync = { skipped: "no_youtube_key" };
    }
    if (intelligenceConfigured()) out.brief = (await generateBrief()).date;
    return Response.json({ ok: true, ...out });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "cron_failed" }, { status: 500 });
  }
}
