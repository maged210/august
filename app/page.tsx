"use client";

import { useEffect, useRef, useState } from "react";
import Circle, { type AugustState } from "@/components/Circle";
import Composer from "@/components/Composer";
import {
  createRecognizer,
  isRecognitionSupported,
  primeVoices,
  speak,
  type Recognizer,
  type SpeakHandle,
} from "@/lib/speech";

type ChatMessage = { role: "user" | "assistant"; content: string };

// ---------------------------------------------------------------------------
// Audio level sources (write 0..1 into a shared ref the Circle reads each frame)
// ---------------------------------------------------------------------------

// Real microphone amplitude via a Web Audio AnalyserNode — drives "listening".
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

// Synthetic envelope for TTS — browser SpeechSynthesis output can't be tapped by
// an AnalyserNode, so we drive "speaking" from word-boundary events + noise.
// (When speak() is swapped for ElevenLabs/OpenAI in v1, feed real amplitude here.)
function startSpeechEnvelope(amplitudeRef: React.MutableRefObject<number>) {
  let kick = 0;
  let raf = 0;
  const t0 = performance.now();
  const loop = () => {
    const t = (performance.now() - t0) / 1000;
    kick *= 0.86;
    const base = 0.16 + 0.1 * Math.abs(Math.sin(t * 7.5));
    amplitudeRef.current = Math.min(1, base + kick);
    raf = requestAnimationFrame(loop);
  };
  loop();
  return {
    boundary: () => {
      kick = Math.min(1, kick + 0.5 + Math.random() * 0.3);
    },
    stop: () => {
      cancelAnimationFrame(raf);
      amplitudeRef.current = 0;
    },
  };
}

// ---------------------------------------------------------------------------

