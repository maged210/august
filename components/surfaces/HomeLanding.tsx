"use client";

// The AUGUST home landing — the ask-first face of the Presence panel, ported
// from docs/design/AUGUST Home.dc.html. Layout, palette, and behavior follow
// the design; every value on screen is real: the clock is the live ET time,
// the state word is the live presence state, RECENT THREADS is the Upstash
// thread store, WATCHING is live quotes off /api/intel/quotes. Empty feeds
// simply don't render — no mock rows, no skeletons.
//
// The orb stays the living WebGL Presence3D: the design's halo ring, pulsing
// glow, and gradient circle are CSS layers (globals.css, .hl-orb*), and the
// canvas is mounted in a larger square around the 190px circle so the corona
// can breathe past the rim (ORB_GL_* below size the sphere to the circle).

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { signOut } from "next-auth/react";
import type { AugustState, Theme } from "@/components/Presence3D";
import type { PushState } from "@/lib/push-client";

const Presence3D = dynamic(() => import("@/components/Presence3D"), { ssr: false });

// The WebGL mount extends 65px past the 190px orb circle on every side
// (320px square); the sphere's on-screen radius must equal the circle's 95px.
const ORB_GL_BLEED = 65;
const ORB_GL_FRACTION = 95 / (190 + 2 * ORB_GL_BLEED);

// Suggestion chips — honest prompts only, wired to real capabilities
// (markets pivot levels, the world/intel wires, the intel board).
const CHIPS = [
  "Why is NQ above pivot?",
  "Summarize overnight intel",
  "What's on the intel board?",
];

// WATCHING — symbols lib/markets actually serves through /api/intel/quotes
// (Yahoo chart: real CME futures quotes, crypto pairs, ^VIX).
const WATCH: Array<{ sym: string; label: string }> = [
  { sym: "NQ=F", label: "NQ" },
  { sym: "ES=F", label: "ES" },
  { sym: "BTC-USD", label: "BTC" },
  { sym: "SOL-USD", label: "SOL" },
  { sym: "^VIX", label: "VIX" },
];

type ThreadRow = { id: string; title: string; updatedAt: number; label?: string };
type Pill = { label: string; price: number; chgPct: number };

// Session chip state: undefined = unknown or auth unconfigured (render
// nothing), null = signed out (quiet SIGN IN link), object = signed in.
type Account = { email: string };

type HomeLandingProps = {
  state: AugustState;
  theme: Theme;
  amplitudeRef: React.MutableRefObject<number>;
  /** The Presence panel is the deck's active surface (gates the ⌘K focus). */
  active: boolean;
  /** A conversation is live — the bar + chips yield to the existing reply UI. */
  conversationActive: boolean;
  micSupported: boolean;
  listening: boolean;
  busy: boolean;
  voiceMode: boolean;
  /** Bumps when an exchange completes — triggers a thread-list refresh. */
  messagesCount: number;
  onSend: (text: string) => void;
  onToggleMic: () => void;
  onToggleVoiceMode: () => void;
  onOpenThread: (id: string) => void;
  // Quiet top-bar cluster — everything the design omits but the app keeps.
  onSummonBrief: () => void;
  pushState: PushState;
  onNotify: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
  onToggleTheme: () => void;
};

