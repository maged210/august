// Voice-turn latency trace. Hands-free voice runs ONE turn at a time, so a single
// module-level record is enough. Each mark logs its delta from the relevant prior
// mark with a [LAT] prefix, so the trace streams live in the console and is robust
// to out-of-order completion — with sentence-pipelining, first audio (t4) can land
// BEFORE the LLM finishes (t2b), which is exactly the win we want to see.
//
// Marks (all relative to t0):
//   t0   transcript committed (speech_final / UtteranceEnd) ≈ handleSend start — turn start
//   t1   /api/chat request sent
//   t2   /api/chat FIRST token received
//   t2b  /api/chat full response done
//   t3   first /api/speak request sent
//   t4   first audio plays   ← HEADLINE: t0→t4 = time-to-first-audio
//
// Spans page.tsx (t0,t1,t2,t2b) and lib/speech.ts (t3,t4) via this shared module.

type Key = "t0" | "t1" | "t2" | "t2b" | "t3" | "t4";

const isBrowser = typeof window !== "undefined";
const now = (): number =>
  isBrowser && typeof performance !== "undefined" ? performance.now() : Date.now();

let marks: Partial<Record<Key, number>> = {};
let active = false;
let turn = 0;

const delta = (a: number | undefined, b: number): string =>
  a !== undefined ? `${Math.round(b - a)}ms` : "n/a";

/** Begin a new turn at t0. Called once per send (voice or typed). */
export function latReset(): void {
  turn += 1;
  marks = { t0: now() };
  active = true;
  console.log(
    `[LAT] ── turn ${turn} start${turn === 1 ? " (first after load — may include cold start)" : ""}`,
  );
}

/** Record a mark (first occurrence wins) and log its delta from the prior stage.
 *  No-ops on turns where latReset() was never called (e.g. before any send). */
export function latMark(key: Key): void {
  if (!active || marks[key] !== undefined) return;
  const t = now();
  marks[key] = t;
  const { t0, t1, t2, t3 } = marks;
  switch (key) {
    case "t1":
      console.log(`[LAT] t0→t1   ${delta(t0, t)}  · chat request sent`);
      break;
    case "t2":
      console.log(`[LAT] t1→t2   ${delta(t1, t)}  · LLM first token`);
      break;
    case "t2b":
      console.log(`[LAT] t2→t2b  ${delta(t2, t)}  · LLM full response`);
      break;
    case "t3":
      console.log(`[LAT] t0→t3   ${delta(t0, t)}  · first TTS request sent`);
      break;
    case "t4":
      console.log(`[LAT] t3→t4   ${delta(t3, t)}  · TTS first audio`);
      console.log(
        `[LAT] ⭐ t0→t4 ${delta(t0, t)}  · TIME-TO-FIRST-AUDIO (stop talking → Daniel speaks)`,
      );
      break;
  }
}
