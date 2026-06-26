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

/** Public API: try compliant automatic sources, falling back to honest unavailable. */
export async function acquireTranscript(videoId: string): Promise<TranscriptResult> {
  const tt = await fetchTimedText(videoId);
  if (tt.status === "available") return tt;
  return { status: "unavailable", note: tt.note ?? "No transcript available — paste one manually." };
}
