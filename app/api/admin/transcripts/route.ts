import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { createIdea } from "@/lib/ideas";
import { createTapeEntry } from "@/lib/tape";
import {
  aiConfigured,
  extractFromTranscript,
  listTranscripts,
  storeTranscript,
  transcriptsConfigured,
  updateTranscript,
  validateTranscriptBody,
} from "@/lib/transcripts";

// Transcript intake (CORE V2 P4) — the ONE endpoint for the /admin paste box
// today and a NoteGPT webhook tomorrow. POST runs the whole pipeline in-line,
// no manual trigger: store raw → extract with Claude → write drafts. The
// extraction call can take a while on a long transcript; give it headroom.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET — recent intake log (records only, never raw text). */
export async function GET(req: Request): Promise<Response> {
  const rl = await checkRateLimit("admin", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  if (!transcriptsConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }

  const transcripts = await listTranscripts(10);
  return Response.json({ ok: true, transcripts });
}

/** POST {text, source?} — store raw, extract, create drafts. */
export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("transcripts", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  const denied = await gateAdminOrRespond(req);
  if (denied) return denied;
  if (!transcriptsConfigured()) {
    return Response.json({ ok: false, error: "storage_not_configured" }, { status: 501 });
  }
  if (!aiConfigured()) {
    return Response.json({ ok: false, error: "ai_not_configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "body_not_json" }, { status: 400 });
  }
  const parsed = validateTranscriptBody(body);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  const { text, source, videoId } = parsed.value;

  // 1. The raw transcript is on disk before any model call — never lost.
  //    feature/ingest-transcripts: videoId is optional provenance, recorded so
  //    the link fetcher's duplicate check can see this intake later. It is "" for
  //    a hand-pasted transcript, which is unchanged behaviour.
  const rec = await storeTranscript(text, source, videoId);
  if (!rec) return Response.json({ ok: false, error: "store_write_failed" }, { status: 502 });

  // 2. Extract (ideas + tape callouts, one model pass). A failure is recorded
  //    on the transcript and reported honestly — the caller can re-paste
  //    later; nothing half-created.
  let candidates;
  try {
    candidates = await extractFromTranscript(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "extraction_failed";
    await updateTranscript(rec.id, { status: "failed", error: msg });
    console.error("[transcripts] extraction failed:", msg);
    return Response.json(
      { ok: false, error: "extraction_failed", transcriptId: rec.id },
      { status: 502 },
    );
  }

  // 3. Every surviving candidate becomes a DRAFT (source "extracted") — the
  //    /admin queue's approve step is the only door to the public rail/dock.
  const ideaIds: string[] = [];
  for (const c of candidates.ideas) {
    const idea = await createIdea(c);
    if (idea) ideaIds.push(idea.id);
  }
  const tapeIds: string[] = [];
  for (const t of candidates.tape) {
    const entry = await createTapeEntry(t);
    if (entry) tapeIds.push(entry.id);
  }
  await updateTranscript(rec.id, { status: "processed", ideaIds, tapeIds });

  return Response.json(
    {
      ok: true,
      transcriptId: rec.id,
      drafts: ideaIds.length + tapeIds.length,
      ideaIds,
      tapeIds,
      // What the idea floor refused to queue, reported rather than silently
      // swallowed — a queue that shrinks without saying why is worse than a
      // noisy one. This is a DECISION, not a deferred queue: the floor is
      // deterministic on the extractor's output, so re-processing the same
      // transcript drops the same rows again.
      dropped: candidates.dropped,
      // fix/ticker-validation — symbols refused before they could queue. ONLY
      // two things delete a row, and both mean there is no security there: a
      // private company, and a symbol that does not resolve. Nothing was
      // substituted.
      symbolDrops: candidates.symbolDrops,
      // Symbols that resolved but could NOT be confirmed as the right one.
      // These rows DID queue, each carrying its reason, because the /admin
      // queue is the only path into the lifecycle and the call is the owner's.
      symbolFlags: candidates.symbolFlags,
    },
    { status: 201 },
  );
}
