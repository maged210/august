// Browser speech helpers for AUGUST.
//
// Voice OUTPUT now uses ElevenLabs (via the /api/speak server route) and plays the
// returned audio through a Web Audio AnalyserNode, so the "speaking" visual pulses
// to his real voice. If ElevenLabs isn't configured (or fails), speak() falls back
// to the built-in browser voice with a synthetic envelope — the app always talks.
//
// speak()'s call shape is unchanged: speak(text, callbacks) -> { cancel }.
// The circle is driven via the optional onLevel(0..1) callback.

const isBrowser = typeof window !== "undefined";

// ---------------------------------------------------------------------------
// Text-to-speech (output)
// ---------------------------------------------------------------------------

export type SpeakCallbacks = {
  onStart?: () => void;
  /** Fires roughly per word — only the browser-voice fallback emits these. */
  onBoundary?: () => void;
  onEnd?: () => void;
  onError?: (e: unknown) => void;
  /** 0..1 live level for the speaking visual: real audio amplitude (ElevenLabs)
   *  or a synthetic envelope (browser fallback). */
  onLevel?: (level: number) => void;
};

export type SpeakHandle = { cancel: () => void };

// A single AudioContext reused for TTS playback + analysis.
let ttsCtx: AudioContext | null = null;
function getTtsContext(): AudioContext | null {
  if (!isBrowser) return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ttsCtx || ttsCtx.state === "closed") ttsCtx = new AC();
  return ttsCtx;
}

let cachedVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (!isBrowser || !("speechSynthesis" in window)) return null;
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const tests: Array<(v: SpeechSynthesisVoice) => boolean> = [
    (v) => /en[-_]GB/i.test(v.lang) && /daniel|arthur|george|male/i.test(v.name),
    (v) => /^en/i.test(v.lang) && /daniel|arthur|george|guy|alex|male/i.test(v.name),
    (v) => /^en/i.test(v.lang),
  ];
  for (const test of tests) {
    const found = voices.find(test);
    if (found) {
      cachedVoice = found;
      return found;
    }
  }
  cachedVoice = voices[0];
  return cachedVoice;
}

/** Warm up the (asynchronously-loaded) voice list. Call once on mount. */
export function primeVoices(): void {
  if (!isBrowser || !("speechSynthesis" in window)) return;
  pickVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = null;
    pickVoice();
  };
}

/** Unlock audio playback + voices on a user gesture so TTS isn't blocked by the
 *  browser autoplay policy. Safe to call repeatedly. */
export function primeAudio(): void {
  if (!isBrowser) return;
  primeVoices();
  getTtsContext()?.resume().catch(() => {});
}

export function speak(text: string, cb: SpeakCallbacks = {}): SpeakHandle {
  if (!isBrowser || !text.trim()) {
    cb.onStart?.();
    cb.onEnd?.();
    return { cancel: () => {} };
  }

  let cancelled = false;
  const ac = new AbortController();
  let stopActive: () => void = () => {};

  (async () => {
    try {
      const player = await playElevenLabs(text, cb, ac.signal);
      if (cancelled) {
        player.stop();
        return;
      }
      stopActive = player.stop;
    } catch {
      // ElevenLabs unavailable/failed — fall back to the browser voice.
      if (cancelled) return;
      try {
        const fb = playBrowser(text, cb);
        if (cancelled) fb.stop();
        else stopActive = fb.stop;
      } catch (e) {
        // Even the browser fallback threw on start — guarantee onEnd so callers
        // (the speech queue, concludeSpeech, the brief) never stall waiting on it.
        cb.onError?.(e);
        cb.onEnd?.();
      }
    }
  })();

  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      ac.abort();
      stopActive();
    },
  };
}

