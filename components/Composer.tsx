"use client";

import { useEffect, useRef, useState } from "react";

type ComposerProps = {
  onSend: (text: string) => void;
  /** AUGUST is thinking — hold new submissions until the reply starts. */
  busy: boolean;
  autoFocus?: boolean;
};

export default function Composer({ onSend, busy, autoFocus }: ComposerProps) {
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
      className="composer-form pointer-events-auto flex w-full max-w-[640px] items-center gap-2 rounded-full px-5 py-3"
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Say something to AUGUST"
        spellCheck={false}
        autoComplete="off"
        className="composer-input min-w-0 flex-1 bg-transparent text-[15px] focus:outline-none"
      />
    </form>
  );
}
