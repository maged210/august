// Link → transcript for the /admin intake. SERVER ONLY — the provider key is
// read from the environment inside this module, is sent only as a request
// header, and is scrubbed out of every message this module can return.
//
// SCOPE (feature/ingest-transcripts): this feeds the /admin transcript
// pipeline (lib/transcripts.ts) and NOTHING else. It is deliberately not wired
// into the intel/brief pipeline, which has its own older adapter in
// lib/intel/transcript.ts producing TranscriptSegment[] for the intel store.
// The two pipelines stay disjoint; this module never imports from lib/intel.
//
// PROVIDER CONTRACT — verified 2026-09-05 against docs.supadata.ai:
//   GET https://api.supadata.ai/v1/transcript?url=<video url>&text=true&mode=native
//     200 → { content: string, lang, availableLangs }
//     202 → { jobId }  → poll GET /v1/transcript/{jobId}
//                        → { status: queued|active|completed|failed, content, error }
//     206 transcript unavailable · 400 invalid request · 401 unauthorized ·
//     402 upgrade required · 403 forbidden · 404 not found ·
//     429 limit exceeded · 500 internal error
//   GET https://api.supadata.ai/v1/youtube/video?id=<url or id>
//     200 → { id, title, author{displayName}, media{duration}, createdAt, … }
//   Every response carries `x-billable-requests` — the credits that call spent.
//   We report that header rather than assuming a price.
//
// COST DISCIPLINE — two deliberate choices, both about the 100-credit tier:
//   1. mode=native. The provider default is `auto`, which silently falls back
//      to AI generation billed at 2 credits PER MINUTE of video: one 40-minute
//      video would eat 80 of the 100 monthly credits in a single click. Native
//      transcripts are a flat 1 credit. A video with no native captions is
//      reported honestly instead of quietly spending the month.
//   2. Transcript first, metadata only after it succeeds. Metadata is 1 credit
//      and is decoration; there is no reason to buy it for a video that turns
//      out to have no transcript. Failures therefore cost at most 1 credit,
//      and a malformed link costs 0 (it never leaves this process).

const TRANSCRIPT_URL = "https://api.supadata.ai/v1/transcript";
const METADATA_URL = "https://api.supadata.ai/v1/youtube/video";

/** Async jobs: how long we will wait in-request before reporting back. The
 *  route's maxDuration is 60s; leave headroom for the metadata call and the
 *  response itself. Native transcripts are normally immediate — this path is
 *  the provider's large-video escape hatch, not the common case. */
const JOB_POLL_INTERVAL_MS = 1_000;
const JOB_POLL_BUDGET_MS = 40_000;

/** Per-request ceilings. Without these a hung provider would run the route
 *  into its platform maxDuration and the UI would get a dead connection —
 *  the "spinner that resolves to silence" this feature exists to avoid.
 *  Measured live 2026-09-05: a successful transcript is ~4s, but a 404 takes
 *  ~30s (the provider is slow to conclude a video doesn't exist), so the
 *  transcript ceiling has to clear that comfortably. */
const TRANSCRIPT_TIMEOUT_MS = 45_000;
const METADATA_TIMEOUT_MS = 10_000;

/** Mirrors MAX_TRANSCRIPT_CHARS in lib/transcripts.ts — the intake cap. Kept
 *  as a local constant so this module has no import edge into the pipeline it
 *  feeds; the check below only WARNS, it never truncates. */
const INTAKE_CHAR_CAP = 120_000;

/** The metadata endpoint returns no x-billable-requests header (verified live
 *  2026-09-05), so its cost can only come from the published price: "All
 *  metadata requests cost 1 credit". Used as a fallback so the credit line the
 *  owner sees is never an under-count. */
const METADATA_DOCUMENTED_CREDITS = 1;

export type VideoRef = { videoId: string; url: string };

export type FetchFailureKind =
  | "not_configured"
  | "malformed_url"
  | "no_captions"
  | "not_found"
  | "unauthorized"
  | "plan_required"
  | "forbidden"
  | "rate_limited"
  | "provider_error"
  | "job_failed"
  | "still_processing"
  | "empty_transcript";

