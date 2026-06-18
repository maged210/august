// Deepgram Nova-3 streaming STT — the speech-to-text engine behind AUGUST's
// hands-free voice loop. It implements the SAME Recognizer interface as the
// Web Speech recognizer in lib/speech.ts (createRecognizer), so the page's
// listen → think → speak → listen loop is untouched: this is a drop-in engine
// swap, not a loop rewrite.
//
// Why replace Web Speech: the browser SpeechRecognition API drops constantly on
// desktop and is effectively dead on iOS. Deepgram is a real streaming service
// that holds a connection and works the same on phone and desktop.
//
// Shape per turn (matches the single-utterance Web Speech recognizer):
//   start()  → getUserMedia → AudioWorklet (Float32→Int16 PCM) → WebSocket to
//              wss://api.deepgram.com/v1/listen, streaming linear16 frames.
//   …Deepgram's endpointing detects end-of-turn (speech_final / UtteranceEnd) →
//   onResult(finalTranscript) → the page sends it to /api/chat and, after AUGUST
//   speaks, calls start() again (a fresh socket). The mic is fully released
//   between turns (stop() stops every track), so it never fights TTS playback.
//
// Auth: the raw Deepgram key never reaches the browser. The client fetches a
// short-lived grant token from our own /api/deepgram-token, then authenticates
// the browser WebSocket via the ['token', <jwt>] subprotocol (browsers can't set
// an Authorization header on a WebSocket).
//
// NOTE (future): Deepgram's newer Flux model (/v2/listen) has model-integrated
// turn-taking (EagerEndOfTurn/EndOfTurn events, eager_eot_threshold) and is their
// recommended voice-agent model — but it's a separate API surface with different
// params. Nova-3 + endpointing/utterance_end_ms (below) is GA and the requested
// engine; a Flux swap would live behind this same interface.

import type { Recognizer, RecognizerCallbacks } from "@/lib/speech";

const isBrowser = typeof window !== "undefined";

// --- Streaming params (Deepgram /v1/listen query string) --------------------
// endpointing=300: finalize after ~300ms of silence (speech_final). A touch
// higher than the 10ms default so a brief mid-sentence pause doesn't end a turn.
// utterance_end_ms=1000: fallback end-of-turn signal; REQUIRES interim_results.
// vad_events=true: SpeechStarted events (used to keep the idle-watchdog alive;
// also the natural hook point for future barge-in).
const DG_PARAMS: Record<string, string> = {
  model: "nova-3",
  language: "en",
  smart_format: "true",
  interim_results: "true",
  vad_events: "true",
  endpointing: "300",
  utterance_end_ms: "1000",
  encoding: "linear16",
  channels: "1",
};

// If the user is silent this long after the socket opens, end the listening
// session so the page re-arms a fresh socket — bounds a wedged connection (and an
// iOS interruption that keeps feeding silence) rather than streaming forever. Any
// transcript buffered when it fires is still delivered (not discarded).
const IDLE_MS = 30_000;

// If the WebSocket handshake neither opens nor errors within this window (captive
// portal / black-hole proxy — the exact flaky-mobile case this rewrite targets),
// fail the turn over to the page's retry path instead of wedging it silently.
const CONNECT_MS = 8_000;

// ---------------------------------------------------------------------------
// Shared, session-scoped audio state. The capture AudioContext is created/
// resumed inside the enter-voice-mode tap gesture (iOS requires that) and reused
// across turns — closing it per turn would re-pay resume latency and risk failing
// to resume outside a gesture. Closed only on full teardown (closeDeepgramAudio).
// ---------------------------------------------------------------------------
let captureCtx: AudioContext | null = null;
let workletReady: Promise<void> | null = null;
// In-memory only, never persisted; cleared on teardown. Reused across back-to-back
// turns while still valid so we don't re-mint every turn.
let cachedToken: { token: string; expiresAt: number } | null = null;

