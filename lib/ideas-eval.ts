// INTEGRITY-1 — the DAILY BOOK PASS. SERVER ONLY. The published book
// (lib/ideas.ts, august:ideas:v1) had no evaluator: rows went live and sat
// "LIVE" forever, because /api/cron/intel-track only ever evaluated the
// SEPARATE video-brief tracker (lib/intel/trackerStore). This pass closes
// that gap: once a day, after the US close (the 21:05 UTC cron), every LIVE
// idea's entry language is read for a crossable trigger and judged against
// the daily close:
//   - conflicted rows (side vs entry language, or two-sided entries) demote
//     to REVIEW and leave the public wire;
//   - crossable triggers evaluate → ARMED / TRIGGERED (sticky) / STALE;
//   - nothing crossable → NEEDS_LEVEL, visibly, instead of lying "LIVE".
// Once-daily-post-close is the honest Hobby cadence; the terminal labels it.
//
// The pure logic (parseEntryTrigger / entryConflict / evaluateLiveIdea) lives
// in lib/ideas.ts with the other pure helpers; this file owns orchestration
// and I/O, mirroring the tracker.ts / trackerStore.ts split.

import { deskSymbolFor } from "@/lib/desk-symbols";
import { getQuote } from "@/lib/markets";
import {
  BOOK_STALE_DAYS,
  demoteIdeaToReview,
  entryConflict,
  evaluateLiveIdea,
  listIdeas,
  setIdeaEvaluation,
  type IdeaEvalState,
} from "@/lib/ideas";

function staleDays(): number {
  // same dial as the tracker (TRACKER_STALE_DAYS), same 3-day default
  const n = Number(process.env.TRACKER_STALE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : BOOK_STALE_DAYS;
}

export type BookPassResult = {
  ran: boolean;
  live: number;
  demotedToReview: number;
  counts: Record<IdeaEvalState, number>;
};

/** Evaluate the whole live book against today's close. Idempotent — a second
 *  run on the same closes reaches the same conclusions. */
export async function runBookPass(now: number = Date.now()): Promise<BookPassResult> {
  const counts: Record<IdeaEvalState, number> = { ARMED: 0, TRIGGERED: 0, STALE: 0, NEEDS_LEVEL: 0 };
  const live = (await listIdeas("live"));
  if (live.length === 0) return { ran: true, live: 0, demotedToReview: 0, counts };

  // one quote per distinct instrument (getQuote rides the 60s-cached Yahoo
  // fetch), routed through the desk's shorthand map so "NQ"/"CL" evaluate
  // against the instrument the desk means — never the wrong listing
  const symbols = [...new Set(live.map((i) => i.instrument.trim().toUpperCase()))];
  const settled = await Promise.allSettled(symbols.map((s) => getQuote(deskSymbolFor(s))));
  const quotes = new Map<string, number>();
  settled.forEach((r, idx) => {
    if (r.status === "fulfilled" && r.value) quotes.set(symbols[idx], r.value.price);
  });

  let demoted = 0;
  for (const idea of live) {
    const conflict = entryConflict(idea.side, idea.entry);
    if (conflict) {
      const reason =
        conflict === "two_sided"
          ? "two-sided entry — one row cannot carry both directions"
          : `stated side ${idea.side} contradicts the entry language`;
      if (await demoteIdeaToReview(idea.id, reason)) demoted++;
      continue;
    }
    const price = quotes.get(idea.instrument.trim().toUpperCase()) ?? null;
    const evaluation = evaluateLiveIdea(idea, price, now, staleDays());
    // write only real changes — the evaluation record is compared without
    // its timestamps so an unchanged conclusion doesn't rewrite 22 blobs
    const prior = idea.evaluation;
    const changed =
      !prior ||
      prior.state !== evaluation.state ||
      prior.level !== evaluation.level ||
      prior.price !== evaluation.price;
    if (changed) await setIdeaEvaluation(idea.id, evaluation);
    counts[evaluation.state]++;
  }

  return { ran: true, live: live.length, demotedToReview: demoted, counts };
}
