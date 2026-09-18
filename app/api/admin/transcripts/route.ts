import { gateAdminOrRespond } from "@/lib/admin";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { createIdea } from "@/lib/ideas";
import { createTapeEntry } from "@/lib/tape";
import {
  aiConfigured,
  extractFromTranscript,
  extractionFailure,
  listTranscripts,
  readTranscript,
  readTranscriptText,
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

/**
 * PATCH {id} — RE-RUN extraction on a transcript already in the store.
 *
 * fix/failure-visibility: an extraction that failed for a reason outside the
 * transcript (a dead key, a provider outage) left a row that could only be
 * retried by pasting the text again — or by paying the transcript provider a
 * second time for a video it had already bought. The raw text is on disk with
 * no TTL, so the retry reads THAT and updates the SAME record: no second
 * fetch, no second row, no duplicate drafts.
 *
 * Only a FAILED row can be re-run. A processed row already has its drafts in
 * the queue, and re-running it would mint a second copy of every one of them.
 */
export async function PATCH(req: Request): Promise<Response> {
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
  const id = typeof (body as { id?: unknown })?.id === "string" ? (body as { id: string }).id.trim() : "";
  if (!id) return Response.json({ ok: false, error: "id_required" }, { status: 400 });

  const rec = await readTranscript(id);
  if (!rec) return Response.json({ ok: false, error: "no such transcript", code: "not_found" }, { status: 404 });
  if (rec.status !== "failed") {
    return Response.json(
      { ok: false, error: "that transcript already processed — re-running it would duplicate its drafts", code: "not_failed" },
      { status: 409 },
    );
  }
  const text = await readTranscriptText(id);
  if (!text) {
    return Response.json(
      { ok: false, error: "the raw text for that row is gone — it can't be re-run", code: "no_raw_text" },
      { status: 410 },
    );
  }

  let candidates;
  try {
    candidates = await extractFromTranscript(text);
  } catch (e) {
    const failure = extractionFailure(e, id);
    await updateTranscript(id, { status: "failed", error: failure.error });
    console.error("[transcripts] re-run failed:", failure.error);
    return Response.json(failure, { status: 502 });
  }

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
  await updateTranscript(id, { status: "processed", ideaIds, tapeIds });

  return Response.json({
    ok: true,
    transcriptId: id,
    drafts: ideaIds.length + tapeIds.length,
    ideaIds,
    tapeIds,
    dropped: candidates.dropped,
    symbolDrops: candidates.symbolDrops,
    symbolFlags: candidates.symbolFlags,
  });
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
  //
  //    DESIGN_LAWS L9 — `error` carries the REAL cause, not a category. The
  //    message was already stored on the record and logged; returning the flat
  //    "extraction_failed" to the one console that can act on it meant the
  //    owner read "extraction_failed" while the record held "400 … API key is
  //    not scoped to a workspace". This route is admin-gated, so provider
  //    detail is the operator's to see. `code` stays stable for callers that
  //    branch on it.
  let candidates;
  try {
    candidates = await extractFromTranscript(text);
  } catch (e) {
    const failure = extractionFailure(e, rec.id);
    await updateTranscript(rec.id, { status: "failed", error: failure.error });
    console.error("[transcripts] extraction failed:", failure.error);
    return Response.json(failure, { status: 502 });
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