function audioCtor(): typeof AudioContext | null {
  if (!isBrowser) return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

function getCaptureCtx(): AudioContext {
  const AC = audioCtor();
  if (!AC) throw new Error("no AudioContext");
  // Recreate when closed OR left in iOS's post-interruption "interrupted" state —
  // a resumed-but-not-running context produces no audio.
  if (!captureCtx || captureCtx.state === "closed" || captureCtx.state === "interrupted") {
    if (captureCtx && captureCtx.state !== "closed") captureCtx.close().catch(() => {});
    captureCtx = new AC();
    workletReady = null; // a new context must re-add the worklet module
  }
  return captureCtx;
}

function ensureWorklet(ctx: AudioContext): Promise<void> {
  if (!workletReady) workletReady = ctx.audioWorklet.addModule("/dg-pcm-worklet.js");
  return workletReady;
}

async function mintToken(signal: AbortSignal): Promise<string> {
  const now = Date.now();
  // Reuse a still-valid token (>15s headroom) to skip a round-trip on quick re-arms.
  if (cachedToken && cachedToken.expiresAt - now > 15_000) return cachedToken.token;

  const res = await fetch("/api/deepgram-token", { method: "POST", signal });
  if (!res.ok) throw new Error(`token mint failed (${res.status})`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("token mint returned no token");
  cachedToken = {
    token: j.access_token,
    expiresAt: now + (j.expires_in ? j.expires_in * 1000 : 120_000),
  };
  return cachedToken.token;
}

/** Probe whether Deepgram STT is configured server-side (no token is minted).
 *  Lets the client decide whether to offer Deepgram before entering the loop. */
export async function probeDeepgram(): Promise<boolean> {
  if (!isBrowser) return false;
  try {
    const res = await fetch("/api/deepgram-token", { method: "GET", cache: "no-store" });
    if (!res.ok) return false;
    const j = (await res.json()) as { configured?: boolean };
    return !!j.configured;
  } catch {
    return false;
  }
}

/** True if this browser can run the Deepgram pipeline (WS + AudioWorklet + mic). */
export function isDeepgramRecognizerSupported(): boolean {
  return (
    isBrowser &&
    "WebSocket" in window &&
    typeof AudioWorkletNode !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    audioCtor() !== null
  );
}

/** Tear down the shared capture context + token. Call on exiting voice mode /
 *  unmount — NOT between turns. */
export function closeDeepgramAudio(): void {
  cachedToken = null;
  workletReady = null;
  const ctx = captureCtx;
  captureCtx = null;
  if (ctx) {
    ctx.onstatechange = null;
    if (ctx.state !== "closed") ctx.close().catch(() => {});
  }
}

// Minimal shapes of the Deepgram streaming messages we read.
interface DgAlternative {
  transcript?: string;
}
interface DgMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: DgAlternative[] };
}

