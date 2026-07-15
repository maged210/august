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
