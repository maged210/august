// TranscriptProvider — SERVER ONLY. Adapters return a status + (when available)
// normalized TranscriptSegment[] with timestamps PRESERVED. We never fabricate a
// transcript: a missing one returns an honest status the UI shows verbatim.
//
//   manual    — parse a pasted transcript (works today, no keys). First-class path.
//   timedtext — best-effort public-caption fetch; legitimately fails for many videos
//               (auto-captions need signed requests) → reported, not faked.
//   external  — slot for an authorized 3rd-party transcription provider (not wired).

import type { TranscriptSegment, TranscriptStatus } from "./types";

export type TranscriptResult = {
  status: TranscriptStatus;
  source?: "manual" | "timedtext" | "external";
  segments?: TranscriptSegment[];
  note?: string;
};

const TS_STANDALONE = /^\[?\(?(\d{1,2}):(\d{2})(?::(\d{2}))?\)?\]?$/;
const TS_INLINE = /^\[?\(?(\d{1,2}):(\d{2})(?::(\d{2}))?\)?\]?\s*[-–—]?\s*(.+)$/;

function toSeconds(a: string, b: string, c?: string): number {
  return c ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
}

function seg(i: number, start: number, end: number, text: string): TranscriptSegment {
  return { id: `s${String(i).padStart(4, "0")}`, startSeconds: start, endSeconds: end, text: text.trim() };
}

/** Parse a pasted transcript. Handles the YouTube "Show transcript" two-line format,
 *  inline "M:SS text", and plain prose (chunked, with a no-timestamps note). */
