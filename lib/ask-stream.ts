// THE ASK STREAM's failure vocabulary (fix/failure-visibility, DESIGN_LAWS L11).
//
// /api/chat answers as a plain text stream, which means the headers are gone
// by the time a mid-stream failure happens: a 200 has already been promised.
// Two things carry the truth to the card instead, and BOTH live here so the
// route and the client can never drift into matching different strings.
//
// Why this matters: before it existed, a stream that died appended the literal
// text "[THE DESK IS UNREACHABLE]" to whatever had arrived, and the client
// rendered it as prose. A half-answer and a complete one looked identical, and
// a failure before the first token produced a card containing nothing but that
// bracket — read as the desk's answer, not as its absence.

/** Appended to the stream when the model call dies after the response opened.
 *  The client matches on this EXACT string and renders the error state. */
export const ASK_STREAM_FAILURE = "\n[THE DESK IS UNREACHABLE]";

/** Response header naming the grounding blocks the answer was built WITHOUT —
 *  a comma-separated subset of memory / markets / command / desk. Absent means
 *  the desk had everything. Names only: the causes are server-side logs, not
 *  facts for a reader. */
export const ASK_DEGRADED_HEADER = "x-aug-degraded";

/** The reader's words for each missing block. The desk says what it could not
 *  see, in the second person — never a system-shaped token. */
const DEGRADED_LABEL: Record<string, string> = {
  memory: "what it remembers about you",
  markets: "live market data",
  command: "the command deck",
  desk: "its own desk read",
};

/** PURE. One sentence naming what the answer was missing, or null when the
 *  header is absent or names nothing recognisable. */
export function degradedNote(header: string | null): string | null {
  if (!header) return null;
  const parts = header
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s in DEGRADED_LABEL);
  if (parts.length === 0) return null;
  const labels = [...new Set(parts)].map((p) => DEGRADED_LABEL[p]);
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Answered without ${list} — that source didn't respond.`;
}