export type VideoMeta = {
  title: string;
  channel: string;
  /** ISO 8601 from the provider's `createdAt`, verbatim; null when absent */
  publishedAt: string | null;
  /** seconds, from `media.duration`; null when absent */
  durationSeconds: number | null;
};

export type FetchTranscriptResult =
  | {
      ok: true;
      videoId: string;
      url: string;
      text: string;
      chars: number;
      /** true when the transcript exceeds the intake cap — the caller must not
       *  pretend it will process; nothing is truncated here */
      overCap: boolean;
      lang: string | null;
      meta: VideoMeta | null;
      /** why metadata is null, when it is — a metadata miss never fails a fetch */
      metaNote: string | null;
      /** credits actually billed, summed from x-billable-requests */
      credits: number;
    }
  | { ok: false; kind: FetchFailureKind; message: string; credits: number };

// --- pure helpers -------------------------------------------------------------

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * PURE. Accept a YouTube URL or a bare 11-character video id and return the
 * canonical form. Rejects everything else with a reason the UI can print —
 * a malformed link must never reach the provider (it would cost a credit to
 * be told what we already know).
 */
export function parseVideoRef(input: string): { ok: true; ref: VideoRef } | { ok: false; message: string } {
  const raw = (input || "").trim();
  if (!raw) return { ok: false, message: "Paste a YouTube link or video ID first." };

  if (VIDEO_ID_RE.test(raw)) {
    return { ok: true, ref: { videoId: raw, url: `https://www.youtube.com/watch?v=${raw}` } };
  }

  // A bare word with no scheme, dot, or slash is someone typing an ID, not a
  // host. `new URL("https://dQw4w9WgXc")` parses happily as a hostname, so
  // without this a one-character typo in an ID would be reported as "not a
  // YouTube link" — true, but useless. Name the actual mistake.
  if (!/[./\s]/.test(raw)) {
    return {
      ok: false,
      message: `"${raw.slice(0, 40)}" isn't a video ID — those are exactly 11 characters (this one is ${raw.length}).`,
    };
  }

  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return { ok: false, message: `Not a YouTube link or video ID: "${raw.slice(0, 80)}"` };
  }

  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtu.be" && parts[0] && VIDEO_ID_RE.test(parts[0])) {
    return { ok: true, ref: { videoId: parts[0], url: `https://www.youtube.com/watch?v=${parts[0]}` } };
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const v = u.searchParams.get("v");
    if (v && VIDEO_ID_RE.test(v)) {
      return { ok: true, ref: { videoId: v, url: `https://www.youtube.com/watch?v=${v}` } };
    }
    if (
      (parts[0] === "live" || parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "v") &&
      parts[1] &&
      VIDEO_ID_RE.test(parts[1])
    ) {
      return { ok: true, ref: { videoId: parts[1], url: `https://www.youtube.com/watch?v=${parts[1]}` } };
    }
    return { ok: false, message: "That is a YouTube link but not a single video (channel and playlist links aren't supported)." };
  }
  return { ok: false, message: `Not a YouTube link: ${host}` };
}

/** PURE. Remove the provider key from any string before it can be surfaced or
 *  logged. Belt-and-braces: we never interpolate the key into a message, but a
 *  provider that echoed it back would otherwise leak it through `note`. */
export function scrubKey(text: string, key: string | undefined): string {
  if (!key || key.length < 8) return text;
  return text.split(key).join("[redacted]");
}

/** PURE. Map a provider HTTP status onto a distinct, readable failure. Every
 *  branch is a different sentence — none of them is an empty string that could
 *  be mistaken for a successful empty transcript. */
