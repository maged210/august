// Browser speech helpers for AUGUST.
//
// speak() is deliberately isolated. The whole point of v0's voice is that it's
// swappable: replacing the robotic built-in browser voice with ElevenLabs /
// OpenAI TTS in v1 is a one-function change inside speak(), nothing else.

const isBrowser = typeof window !== "undefined";

// ---------------------------------------------------------------------------
// Text-to-speech (output)
// ---------------------------------------------------------------------------

export type SpeakCallbacks = {
  onStart?: () => void;
  /** Fires roughly per word — used to drive the "speaking" visual envelope. */
  onBoundary?: () => void;
  onEnd?: () => void;
  onError?: (e: unknown) => void;
};

export type SpeakHandle = { cancel: () => void };

let cachedVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (!isBrowser || !("speechSynthesis" in window)) return null;
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  // Prefer a calm, lower English voice if the platform offers one.
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

export function speak(text: string, cb: SpeakCallbacks = {}): SpeakHandle {
  if (!isBrowser || !("speechSynthesis" in window) || !text.trim()) {
    cb.onStart?.();
    cb.onEnd?.();
    return { cancel: () => {} };
  }

  const synth = window.speechSynthesis;
  synth.cancel(); // never let two utterances overlap

  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utter.voice = voice;
  utter.rate = 0.98; // unhurried
  utter.pitch = 0.92; // a touch lower — calmer
  utter.volume = 1;

  utter.onstart = () => cb.onStart?.();
  utter.onboundary = () => cb.onBoundary?.();
  utter.onend = () => cb.onEnd?.();
  utter.onerror = (e) => {
    cb.onError?.(e);
    cb.onEnd?.();
  };

  synth.speak(utter);
  return { cancel: () => synth.cancel() };
}

// ---------------------------------------------------------------------------
// Speech-to-text (input)
// ---------------------------------------------------------------------------

export type RecognizerCallbacks = {
  onPartial?: (text: string) => void;
  onResult?: (text: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: string) => void;
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