// ElevenLabs path: POST the text, play the returned audio through an AnalyserNode.
async function playElevenLabs(
  text: string,
  cb: SpeakCallbacks,
  signal: AbortSignal,
): Promise<{ stop: () => void }> {
  const res = await fetch("/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`/api/speak unavailable (${res.status})`);

  const arrayBuf = await res.arrayBuffer();
  if (arrayBuf.byteLength === 0) throw new Error("empty audio");

  const ctx = getTtsContext();
  if (!ctx) throw new Error("no AudioContext");
  await ctx.resume().catch(() => {});
  if (ctx.state !== "running") throw new Error("audio context suspended");

  const audioBuf = await ctx.decodeAudioData(arrayBuf);
  if (signal.aborted) throw new DOMException("aborted", "AbortError");

  // graph: bufferSource -> analyser -> destination
  const source = ctx.createBufferSource();
  source.buffer = audioBuf;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);
  analyser.connect(ctx.destination);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  let level = 0;
  let stopped = false;
  let watchdog = 0;

  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    level += (Math.min(1, rms * 3.2) - level) * 0.4; // smooth + scale to a lively 0..1
    cb.onLevel?.(level);
    raf = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    if (watchdog) clearTimeout(watchdog);
    try {
      source.onended = null;
      source.stop();
    } catch {
      /* already stopped */
    }
    try {
      source.disconnect();
      analyser.disconnect();
    } catch {
      /* noop */
    }
    cb.onLevel?.(0);
  };

  source.onended = () => {
    if (stopped) return;
    stop();
    cb.onEnd?.();
  };

  cb.onStart?.();
  source.start();
  // Safety net: if onended never fires (AudioContext interrupted, tab/audio-focus
  // suspended mid-playback), end the chunk after its known duration so a sequential
  // speech queue — and the voice-mode mic re-arm that hangs off onEnd — can't stall.
  watchdog = window.setTimeout(
    () => {
      if (!stopped) {
        stop();
        cb.onEnd?.();
      }
    },
    Math.ceil(audioBuf.duration * 1000) + 800,
  );
  tick();

  return { stop };
}

// Browser-voice fallback: SpeechSynthesis + a synthetic envelope for the visual.
function playBrowser(text: string, cb: SpeakCallbacks): { stop: () => void } {
  if (!("speechSynthesis" in window)) {
    cb.onStart?.();
    cb.onEnd?.();
    return { stop: () => {} };
  }

  const synth = window.speechSynthesis;
  synth.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utter.voice = voice;
  utter.rate = 0.98;
  utter.pitch = 0.92;
  utter.volume = 1;

  let raf = 0;
  let kick = 0;
  let level = 0;
  let running = true;
  let stopped = false;
  const t0 = performance.now();

  const tick = () => {
    if (!running) return;
    const t = (performance.now() - t0) / 1000;
    kick *= 0.86;
    const base = 0.16 + 0.1 * Math.abs(Math.sin(t * 7.5));
    level += (Math.min(1, base + kick) - level) * 0.5;
    cb.onLevel?.(level);
    raf = requestAnimationFrame(tick);
  };

  const stopEnvelope = () => {
    running = false;
    cancelAnimationFrame(raf);
    cb.onLevel?.(0);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopEnvelope();
    utter.onend = null;
    utter.onerror = null;
    try {
      synth.cancel();
    } catch {
      /* noop */
    }
  };

  utter.onstart = () => cb.onStart?.();
  utter.onboundary = () => {
    kick = Math.min(1, kick + 0.5 + Math.random() * 0.3);
    cb.onBoundary?.();
  };
  utter.onend = () => {
    if (stopped) return;
    stopEnvelope();
    cb.onEnd?.();
  };
  utter.onerror = (e) => {
    if (stopped) return;
    stopEnvelope();
    cb.onError?.(e);
    cb.onEnd?.();
  };

  synth.speak(utter);
  tick();

  return { stop };
}