export default function HomeLanding({
  state,
  theme,
  amplitudeRef,
  active,
  conversationActive,
  micSupported,
  listening,
  busy,
  voiceMode,
  messagesCount,
  onSend,
  onToggleMic,
  onToggleVoiceMode,
  onOpenThread,
  onSummonBrief,
  pushState,
  onNotify,
  soundOn,
  onToggleSound,
  onToggleTheme,
}: HomeLandingProps) {
  const [draft, setDraft] = useState("");
  const [clock, setClock] = useState(""); // filled client-side (SSR-safe)
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [pills, setPills] = useState<Pill[]>([]);
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Live ET clock — same format as the design's runtime (24h, America/New_York).
  useEffect(() => {
    const fmt = () => {
      try {
        setClock(
          new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "America/New_York",
          }) + " ET",
        );
      } catch {
        setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      }
    };
    fmt();
    const id = window.setInterval(fmt, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // ⌘K / Ctrl+K focuses the ask bar (design behavior) — only while the
  // Presence panel is the active surface, so it never yanks the deck around.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "k") {
        if (!activeRef.current) return;
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Who's signed in — one fetch of the NextAuth session endpoint (no
  // SessionProvider: the page is one big client component and this is the
  // only session consumer). Signed out → the endpoint returns JSON null;
  // auth unconfigured → the route answers 501 and the chip stays hidden
  // (single-user fallback keeps the cluster clean).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: { user?: { email?: string } } | null) => {
        if (cancelled) return;
        const email = j?.user?.email;
        setAccount(email ? { email } : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // RECENT THREADS — the real store. Unconfigured or empty → the column
  // simply doesn't render.
  const fetchThreads = useCallback(() => {
    fetch("/api/threads?limit=3", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: { threads?: ThreadRow[] }) => {
        const rows = Array.isArray(j.threads)
          ? j.threads.filter(
              (t) => t && typeof t.id === "string" && typeof t.title === "string",
            )
          : [];
        setThreads(rows.slice(0, 3));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchThreads();
    const id = window.setInterval(() => {
      if (!document.hidden) fetchThreads();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [fetchThreads]);

  // A completed exchange persists its thread fire-and-forget — refresh the
  // list shortly after the message count moves so the new row appears.
  useEffect(() => {
    if (messagesCount === 0) return;
    const id = window.setTimeout(fetchThreads, 1500);
    return () => window.clearTimeout(id);
  }, [messagesCount, fetchThreads]);

  // WATCHING — live quotes, gentle 60s poll riding the server's 60s cache.
  useEffect(() => {
    let cancelled = false;
    const symbols = WATCH.map((w) => w.sym).join(",");
    const pull = () => {
      fetch(`/api/intel/quotes?symbols=${encodeURIComponent(symbols)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { quotes?: Record<string, { price: number; chgPct: number }> }) => {
          if (cancelled) return;
          const out: Pill[] = [];
          for (const w of WATCH) {
            const q = j.quotes?.[w.sym];
            if (q && Number.isFinite(q.price) && q.price > 0 && Number.isFinite(q.chgPct)) {
              out.push({ label: w.label, price: q.price, chgPct: q.chgPct });
            }
          }
          setPills(out);
        })
        .catch(() => {});
    };
    pull();
    const id = window.setInterval(() => {
      if (!document.hidden) pull();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
    setDraft("");
  };

  const fillChip = (text: string) => {
    setDraft(text);
    inputRef.current?.focus();
  };

  // The real system state word — 'SYSTEMS STEADY' only when he actually is.
  const stateWord =
    state === "listening"
      ? "LISTENING"
      : state === "thinking"
        ? "THINKING"
        : state === "speaking"
          ? "SPEAKING"
          : "SYSTEMS STEADY";

  const showActivity = threads.length > 0 || pills.length > 0;

  return (
    <div className="home-landing">
      {/* top bar — wordmark · live clock + live state · quiet control cluster */}
      <div className="hl-top">
        <div className="hl-brand">
          <span className="hl-brand-dot" aria-hidden />
          <span className="hl-wordmark">AUGUST</span>
        </div>
        <div className="hl-top-right">
          <span className="hl-clock">{clock ? `${clock} · ${stateWord}` : stateWord}</span>
          {account === null ? (
            <a className="hl-signin" href="/login">
              SIGN IN
            </a>
          ) : account ? (
            <span className="hl-session">
              <span className="hl-account-email" title={account.email}>
                {account.email}
              </span>
              <button
                type="button"
                className="hl-signout"
                onClick={() => void signOut({ redirectTo: "/" })}
                aria-label={`Sign out of ${account.email}`}
              >
                SIGN OUT
              </button>
            </span>
          ) : null}
          <div className="hl-ctls">
            <button
              type="button"
              className="hl-ctl"
              onClick={onSummonBrief}
              title="Today's brief"
              aria-label="Open today's brief"
            >
              <BriefGlyph />
            </button>
            {pushState !== "unsupported" && (
              <button
                type="button"
                className={`hl-ctl${pushState === "granted" ? " on" : ""}`}
                onClick={onNotify}
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
                aria-label={
                  pushState === "granted" ? "Notifications enabled" : "Enable notifications"
                }
              >
                <BellGlyph off={pushState === "denied"} on={pushState === "granted"} />
              </button>
            )}
            <button
              type="button"
              className="hl-ctl"
              onClick={onToggleSound}
              title={soundOn ? "UI sounds on" : "UI sounds off"}
              aria-pressed={soundOn}
              aria-label={soundOn ? "Turn UI sounds off" : "Turn UI sounds on"}
            >
              <ToneGlyph off={!soundOn} />
            </button>
            <button
              type="button"
              className="hl-ctl"
              onClick={onToggleTheme}
              title={
                theme === "dark"
                  ? "Switch to light theme"
                  : theme === "light"
                    ? "Switch to Gotham theme"
                    : "Switch to dark theme"
              }
              aria-label={
                theme === "dark"
                  ? "Switch to light theme"
                  : theme === "light"
                    ? "Switch to Gotham theme"
                    : "Switch to dark theme"
              }
            >
              {theme === "dark" ? <SunGlyph /> : theme === "light" ? <SignalGlyph /> : <MoonGlyph />}
            </button>
          </div>
        </div>
      </div>

      {/* the orb — design halo/ring/glow layers around the living WebGL sphere */}
      <div className="hl-orb">
        <div className="hl-orb-halo" aria-hidden />
        <div className="hl-orb-ring" aria-hidden />
        <div className="hl-orb-core" aria-hidden />
        <div className="hl-orb-gl">
          <Presence3D
            state={state}
            amplitudeRef={amplitudeRef}
            theme={theme}
            orbFraction={ORB_GL_FRACTION}
          />
        </div>
      </div>

      <h1 className="hl-heading">What do you want to know?</h1>

      {/* the ask bar — THE real input; hidden while a conversation is live
          (the existing reply panel + composer own that state) */}
      {!conversationActive ? (
        <form className="hl-bar" onSubmit={submit}>
          <input
            ref={inputRef}
            className="hl-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about markets, the tape, or the world…"
            aria-label="Ask AUGUST"
            spellCheck={false}
            autoComplete="off"
          />
          {micSupported && (
            <button
              type="button"
              className={`hl-mic${listening ? " on" : ""}`}
              onClick={onToggleMic}
              aria-label={listening ? "Stop listening" : "Speak"}
              aria-pressed={listening}
            >
              <MicGlyph active={listening} />
            </button>
          )}
          {micSupported && (
            <button
              type="button"
              className={`hl-mic${voiceMode ? " on" : ""}`}
              onClick={onToggleVoiceMode}
              aria-label="Enter hands-free voice mode"
              aria-pressed={voiceMode}
              title="Hands-free voice mode"
            >
              <WaveGlyph />
            </button>
          )}
          <span className="hl-kbd" aria-hidden>
            ⌘K
          </span>
        </form>
      ) : null}

      {/* suggestion chips — idle-state only (showSuggestions semantics) */}
      {!conversationActive ? (
        <div className="hl-chips">
          {CHIPS.map((c) => (
            <button key={c} type="button" className="hl-chip" onClick={() => fillChip(c)}>
              {c}
            </button>
          ))}
        </div>
      ) : null}

      <div className="hl-spacer" />

      {/* activity — real threads, real quotes; absent when there are none */}
      {showActivity ? (
        <div className="hl-activity">
          {threads.length > 0 ? (
            <div className="hl-col">
              <span className="hl-label">RECENT THREADS</span>
              <div className="hl-threads">
                {threads.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="hl-thread"
                    onClick={() => onOpenThread(t.id)}
                  >
                    <span className="hl-thread-title">{t.title}</span>
                    {t.label ? <span className="hl-thread-date">{t.label}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {pills.length > 0 ? (
            <div className="hl-col hl-watch">
              <span className="hl-label">WATCHING</span>
              <div className="hl-pills">
                {pills.map((p) => (
                  <span key={p.label} className="hl-pill">
                    {p.label} {fmtPrice(p.price)}{" "}
                    <span className={p.chgPct >= 0 ? "hl-up" : "hl-down"}>
                      {fmtChg(p.chgPct)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Big levels read whole (NQ 29,527); everything else keeps cents (SOL 212.40).
function fmtPrice(n: number): string {
  return n >= 1000
    ? Math.round(n).toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtChg(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Glyphs — same stroke language as the app's control icons, sized for the
// landing's quiet cluster.
// ---------------------------------------------------------------------------

function MicGlyph({ active }: { active: boolean }) {
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
      aria-hidden
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  );
}

function WaveGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
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

// Sunrise-over-line — the morning brief.
function BriefGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="8" cy="8" r="3.4" />
      <line x1="2" y1="13.4" x2="14" y2="13.4" />
      <path d="M8 1.4v1.4M3.3 3.3l1 1M12.7 3.3l-1 1" />
    </svg>
  );
}

function BellGlyph({ off = false, on = false }: { off?: boolean; on?: boolean }) {
  if (off) {
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

function ToneGlyph({ off }: { off?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
      {off ? <line x1="3" y1="3" x2="21" y2="21" /> : null}
    </svg>
  );
}

function SunGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function SignalGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="8.5" opacity="0.45" />
    </svg>
  );
}
