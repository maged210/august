"use client";

import { useEffect, useRef, useState } from "react";

type ComposerProps = {
  onSend: (text: string) => void;
  onToggleMic: () => void;
  listening: boolean;
  /** AUGUST is thinking — hold new submissions until the reply starts. */
  busy: boolean;
  micSupported: boolean;
  autoFocus?: boolean;
};

export default function Composer({
  onSend,
  onToggleMic,
  listening,
  busy,
  micSupported,
  autoFocus,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue("");
  };

  return (
    <form
      onSubmit={submit}
      className="pointer-events-auto flex w-full max-w-[640px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 backdrop-blur-sm transition-colors focus-within:border-steel/50"
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={listening ? "Listening…" : "Say something to AUGUST"}
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-[15px] text-bone placeholder:text-ash/50 focus:outline-none"
      />

      {micSupported && (
        <button
          type="button"
          onClick={onToggleMic}
          aria-label={listening ? "Stop listening" : "Speak"}
          aria-pressed={listening}
          className={[
            "relative grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors",
            listening
              ? "bg-steel/20 text-steel"
              : "text-ash hover:bg-white/5 hover:text-bone",
          ].join(" ")}
        >
          {listening && (
            <span className="absolute inset-0 animate-ping rounded-full bg-steel/20" />
          )}
          <MicIcon active={listening} />
        </button>
      )}
    </form>
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.1 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="relative"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  );
}