// ---------------------------------------------------------------------------
// Sequential speech queue — speak text in ordered chunks, reusing speak().
//
// Lets a streamed reply start talking on its first sentence while the rest is
// still generating: push the first sentence early, push the remainder when the
// stream ends, then end(). Each chunk is a normal /api/speak call, so it keeps
// the Daniel voice + the amplitude envelope and inherits the browser-voice
// fallback. onStart fires once (first audio), onEnd once (after the last chunk
// drains). Conservative chunking keeps it to ~1-2 /api/speak calls per turn.
// ---------------------------------------------------------------------------

export type SpeechQueue = {
  /** Queue a chunk to speak after the ones already queued. */
  push: (text: string) => void;
  /** No more chunks coming — onEnd fires once the queue drains. */
  end: () => void;
  /** Stop immediately and drop anything pending. */
  cancel: () => void;
};

export function createSpeechQueue(cb: SpeakCallbacks = {}): SpeechQueue {
  const pending: string[] = [];
  let active: SpeakHandle | null = null;
  let playing = false;
  let ended = false;
  let started = false;
  let finished = false;
  let cancelled = false;

  const pump = () => {
    if (cancelled || playing) return;
    const next = pending.shift();
    if (next === undefined) {
      if (ended && !finished) {
        finished = true;
        cb.onEnd?.();
      }
      return;
    }
    playing = true;
    active = speak(next, {
      onStart: () => {
        if (!started) {
          started = true;
          cb.onStart?.();
        }
      },
      onLevel: cb.onLevel,
      // speak() always lands on onEnd (even when it fell back / errored), so
      // onEnd is the single "advance" signal; onError is informational only.
      onError: (e) => cb.onError?.(e),
      onEnd: () => {
        playing = false;
        active = null;
        if (!cancelled) pump();
      },
    });
  };

  return {
    push: (text) => {
      if (cancelled || ended) return;
      const t = text.trim();
      if (!t) return;
      pending.push(t);
      pump();
    },
    end: () => {
      if (cancelled) return;
      ended = true;
      if (!playing) pump();
    },
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      pending.length = 0;
      active?.cancel();
      active = null;
      cb.onLevel?.(0);
    },
  };
}

// ---------------------------------------------------------------------------
// Speech-to-text (input) — UNCHANGED
// ---------------------------------------------------------------------------

export type RecognizerCallbacks = {
  onPartial?: (text: string) => void;
  onResult?: (text: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  /** err is a coarse kind ("network", "not-allowed", …); detail is an optional
   *  human/diagnostic string (e.g. a Deepgram close code) for logs + the UI. */
  onError?: (err: string, detail?: string) => void;
  /** 0..1 live mic level for the "listening" orb. Only engines that own the audio
   *  graph (Deepgram) emit this; the Web Speech recognizer leaves it unset and the
   *  caller drives the orb via startMicLevel() instead. */
  onLevel?: (level: number) => void;
};

export type Recognizer = {
  start: () => void;
  stop: () => void;
  supported: boolean;
};

// The Web Speech API is still vendor-prefixed and untyped in lib.dom.
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onresult: ((e: SpeechRecognitionResultEventLike) => void) | null;
}
interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (!isBrowser) return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export function createRecognizer(cb: RecognizerCallbacks): Recognizer {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    return { start: () => cb.onError?.("unsupported"), stop: () => {}, supported: false };
  }

  const rec = new Ctor();
  rec.lang = "en-US";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = "";

  rec.onstart = () => {
    finalText = "";
    cb.onStart?.();
  };
  rec.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) final += res[0].transcript;
      else interim += res[0].transcript;
    }
    if (final) {
      finalText = final;
      cb.onPartial?.(final.trim());
    } else if (interim) {
      cb.onPartial?.(interim);
    }
  };
  rec.onerror = (e) => cb.onError?.(e?.error ?? "error");
  rec.onend = () => {
    const t = finalText.trim();
    if (t) cb.onResult?.(t);
    cb.onEnd?.();
  };

  return {
    start: () => {
      try {
        rec.start();
      } catch {
        /* start() throws if already running — ignore */
      }
    },
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    },
    supported: true,
  };
}
