"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Composer from "@/components/Composer";
import Deck, { type DeckHandle } from "@/components/Deck";
import MorningBrief, { type MorningBriefData, type BriefStatus } from "@/components/MorningBrief";
import PresenceTelemetry from "@/components/PresenceTelemetry";
import IntelDeckSurface from "@/components/surfaces/IntelDeckSurface";
import CommsSurface from "@/components/surfaces/CommsSurface";
import { SCREENS, SCREEN_LABELS, screenIndex } from "@/lib/screens";
import type { AugustState, Theme } from "@/components/Presence3D";
import type { GlobeTarget } from "@/components/command/CommandGlobe";
import {
  createRecognizer,
  createSpeechQueue,
  isRecognitionSupported,
  primeAudio,
  primeVoices,
  speak,
  type Recognizer,
  type RecognizerCallbacks,
  type SpeakHandle,
  type SpeechQueue,
} from "@/lib/speech";
import {
  closeDeepgramAudio,
  createDeepgramRecognizer,
  isDeepgramRecognizerSupported,
  probeDeepgram,
} from "@/lib/deepgram";
import { latMark, latReset } from "@/lib/latency";
import {
  enablePush,
  getPushState,
  registerServiceWorker,
  type PushState,
} from "@/lib/push-client";
import { playTone, setSoundEnabled, soundEnabled, type UiTone } from "@/lib/sound";

// WebGL components load only in the browser.
const Presence3D = dynamic(() => import("@/components/Presence3D"), { ssr: false });
const CommandGlobe = dynamic(() => import("@/components/command/CommandGlobe"), { ssr: false });

const DECK_LABELS = SCREENS.map((s) => SCREEN_LABELS[s]);

// Tool calls are framed in the chat stream with this separator (0x1F). Split
// AUGUST's spoken words from any tool events without disturbing the text path.
const TOOL_SEP = String.fromCharCode(0x1f);
type ToolEvent = { tool: string; input?: Record<string, unknown> };

function splitToolStream(raw: string): { text: string; tools: ToolEvent[] } {
  const tools: ToolEvent[] = [];
  let text = "";
  let i = 0;
  while (i < raw.length) {
    const start = raw.indexOf(TOOL_SEP, i);
    if (start === -1) {
      text += raw.slice(i);
      break;
    }
    text += raw.slice(i, start);
    const end = raw.indexOf(TOOL_SEP, start + 1);
    if (end === -1) break; // incomplete trailer — completes by stream end
    try {
      tools.push(JSON.parse(raw.slice(start + 1, end)) as ToolEvent);
    } catch {
      /* ignore malformed */
    }
    i = end + 1;
  }
  return { text, tools };
}

type ChatMessage = { role: "user" | "assistant"; content: string };

