// THE CALL — settle-event seam (feature/the-call). PUSH IS NOT THIS BRANCH:
// the next branch subscribes its sender here (register in the cron route,
// where settles actually run) and gets the settle payload with zero changes
// to the engine. In-process by design — settles only ever happen inside the
// daily-pass invocation, so a process-local registry is sufficient.

export type CallSettledEvent = {
  forDate: string;
  side: "HIGHER" | "LOWER";
  result: "HIGHER" | "LOWER" | "FLAT" | "NO_SESSION";
  closePct: number | null;
  augustWin: boolean | null;
};

type Handler = (e: CallSettledEvent) => void | Promise<void>;
const handlers: Handler[] = [];

/** Subscribe to settles (the push branch's entry point). */
export function onCallSettled(h: Handler): void {
  handlers.push(h);
}

/** Fired by the engine after a call settles. Handlers are best-effort — a
 *  failing subscriber never breaks the pass. */
export async function emitCallSettled(e: CallSettledEvent): Promise<void> {
  for (const h of handlers) {
    try {
      await h(e);
    } catch (err) {
      console.warn("[call-events] handler failed:", err instanceof Error ? err.message : err);
    }
  }
}
