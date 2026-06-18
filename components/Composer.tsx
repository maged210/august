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
      className="composer-form pointer-events-auto flex w-full max-w-[640px] items-center gap-2 rounded-full px-5 py-3 backdrop-blur-sm"
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={listening ? "Listening…" : "Say something to AUGUST"}
        spellCheck={false}
        autoComplete="off"
        className="composer-input min-w-0 flex-1 bg-transparent text-[15px] focus:outline-none"
      />

      {micSupported && (
        <button
          type="button"
          onClick={onToggleMic}
          aria-label={listening ? "Stop listening" : "Speak"}
          aria-pressed={listening}
          className={`composer-mic relative grid h-9 w-9 shrink-0 place-items-center rounded-full${listening ? " on" : ""}`}
        >
          {listening && <span className="composer-mic-ping absolute inset-0 animate-ping rounded-full" />}
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