export function failureForStatus(status: number): { kind: FetchFailureKind; message: string } {
  switch (status) {
    case 206:
      return {
        kind: "no_captions",
        message:
          "No captions on this video. AUGUST asks for native transcripts only — generating one with AI costs ~2 credits per minute of video, so it is not done automatically. Paste the transcript by hand if you need this one.",
      };
    case 400:
      return { kind: "malformed_url", message: "The provider rejected that link as malformed." };
    case 401:
      return { kind: "unauthorized", message: "The provider rejected the API key (401). Check TRANSCRIPT_PROVIDER_API_KEY." };
    case 402:
      return { kind: "plan_required", message: "This request needs a higher provider plan (402)." };
    case 403:
      return { kind: "forbidden", message: "The provider refused access to this video (403) — it may be private or region-locked." };
    case 404:
      return { kind: "not_found", message: "No such video (404) — it is private, deleted, or the ID is wrong." };
    case 429:
      return {
        kind: "rate_limited",
        message: "Provider limit hit (429) — either the rate limit or the monthly credit quota. Check the Supadata dashboard before retrying.",
      };
    case 500:
      return { kind: "provider_error", message: "The provider hit an internal error (500). Try again shortly." };
    default:
      return { kind: "provider_error", message: `Provider returned an unexpected status (${status}).` };
  }
}

/** PURE. Read the credits a response was billed. Absent/garbage → 0, never NaN. */
export function billedCredits(headers: Headers): number {
  const raw = headers.get("x-billable-requests");
  const n = raw === null ? 0 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// --- provider calls -----------------------------------------------------------

export function transcriptProviderConfigured(): boolean {
  return !!process.env.TRANSCRIPT_PROVIDER_API_KEY;
}

type JobBody = { status?: string; content?: unknown; lang?: string; error?: string };

async function pollJob(
  jobId: string,
  key: string,
  spent: { credits: number },
): Promise<{ ok: true; text: string; lang: string | null } | { ok: false; kind: FetchFailureKind; message: string }> {
  const deadline = Date.now() + JOB_POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS));
    let res: Response;
    try {
      res = await fetch(`${TRANSCRIPT_URL}/${encodeURIComponent(jobId)}`, {
        cache: "no-store",
        headers: { "x-api-key": key },
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, kind: "provider_error", message: "Lost contact with the provider while waiting for the transcript job." };
    }
    spent.credits += billedCredits(res.headers);
    if (!res.ok) return { ok: false, ...failureForStatus(res.status) };

    let body: JobBody;
    try {
      body = (await res.json()) as JobBody;
    } catch {
      return { ok: false, kind: "provider_error", message: "The provider sent an unreadable job response." };
    }
    if (body.status === "failed") {
      const why = scrubKey((body.error ?? "").trim(), key).slice(0, 300);
      return { ok: false, kind: "job_failed", message: why ? `The provider's transcription job failed: ${why}` : "The provider's transcription job failed." };
    }
    if (body.status === "completed") {
      const text = typeof body.content === "string" ? body.content.trim() : "";
      if (!text) return { ok: false, kind: "empty_transcript", message: "The provider reported success but returned no transcript text." };
      return { ok: true, text, lang: body.lang ?? null };
    }
    // queued | active → keep waiting
  }
  return {
    ok: false,
    kind: "still_processing",
    message: `The provider is still transcribing (job ${jobId}). It didn't finish inside the request window — try the fetch again in a minute.`,
  };
}

