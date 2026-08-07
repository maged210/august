"use client";

// CORE V2 P5 — the Claude-style conversation column for the chat view. The
// whole session transcript scrolls in place: user turns as glass bubbles,
// AUGUST's replies as plain text, the in-flight reply streaming at the bottom.
// Message history lives in the page's client state (page.tsx `messages`); this
// component only presents it. The terminal view keeps the compact overlay
// reply-dock — this column is chat-view-only, where the conversation IS the
// surface and needs no dismissal.

import { useEffect, useRef } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };

type ChatTranscriptProps = {
  messages: ChatMessage[];
  /** Streaming / unfinalized assistant text (a partial, or a system feedback line). */
  replyText: string;
  /** Live STT partial while the mic is open. */
  interim: string;
  /** He's generating — shows the caret on the streaming line, or dots before it. */
  thinking: boolean;
  onNewChat: () => void;
};

export default function ChatTranscript({
  messages,
  replyText,
  interim,
  thinking,
  onNewChat,
}: ChatTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Stick to the newest line while the reply streams — unless the user has
  // scrolled up to reread, in which case leave them alone until they return
  // near the bottom (within 80px re-engages the follow).
  const stickRef = useRef(true);

  // Any reply text not yet finalized into messages — a streaming reply, a
  // stopped partial, or a local feedback line — renders as its own AUGUST turn.
  const last = messages[messages.length - 1];
  const finalized = !!last && last.role === "assistant" && last.content === replyText;
  const streaming = replyText && !finalized ? replyText : "";

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, interim, thinking]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <>
      <div className="hl-convo-head">
        <button
          type="button"
          className="hl-newchat"
          onClick={onNewChat}
          title="Start a fresh conversation (memory is kept)"
        >
          + NEW CHAT
        </button>
      </div>
      <div
        className="hl-convo"
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label="Conversation with AUGUST"
      >
        <div className="hl-convo-inner">
          {messages.map((m, i) => (
            <div key={i} className={`hl-msg${m.role === "user" ? " you" : " aug"}`}>
              {m.content}
            </div>
          ))}
          {streaming ? (
            <div className="hl-msg aug">
              {streaming}
              {thinking ? <span className="hl-caret" aria-hidden /> : null}
            </div>
          ) : null}
          {interim ? <div className="hl-msg you interim">{interim}</div> : null}
          {thinking && !streaming ? (
            <div className="hl-msg aug hl-thinking" aria-label="AUGUST is thinking">
              <span aria-hidden />
              <span aria-hidden />
              <span aria-hidden />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