export default function Home() {
  const [state, setState] = useState<AugustState>("boot");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [interim, setInterim] = useState("");
  const [micSupported, setMicSupported] = useState(false);
  const [booted, setBooted] = useState(false);

  const amplitudeRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const speakHandleRef = useRef<SpeakHandle | null>(null);
  const envelopeRef = useRef<ReturnType<typeof startSpeechEnvelope> | null>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  const listeningActiveRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Boot: prime the voice list, detect mic support, resolve into idle.
  useEffect(() => {
    primeVoices();
    setMicSupported(isRecognitionSupported());
    const id = window.setTimeout(() => {
      setState("idle");
      setBooted(true);
    }, 2200);
    return () => window.clearTimeout(id);
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
      envelopeRef.current?.stop();
    };
  }, []);

  function stopSpeaking() {
    speakHandleRef.current?.cancel();
    speakHandleRef.current = null;
    envelopeRef.current?.stop();
    envelopeRef.current = null;
  }

  function stopListening() {
    listeningActiveRef.current = false;
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    micCleanupRef.current?.();
    micCleanupRef.current = null;
    amplitudeRef.current = 0;
  }

  function speakReply(text: string) {
    setState("speaking");
    const env = startSpeechEnvelope(amplitudeRef);
    envelopeRef.current = env;
    speakHandleRef.current = speak(text, {
      onBoundary: () => env.boundary(),
      onEnd: () => {
        env.stop();
        envelopeRef.current = null;
        speakHandleRef.current = null;
        setState("idle");
      },
      onError: () => {
        env.stop();
        envelopeRef.current = null;
        speakHandleRef.current = null;
        setState("idle");
      },
    });
  }

  async function handleSend(raw: string) {
    const text = raw.trim();
    if (!text) return;

    stopSpeaking();
    stopListening();

    const next = [...messagesRef.current, { role: "user" as const, content: text }];
    messagesRef.current = next;
    setMessages(next);
    setInterim("");
    setReplyText("");
    setState("thinking");

    let full = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        setReplyText(errText || "— AUGUST is unreachable —");
        setState("idle");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setReplyText(full);
      }
      full = full.trim();

      if (full) {
        const withAssistant = [...next, { role: "assistant" as const, content: full }];
        messagesRef.current = withAssistant;
        setMessages(withAssistant);
        speakReply(full);
      } else {
        setState("idle");
      }
    } catch {
      setReplyText("— connection lost —");
      setState("idle");
    }
  }

  function toggleMic() {
    if (listeningActiveRef.current) {
      // Tap again = cancel listening (no send).
      stopListening();
      setInterim("");
      setState("idle");
      return;
    }

    stopSpeaking();
    setReplyText("");
    setInterim("");
    listeningActiveRef.current = true;
    setState("listening");

    startMicLevel(amplitudeRef)
      .then((cleanup) => {
        if (listeningActiveRef.current) micCleanupRef.current = cleanup;
        else cleanup();
      })
      .catch(() => {
        /* analyser is optional — listening still works without it */
      });

    const rec = createRecognizer({
      onPartial: (t) => {
        if (listeningActiveRef.current) setInterim(t);
      },
      onResult: (t) => {
        if (!listeningActiveRef.current) return;
        listeningActiveRef.current = false;
        micCleanupRef.current?.();
        micCleanupRef.current = null;
        amplitudeRef.current = 0;
        setInterim("");
        handleSend(t);
      },
      onEnd: () => {
        micCleanupRef.current?.();
        micCleanupRef.current = null;
        amplitudeRef.current = 0;
        if (listeningActiveRef.current) {
          listeningActiveRef.current = false;
          setInterim("");
          setState((s) => (s === "listening" ? "idle" : s));
        }
      },
      onError: () => {
        micCleanupRef.current?.();
        micCleanupRef.current = null;
        amplitudeRef.current = 0;
        if (listeningActiveRef.current) {
          listeningActiveRef.current = false;
          setInterim("");
          setState((s) => (s === "listening" ? "idle" : s));
        }
      },
    });
    recognizerRef.current = rec;
    rec.start();
  }

  const statusLabel =
    state === "thinking" ? "THINKING" : state === "listening" ? "LISTENING" : null;

  return (
    <main className="stage-vignette relative h-[100dvh] w-screen overflow-hidden bg-charcoal">
      <BootHud />

      {/* the circle is the star — always centered */}
      <div className="absolute inset-0 flex items-center justify-center">
        <Circle state={state} amplitudeRef={amplitudeRef} />
      </div>

      {/* reply text + composer, pinned bottom-center */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-5 px-4 pb-8 sm:pb-10">
        <div className="flex min-h-[3.5rem] w-full max-w-[680px] flex-col items-center justify-end text-center">
          {interim ? (
            <p className="fade-in text-[15px] italic text-ash/70">{interim}</p>
          ) : replyText ? (
            <p className="fade-in text-[17px] leading-relaxed text-bone/90">{replyText}</p>
          ) : statusLabel ? (
            <p className="hud text-ash/40">{statusLabel}</p>
          ) : null}
        </div>

        <Composer
          onSend={handleSend}
          onToggleMic={toggleMic}
          listening={state === "listening"}
          busy={state === "thinking"}
          micSupported={micSupported}
          autoFocus={booted}
        />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Boot HUD — typed sequence in the corner, then a live ZULU clock.
// ---------------------------------------------------------------------------

function BootHud() {
  const STATIC_LINES = ["SYSTEM INITIATED", "AUGUST · BUILD 0.06", "LOCATION — UNDISCLOSED"];
  const [typed, setTyped] = useState<string[]>(["", "", ""]);
  const [showClock, setShowClock] = useState(false);
  const [zulu, setZulu] = useState("");

  // Typewriter through the three static lines.
  useEffect(() => {
    let line = 0;
    let char = 0;
    let timer = 0;
    const tick = () => {
      if (line >= STATIC_LINES.length) {
        setShowClock(true);
        return;
      }
      char += 1;
      const current = STATIC_LINES[line].slice(0, char);
      setTyped((prev) => {
        const nextArr = [...prev];
        nextArr[line] = current;
        return nextArr;
      });
      if (char >= STATIC_LINES[line].length) {
        line += 1;
        char = 0;
        timer = window.setTimeout(tick, 190);
      } else {
        timer = window.setTimeout(tick, 26);
      }
    };
    timer = window.setTimeout(tick, 260);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live ZULU timestamp.
  useEffect(() => {
    const fmt = () => setZulu(new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
    fmt();
    const id = window.setInterval(fmt, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="hud fixed left-5 top-5 z-30 select-none">
      {typed.map((t, i) =>
        t ? (
          <div key={i} className="opacity-70">
            {t}
          </div>
        ) : null,
      )}
      {showClock ? <div className="fade-in opacity-90">{zulu}</div> : null}
    </div>
  );
}