// Index just past the first sentence terminator at/after `from` whose chunk is at
// least `minLen` chars (for streaming TTS): lets the queue speak each sentence as it
// completes while the rest of the reply still generates. Returns -1 if no usable
// boundary yet. minLen avoids splitting on a stray early "1." / "Mr." and lets us
// keep the FIRST chunk small (fast first audio) but coalesce later ones (fewer
// /api/speak calls — the route is rate-limited).
function sentenceChunkEnd(s: string, from: number, minLen: number): number {
  const re = /[.!?…]["')\]]?(?:\s|$)/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const end = m.index + m[0].length;
    if (end - from >= minLen) return end;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Real microphone amplitude via a Web Audio AnalyserNode — drives "listening".
// ---------------------------------------------------------------------------
async function startMicLevel(
  amplitudeRef: React.MutableRefObject<number>,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AC();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const loop = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    amplitudeRef.current = Math.min(1, rms * 3.4);
    raf = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    audioCtx.close().catch(() => {});
    amplitudeRef.current = 0;
  };
}

// ---------------------------------------------------------------------------

export default function Home() {
  const [state, setState] = useState<AugustState>("boot");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [interim, setInterim] = useState("");
  const [micSupported, setMicSupported] = useState(false);
  // Deepgram streaming STT availability (server key present + browser can run the
  // pipeline). Preferred over Web Speech everywhere — it's the reliable, phone-first
  // engine. Web Speech remains the fallback when Deepgram isn't configured.
  const [deepgramAvailable, setDeepgramAvailable] = useState(false);
  const [booted, setBooted] = useState(false);
  const [commandTarget, setCommandTarget] = useState<GlobeTarget | null>(null);
  const [activeScreen, setActiveScreen] = useState(0);
  // Reply panel controls: dismissible, expandable transcript, persistent voice mute.
  const [panelOpen, setPanelOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dockClosing, setDockClosing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  // Morning Brief — the once-a-day spoken read, now a summonable Presence panel.
  const [brief, setBrief] = useState<MorningBriefData | null>(null);
  const [briefStatus, setBriefStatus] = useState<BriefStatus>("checking");
  const [briefPlaying, setBriefPlaying] = useState(false);
  const [briefDismissed, setBriefDismissed] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  // White / black theme — persisted; the toggle flips the whole token system.
  const [theme, setTheme] = useState<Theme>("light");
  // Hands-free voice mode: a continuous listen → think → speak → listen loop.
  const [voiceMode, setVoiceMode] = useState(false);
  // Web-push enablement state for the (deliberate, never auto-prompted) bell control.
  // Starts "unsupported" so SSR + first client render match; the mount effect resolves it.
  const [pushState, setPushState] = useState<PushState>("unsupported");
  // One-shot screen-reader announcements for the privacy-critical transitions
  // (mic goes live / off) — a persistent live region the visual bar can't cover.
  const [voiceAnnounce, setVoiceAnnounce] = useState("");

  const amplitudeRef = useRef(0);
  // Voice-mode loop refs (read inside recognizer/speech callbacks that outlive a render).
  const voiceModeRef = useRef(false);
  // Mirror of deepgramAvailable for the recognizer selection inside beginListening
  // (called from timers/callbacks that close over a stale render).
  const deepgramAvailableRef = useRef(false);
  const speechQueueRef = useRef<SpeechQueue | null>(null);
  const reArmTimerRef = useRef(0);
  const voiceErrorsRef = useRef(0);
  // Last STT diagnostic (e.g. a Deepgram close code) — shown if voice falls back.
  const voiceDiagRef = useRef("");
  const messagesRef = useRef<ChatMessage[]>([]);
  const speakHandleRef = useRef<SpeakHandle | null>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  const listeningActiveRef = useRef(false);
  // Monotonic counter stamped per beginListening() call so stale async callbacks
  // from a prior recognizer (fired after we've torn it down and started a new one)
  // are ignored rather than corrupting shared refs or triggering double re-arms.
  const recSessionRef = useRef(0);
  const sessionIdRef = useRef<string>("");
  // Server-side conversation thread (the landing's RECENT THREADS). null until
  // the first completed exchange persists one; a page load or /forget starts a
  // fresh conversation → fresh thread. Best-effort only — never blocks chat.
  const threadIdRef = useRef<string | null>(null);
  const globeNonceRef = useRef(0);
  const deckRef = useRef<DeckHandle | null>(null);
  const replyDockRef = useRef<HTMLDivElement | null>(null);
  const dockWrapRef = useRef<HTMLDivElement | null>(null);
  const mutedRef = useRef(false);
  const soundOnRef = useRef(true);
  const closeTimerRef = useRef(0);
  const themingTimerRef = useRef(0);
  // Generation counter + abort: a new send (or the stop control) supersedes any
  // in-flight stream, so a stale closure can never write over the new turn's UI.
  const genRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // True while AUGUST himself is sliding the deck (tool nav) — his narration should
  // stay on screen; only USER surface changes dismiss the reply panel.
  const augNavRef = useRef(false);
  const augNavTimerRef = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Keep the reply dock pinned to the newest line as the reply streams in.
  useEffect(() => {
    const el = replyDockRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replyText, historyOpen, messages]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Open/close the reply panel with the dock-in/dock-out animations.
  const openPanel = useCallback(() => {
    window.clearTimeout(closeTimerRef.current);
    setDockClosing(false);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setDockClosing(true);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setPanelOpen(false);
      setHistoryOpen(false);
      setDockClosing(false);
    }, 160); // just under --dur-fast + buffer; reduced-motion makes it instant anyway
  }, []);

  // Esc exits hands-free voice mode first (it's the bigger thing to back out of);
  // otherwise it dismisses the reply panel. Works even while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (voiceModeRef.current) exitVoiceMode();
      else closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closePanel]);

  // Clicking anywhere outside the dock + composer cluster dismisses the panel.
  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && dockWrapRef.current && !dockWrapRef.current.contains(t)) closePanel();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [panelOpen, closePanel]);

  // Boot: prime the voice list, detect mic support, resolve into idle.
  useEffect(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
    primeVoices();
    setMicSupported(isRecognitionSupported());
    try {
      if (window.localStorage.getItem("aug-muted") === "1") {
        setMuted(true);
        mutedRef.current = true;
      }
    } catch {
      /* private mode — mute just won't persist */
    }
    const on = soundEnabled();
    setSoundOn(on);
    soundOnRef.current = on;
    const id = window.setTimeout(() => {
      setState("idle");
      setBooted(true);
      if (soundOnRef.current && !mutedRef.current) playTone("ready");
    }, 2200);
    return () => window.clearTimeout(id);
  }, []);

  // Probe Deepgram STT once on mount (server key present + browser can run the
  // pipeline). When available it becomes the STT engine for both voice mode and
  // tap-to-talk; otherwise the loop falls back to Web Speech, then text.
  useEffect(() => {
    let cancelled = false;
    probeDeepgram().then((configured) => {
      if (cancelled) return;
      const usable = configured && isDeepgramRecognizerSupported();
      deepgramAvailableRef.current = usable;
      setDeepgramAvailable(usable);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // PWA: register the (minimal) service worker and resolve the push-control state.
  // Re-check on focus/visibility so installing to the home screen then reopening
  // (the iOS path) flips the bell from "install" to "enable" without a hard reload.
  useEffect(() => {
    registerServiceWorker();
    setPushState(getPushState());
    const refresh = () => setPushState(getPushState());
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
      micCleanupRef.current?.();
      recognizerRef.current?.stop();
      speakHandleRef.current?.cancel();
      speechQueueRef.current?.cancel();
      closeDeepgramAudio();
      window.clearTimeout(reArmTimerRef.current);
    };
  }, []);

  function stopSpeaking() {
    speakHandleRef.current?.cancel();
    speakHandleRef.current = null;
    speechQueueRef.current?.cancel();
    speechQueueRef.current = null;
    amplitudeRef.current = 0;
    // The brief shares the single speak handle — if it was reading, the card's
    // control must fall back from Stop to Replay.
    setBriefPlaying(false);
  }

  function stopListening() {
    listeningActiveRef.current = false;
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    micCleanupRef.current?.();
    micCleanupRef.current = null;
    amplitudeRef.current = 0;
  }

  // UI tones obey both switches: the sound toggle, and the voice mute
  // (sounds never play while muted).
  function uiTone(name: UiTone) {
    if (!soundOnRef.current || mutedRef.current) return;
    playTone(name);
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    try {
      window.localStorage.setItem("aug-muted", next ? "1" : "0");
    } catch {
      /* non-persistent */
    }
    if (next) {
      stopSpeaking();
      setState((s) => (s === "speaking" ? "idle" : s));
    } else if (soundOnRef.current) {
      playTone("toggle"); // only audible feedback on UNmute — never while muted
    }
  }

  // The bell control. Deliberate, never auto-prompted. On a fresh browser it requests
  // permission + subscribes; otherwise it explains the current state (iOS needs the
  // app installed first; a blocked permission must be re-enabled in site settings).
  // Feedback rides the existing reply panel — no new UI surface.
  async function handleNotify() {
    const s = getPushState();
    if (s === "granted") {
      setReplyText("Notifications are on — I can reach you even when AUGUST is closed.");
      openPanel();
      return;
    }
    if (s === "ios-install") {
      setReplyText(
        "To get notifications on iPhone, install AUGUST first: tap the Share button, then “Add to Home Screen.” Open AUGUST from the home screen and tap the bell again.",
      );
      openPanel();
      return;
    }
    if (s === "denied") {
      setReplyText(
        "Notifications are blocked for this site. Re-enable them in your browser’s settings for this page, then tap the bell again.",
      );
      openPanel();
      return;
    }
    // "default" — request permission + subscribe (this call is the user gesture).
    const r = await enablePush();
    setPushState(getPushState());
    if (r.ok) {
      uiTone("ready");
      setReplyText("Notifications enabled. I’ll be able to reach you off-screen.");
    } else if (r.reason === "ios-install") {
      setReplyText(
        "On iPhone, install AUGUST to the home screen first (Share → Add to Home Screen), then enable notifications from the installed app.",
      );
    } else if (r.reason === "denied") {
      setReplyText("Notification permission was declined. You can enable it anytime from the bell.");
    } else if (r.reason === "config" || r.reason === "unsupported") {
      setReplyText("Notifications aren’t available in this browser.");
    } else {
      setReplyText("Couldn’t enable notifications just now — try again in a moment.");
    }
    openPanel();
  }

  function toggleSound() {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next && !mutedRef.current) playTone("toggle");
  }

  function stopGeneration() {
    // Halts the in-flight stream; the partial text stays on screen.
    abortRef.current?.abort();
  }

  function stopVoice() {
    // Skip his current speech. In voice mode that hands the turn back to you
    // (re-arm); otherwise settle to idle.
    stopSpeaking();
    concludeSpeech();
  }

  // --- Hands-free voice mode ------------------------------------------------
  // A continuous loop: listen (user mic → orb) → think → speak (Daniel → orb) →
  // listen again, no per-turn buttons. It reuses the existing recognizer, the
  // existing /api/chat brain (persona + memory + tools), and ElevenLabs speak().
  // BARGE-IN is intentionally out of scope for v1 — AUGUST finishes speaking
  // before the mic re-opens. The hook for it would live here: while the speech
  // queue plays, run a lightweight mic VAD and, on detected user speech, call
  // stopSpeaking() + beginListening(). Not built now (needs echo cancellation so
  // his own voice doesn't trigger it).

  // Single-slot timer, last-writer-wins: re-arm callers (concludeSpeech, silence
  // onEnd, benign-error onError) are mutually exclusive within a turn, so clearing
  // the prior pending re-arm before scheduling a new one is intentional de-dup —
  // never two live re-arms at once. The fire-time check makes a late timer a no-op
  // after exit (voiceModeRef cleared) or once listening has already resumed.
  function reArmListen(delay: number) {
    window.clearTimeout(reArmTimerRef.current);
    reArmTimerRef.current = window.setTimeout(() => {
      if (voiceModeRef.current && !listeningActiveRef.current) beginListening();
    }, delay);
  }

  // The single continuation after ANY spoken turn ends: in voice mode, loop back
  // to listening; otherwise settle to idle.
  function concludeSpeech() {
    amplitudeRef.current = 0;
    speakHandleRef.current = null;
    speechQueueRef.current = null;
    // In voice mode, loop straight back to listening (beginListening flips the
    // state ~150ms later); the orb stays at its calm speaking baseline in the gap
    // — no "thinking" flash after he's already finished talking.
    if (voiceModeRef.current) reArmListen(150);
    else setState("idle");
  }

  function speakReply(text: string) {
    if (mutedRef.current) {
      concludeSpeech();
      return;
    }
    setState("speaking");
    speakHandleRef.current = speak(text, {
      onLevel: (v) => {
        amplitudeRef.current = v;
      },
      onEnd: () => concludeSpeech(),
      onError: () => concludeSpeech(),
    });
  }

  // Open the mic for one utterance. Shared by tap-to-talk and the voice-mode
  // loop; the recognizer callbacks branch on voiceModeRef for re-arm vs idle.
  function beginListening() {
    stopListening(); // tear down any prior capture first
    primeAudio();
    stopSpeaking();
    if (!voiceModeRef.current) setReplyText(""); // tap clears; voice keeps last reply visible
    setInterim("");
    openPanel();
    listeningActiveRef.current = true;
    setState("listening");

    // Stamp this recognizer instance. Callbacks capture mySession at creation time
    // and bail immediately if recSessionRef has moved on — prevents a stale onerror/
    // onend (fired async after stopListening → rec.stop()) from corrupting the new
    // session's listeningActiveRef or scheduling a spurious re-arm.
    const mySession = ++recSessionRef.current;

    // Deepgram owns its own audio graph and reports the mic level via onLevel;
    // Web Speech can't, so only in that fallback do we run a separate analyser
    // to drive the listening orb.
    const useDeepgram = deepgramAvailableRef.current;
    if (!useDeepgram) {
      startMicLevel(amplitudeRef)
        .then((cleanup) => {
          if (recSessionRef.current === mySession && listeningActiveRef.current) {
            micCleanupRef.current = cleanup;
          } else {
            cleanup();
          }
        })
        .catch(() => {
          /* analyser is optional — recognition still works without the orb meter */
        });
    }

    const callbacks: RecognizerCallbacks = {
      onLevel: (v) => {
        if (recSessionRef.current === mySession && listeningActiveRef.current) {
          amplitudeRef.current = v;
        }
      },
      onStart: () => {
        // A real capture start (Deepgram fires this on socket open) is strong
        // evidence the transient trouble cleared — reset the streak so the "5
        // consecutive failures" semantics stay actually consecutive.
        if (recSessionRef.current !== mySession) return;
        voiceErrorsRef.current = 0;
        voiceDiagRef.current = "";
      },
      onPartial: (t) => {
        if (recSessionRef.current !== mySession || !listeningActiveRef.current) return;
        setInterim(t);
      },
      onResult: (t) => {
        if (recSessionRef.current !== mySession || !listeningActiveRef.current) return;
        listeningActiveRef.current = false;
        micCleanupRef.current?.();
        micCleanupRef.current = null;
        amplitudeRef.current = 0;
        setInterim("");
        voiceErrorsRef.current = 0; // a clean capture clears the error streak
        voiceDiagRef.current = "";
        if (voiceModeRef.current) handleTranscript(t);
        else handleSend(t);
      },
      onEnd: () => {
        if (recSessionRef.current !== mySession) return; // stale — already restarted
        micCleanupRef.current?.();
        micCleanupRef.current = null;
        amplitudeRef.current = 0;
        if (listeningActiveRef.current) {
          // ended on silence with no transcript — restart promptly
          listeningActiveRef.current = false;
          setInterim("");
          if (voiceModeRef.current) reArmListen(300);
          else setState((s) => (s === "listening" ? "idle" : s));
        }
      },
      onError: (err, detail) => {
        if (recSessionRef.current !== mySession) return; // stale — ignore completely
        if (detail) voiceDiagRef.current = detail; // e.g. a Deepgram close code
        micCleanupRef.current?.();
        micCleanupRef.current = null;
        amplitudeRef.current = 0;
        const wasActive = listeningActiveRef.current;
        listeningActiveRef.current = false;
        setInterim("");

        // Intentional stop (new turn / exit called rec.stop()) — don't re-arm.
        if (err === "aborted") {
          if (!voiceModeRef.current && wasActive) setState((s) => (s === "listening" ? "idle" : s));
          return;
        }

        // Voice setup couldn't load (AudioWorklet module fetch/parse failed) — the
        // mic is fine, so don't blame permission; fall back to text gracefully.
        if (err === "worklet-unsupported") {
          if (wasActive) voiceTrouble("Voice setup couldn't load in this browser — text still works.");
          return;
        }

        // Fatal: mic permission denied or hardware unavailable.
        if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") {
          if (wasActive) micBlocked();
          return;
        }

        // no-speech: the browser timed out waiting for the user to speak.
        // This is normal during pauses and must NOT count as a failure — doing so
        // was what caused voiceTrouble() to fire after a few seconds of silence.
        if (err === "no-speech") {
          if (voiceModeRef.current && wasActive) reArmListen(300);
          else if (!voiceModeRef.current && wasActive) setState((s) => (s === "listening" ? "idle" : s));
          return;
        }

        // Transient (network / bad-grammar / etc.): count genuine failures and
        // back out only after several consecutive real errors. Guard wasActive so
        // a stale error from a recognizer we deliberately stopped doesn't re-arm.
        if (voiceModeRef.current && wasActive) {
          voiceErrorsRef.current += 1;
          if (voiceErrorsRef.current >= 5) {
            voiceTrouble();
            return;
          }
          // Back off between reconnects so a hard failure isn't a tight retry storm.
          reArmListen(Math.min(400 * voiceErrorsRef.current, 2500));
        } else if (!voiceModeRef.current && wasActive) {
          setState((s) => (s === "listening" ? "idle" : s));
        }
      },
    };
    const rec = useDeepgram
      ? createDeepgramRecognizer(callbacks)
      : createRecognizer(callbacks);
    recognizerRef.current = rec;
    rec.start();
  }

  function enterVoiceMode() {
    if (!deepgramAvailable && !micSupported) {
      setReplyText(
        "Hands-free voice isn't available in this browser. Text and tap-to-talk still work.",
      );
      openPanel();
      return;
    }
    voiceModeRef.current = true;
    setVoiceMode(true);
    voiceErrorsRef.current = 0;
    setVoiceAnnounce("Voice mode on — microphone live.");
    uiTone("ready");
    primeAudio();
    beginListening();
  }

  function exitVoiceMode() {
    voiceModeRef.current = false;
    setVoiceMode(false);
    window.clearTimeout(reArmTimerRef.current);
    abortRef.current?.abort(); // drop any in-flight reply
    stopListening();
    stopSpeaking();
    closeDeepgramAudio(); // release the shared capture context (no-op if Web Speech)
    setInterim("");
    setState((s) => (s === "boot" ? s : "idle"));
    setVoiceAnnounce("Voice mode off.");
    uiTone("toggle");
  }

  function toggleVoiceMode() {
    if (voiceModeRef.current) exitVoiceMode();
    else enterVoiceMode();
  }

  // Permission/hardware denial: stop the loop, keep text working, say so plainly.
  function micBlocked() {
    voiceModeRef.current = false;
    setVoiceMode(false);
    window.clearTimeout(reArmTimerRef.current);
    listeningActiveRef.current = false;
    closeDeepgramAudio();
    setState((s) => (s === "listening" ? "idle" : s));
    setReplyText(
      "I can't reach your microphone — check this site's mic permission in the browser. You can still talk to me by typing.",
    );
    setVoiceAnnounce("Microphone unavailable — voice mode off. Text still works.");
    openPanel();
  }

  // Repeated recognizer failures (e.g. a rejected STT connection), or a one-shot
  // setup failure: back out gracefully, keeping text. Optional message overrides
  // the default copy (e.g. a worklet that couldn't load). The default surfaces the
  // last diagnostic (a Deepgram close code) so a real failure is visible, not generic.
  function voiceTrouble(message?: string) {
    voiceModeRef.current = false;
    setVoiceMode(false);
    window.clearTimeout(reArmTimerRef.current);
    listeningActiveRef.current = false;
    closeDeepgramAudio();
    setState((s) => (s === "listening" ? "idle" : s));
    const diag = voiceDiagRef.current;
    setReplyText(
      message ??
        `Voice connection kept dropping${diag ? ` (${diag})` : ""} — I've switched to text. Type to me.`,
    );
    setVoiceAnnounce("Voice mode off — the speech connection was unavailable. Text still works.");
    openPanel();
  }

  // A couple of spoken commands handled locally (no brain round-trip). Everything
  // else flows to /api/chat, where the existing tools (go_to_screen, look_closer,
  // close_map) already act on his words. Returns true if handled here.
  function tryVoiceCommand(raw: string): boolean {
    const t = raw.trim().toLowerCase().replace(/[.!?,]+$/g, "");
    if (
      voiceModeRef.current &&
      (t === "exit voice mode" ||
        t === "stop listening" ||
        t === "stop voice mode" ||
        t === "turn off voice mode" ||
        t === "turn off voice" ||
        t === "exit voice" ||
        t === "end voice mode")
    ) {
      exitVoiceMode();
      setReplyText("Voice mode off.");
      openPanel();
      return true;
    }
    if (
      t.length <= 32 &&
      /\b(brief me|play (?:the |my )?brief|read (?:me )?the brief|morning brief)\b/.test(t)
    ) {
      voiceBrief();
      return true;
    }
    return false;
  }

  function handleTranscript(t: string) {
    if (tryVoiceCommand(t)) return;
    handleSend(t);
  }

  // "Brief me" by voice: play it if ready, else summon + compile and keep the
  // loop alive (the card offers playback once it lands).
  function voiceBrief() {
    setInterim("");
    if (brief) {
      if (mutedRef.current) {
        setReplyText("Voice is muted — unmute to hear the brief.");
        openPanel();
        concludeSpeech();
      } else {
        playBrief(); // its onEnd routes through concludeSpeech (re-arm in voice mode)
      }
      return;
    }
    summonBrief(); // compiles if none yet + opens the card
    setReplyText("Pulling your brief together…");
    openPanel();
    concludeSpeech();
  }

  // --- Morning Brief --------------------------------------------------------
  // Dismissal persists per-day so it doesn't reappear on every app open.
  const briefDismissKey = "aug-brief-dismissed";
  function isBriefDismissed(date: string): boolean {
    try {
      return window.localStorage.getItem(briefDismissKey) === date;
    } catch {
      return false;
    }
  }

  // Theme: load the persisted choice once, then keep <html data-theme> + storage
  // in sync (layout.tsx sets the attribute pre-paint to avoid a flash).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("aug-theme");
      if (saved === "light" || saved === "dark" || saved === "batman") setTheme(saved);
    } catch {
      /* private mode */
    }
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("aug-theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  // Flip the theme with a transient app-wide colour cross-fade — the brief
  // [data-theming] window applies a one-off transition to everything, then clears
  // (so there's no permanent transition cost). No hard flash.
  function toggleTheme() {
    const root = document.documentElement;
    root.setAttribute("data-theming", "");
    window.clearTimeout(themingTimerRef.current);
    themingTimerRef.current = window.setTimeout(() => root.removeAttribute("data-theming"), 460);
    // three-way cycle: dark → light → batman (Gotham) → dark
    setTheme((t) => (t === "dark" ? "light" : t === "light" ? "batman" : "dark"));
  }

  // On boot, ask whether today's brief is already waiting (cheap GET, never
  // compiles). If one's ready and not dismissed today, auto-deliver it (on-open).
  useEffect(() => {
    if (!booted) return;
    let cancelled = false;
    // Arrived from the morning-brief push (notificationclick → "/?brief=1")? Force the
    // card open with its one-tap play control regardless of today's dismissal, then
    // strip the param so a later reload doesn't re-trigger it.
    let fromPush = false;
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("brief")) {
        fromPush = true;
        u.searchParams.delete("brief");
        window.history.replaceState({}, "", u.toString());
      }
    } catch {
      /* no-op */
    }
    fetch("/api/brief", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: { ready?: boolean; brief?: MorningBriefData | null }) => {
        if (cancelled) return;
        if (j.ready && j.brief) {
          setBrief(j.brief); // always store so the summon trigger has it later
          if (fromPush) {
            // Came from the push: always surface it (clear any same-day dismissal).
            try {
              window.localStorage.removeItem(briefDismissKey);
            } catch {
              /* private mode */
            }
            setBriefDismissed(false);
            setBriefOpen(true);
          } else if (isBriefDismissed(j.brief.date)) {
            setBriefDismissed(true);
          } else {
            setBriefOpen(true); // on-open delivery
          }
          setBriefStatus("ready");
        } else {
          setBriefStatus("none");
        }
      })
      .catch(() => {
        if (!cancelled) setBriefStatus("none");
      });
    return () => {
      cancelled = true;
    };
  }, [booted]);

  // Deep-link: a Watcher push opens "/?screen=markets|world" — slide the deck to that
  // surface so the tap lands where the alert points, then strip the param.
  useEffect(() => {
    if (!booted) return;
    let screen: string | null = null;
    try {
      const u = new URL(window.location.href);
      screen = u.searchParams.get("screen");
      if (screen) {
        u.searchParams.delete("screen");
        window.history.replaceState({}, "", u.toString());
      }
    } catch {
      /* no-op */
    }
    if (!screen) return;
    const idx = screenIndex(screen);
    if (idx >= 0) {
      markAugNav();
      // Defer one tick so the deck is mounted + measured before it scrolls.
      const t = window.setTimeout(() => deckRef.current?.goTo(idx), 80);
      return () => window.clearTimeout(t);
    }
  }, [booted]);

  // Summon the brief panel on demand; compile if none exists yet.
  function summonBrief() {
    setBriefDismissed(false);
    setBriefOpen(true);
    if (briefStatus === "none" || briefStatus === "error") compileBriefNow();
  }

  // Speak the brief — reuses the chat speech path so AUGUST's orb pulses to his
  // real voice. Gated behind this click so the browser autoplay policy is satisfied.
  function playBrief() {
    if (!brief) return;
    if (mutedRef.current) {
      // Muted: don't speak (and don't tear down anything in flight just to say so).
      // The card already shows the text; nudge him to unmute to hear it.
      setReplyText("Voice is muted — unmute to hear the brief.");
      openPanel();
      return;
    }
    primeAudio();
    stopSpeaking();
    stopListening();
    abortRef.current?.abort(); // a brief read supersedes any in-flight chat too
    setBriefPlaying(true);
    setState("speaking");
    speakHandleRef.current = speak(brief.text, {
      onLevel: (v) => {
        amplitudeRef.current = v;
      },
      onEnd: () => {
        setBriefPlaying(false);
        concludeSpeech();
      },
      onError: () => {
        setBriefPlaying(false);
        concludeSpeech();
      },
    });
  }

  // "Brief me" — compile on demand when none is waiting yet.
  function compileBriefNow() {
    setBriefStatus("compiling");
    fetch("/api/brief", { method: "POST" })
      .then(async (r) => {
        if (r.status === 429) throw new Error("rate");
        if (!r.ok) throw new Error("compile");
        return r.json() as Promise<{ ready?: boolean; brief?: MorningBriefData | null }>;
      })
      .then((j) => {
        if (j.ready && j.brief) {
          // Deliberate re-request: clear any same-day dismissal so it survives reload.
          try {
            window.localStorage.removeItem(briefDismissKey);
          } catch {
            /* private mode */
          }
          setBrief(j.brief);
          setBriefDismissed(false);
          setBriefOpen(true);
          setBriefStatus("ready");
        } else {
          setBriefStatus("error");
        }
      })
      .catch(() => setBriefStatus("error"));
  }

  function dismissBrief() {
    if (brief) {
      try {
        window.localStorage.setItem(briefDismissKey, brief.date);
      } catch {
        /* private mode — won't persist */
      }
    }
    if (briefPlaying) stopSpeaking();
    setBriefDismissed(true);
    setBriefOpen(false);
  }

  // Flag the next surface change as AUGUST-driven so it doesn't dismiss his reply.
  function markAugNav() {
    augNavRef.current = true;
    window.clearTimeout(augNavTimerRef.current);
    augNavTimerRef.current = window.setTimeout(() => {
      augNavRef.current = false;
    }, 1600);
  }

  function applyToolEvents(tools: ToolEvent[]) {
    for (const t of tools) {
      if (t.tool === "look_closer" && t.input) {
        const lat = Number(t.input.lat);
        const lon = Number(t.input.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const label = typeof t.input.label === "string" ? t.input.label : "";
        const zoom = typeof t.input.zoom === "number" ? t.input.zoom : undefined;
        globeNonceRef.current += 1;
        setCommandTarget({ lat, lon, label, zoom, key: globeNonceRef.current });
        markAugNav();
        deckRef.current?.goTo(screenIndex("world"));
      } else if (t.tool === "close_map") {
        markAugNav();
        deckRef.current?.goTo(screenIndex("presence"));
      } else if (t.tool === "go_to_screen" && t.input) {
        const idx = screenIndex(String(t.input.screen ?? ""));
        if (idx >= 0) {
          markAugNav();
          deckRef.current?.goTo(idx);
        }
      }
    }
  }

  // USER surface changes dismiss the reply panel — a stale reply must not follow
  // you across the deck. AUGUST's own navigation keeps his narration visible.
  // useCallback is load-bearing: Deck keys its debounced scroll effect on this
  // prop's identity, and an unstable function would re-subscribe the effect on
  // every streamed chunk — clearing the pending debounce and silently losing
  // active-surface tracking (stale dots, globe never activates).
  const handleSurfaceChange = useCallback(
    (i: number) => {
      if (augNavRef.current) {
        // AUGUST is driving — update the indicator (CommandGlobe needs this)
        // but keep the reply panel open so his narration stays visible.
        setActiveScreen(i);
        return;
      }
      setActiveScreen(i);
      closePanel();
    },
    [closePanel],
  );

  function forgetMemory() {
    // Wipe persistent memory (Upstash) and reset the on-screen conversation.
    void fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "forget" }),
    }).catch(() => {});
    stopSpeaking();
    stopListening();
    messagesRef.current = [];
    setMessages([]);
    threadIdRef.current = null; // the wiped conversation is over — next exchange opens a new thread
    setInterim("");
    openPanel();
    setHistoryOpen(false);
    const line = "Done. I've let it go — we start clean.";
    setReplyText(line);
    speakReply(line);
  }

  async function handleSend(raw: string) {
    const text = raw.trim();
    if (!text) return;

    if (text.toLowerCase() === "/forget") {
      forgetMemory();
      return;
    }

    latReset(); // t0 — turn start (≈ transcript committed for the voice path)
    primeAudio();
    stopSpeaking(); // a new message always cuts current speech
    stopListening();
    abortRef.current?.abort(); // ...and supersedes any in-flight generation
    const gen = ++genRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    const next = [...messagesRef.current, { role: "user" as const, content: text }];
    messagesRef.current = next;
    setMessages(next);
    setInterim("");
    setReplyText("");
    openPanel(); // a new reply (re)opens the panel
    setState("thinking");
    uiTone("send");

    let full = "";
    try {
      latMark("t1"); // chat request sent
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // voice turns ask for Haiku 4.5 server-side (lowest TTFT for the spoken loop).
        body: JSON.stringify({ messages: next, voice: voiceModeRef.current }),
        signal: controller.signal,
      });
      if (gen !== genRef.current) return; // superseded while connecting

      if (res.status === 429) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        if (gen !== genRef.current) return;
        setReplyText(body.message ?? "Easy — too many requests. Give it a second.");
        concludeSpeech(); // re-arms the mic in voice mode so the loop survives
        return;
      }

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        if (gen !== genRef.current) return; // superseded while reading the error body
        setReplyText(errText || "— AUGUST is unreachable —");
        concludeSpeech(); // keep the voice-mode loop alive after a failed turn
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let appliedTools = 0;

      // Streaming TTS: start speaking the first sentence the moment it lands so
      // playback begins before the full reply finishes generating; the remainder
      // is spoken as one more chunk at the end. ~1-2 /api/speak calls per turn
      // (the route is rate-limited to 15/min), reusing the Daniel voice + orb.
      // The queue's onEnd → concludeSpeech, which re-arms the mic in voice mode.
      let queue: SpeechQueue | null = null;
      let spokenLen = 0;
      const makeQueue = (): SpeechQueue =>
        createSpeechQueue({
          onStart: () => {
            if (gen === genRef.current) setState("speaking");
          },
          onLevel: (v) => {
            amplitudeRef.current = v;
          },
          onEnd: () => {
            if (gen === genRef.current) concludeSpeech();
          },
        });

      for (;;) {
        const { value, done } = await reader.read();
        if (gen !== genRef.current) return; // superseded mid-stream — the new turn owns the UI
        if (done) {
          latMark("t2b"); // LLM full response done
          break;
        }
        latMark("t2"); // LLM first token (first-occurrence-only)
        full += decoder.decode(value, { stream: true });
        const parsed = splitToolStream(full);
        setReplyText(parsed.text);
        // Fire tool calls (globe / navigation) the moment they arrive — before
        // the narration streams in after them.
        if (parsed.tools.length > appliedTools) {
          applyToolEvents(parsed.tools.slice(appliedTools));
          appliedTools = parsed.tools.length;
        }
        // Per-sentence pipelining — voice mode only, where hands-free latency matters
        // most. Push each sentence to the prefetching queue the moment it completes so
        // playback starts on sentence one and later sentences are fetched/decoded while
        // earlier ones play (no dead air, TTS overlaps the LLM). The FIRST chunk is kept
        // short (minLen 18) for the fastest possible first audio; later chunks coalesce
        // to ~80 chars so a long reply doesn't burn the /api/speak rate limit. Typed
        // replies stay a single smooth /api/speak call.
        if (voiceModeRef.current && !mutedRef.current) {
          for (;;) {
            const end = sentenceChunkEnd(parsed.text, spokenLen, spokenLen === 0 ? 18 : 80);
            if (end <= 0) break;
            const chunk = parsed.text.slice(spokenLen, end).trim();
            if (chunk) {
              if (!queue) {
                queue = makeQueue();
                speechQueueRef.current = queue;
              }
              queue.push(chunk);
            }
            spokenLen = end;
          }
        }
      }

      const { text: spoken, tools } = splitToolStream(full);
      if (tools.length > appliedTools) applyToolEvents(tools.slice(appliedTools));
      const reply = spoken.trim();

      if (reply) {
        const withAssistant = [...next, { role: "assistant" as const, content: reply }];
        messagesRef.current = withAssistant;
        setMessages(withAssistant);
        uiTone("reply");

        if (mutedRef.current) {
          queue?.cancel(); // muted mid-reply: drop any eagerly-started audio
          concludeSpeech(); // no audio — but keep the voice-mode loop alive
        } else if (queue) {
          // We started speaking sentence one mid-stream — speak the remainder.
          const remainder = spoken.slice(spokenLen).trim();
          if (remainder) queue.push(remainder);
          queue.end(); // onEnd → concludeSpeech once the queue drains
        } else {
          // Short reply / no sentence boundary mid-stream — speak it whole.
          const q = makeQueue();
          speechQueueRef.current = q;
          q.push(reply);
          q.end();
        }

        // Background: update long-term memory. Fire-and-forget — never blocks the reply.
        void fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update",
            sessionId: sessionIdRef.current,
            userText: text,
            assistantText: reply,
          }),
        }).catch(() => {});

        // Background: persist the conversation as a thread (RECENT THREADS on the
        // landing). Fire-and-forget and best-effort — a failure never blocks or
        // breaks the chat. Pre-trimmed to the server caps (≤40 messages, ≤8KB
        // each — see lib/threads.ts) so long sessions keep persisting instead of
        // tripping the route's 400 validation.
        void fetch("/api/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: threadIdRef.current ?? undefined,
            messages: withAssistant.slice(-40).map((m) => ({
              role: m.role,
              content: m.content.length > 8000 ? m.content.slice(0, 8000) : m.content,
            })),
          }),
        })
          .then((r) => (r.ok ? (r.json() as Promise<{ id?: string }>) : null))
          .then((d) => {
            if (d && typeof d.id === "string") threadIdRef.current = d.id;
          })
          .catch(() => {});
      } else {
        concludeSpeech();
      }
    } catch (err) {
      if (gen !== genRef.current) return; // superseded — stay silent
      if ((err as Error)?.name === "AbortError") {
        // Stop/exit/supersede: intentional halt. Don't re-arm here — exitVoiceMode
        // already cleared voiceModeRef, and a superseding turn owns the next step.
        setState("idle");
        return;
      }
      setReplyText("— connection lost —");
      concludeSpeech(); // re-arm the mic in voice mode so the loop recovers
    }
  }

  function toggleMic() {
    // Voice mode owns the mic and re-arms automatically — its own toggle controls
    // it, so a manual tap here is a no-op while hands-free is on.
    if (voiceModeRef.current) return;
    if (listeningActiveRef.current) {
      // Tap again = cancel listening (no send).
      stopListening();
      setInterim("");
      setState("idle");
      return;
    }
    beginListening();
  }

  const statusLabel =
    state === "thinking" ? "THINKING" : state === "listening" ? "LISTENING" : null;

  // Either STT engine enables voice + tap-to-talk. Deepgram is preferred and works
  // on phones where Web Speech (micSupported) doesn't.
  const voiceCapable = micSupported || deepgramAvailable;

  return (
    <main className="stage-vignette relative h-[100dvh] w-screen overflow-hidden">
      <BootHud />
      <FrameTicks />
      {/* Always-present live region for the privacy-critical voice transitions —
          a conditionally-mounted bar wouldn't announce its first "mic live" state. */}
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {voiceAnnounce}
      </div>

      <Deck
        ref={deckRef}
        labels={DECK_LABELS}
        onActiveChange={handleSurfaceChange}
        surfaces={[
          <div key="presence" className="presence-surface">
            <Presence3D state={state} amplitudeRef={amplitudeRef} theme={theme} />
            <PresenceTelemetry
              state={state}
              sessionCount={messages.length}
              visible={booted && !briefOpen}
              onNavigate={(key) => deckRef.current?.goTo(screenIndex(key))}
            />
            {booted && !briefOpen ? (
              <button type="button" className="brief-summon" onClick={summonBrief}>
                <span className="brief-summon-dot" /> today&rsquo;s brief
              </button>
            ) : null}
            {booted && briefOpen ? (
              <MorningBrief
                brief={brief}
                status={briefStatus}
                playing={briefPlaying}
                onPlay={playBrief}
                onStop={stopVoice}
                onCompile={compileBriefNow}
                onDismiss={dismissBrief}
              />
            ) : null}
          </div>,
          // MarketsSurface was replaced by the embedded intel desk (user decision:
          // intel is a full deck surface, not a corner pill; the file stays).
          <IntelDeckSurface key="markets" active={activeScreen === screenIndex("markets")} />,
          <CommandGlobe
            key="world"
            active={activeScreen === screenIndex("world")}
            flyTo={commandTarget}
          />,
          <CommsSurface key="comms" />,
        ]}
      />

      {/* reply dock + composer — fixed, available on every surface. A contained,
          translucent card that never covers the dashboard widgets: dismissible
          (✕ / Esc / click outside), expandable into the session transcript. */}
      {/* pointer-events-none is load-bearing: the transparent full-width wrapper must
          never eat clicks meant for the surfaces beneath (globe reset, drag, click-
          outside dismissal). The dock and composer row re-enable their own events. */}
      <div
        ref={dockWrapRef}
        className="dock-wrap pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-4 pb-8 sm:pb-10"
      >
        {panelOpen && (replyText || interim || (historyOpen && messages.length > 0)) ? (
          <div
            className={`reply-dock${historyOpen ? " history" : ""}${dockClosing ? " closing" : ""}`}
            role="log"
            onClick={() => {
              // Don't expand when the user was selecting text to copy — the view
              // swap would unmount the node and destroy the selection.
              if (!historyOpen && !window.getSelection()?.toString()) setHistoryOpen(true);
            }}
          >
            <div className="dock-head">
              <button
                type="button"
                className="dock-ctl"
                onClick={(e) => {
                  e.stopPropagation();
                  setHistoryOpen((v) => !v);
                }}
              >
                {historyOpen ? "▾ reply" : "▸ transcript"}
              </button>
              <button
                type="button"
                className="dock-ctl dock-x"
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  closePanel();
                }}
              >
                ✕
              </button>
            </div>
            <div className="dock-body" ref={replyDockRef}>
              {historyOpen ? (
                <>
                  {messages.map((m, i) => (
                    <p key={i} className={`dock-line${m.role === "user" ? " you" : ""}`}>
                      <span className="dock-who">{m.role === "user" ? "YOU" : "AUGUST"}</span>
                      {m.content}
                    </p>
                  ))}
                  {/* Any reply text not yet finalized into messages — a streaming
                      reply, a stopped partial, or the connection-lost line — must
                      stay visible in the transcript view too. */}
                  {(() => {
                    const last = messages[messages.length - 1];
                    const finalized =
                      !!last && last.role === "assistant" && last.content === replyText;
                    return replyText && !finalized ? (
                      <p className="dock-line">
                        <span className="dock-who">AUGUST</span>
                        {replyText}
                      </p>
                    ) : null;
                  })()}
                  {interim ? <p className="reply-interim">{interim}</p> : null}
                </>
              ) : interim ? (
                <p className="reply-interim">{interim}</p>
              ) : (
                <p className="reply-text">{replyText}</p>
              )}
            </div>
          </div>
        ) : statusLabel && !voiceMode ? (
          <div className="reply-status">{statusLabel}</div>
        ) : null}

        {voiceMode ? (
          <div className={`voice-bar voice-${state}`}>
            <span className="voice-bar-dot" aria-hidden />
            <span className="voice-bar-label">
              {state === "listening"
                ? "Listening…"
                : state === "thinking"
                  ? "Thinking…"
                  : state === "speaking"
                    ? "Speaking"
                    : "Voice mode on"}
            </span>
            <button
              type="button"
              className="voice-bar-exit"
              onClick={exitVoiceMode}
              aria-label="Exit hands-free voice mode"
              title="Exit voice mode (Esc)"
            >
              Exit
            </button>
          </div>
        ) : null}

        <div className="composer-row">
          <Composer
            onSend={handleSend}
            onToggleMic={toggleMic}
            listening={state === "listening"}
            busy={state === "thinking"}
            micSupported={voiceCapable}
            autoFocus={booted}
          />
          <div className="composer-ctls">
            <button
              type="button"
              className={`ctl-round ctl-voice${voiceMode ? " on" : ""}`}
              onClick={toggleVoiceMode}
              disabled={!voiceCapable || !booted}
              title={
                !voiceCapable
                  ? "Hands-free voice isn't available in this browser"
                  : voiceMode
                    ? "Exit voice mode (Esc)"
                    : "Hands-free voice mode"
              }
              aria-pressed={voiceMode}
              aria-label={voiceMode ? "Exit hands-free voice mode" : "Enter hands-free voice mode"}
            >
              <VoiceModeIcon active={voiceMode} />
            </button>
            {state === "thinking" ? (
              <button
                type="button"
                className="ctl-round"
                onClick={stopGeneration}
                title="Stop generating"
                aria-label="Stop generating"
              >
                <StopIcon />
              </button>
            ) : state === "speaking" ? (
              <button
                type="button"
                className="ctl-round"
                onClick={stopVoice}
                title="Stop voice"
                aria-label="Stop voice"
              >
                <StopIcon />
              </button>
            ) : null}
            <button
              type="button"
              className={`ctl-round${muted ? " on" : ""}`}
              onClick={toggleMute}
              title={muted ? "Voice muted — click to unmute" : "Mute voice"}
              aria-pressed={muted}
              aria-label={muted ? "Unmute voice" : "Mute voice"}
            >
              {muted ? <VoiceOffIcon /> : <VoiceIcon />}
            </button>
            <button
              type="button"
              className={`ctl-round${soundOn ? "" : " off"}`}
              onClick={toggleSound}
              title={soundOn ? "UI sounds on" : "UI sounds off"}
              aria-pressed={soundOn}
              aria-label={soundOn ? "Turn UI sounds off" : "Turn UI sounds on"}
            >
              <ToneIcon off={!soundOn} />
            </button>
            {pushState !== "unsupported" && (
              <button
                type="button"
                className={`ctl-round${pushState === "granted" ? " on" : ""}`}
                onClick={handleNotify}
                title={
                  pushState === "granted"
                    ? "Notifications on"
                    : pushState === "ios-install"
                      ? "Install AUGUST to enable notifications"
                      : pushState === "denied"
                        ? "Notifications blocked — tap for help"
                        : "Enable notifications"
                }
                aria-pressed={pushState === "granted"}
                aria-label={pushState === "granted" ? "Notifications enabled" : "Enable notifications"}
              >
                {pushState === "denied" ? <BellOffIcon /> : <BellIcon on={pushState === "granted"} />}
              </button>
            )}
            <button
              type="button"
              className="ctl-round ctl-theme"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light theme" : theme === "light" ? "Switch to Gotham theme" : "Switch to dark theme"}
              aria-label={theme === "dark" ? "Switch to light theme" : theme === "light" ? "Switch to Gotham theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <SunIcon /> : theme === "light" ? <SignalIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Small control icons (match the Composer's mic icon style).
// ---------------------------------------------------------------------------

function StopIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}