async function fetchMetadata(ref: VideoRef, key: string, spent: { credits: number }): Promise<{ meta: VideoMeta | null; note: string | null }> {
  try {
    const u = new URL(METADATA_URL);
    u.searchParams.set("id", ref.videoId);
    const res = await fetch(u, {
      cache: "no-store",
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    // VERIFIED LIVE: /v1/youtube/video sends NO x-billable-requests header, so
    // billedCredits() reads 0 here. The provider documents metadata at 1 credit
    // regardless, so bill the documented price rather than under-reporting the
    // cost to the owner.
    spent.credits += billedCredits(res.headers) || (res.ok ? METADATA_DOCUMENTED_CREDITS : 0);
    if (!res.ok) return { meta: null, note: `Metadata unavailable (provider returned ${res.status}).` };
    // Field names VERIFIED LIVE 2026-09-05, not taken from the docs — the
    // published example shows author.displayName / media.duration / createdAt,
    // but /v1/youtube/video actually returns channel{id,name} / duration /
    // uploadDate. Reading the documented names silently yielded undefined for
    // everything except the title.
    const b = (await res.json()) as {
      title?: unknown;
      channel?: { name?: unknown };
      duration?: unknown;
      uploadDate?: unknown;
    };
    const duration = typeof b.duration === "number" && Number.isFinite(b.duration) ? b.duration : null;
    return {
      meta: {
        title: typeof b.title === "string" ? b.title : "",
        channel: typeof b.channel?.name === "string" ? b.channel.name : "",
        publishedAt: typeof b.uploadDate === "string" ? b.uploadDate : null,
        durationSeconds: duration,
      },
      note: null,
    };
  } catch {
    // Never fatal: a metadata miss must not throw away a transcript we already
    // paid for and hold in hand.
    return { meta: null, note: "Metadata request failed or timed out — the transcript above is unaffected." };
  }
}

/**
 * Fetch one video's transcript. Never returns an empty string as success:
 * every failure path carries a distinct kind and a sentence explaining it.
 *
 * `includeMetadata` defaults true; set false to halve the credit cost when the
 * title/channel aren't needed.
 */
export async function fetchTranscript(
  input: string,
  opts: { includeMetadata?: boolean } = {},
): Promise<FetchTranscriptResult> {
  const spent = { credits: 0 };
  const key = process.env.TRANSCRIPT_PROVIDER_API_KEY;
  if (!key) {
    return {
      ok: false,
      kind: "not_configured",
      message: "No transcript provider key is set (TRANSCRIPT_PROVIDER_API_KEY).",
      credits: 0,
    };
  }

  // Parse before spending anything — a bad link costs 0 credits.
  const parsed = parseVideoRef(input);
  if (!parsed.ok) return { ok: false, kind: "malformed_url", message: parsed.message, credits: 0 };
  const ref = parsed.ref;

  let text: string;
  let lang: string | null = null;
  try {
    const u = new URL(TRANSCRIPT_URL);
    u.searchParams.set("url", ref.url);
    u.searchParams.set("text", "true");
    u.searchParams.set("mode", "native"); // see COST DISCIPLINE above
    const res = await fetch(u, {
      cache: "no-store",
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(TRANSCRIPT_TIMEOUT_MS),
    });
    spent.credits += billedCredits(res.headers);

    if (res.status === 202) {
      const { jobId } = (await res.json()) as { jobId?: string };
      if (!jobId) {
        return { ok: false, kind: "provider_error", message: "The provider queued a job but returned no job ID.", credits: spent.credits };
      }
      const job = await pollJob(jobId, key, spent);
      if (!job.ok) return { ok: false, kind: job.kind, message: job.message, credits: spent.credits };
      text = job.text;
      lang = job.lang;
    } else if (!res.ok) {
      const f = failureForStatus(res.status);
      return { ok: false, kind: f.kind, message: f.message, credits: spent.credits };
    } else {
      const body = (await res.json()) as { content?: unknown; lang?: unknown };
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content) {
        // A 200 with nothing in it is the exact case that must never look like
        // a successful empty transcript.
        return {
          ok: false,
          kind: "empty_transcript",
          message: "The provider answered OK but sent no transcript text.",
          credits: spent.credits,
        };
      }
      text = content;
      lang = typeof body.lang === "string" ? body.lang : null;
    }
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      kind: "provider_error",
      message: timedOut
        ? `The provider didn't answer within ${Math.round(TRANSCRIPT_TIMEOUT_MS / 1000)}s. Nothing was returned — try again, or paste the transcript by hand.`
        : "Couldn't reach the transcript provider.",
      credits: spent.credits,
    };
  }

  const includeMetadata = opts.includeMetadata !== false;
  const { meta, note } = includeMetadata
    ? await fetchMetadata(ref, key, spent)
    : { meta: null, note: "Metadata not requested." };

  return {
    ok: true,
    videoId: ref.videoId,
    url: ref.url,
    text,
    chars: text.length,
    overCap: text.length > INTAKE_CHAR_CAP,
    lang,
    meta,
    metaNote: note,
    credits: spent.credits,
  };
}
