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
//   start()  → getUserMedia → MediaRecorder (webm/opus) → WebSocket to
//              wss://api.deepgram.com/v1/listen, auto-detected container format.
//   …Deepgram's endpointing detects end-of-turn (speech_final / UtteranceEnd) →
//   onResult(finalTranscript) → the page sends it to /api/chat and, after AUGUST
//   speaks, calls start() again (a fresh socket). The mic is fully released
//   between turns (stop() stops every track), so it never fights TTS playback.
//
// Audio format: MediaRecorder with webm/opus (or webm fallback). Do NOT declare
// encoding/sample_rate — Deepgram auto-detects the container. The old AudioWorklet
// linear16 path produced empty transcripts because of PCM vs. declaration mismatch.
//
// Auth: the raw Deepgram key never reaches the browser. The client fetches a
// short-lived grant token from our own /api/deepgram-token, then authenticates
// the browser WebSocket via the ['bearer', <jwt>] subprotocol (browsers can't set
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
// NO encoding/sample_rate/channels: sending webm/opus via MediaRecorder; the
// container is self-describing so Deepgram auto-detects everything. Declaring
// encoding=linear16 while the client actually sends Opus produces empty transcripts.
// utterance_end_ms=1000: fallback end-of-turn; REQUIRES interim_results=true.
// vad_events=true: SpeechStarted events keep the idle-watchdog alive.
const DG_PARAMS: Record<string, string> = {
  model: "nova-3",
  language: "en",
  smart_format: "true",
  interim_results: "true",
  vad_events: "true",
  endpointing: "300",
  utterance_end_ms: "1000",
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
// across turns for level-metering. Closed only on full teardown (closeDeepgramAudio).
// ---------------------------------------------------------------------------
let captureCtx: AudioContext | null = null;
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
  }
  return captureCtx;
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

/** True if this browser can run the Deepgram pipeline (WS + MediaRecorder + mic). */
export function isDeepgramRecognizerSupported(): boolean {
  return (
    isBrowser &&
    "WebSocket" in window &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    audioCtor() !== null
  );
}

/** Tear down the shared capture context + token. Call on exiting voice mode /
 *  unmount — NOT between turns. */