export function parseManualTranscript(raw: string): TranscriptResult {
  const text = (raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return { status: "unavailable", note: "Empty transcript." };

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const segments: TranscriptSegment[] = [];

  // Pass 1: timestamped formats.
  let pendingTs: number | null = null;
  let buf: string[] = [];
  let i = 0;
  let sawTimestamp = false;

  const flush = (end: number) => {
    if (pendingTs !== null && buf.length) {
      segments.push(seg(i++, pendingTs, end, buf.join(" ")));
      buf = [];
    }
  };

  for (const line of lines) {
    const standalone = TS_STANDALONE.exec(line);
    if (standalone) {
      sawTimestamp = true;
      const t = toSeconds(standalone[1], standalone[2], standalone[3]);
      flush(t);
      pendingTs = t;
      continue;
    }
    const inline = TS_INLINE.exec(line);
    if (inline && /^\d/.test(line)) {
      sawTimestamp = true;
      const t = toSeconds(inline[1], inline[2], inline[3]);
      flush(t);
      segments.push(seg(i++, t, t, inline[4]));
      pendingTs = null;
      continue;
    }
    buf.push(line);
  }
  if (pendingTs !== null && buf.length) segments.push(seg(i++, pendingTs, pendingTs, buf.join(" ")));

  if (sawTimestamp && segments.length) {
    // Backfill endSeconds from the next segment's start.
    for (let k = 0; k < segments.length - 1; k++) {
      if (segments[k].endSeconds <= segments[k].startSeconds) segments[k].endSeconds = segments[k + 1].startSeconds;
    }
    return { status: "available", source: "manual", segments: segments.filter((s) => s.text) };
  }

  // No timestamps — chunk prose into ~75-word segments. Order preserved; timestamps
  // absent (flagged) so citations are by passage, not a precise seek.
  const words = text.split(/\s+/);
  const out: TranscriptSegment[] = [];
  for (let w = 0, n = 0; w < words.length; w += 75, n++) {
    out.push(seg(n, 0, 0, words.slice(w, w + 75).join(" ")));
  }
  return {
    status: out.length ? "available" : "unavailable",
    source: "manual",
    segments: out,
    note: "No timestamps in the pasted transcript — citations are by passage, not a precise seek.",
  };
}

/** Best-effort public caption fetch. Many videos (auto-captions) will return nothing;
 *  that's an HONEST "unavailable", never a fabricated transcript. */
export async function fetchTimedText(videoId: string, lang = "en"): Promise<TranscriptResult> {
  try {
    const res = await fetch(`https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}`, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return { status: "unavailable", note: `timedtext ${res.status}` };
    const xml = await res.text();
    if (!xml || !xml.includes("<text")) {
      return { status: "unavailable", note: "No public captions exposed (likely auto-captions or members-only)." };
    }
    const segments: TranscriptSegment[] = [];
    let i = 0;
    for (const m of xml.matchAll(/<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g)) {
      const start = Number(m[1]);
      const dur = Number(m[2] || 0);
      const t = m[3]
        .replace(/&amp;#39;|&#39;/g, "'")
        .replace(/&amp;quot;|&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (t) segments.push(seg(i++, start, start + dur, t));
    }
    if (!segments.length) return { status: "unavailable", note: "Captions endpoint returned no text." };
    return { status: "available", source: "timedtext", segments };
  } catch {
    return { status: "provider_error", note: "timedtext fetch failed." };
  }
}

// --- external provider (OPTIONAL, key-gated) --------------------------------
// Implemented against Supadata's documented contract (verified 2026-07-01 at
// docs.supadata.ai/api-reference/endpoint/youtube/transcript):
//   GET https://api.supadata.ai/v1/youtube/transcript?videoId=<id>[&lang=en]
//   header `x-api-key: <TRANSCRIPT_PROVIDER_API_KEY>`
//   200 → { content: [{ text, offset(ms), duration(ms), lang }], lang, availableLangs }
//   206 → transcript unavailable · 400 invalid · 404 not found · 500 provider error
// The interface stays swappable: TRANSCRIPT_PROVIDER selects the adapter
// ("supadata" is the one implemented); an unknown name reports not_configured
// honestly rather than guessing at an unverified API.

export function externalProviderConfigured(): boolean {
  return !!process.env.TRANSCRIPT_PROVIDER_API_KEY;
}

type SupadataChunk = { text?: string; offset?: number; duration?: number };

export async function fetchExternalTranscript(videoId: string, lang = "en"): Promise<TranscriptResult> {
  const key = process.env.TRANSCRIPT_PROVIDER_API_KEY;
  if (!key) {
    return { status: "not_configured", note: "No transcript provider key set (TRANSCRIPT_PROVIDER_API_KEY)." };
  }
  const provider = (process.env.TRANSCRIPT_PROVIDER || "supadata").toLowerCase();
  if (provider !== "supadata") {
    return {
      status: "not_configured",
      note: `Unknown TRANSCRIPT_PROVIDER "${provider}" — "supadata" is the implemented adapter.`,
    };
  }
  try {
    const u = new URL("https://api.supadata.ai/v1/youtube/transcript");
    u.searchParams.set("videoId", videoId);
    u.searchParams.set("lang", lang);
    const res = await fetch(u, { cache: "no-store", headers: { "x-api-key": key } });
    if (res.status === 206) {
      return { status: "unavailable", source: "external", note: "Provider reports no transcript for this video." };
    }
    if (res.status === 401 || res.status === 403) {
      return { status: "permission_required", source: "external", note: `Provider rejected the API key (${res.status}).` };
    }
    if (!res.ok) {
      return { status: "provider_error", source: "external", note: `Provider returned ${res.status}.` };
    }
    const body = (await res.json()) as { content?: SupadataChunk[] | string };
    const content = body?.content;
    if (!Array.isArray(content) || content.length === 0) {
      // text=true mode or an empty payload — we only request chunked mode, so
      // anything else is reported, never guessed at.
      return { status: "unavailable", source: "external", note: "Provider returned no transcript chunks." };
    }
    const segments: TranscriptSegment[] = [];
    let i = 0;
    for (const c of content) {
      const text = (c.text ?? "").trim();
      if (!text) continue;
      const start = (c.offset ?? 0) / 1000; // documented in milliseconds
      const dur = (c.duration ?? 0) / 1000;
      segments.push(seg(i++, start, start + dur, text));
    }
    if (!segments.length) return { status: "unavailable", source: "external", note: "Provider chunks were empty." };
    return { status: "available", source: "external", segments };
  } catch {
    return { status: "provider_error", source: "external", note: "Transcript provider fetch failed." };
  }
}

/** Public API: try compliant automatic sources in order — public captions
 * first (free), then the external provider when configured — falling back to
 * an honest unavailable. Manual paste always remains first-class. */
export async function acquireTranscript(videoId: string): Promise<TranscriptResult> {
  const tt = await fetchTimedText(videoId);
  if (tt.status === "available") return tt;
  if (externalProviderConfigured()) {
    const ext = await fetchExternalTranscript(videoId);
    if (ext.status === "available") return ext;
    // surface the provider's honest status rather than flattening it
    if (ext.status === "permission_required" || ext.status === "provider_error") return ext;
  }
  return { status: "unavailable", note: tt.note ?? "No transcript available — paste one manually." };
}
