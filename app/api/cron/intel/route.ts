// Market Intel scheduled tick — PROTECTED by CRON_SECRET (same pattern as
// /api/cron/brief). Wired by an external pinger / Vercel Cron after deploy. Discovers
// new uploads (needs YOUTUBE_API_KEY), auto-tries transcripts, and regenerates today's
// brief. Cheap + idempotent; safe to call repeatedly.
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