export function closeDeepgramAudio(): void {
  cachedToken = null;
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
  let mediaRecorder: MediaRecorder | null = null;
  // Level metering: AnalyserNode on the mic stream drives cb.onLevel for the orb.
  let levelSrc: MediaStreamAudioSourceNode | null = null;
  let levelAnalyser: AnalyserNode | null = null;
  let levelRafId = 0;
  let turnCtx: AudioContext | null = null; // the context this turn wired its statechange handler onto
  let idleTimer = 0;
  let connectTimer = 0;
  // Safety commit: if is_final arrives but speech_final / UtteranceEnd never does
  // (e.g. a silent Deepgram quirk), commit after 1.5 s so the turn always closes.
  let noWordsTimer = 0;
  let level = 0;
  let opened = false; // WS reached OPEN — distinguishes a connect/auth failure from a mid-stream drop
  let sessionEnded = false; // set once any terminal path runs — guards all callbacks
  const abort = new AbortController(); // cancels an in-flight token fetch on stop
  // Throttled send-logging counters.
  let chunksSent = 0;
  let bytesSent = 0;

  let finalBuffer = ""; // accumulates is_final segments for the current utterance

  const clearTimers = () => {
    if (idleTimer) window.clearTimeout(idleTimer);
    if (connectTimer) window.clearTimeout(connectTimer);
    if (noWordsTimer) window.clearTimeout(noWordsTimer);
    idleTimer = 0;
    connectTimer = 0;
    noWordsTimer = 0;
  };

  // Start (or restart) the safety-commit countdown after each finalized segment.
  // Cleared immediately when speech_final or UtteranceEnd arrives — this only
  // fires when those signals are absent.
  const armSafeCommit = () => {
    if (noWordsTimer) window.clearTimeout(noWordsTimer);
    noWordsTimer = window.setTimeout(() => {
      noWordsTimer = 0;
      if (!sessionEnded && finalBuffer.trim()) {
        console.log("[DG] safety-commit: no speech_final/UtteranceEnd after 1500ms — committing");
        emitFinal(finalBuffer);
      }
    }, 1500);
  };

  // Stops the mic + socket + MediaRecorder + level meter. Idempotent. Does NOT
  // close the shared context (next turn reuses it) and does NOT fire callbacks.
  const teardownAudio = () => {
    clearTimers();
    if (levelRafId) { cancelAnimationFrame(levelRafId); levelRafId = 0; }
    if (turnCtx) {
      turnCtx.onstatechange = null;
      turnCtx = null;
    }
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try { mediaRecorder.ondataavailable = null; mediaRecorder.stop(); } catch { /* noop */ }
    }
    mediaRecorder = null;
    if (levelAnalyser) {
      try { levelAnalyser.disconnect(); } catch { /* noop */ }
      levelAnalyser = null;
    }
    if (levelSrc) {
      try { levelSrc.disconnect(); } catch { /* noop */ }
      levelSrc = null;
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

  const emitError = (kind: string, detail?: string) => {
    if (sessionEnded) return;
    sessionEnded = true;
    abort.abort();
    teardownAudio();
    cb.onError?.(kind, detail);
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
      console.warn("[DG] non-JSON frame:", typeof ev.data);
      return;
    }

    if (msg.type === "Results") {
      const transcript = msg.channel?.alternatives?.[0]?.transcript ?? "";
      console.log(
        `[DG] Results is_final=${msg.is_final} speech_final=${msg.speech_final}` +
          ` "${transcript.slice(0, 80)}"`,
      );
      if (transcript) resetIdle();
      if (msg.is_final) {
        // A finalized (non-revised) segment — accumulate it. A long utterance can
        // emit several of these before one speech_final.
        finalBuffer = (finalBuffer + " " + transcript).trim();
        if (finalBuffer) armSafeCommit(); // safety net if speech_final/UtteranceEnd don't arrive
        cb.onPartial?.(finalBuffer);
      } else if (transcript) {
        // Interim — show the stable buffer plus the live tail.
        cb.onPartial?.((finalBuffer + " " + transcript).trim());
      }
      // speech_final = endpointing detected the speaker paused → end of turn.
      if (msg.speech_final && finalBuffer) {
        if (noWordsTimer) { window.clearTimeout(noWordsTimer); noWordsTimer = 0; }
        emitFinal(finalBuffer);
      }
    } else if (msg.type === "UtteranceEnd") {
      // Fallback end-of-turn for when endpointing never produced speech_final
      // (e.g. lingering background noise). A trailing UtteranceEnd after a
      // speech_final is harmlessly ignored (emitFinal/sessionEnded guard).
      console.log(`[DG] UtteranceEnd buffer="${finalBuffer.slice(0, 60)}"`);
      if (noWordsTimer) { window.clearTimeout(noWordsTimer); noWordsTimer = 0; }
      if (finalBuffer) emitFinal(finalBuffer);
    } else if (msg.type === "SpeechStarted") {
      // User began speaking — keep the idle watchdog from firing. (This is also
      // where v1's deferred barge-in would interrupt TTS playback.)
      console.log("[DG] SpeechStarted");
      resetIdle();
    } else {
      // Metadata / error / anything else — log for diagnostics. Low volume
      // (Metadata is one-per-stream); an auth/usage error message lands here.
      console.log(
        "[DG] MSG type=" + (msg.type ?? "(none)") + ":",
        typeof ev.data === "string" ? ev.data.slice(0, 300) : "(binary)",
      );
    }
  };

  // Logs the EXACT close code/reason (the provable diagnostic) and ends the turn.
  // A clean close we initiated sets sessionEnded first, so this only runs on an
  // UNEXPECTED drop or a handshake/auth rejection — the classic symptom being a
  // socket that opens then closes in ~50ms with 0 bytes and code 1006 (wrong auth
  // scheme). If we'd buffered finalized words before the drop, deliver them rather
  // than losing the turn; otherwise surface a transient 'network' error carrying
  // the close code so the page can show it.
  const onWsClose = (ev?: CloseEvent) => {
    const code = typeof ev?.code === "number" ? ev.code : 0;
    const reason = ev?.reason || "";
    console.warn(
      `[deepgram] socket closed ${opened ? "after open" : "BEFORE open (handshake/auth)"} —` +
        ` code=${code}${reason ? ` reason="${reason}"` : ""}`,
    );
    if (sessionEnded) return;
    // A pre-open close is almost always auth/config (e.g. a rejected token), not
    // flaky audio — drop the cached token so the next attempt mints a fresh one.
    if (!opened) cachedToken = null;
    if (finalBuffer.trim()) emitFinal(finalBuffer);
    else emitError("network", code ? `close ${code}` : undefined);
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

      let token: string;
      try {
        token = await mintToken(abort.signal);
      } catch {
        emitError("network");
        return;
      }
      if (sessionEnded) return;

      // No encoding/sample_rate: MediaRecorder sends webm/opus which Deepgram
      // auto-detects. Grant JWT → "bearer" subprotocol (not "token" = raw API key).
      const params = new URLSearchParams(DG_PARAMS);
      let socket: WebSocket;
      try {
        socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["bearer", token]);
      } catch {
        emitError("network", "ws construct failed");
        return;
      }
      ws = socket;

      // Connect-deadline: a WebSocket can sit in CONNECTING forever without ever
      // firing onopen OR onclose (stalled handshake). Bail to the retry path so a
      // turn never wedges silently.
      connectTimer = window.setTimeout(() => {
        if (!sessionEnded && !opened) {
          cachedToken = null;
          console.warn(`[deepgram] connect timed out after ${CONNECT_MS}ms (no open/close)`);
          emitError("network", "connect timeout");
        }
      }, CONNECT_MS);

      socket.onopen = () => {
        if (sessionEnded) return;
        opened = true;
        if (connectTimer) { window.clearTimeout(connectTimer); connectTimer = 0; }
        console.log(`[DG] OPEN — protocol="${socket.protocol}"`);

        // Level metering: AnalyserNode on the mic stream → cb.onLevel for the orb.
        try {
          levelSrc = ctx.createMediaStreamSource(stream!);
          levelAnalyser = ctx.createAnalyser();
          levelAnalyser.fftSize = 512;
          levelAnalyser.smoothingTimeConstant = 0.8;
          levelSrc.connect(levelAnalyser);
          const data = new Uint8Array(levelAnalyser.frequencyBinCount);
          const levelTick = () => {
            if (sessionEnded || !levelAnalyser) return;
            levelAnalyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            level += (Math.min(1, rms * 3.4) - level) * 0.4;
            cb.onLevel?.(level);
            levelRafId = requestAnimationFrame(levelTick);
          };
          levelRafId = requestAnimationFrame(levelTick);
        } catch {
          // Level metering is optional — audio still flows without it.
          console.warn("[DG] level-meter setup failed (non-fatal)");
        }

        // Audio capture: MediaRecorder → webm/opus blob every 250ms → WS binary frame.
        // Deepgram auto-detects the container; no encoding/sample_rate declaration needed.
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
        console.log(`[DG] MediaRecorder mimeType="${mimeType || "(browser default)"}"`);
        let mr: MediaRecorder;
        try {
          mr = mimeType ? new MediaRecorder(stream!, { mimeType }) : new MediaRecorder(stream!);
        } catch {
          emitError("audio-capture");
          return;
        }
        mr.ondataavailable = (e: BlobEvent) => {
          // Log EVERY event (including size=0) so we can distinguish "never fires"
          // from "fires with empty blobs" — the only one we send is size > 0.
          if (e.data.size === 0) {
            console.warn("[DG] ondataavailable size=0 (empty blob — silent mic or codec issue)");
            return;
          }
          chunksSent++;
          bytesSent += e.data.size;
          if (chunksSent === 1 || chunksSent % 10 === 0) {
            console.log(
              `[DG] audio sending — chunk=${chunksSent} size=${e.data.size} total_bytes=${bytesSent} ws_state=${ws?.readyState}`,
            );
          }
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
        };
        mr.onerror = (ev) => console.warn("[DG] MediaRecorder error:", ev);
        try {
          mr.start(250); // fire ondataavailable every 250ms
          console.log(`[DG] MediaRecorder started — state=${mr.state} tracks=${stream?.getAudioTracks().length}`);
        } catch (e) {
          // If start() throws (invalid state, unsupported codec, etc.) the rest of
          // onopen won't execute, leaving the turn with no idle timer → hangs forever.
          // Emit an error so the page can re-arm or fall back instead of hanging.
          console.error("[DG] MediaRecorder.start() threw:", e);
          emitError("audio-capture");
          return;
        }
        mediaRecorder = mr;

        cb.onStart?.();
        resetIdle();
      };
      socket.onmessage = onWsMessage;
      socket.onerror = () => {
        // The close event carries the code and drives termination; an error with no
        // following close is caught by the connect/idle watchdog.
        console.warn(`[deepgram] socket error (${opened ? "open" : "pre-open"})`);
      };
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
