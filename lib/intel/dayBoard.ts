// AUGUST Market Intel — DAY BOARD derivations. Pure (no I/O), unit-tested.
//
// One day = one desk run (a stored dated brief). Each day row answers the
// owner's three questions, honestly:
//   CREATED — when this idea entered the desk: the tracker's ingest timestamp
//             for THIS contributing idea id when a tracked record carries it,
//             else the desk run (brief generation) time. Never invented; the
//             basis is carried so the UI can label which one it is.
//   ALERTED — the tracker's TRIGGERED transition (statusHistory), verbatim:
//             timestamp + observed price + the engine's reason. No tracker
//             record / never triggered → absent (∅), never a guess.
//   SO FAR  — the tracker engine's pnlView, passed through UNCHANGED (the
//             engine's labels are the law: since called / since first
//             mention / none-with-reason). Untracked rows are an explicit
//             "none · untracked".
import { pnlView, type PnlView, type TrackedIdea } from "./tracker";

export type DayCreated = {
  at: number;
  /** which real timestamp this is — the UI must say so */
  basis: "tracker_ingest" | "desk_run";
};

export type DayAlerted = { at: number; price: number | null; reason: string };

/** CREATED: tracker ingest time for this idea id, else the desk-run time.
 *  Returns null only when neither exists (no brief timestamp supplied). */
export function dayCreated(
  ideaId: string,
  tracked: TrackedIdea | null,
  briefGeneratedAt: number | null | undefined,
): DayCreated | null {
  const ref = tracked?.sourceRefs.find((r) => r.ideaId === ideaId) ?? null;
  if (ref && ref.mentionedAt > 0) return { at: ref.mentionedAt, basis: "tracker_ingest" };
  if (briefGeneratedAt && briefGeneratedAt > 0) return { at: briefGeneratedAt, basis: "desk_run" };
  return null;
}

/** ALERTED: the FIRST TRIGGERED transition the tracker recorded, verbatim. */
export function dayAlerted(tracked: TrackedIdea | null): DayAlerted | null {
  const h = tracked?.statusHistory.find((e) => e.state === "TRIGGERED") ?? null;
  return h ? { at: h.at, price: h.price, reason: h.reason } : null;
}

/** SO FAR: the engine's pnlView unchanged; untracked → explicit none. */
export function daySoFar(tracked: TrackedIdea | null): PnlView {
  return tracked ? pnlView(tracked) : { kind: "none", reason: "untracked" };
}

// ── DAY STACK group derivations ──────────────────────────────────────────────
// The owner's default BOARD is a STACK: today's day board on top, then PAST
// IDEAS — prior desk days newest-first. This plans WHICH past days render and
// how they load, purely from the briefs index (dates only — the index carries
// no counts, so a day's idea count is unknown until its brief is fetched).

export type PastDayPlan = {
  date: string;
  /** fetched eagerly when the stack mounts (the newest few past days);
   *  non-eager days start as collapsed headers and load on expand */
  eager: boolean;
};

/** Plan the PAST IDEAS stack. `briefDates` is the briefs index, newest first
 *  (today's key, when present, is excluded — TODAY is its own section).
 *  `visibleCount` caps how many past days render (LOAD OLDER raises it);
 *  the first `eagerCount` of those are marked for eager fetch. `older` is
 *  how many known past days remain beyond the cap — 0 means the index is
 *  exhausted. Pure: no I/O, input order preserved. */
export function planPastDays(
  briefDates: string[],
  todayKey: string,
  visibleCount: number,
  eagerCount = 3,
): { days: PastDayPlan[]; older: number } {
  const past = briefDates.filter((d) => d !== todayKey);
  const days = past
    .slice(0, Math.max(0, visibleCount))
    .map((date, i) => ({ date, eager: i < Math.max(0, eagerCount) }));
  return { days, older: past.length - days.length };
}
