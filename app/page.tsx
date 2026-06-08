"use client";

import { useEffect, useRef, useState } from "react";
import Circle, { type AugustState } from "@/components/Circle";
import Composer from "@/components/Composer";
import {
  createRecognizer,
  isRecognitionSupported,
  primeAudio,
  primeVoices,
  speak,
  type Recognizer,
  type SpeakHandle,
} from "@/lib/speech";
import dynamic from "next/dynamic";
import type { GlobeTarget } from "@/components/Globe";

// Load the globe (MapLibre / WebGL) only in the browser.
const Globe = dynamic(() => import("@/components/Globe"), { ssr: false });

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

// ---------------------------------------------------------------------------

export default function Home() {
  const [state, setState] = useState<AugustState>("boot");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [interim, setInterim] = useState("");
  const [micSupported, setMicSupported] = useState(false);
  const [booted, setBooted] = useState(false);
  const [globeVisible, setGlobeVisible] = useState(false);
  const [globeTarget, setGlobeTarget] = useState<GlobeTarget | null>(null);

  const amplitudeRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const speakHandleRef = useRef<SpeakHandle | null>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  const listeningActiveRef = useRef(false);
  const sessionIdRef = useRef<string>("");
  const globeNonceRef = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
      speakHandleRef.current?.cancel();
    };
  }, []);

  function stopSpeaking() {
    speakHandleRef.current?.cancel();
    speakHandleRef.current = null;
    amplitudeRef.current = 0;
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
    speakHandleRef.current = speak(text, {
      onLevel: (v) => {
        amplitudeRef.current = v;
      },
      onEnd: () => {
        amplitudeRef.current = 0;
        speakHandleRef.current = null;
        setState("idle");
      },
      onError: () => {
        amplitudeRef.current = 0;
        speakHandleRef.current = null;
        setState("idle");
      },
    });
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
        setGlobeTarget({ lat, lon, label, zoom, key: globeNonceRef.current });
        setGlobeVisible(true);
      } else if (t.tool === "close_map") {
        setGlobeVisible(false);
      }
    }
  }

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
    setInterim("");
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

    primeAudio();
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
      let appliedTools = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        const parsed = splitToolStream(full);
        setReplyText(parsed.text);
        // Fire tool calls (globe fly-to / close) the moment they arrive — before
        // the narration streams in after them.
        if (parsed.tools.length > appliedTools) {
          applyToolEvents(parsed.tools.slice(appliedTools));
          appliedTools = parsed.tools.length;
        }
      }

      const { text: spoken, tools } = splitToolStream(full);
      if (tools.length > appliedTools) applyToolEvents(tools.slice(appliedTools));
      const reply = spoken.trim();

      if (reply) {
        const withAssistant = [...next, { role: "assistant" as const, content: reply }];
        messagesRef.current = withAssistant;
        setMessages(withAssistant);
        speakReply(reply);
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

    primeAudio();
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

      <Globe
        visible={globeVisible}
        target={globeTarget}
        onClose={() => setGlobeVisible(false)}
      />

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