// Notification bell — outline by default, with a small "on" dot once enabled.
function BellIcon({ on = false }: { on?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2a3.5 3.5 0 0 0-3.5 3.5c0 3-1.3 4-1.3 4h9.6s-1.3-1-1.3-4A3.5 3.5 0 0 0 8 2Z" />
      <path d="M6.6 12a1.5 1.5 0 0 0 2.8 0" />
      {on && <circle cx="12.2" cy="3.8" r="2" fill="currentColor" stroke="none" />}
    </svg>
  );
}

// Bell with a slash — notifications blocked.
function BellOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.6 5.2A3.5 3.5 0 0 1 11.5 6c0 2.4.9 3.5 1.2 3.8" />
      <path d="M11.4 11.5H3.2s1.3-1 1.3-4v-.3" />
      <path d="M6.6 12a1.5 1.5 0 0 0 2.8 0" />
      <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" />
    </svg>
  );
}

// A centered audio waveform — the "hands-free voice" metaphor, kept distinct
// from the Composer's tap-to-talk mic and the sound toggle so the cluster reads
// clearly. The live/breathing treatment comes from .ctl-voice.on in CSS.
function VoiceModeIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.4 : 2}
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="3" y1="9.5" x2="3" y2="14.5" />
      <line x1="7.5" y1="6" x2="7.5" y2="18" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="16.5" y1="6" x2="16.5" y2="18" />
      <line x1="21" y1="9.5" x2="21" y2="14.5" />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9.5 9.5 0 0 1 0 13" />
    </svg>
  );
}

function VoiceOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <line x1="15" y1="9" x2="21" y2="15" />
      <line x1="21" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function ToneIcon({ off }: { off?: boolean }) {
  // A small note — the UI-tones toggle (distinct from the voice speaker).
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
      {off ? <line x1="3" y1="3" x2="21" y2="21" /> : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Corner frame ticks — thin L-marks in the four corners. The instrument frame:
// precise detail at the periphery while the centre stays calm. Purely decorative.
// ---------------------------------------------------------------------------

function FrameTicks() {
  return (
    <div className="frame-ticks" aria-hidden>
      <span className="frame-tick tl" />
      <span className="frame-tick tr" />
      <span className="frame-tick bl" />
      <span className="frame-tick br" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme toggle icons — the control lives in the composer's control cluster.
// ---------------------------------------------------------------------------

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

/* Signal icon — a beam ring, the third theme's cue. Same stroke language as
   Sun/Moon; monochrome (currentColor), no decoration. */
function SignalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="8.5" opacity="0.45" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Boot HUD — typed sequence in the corner, then a live ZULU clock.
// ---------------------------------------------------------------------------

function BootHud() {
  const LINES = ["SYSTEM INITIATED", "AUGUST · BUILD 0.10", "LOCATION — UNDISCLOSED"];
  const full = LINES.join("\n");
  const [n, setN] = useState(0);
  const [zulu, setZulu] = useState("");

  // Typewriter driven by ONE character index over the joined block, so even if React
  // double-invokes this effect (StrictMode / HMR) the chains converge instead of
  // racing line-by-line — one tidy block, never doubled or overlapping.
  useEffect(() => {
    if (n >= full.length) return;
    const id = window.setTimeout(() => setN((v) => Math.min(full.length, v + 1)), n === 0 ? 260 : 27);
    return () => window.clearTimeout(id);
  }, [n, full.length]);

  // Live ZULU timestamp — time-only; the full ISO date was corner clutter.
  useEffect(() => {
    const fmt = () => setZulu(new Date().toISOString().slice(11, 19) + "Z");
    fmt();
    const id = window.setInterval(fmt, 1000);
    return () => window.clearInterval(id);
  }, []);

  const shown = full.slice(0, n).split("\n");
  const done = n >= full.length;

  return (
    <div className={`boot-hud hud fixed left-5 top-5 z-30 select-none${done ? " settled" : ""}`}>
      {LINES.map((_, i) => (
        <div key={i} className={i === 1 ? "boot-brand" : "opacity-70"}>
          {shown[i] ?? ""}
        </div>
      ))}
      {done ? <div className="fade-in boot-zulu">{zulu}</div> : null}
    </div>
  );
}