export function createDeepgramRecognizer(cb: RecognizerCallbacks): Recognizer {
  if (!isDeepgramRecognizerSupported()) {
    return { start: () => cb.onError?.("unsupported"), stop: () => {}, supported: false };
  }

  // Per-turn state.
  let ws: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;
  let silentGain: GainNode | null = null;
  let turnCtx: AudioContext | null = null; // the context this turn wired its statechange handler onto
  let idleTimer = 0;
  let connectTimer = 0;
  let level = 0;
  let opened = false; // WS reached OPEN — distinguishes a connect/auth failure from a mid-stream drop
  let sessionEnded = false; // set once any terminal path runs — guards all callbacks
  const abort = new AbortController(); // cancels an in-flight token fetch on stop

  let finalBuffer = ""; // accumulates is_final segments for the current utterance

  const clearTimers = () => {
    if (idleTimer) window.clearTimeout(idleTimer);
    if (connectTimer) window.clearTimeout(connectTimer);
    idleTimer = 0;
    connectTimer = 0;
  };

  // Stops the mic + socket + graph. Idempotent. Does NOT close the shared context
  // (next turn reuses it) and does NOT fire callbacks (callers drive that).
  const teardownAudio = () => {
    clearTimers();
    if (turnCtx) {
      turnCtx.onstatechange = null;
      turnCtx = null;
    }
    if (node) {
      try {
        node.port.onmessage = null;
        node.disconnect();
      } catch {
        /* noop */
      }
      node = null;
    }
    if (silentGain) {
      try {
        silentGain.disconnect();
      } catch {
        /* noop */
      }
      silentGain = null;
    }
    if (source) {
      try {
        source.disconnect();
      } catch {
        /* noop */
      }
      source = null;
    }
    if (stream) {
      // Stopping EVERY track is what turns the OS mic indicator off (iOS dot).
      // Null the interruption handlers first so our own stop() doesn't look like one.
      try {
        stream.getTracks().forEach((t) => {
          t.onended = null;
          t.onmute = null;
          t.stop();
        });
      } catch {
        /* noop */
      }
      stream = null;
    }
    if (ws) {
      const s = ws;
      ws = null;
      try {
        s.onopen = s.onmessage = s.onerror = s.onclose = null;
      } catch {
        /* noop */
      }
      try {
        if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: "CloseStream" }));
      } catch {
        /* noop */
      }
      try {
        s.close();
      } catch {
        /* noop */
      }
    }
  };

  // End-of-turn: hand the finalized utterance to the loop (mirrors Web Speech's
  // onResult-then-onEnd), then release the mic.
  const emitFinal = (text: string) => {
    if (sessionEnded) return;
    sessionEnded = true;
    abort.abort();
    teardownAudio();
    const t = text.trim();
    if (t) cb.onResult?.(t);
    cb.onEnd?.();
  };

  // Natural silent end (idle watchdog) — no transcript; the page treats this like
  // Web Speech's no-result onEnd (re-arm in voice mode, idle for tap-to-talk).
  const emitSilentEnd = () => {
    if (sessionEnded) return;
    sessionEnded = true;
    abort.abort();
    teardownAudio();
    cb.onEnd?.();
  };

  const emitError = (kind: string) => {
    if (sessionEnded) return;
    sessionEnded = true;
    abort.abort();
    teardownAudio();
    cb.onError?.(kind);
  };

  // End the turn WITHOUT losing speech: if we've buffered finalized words, deliver
  // them (so a drop / idle / interruption never silently swallows a sentence);
  // otherwise end silently so the page re-arms. Used by the idle watchdog and the
  // iOS-interruption handler.
  const endTurnSalvaging = () => {
    if (finalBuffer.trim()) emitFinal(finalBuffer);
    else emitSilentEnd();
  };

  // iOS interrupted the audio session (phone call, Siri, route change) or the mic
  // track ended/muted. Don't keep streaming dead silence into the socket — end the
  // turn now (salvaging any words) so the page re-arms cleanly.
  const handleInterruption = () => {
    if (!sessionEnded) endTurnSalvaging();
  };

  const resetIdle = () => {
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(endTurnSalvaging, IDLE_MS);
  };

  const onWsMessage = (ev: MessageEvent) => {
    if (sessionEnded) return;
    let msg: DgMessage;
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as DgMessage;
    } catch {
      return;
    }

    if (msg.type === "Results") {
      const transcript = msg.channel?.alternatives?.[0]?.transcript ?? "";
      if (transcript) resetIdle();
      if (msg.is_final) {
        // A finalized (non-revised) segment — accumulate it. A long utterance can
        // emit several of these before one speech_final.
        finalBuffer = (finalBuffer + " " + transcript).trim();
        cb.onPartial?.(finalBuffer);
      } else if (transcript) {
        // Interim — show the stable buffer plus the live tail.
        cb.onPartial?.((finalBuffer + " " + transcript).trim());
      }
      // speech_final = endpointing detected the speaker paused → end of turn.
      if (msg.speech_final && finalBuffer) emitFinal(finalBuffer);
    } else if (msg.type === "UtteranceEnd") {
      // Fallback end-of-turn for when endpointing never produced speech_final
      // (e.g. lingering background noise). A trailing UtteranceEnd after a
      // speech_final is harmlessly ignored (emitFinal/sessionEnded guard).
      if (finalBuffer) emitFinal(finalBuffer);
    } else if (msg.type === "SpeechStarted") {
      // User began speaking — keep the idle watchdog from firing. (This is also
      // where v1's deferred barge-in would interrupt TTS playback.)
      resetIdle();
    }
    // "Metadata" and anything else: ignore.
  };

  const onWsClose = () => {
    // A clean close we initiated sets sessionEnded first, so this only runs for an
    // UNEXPECTED drop (or a connect/auth failure). If we'd buffered finalized words
    // before the drop, deliver them rather than losing the turn. Otherwise treat as
    // transient 'network': the page's capped retry re-arms; persistent failure
    // trips its voice-trouble fallback to text.
    if (sessionEnded) return;
    // A failure before we ever opened is usually auth/config (e.g. a rejected
    // token), not flaky audio — drop the cached token so the next re-arm mints fresh.
    if (!opened) cachedToken = null;
    if (finalBuffer.trim()) emitFinal(finalBuffer);
    else emitError("network");
  };

  const start = () => {
    // The whole setup runs in an async IIFE, but getUserMedia + ctx.resume() are
    // kicked off SYNCHRONOUSLY (before any await) so iOS keeps the user-gesture
    // activation from the enter-voice-mode tap. Token fetch / WS come after.
    let ctx: AudioContext;
    try {
      ctx = getCaptureCtx();
    } catch {
      emitError("audio-capture");
      return;
    }
    const resumeP = ctx.resume().catch(() => {});
    const streamP = navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    (async () => {
      let micStream: MediaStream;
      try {
        micStream = await streamP;
      } catch (err) {
        const name = (err as { name?: string })?.name ?? "";
        emitError(name === "NotAllowedError" || name === "SecurityError" ? "not-allowed" : "audio-capture");
        return;
      }
      if (sessionEnded) {
        micStream.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = micStream;
      // An involuntary mic stop/mute (iOS interruption, device change) ends the turn.
      stream.getAudioTracks().forEach((t) => {
        t.onended = handleInterruption;
        t.onmute = handleInterruption;
      });

      await resumeP;
      // If the context didn't actually start (iOS may resolve resume() while still
      // interrupted), don't open a socket against a dead graph — fail over.
      if (sessionEnded) return;
      if (ctx.state !== "running") {
        emitError("network");
        return;
      }
      // Watch for the session going interrupted/suspended mid-turn.
      turnCtx = ctx;
      ctx.onstatechange = () => {
        if (!sessionEnded && ctx.state !== "running") handleInterruption();
      };

      try {
        await ensureWorklet(ctx);
      } catch {
        // The node exists (we gated on AudioWorkletNode) but the module fetch/parse
        // failed — that's a setup problem, not a mic-permission one.
        emitError("worklet-unsupported");
        return;
      }
      if (sessionEnded) return;

      let token: string;
      try {
        token = await mintToken(abort.signal);
      } catch {
        emitError("network");
        return;
      }
      if (sessionEnded) return;

      // Tell Deepgram the ACTUAL context rate (iOS won't honor a pinned 16k, and
      // resampling there distorts) — no resampling anywhere, no desync.
      const sampleRate = Math.round(ctx.sampleRate);
      const params = new URLSearchParams({ ...DG_PARAMS, sample_rate: String(sampleRate) });
      let socket: WebSocket;
      try {
        // Browser auth: the credential rides the WebSocket subprotocol header.
        socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["token", token]);
      } catch {
        emitError("network");
        return;
      }
      socket.binaryType = "arraybuffer";
      ws = socket;

      // Connect-deadline: a WebSocket can sit in CONNECTING forever without ever
      // firing onopen OR onclose (stalled handshake). Bail to the retry path so a
      // turn never wedges silently.
      connectTimer = window.setTimeout(() => {
        if (!sessionEnded && !opened) {
          cachedToken = null; // a stalled connect is usually auth/config, not flaky net
          emitError("network");
        }
      }, CONNECT_MS);

      socket.onopen = () => {
        if (sessionEnded) return;
        opened = true;
        if (connectTimer) {
          window.clearTimeout(connectTimer);
          connectTimer = 0;
        }
        // Build the capture graph ONLY now — no PCM is produced before the socket
        // can carry it, so the user's first word isn't clipped during the handshake.
        try {
          source = ctx.createMediaStreamSource(stream!);
          node = new AudioWorkletNode(ctx, "dg-pcm-worklet");
          // Worklet → WS: compute the live level for the orb, then forward the PCM.
          node.port.onmessage = (e: MessageEvent) => {
            const buf = e.data as ArrayBuffer;
            const pcm = new Int16Array(buf);
            let sum = 0;
            for (let i = 0; i < pcm.length; i++) {
              const v = pcm[i] / 32768;
              sum += v * v;
            }
            const rms = pcm.length ? Math.sqrt(sum / pcm.length) : 0;
            level += (Math.min(1, rms * 3.4) - level) * 0.4;
            cb.onLevel?.(level);
            if (ws && ws.readyState === WebSocket.OPEN) ws.send(buf);
          };
          source.connect(node);
          // Route through a zero-gain node to destination: keeps the worklet running
          // on browsers that GC a node with no downstream, with NO audible feedback.
          silentGain = ctx.createGain();
          silentGain.gain.value = 0;
          node.connect(silentGain);
          silentGain.connect(ctx.destination);
        } catch {
          emitError("audio-capture");
          return;
        }
        cb.onStart?.();
        resetIdle();
      };
      socket.onmessage = onWsMessage;
      socket.onerror = onWsClose;
      socket.onclose = onWsClose;
    })();
  };

  const stop = () => {
    // Silent, idempotent teardown. The page calls this on a new turn / exit;
    // it already moved on, so we fire no callbacks. The session stamp on the
    // page side ignores any late async callback regardless.
    if (sessionEnded) return;
    sessionEnded = true;
    abort.abort();
    teardownAudio();
  };

  return { start, stop, supported: true };
}
