// Tiny synthesized UI tones — Web Audio only, no audio files. Quiet by design.
//
// Four tones: ready (boot resolves), send (message away), reply (answer arrived),
// toggle (a switch flipped). All are short sine/triangle envelopes through one
// master gain set very low. Server-safe: every entry point no-ops without window.

const KEY = "aug-sound";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx || ctx.state === "closed") {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.05; // master volume — barely-there on purpose
    master.connect(ctx.destination);
  }
  return ctx;
}

export function soundEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "0"; // default ON
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* non-persistent */
  }
}

export type UiTone = "ready" | "send" | "reply" | "toggle";

type Note = { f0: number; f1?: number; at: number; dur: number; peak: number; type?: OscillatorType };

const NOTES: Record<UiTone, Note[]> = {
  // a small rising fifth — "systems up"
  ready: [
    { f0: 523.25, at: 0, dur: 0.1, peak: 0.5 },
    { f0: 783.99, at: 0.09, dur: 0.18, peak: 0.42 },
  ],
  // one short upward blip — "away"
  send: [{ f0: 440, f1: 587.33, at: 0, dur: 0.09, peak: 0.45 }],
  // soft falling third — "it's here"
  reply: [
    { f0: 659.25, at: 0, dur: 0.08, peak: 0.36 },
    { f0: 523.25, at: 0.07, dur: 0.16, peak: 0.3 },
  ],
  // a dry tick
  toggle: [{ f0: 330, at: 0, dur: 0.05, peak: 0.4, type: "triangle" }],
};

function schedule(c: AudioContext, name: UiTone): void {
  if (!master) return;
  const t0 = c.currentTime + 0.01;
  for (const n of NOTES[name]) {
    const osc = c.createOscillator();
    osc.type = n.type ?? "sine";
    osc.frequency.setValueAtTime(n.f0, t0 + n.at);
    if (n.f1) osc.frequency.exponentialRampToValueAtTime(n.f1, t0 + n.at + n.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0 + n.at);
    g.gain.linearRampToValueAtTime(n.peak, t0 + n.at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.dur + 0.05);
  }
}

/** Play a UI tone. Silently does nothing when audio is unavailable or blocked by
 *  the autoplay policy (a later user gesture unblocks the context). The caller
 *  gates on the sound toggle + voice mute. */
export function playTone(name: UiTone): void {
  const c = ensure();
  if (!c) return;
  if (c.state === "suspended") {
    // Inside a user gesture resume() settles ~immediately. Outside one (e.g. the
    // boot tone before any click) the promise stays PENDING until the first
    // gesture — so time-bound it, or the stale tone would burst much later.
    const asked = Date.now();
    c.resume()
      .then(() => {
        if (c.state === "running" && Date.now() - asked < 250) schedule(c, name);
      })
      .catch(() => {});
    return;
  }
  if (c.state === "running") schedule(c, name);
}
