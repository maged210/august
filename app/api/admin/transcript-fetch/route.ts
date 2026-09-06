import { gateAdminStrictOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { fetchTranscript, parseVideoRef, transcriptProviderConfigured } from "@/lib/transcript-fetch";
import { findTranscriptsForVideo, transcriptsConfigured } from "@/lib/transcripts";

// Link → transcript for the /admin intake (feature/ingest-transcripts).
//
// This route FETCHES ONLY. It stores nothing, extracts nothing, and creates no
// drafts: it hands text back to the paste box so the owner can read it before
// pressing PROCESS. The existing POST /api/admin/transcripts is still the one
// and only door into extraction and the approve/deny queue.
//
// The provider key lives in the environment and is used inside
// lib/transcript-fetch on the server. It is never returned in a body, never
// put in an error message, and never logged — see the scrubKey guard there.
//
// AUTH: gateAdminStrictOrRespond, not the usual gateAdminOrRespond. Every
// other /admin route inherits the single-user fallback ("no auth env → you are
// the owner", dev/test only). That is fine for routes that move local data and
// wrong for this one: it spends metered provider credits on every call, so an
// environment that merely happens to lack AUTH_SECRET must not hand an
// anonymous caller the ability to drain the quota.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The provider can queue large videos as async jobs; lib/transcript-fetch
// polls for up to 40s and then reports back rather than hanging.
export const maxDuration = 60;

/** POST { url, force? } — resolve a link to transcript text. */
export async function POST(req: Request): Promise<Response> {
  // Shares the transcript bucket: this is the expensive, credit-spending
  // sibling of the intake it feeds.
  const rl = await checkRateLimit("transcripts", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  // STRICT gate: this route spends paid provider credits per call, so it takes
  // no single-user fallback. An ADMIN_TOKEN bearer or a signed-in owner session
  // is required in every environment, including local dev.
  const denied = await gateAdminStrictOrRespond(req);
  if (denied) return denied;

  if (!transcriptProviderConfigured()) {
    return Response.json(
      { ok: false, kind: "not_configured", message: "No transcript provider key is set (TRANSCRIPT_PROVIDER_API_KEY)." },
      { status: 501 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, kind: "malformed_url", message: "Body was not JSON." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const input = typeof b.url === "string" ? b.url : "";
  const force = b.force === true;

  // Parse first: a bad link is answered locally and costs zero credits.
  const parsed = parseVideoRef(input);
  if (!parsed.ok) {
    return Response.json({ ok: false, kind: "malformed_url", message: parsed.message }, { status: 400 });
  }
  const { videoId, url } = parsed.ref;

  // Duplicate guard — BEFORE spending a credit. The owner decides; this route
  // never silently proceeds and never silently refuses.
  if (!force && transcriptsConfigured()) {
    const priors = await findTranscriptsForVideo(videoId);
    if (priors.length > 0) {
      const newest = priors[0];
      return Response.json({
        ok: false,
        kind: "duplicate",
        videoId,
        url,
        message:
          `Already ingested ${priors.length === 1 ? "once" : `${priors.length} times`}` +
          ` — most recently as ${newest.id}` +
          (newest.status === "processed"
            ? ` (${newest.ideaIds.length} idea${newest.ideaIds.length === 1 ? "" : "s"}, ${newest.tapeIds?.length ?? 0} tape).`
            : ` (that run failed).`) +
          " Fetch again anyway?",
        priors: priors.slice(0, 5).map((p) => ({
          id: p.id,
          receivedAt: p.receivedAt,
          status: p.status,
          ideaIds: p.ideaIds.length,
          tapeIds: p.tapeIds?.length ?? 0,
        })),
      });
    }
  }

  const result = await fetchTranscript(url);
  if (!result.ok) {
    // 200 with ok:false — this is a provider outcome the UI renders verbatim,
    // not an HTTP-level failure of this endpoint. `credits` is reported even on
    // failure so the owner can see what a miss cost.
    return Response.json({ ok: false, kind: result.kind, message: result.message, credits: result.credits, videoId, url });
  }

  return Response.json({
    ok: true,
    videoId: result.videoId,
    url: result.url,
    text: result.text,
    chars: result.chars,
    overCap: result.overCap,
    lang: result.lang,
    meta: result.meta,
    metaNote: result.metaNote,
    credits: result.credits,
  });
}
