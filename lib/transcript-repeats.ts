// THE REPEAT RULE (fix/failure-visibility) — one intake per video, however
// many attempts it took.
//
// Its own module because it is PURE and the /admin console is a client
// component: lib/transcripts.ts pulls in the Anthropic SDK and Upstash, so a
// value import of it from the browser would drag the whole server module into
// the bundle. The type erases; a function does not.
//
// Why it exists: a run of failed extractions produces one row per attempt. Six
// attempts at one video and two at another read as eight separate intakes,
// which makes a single broken dependency look like eight broken transcripts.

/** PURE. Rows arrive NEWEST-FIRST. The newest attempt on a videoId is the one
 *  that stands; every older attempt on that same video is marked as a repeat
 *  of it, carrying the total attempt count.
 *
 *  A row with no videoId is never grouped — hand-pasted text carries no
 *  identity, and inferring one from a typed label would collapse two genuinely
 *  different transcripts into one. */
export function markRepeats<T extends { id: string; videoId?: string }>(
  rows: readonly T[],
): Array<T & { repeatOf: string | null; attempts: number }> {
  const firstFor = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const r of rows) {
    const vid = r.videoId?.trim();
    if (!vid) continue;
    if (!firstFor.has(vid)) firstFor.set(vid, r.id);
    counts.set(vid, (counts.get(vid) ?? 0) + 1);
  }
  return rows.map((r) => {
    const vid = r.videoId?.trim();
    const head = vid ? firstFor.get(vid) : undefined;
    return {
      ...r,
      repeatOf: vid && head && head !== r.id ? head : null,
      attempts: vid ? (counts.get(vid) ?? 1) : 1,
    };
  });
}
