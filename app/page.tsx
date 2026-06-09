"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Composer from "@/components/Composer";
import Deck, { type DeckHandle } from "@/components/Deck";
import Brief from "@/components/Brief";
import MarketsSurface from "@/components/surfaces/MarketsSurface";
import IntelSurface from "@/components/surfaces/IntelSurface";
import CommsSurface from "@/components/surfaces/CommsSurface";
import { SCREENS, SCREEN_LABELS, screenIndex } from "@/lib/screens";
import type { AugustState } from "@/components/Presence3D";
import type { GlobeTarget } from "@/components/command/CommandGlobe";
import {
  createRecognizer,
  isRecognitionSupported,
  primeAudio,
  primeVoices,
  speak,
  type Recognizer,
  type SpeakHandle,
} from "@/lib/speech";

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
  const [booted, setBooted] = useState(false);
  const [commandTarget, setCommandTarget] = useState<GlobeTarget | null>(null);
  const [activeScreen, setActiveScreen] = useState(0);

  const amplitudeRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const speakHandleRef = useRef<SpeakHandle | null>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  const listeningActiveRef = useRef(false);
  const sessionIdRef = useRef<string>("");
  const globeNonceRef = useRef(0);
  const deckRef = useRef<DeckHandle | null>(null);
  const replyDockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Keep the reply dock pinned to the newest line as the reply streams in.
  useEffect(() => {
    const el = replyDockRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replyText]);

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
        setCommandTarget({ lat, lon, label, zoom, key: globeNonceRef.current });
        deckRef.current?.goTo(screenIndex("command"));
      } else if (t.tool === "close_map") {
        deckRef.current?.goTo(screenIndex("presence"));
      } else if (t.tool === "go_to_screen" && t.input) {
        const idx = screenIndex(String(t.input.screen ?? ""));
        if (idx >= 0) deckRef.current?.goTo(idx);
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
        // Fire tool calls (globe / navigation) the moment they arrive — before
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

      <Deck
        ref={deckRef}
        labels={DECK_LABELS}
        onActiveChange={setActiveScreen}
        surfaces={[
          <div key="presence" className="presence-surface">
            <Presence3D state={state} amplitudeRef={amplitudeRef} />
            <Brief visible={booted} />
          </div>,
          <MarketsSurface key="markets" />,
          <IntelSurface key="intel" />,
          <CommsSurface key="comms" />,
          <CommandGlobe
            key="command"
            active={activeScreen === screenIndex("command")}
            flyTo={commandTarget}
          />,
        ]}
      />

      {/* reply dock + composer — fixed, available on every surface. A contained,
          translucent strip that never covers the dashboard widgets. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-4 pb-8 sm:pb-10">
        {replyText || interim ? (
          <div className="reply-dock" ref={replyDockRef}>
            {interim ? (
              <p className="reply-interim">{interim}</p>
            ) : (
              <p className="reply-text">{replyText}</p>
            )}
          </div>
        ) : statusLabel ? (
          <div className="reply-status">{statusLabel}</div>
        ) : null}

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

  // Live ZULU timestamp.
  useEffect(() => {
    const fmt = () => setZulu(new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
    fmt();
    const id = window.setInterval(fmt, 1000);
    return () => window.clearInterval(id);
  }, []);

  const shown = full.slice(0, n).split("\n");
  const done = n >= full.length;

  return (
    <div className="boot-hud hud fixed left-5 top-5 z-30 select-none">
      {LINES.map((_, i) => (
        <div key={i} className="opacity-70">
          {shown[i] ?? ""}
        </div>
      ))}
      {done ? <div className="fade-in opacity-90">{zulu}</div> : null}
    </div>
  );
}
