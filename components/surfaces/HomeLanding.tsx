"use client";

// The AUGUST home landing — the ask-first face of the Presence panel, ported
// from docs/design/AUGUST Home.dc.html. Layout, palette, and behavior follow
// the design; every value on screen is real: the clock is the live ET time,
// the state word is the live presence state, WATCHING is live quotes off
// /api/intel/quotes. Empty feeds simply don't render — no mock rows, no
// skeletons.
//
// The orb stays the living WebGL Presence3D: the design's halo ring, pulsing
// glow, and gradient circle are CSS layers (globals.css, .hl-orb*), and the
// canvas is mounted in a larger square around the 190px circle so the corona
// can breathe past the rim (ORB_GL_* below size the sphere to the circle).

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { signOut } from "next-auth/react";
import type { AugustState, Theme } from "@/components/Presence3D";
import HomeBrief from "@/components/HomeBrief";
import { RAIN_PRESETS, type RainPreset } from "@/components/MatrixRain";
import type { PushState } from "@/lib/push-client";

const Presence3D = dynamic(() => import("@/components/Presence3D"), { ssr: false });

// The WebGL mount extends 65px past the 190px orb circle on every side
// (320px square); the sphere's on-screen radius must equal the circle's 95px.
const ORB_GL_BLEED = 65;
const ORB_GL_FRACTION = 95 / (190 + 2 * ORB_GL_BLEED);

// Suggestion chips retired (UX2-T2) — the daily brief owns the home state.

// WATCHING — the PUBLIC DEFAULT (stage 3): signed out, or on an instance where
// auth isn't configured, the pills show exactly this macro five — symbols
// lib/markets actually serves through /api/intel/quotes (Yahoo chart: real CME
// futures quotes, crypto pairs, ^VIX). A signed-in session swaps in the user's
// stored watchlist from GET /api/watchlist (plain tickers pass to the quotes
// route as-is; the store validates the Yahoo-style charset).
const WATCH: Array<{ sym: string; label: string }> = [
  { sym: "NQ=F", label: "NQ" },
  { sym: "ES=F", label: "ES" },
  { sym: "BTC-USD", label: "BTC" },
  { sym: "SOL-USD", label: "SOL" },
  { sym: "^VIX", label: "VIX" },
];

type Pill = { label: string; price: number; chgPct: number };

// Session chip state: undefined = unknown or auth unconfigured (render
// nothing), null = signed out (quiet SIGN IN link), object = signed in.
type Account = { email: string };

type HomeLandingProps = {
  state: AugustState;
  theme: Theme;
  /** The Presence panel is the deck's active surface (gates the ⌘K focus). */
  active: boolean;
  /** A conversation is live — the bar + chips yield to the existing reply UI. */
  conversationActive: boolean;
  busy: boolean;
  /** calendarAskId (WHAT'S COMING cards only) lets /api/chat serve one
      cached answer per event per day instead of spending per click */
  onSend: (text: string, calendarAskId?: string) => void;
  /** CORE V2 P5 — the conversation column (ChatTranscript), rendered by the
      page so message state stays there. Shown while a conversation is active;
      the landing's heading/chips/activity yield to it and the orb compacts. */
  transcript?: React.ReactNode;
  // Quiet top-bar cluster — everything the design omits but the app keeps.
  pushState: PushState;
  onNotify: () => void;
  /** F7 — the moon button opens the theme menu; selection applies directly */
  onSetTheme: (t: Theme) => void;
  /** the rain intensity dial — lives INSIDE the theme menu (matrix only) */
  rainPreset: RainPreset;
  onSetRainPreset: (p: RainPreset) => void;
};

const THEME_OPTIONS: Array<{ id: Theme; label: string }> = [
  { id: "matrix", label: "MATRIX" },
  { id: "dark", label: "DARK" },
  { id: "light", label: "LIGHT" },
  { id: "batman", label: "GOTHAM" },
];

export default function HomeLanding({
  state,
  theme,
  active,
  conversationActive,
  busy,
  onSend,
  transcript,
  pushState,
  onNotify,
  onSetTheme,
  rainPreset,
  onSetRainPreset,
}: HomeLandingProps) {
  const [draft, setDraft] = useState("");
  const [clock, setClock] = useState(""); // filled client-side (SSR-safe)
  const [pills, setPills] = useState<Pill[]>([]);
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [isOwner, setIsOwner] = useState(false);
  // R1-REDO — the rain dial's little menu (matrix only); closes on outside tap
  const [rainMenuOpen, setRainMenuOpen] = useState(false);
  const rainWrapRef = useRef<HTMLDivElement | null>(null);
  // The symbols WATCHING quotes: the public macro five until a signed-in
  // session's watchlist loads (see the session effect below).
  const [watch, setWatch] = useState<Array<{ sym: string; label: string }>>(WATCH);
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
  //
  // A signed-in session additionally (stage 3):
  //   - swaps WATCHING to the user's stored watchlist (failure or an empty
  //     list keeps the public five — no blank pill row, no mock data);
  //   - nudges first-timers to /welcome ONCE per browser session (the flag
  //     rides sessionStorage so a storage failure can't cause a redirect loop).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: { user?: { email?: string } } | null) => {
        if (cancelled) return;
        const email = j?.user?.email;
        setAccount(email ? { email } : null);
        if (!email) return;
        // AUTH-1a — THE CLAIM: fold this device's anonymous identity into the
        // account, once per email per device (idempotent server-side too)
        try {
          if (window.localStorage.getItem("aug-claimed") !== email) {
            fetch("/api/account/claim", { method: "POST" })
              .then((r) => (r.ok ? r.json() : null))
              .then((c: { ok?: boolean } | null) => {
                if (c?.ok) window.localStorage.setItem("aug-claimed", email);
              })
              .catch(() => {});
          }
        } catch { /* private mode — server idempotency still holds */ }
        // owner badge (derived server-side; the session carries only the email)
        fetch("/api/intel/role", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : Promise.reject(r)))
          .then((ro: { owner?: boolean }) => {
            if (!cancelled && ro.owner) setIsOwner(true);
          })
          .catch(() => {});
        fetch("/api/watchlist", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : Promise.reject(r)))
          .then((w: { symbols?: unknown }) => {
            if (cancelled) return;
            const syms = Array.isArray(w.symbols)
              ? w.symbols.filter((s): s is string => typeof s === "string" && s.length > 0)
              : [];
            if (syms.length > 0) setWatch(syms.map((s) => ({ sym: s, label: s })));
          })
          .catch(() => {});
        fetch("/api/feeds", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : Promise.reject(r)))
          .then((f: { onboarded?: boolean }) => {
            if (cancelled || f.onboarded !== false) return;
            try {
              if (window.sessionStorage.getItem("aug-welcome-nudged")) return;
              window.sessionStorage.setItem("aug-welcome-nudged", "1");
            } catch {
              return; // can't guard against a loop — skip the nudge entirely
            }
            window.location.assign("/welcome");
          })
          .catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // WATCHING — live quotes, gentle 60s poll riding the server's 60s cache.
  // Re-keyed on `watch` (the public five, or the signed-in watchlist once it
  // lands); the cadence itself is unchanged.
  useEffect(() => {
    let cancelled = false;
    const symbols = watch.map((w) => w.sym).join(",");
    const pull = () => {
      fetch(`/api/intel/quotes?symbols=${encodeURIComponent(symbols)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { quotes?: Record<string, { price: number; chgPct: number }> }) => {
          if (cancelled) return;
          const out: Pill[] = [];
          for (const w of watch) {
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
  }, [watch]);

  // Close the rain menu on any outside pointer-down.
  useEffect(() => {
    if (!rainMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && rainWrapRef.current && !rainWrapRef.current.contains(t)) setRainMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [rainMenuOpen]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
    setDraft("");
  };

  // The real system state word — 'SYSTEMS STEADY' only when he actually is.
  const stateWord = state === "thinking" ? "THINKING" : "SYSTEMS STEADY";

  return (
    <div className={`home-landing${conversationActive ? " convo" : ""}`}>
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
              {isOwner ? <span className="hl-owner-badge" title="Owner session — /admin is open">OWNER</span> : null}
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
            {/* the brief control retired (UX2-T2) — the brief IS the home state */}
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
            {/* F7 — THE moon menu: theme selection + (matrix only) the ticker
                rain intensity dial, one quiet dropdown styled to the theme */}
            <div className="hl-rainwrap" ref={rainWrapRef}>
              <button
                type="button"
                className="hl-ctl hl-menu-trigger"
                onClick={() => setRainMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={rainMenuOpen}
                title="Theme & rain"
                aria-label="Theme, rain and controls"
              >
                <MoonGlyph />
              </button>
              {rainMenuOpen ? (
                <div className="hl-rainmenu" role="menu" aria-label="Theme and rain">
                  <span className="hl-menu-k">THEME</span>
                  {THEME_OPTIONS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={theme === t.id}
                      className={`hl-rainopt${theme === t.id ? " on" : ""}`}
                      onClick={() => onSetTheme(t.id)}
                    >
                      <span className="hl-opt-glyph" aria-hidden="true">
                        {t.id === "matrix" ? (
                          <RainGlyph />
                        ) : t.id === "dark" ? (
                          <MoonGlyph />
                        ) : t.id === "light" ? (
                          <SunGlyph />
                        ) : (
                          <SignalGlyph />
                        )}
                      </span>
                      {t.label}
                    </button>
                  ))}
                  {theme === "matrix" ? (
                    <>
                      <span className="hl-menu-k">TICKER RAIN</span>
                      {RAIN_PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          role="menuitemradio"
                          aria-checked={rainPreset === p}
                          className={`hl-rainopt${rainPreset === p ? " on" : ""}`}
                          onClick={() => onSetRainPreset(p)}
                        >
                          {p.toUpperCase()}
                        </button>
                      ))}
                    </>
                  ) : null}
                  {/* M1 — on phones the header keeps only menu · wordmark ·
                      clock; the control cluster folds in here */}
                  <div className="hl-menu-mobile">
                    <span className="hl-menu-k">CONTROLS</span>
                    {pushState !== "unsupported" ? (
                      <button type="button" className="hl-rainopt" onClick={onNotify}>
                        NOTIFICATIONS{pushState === "granted" ? " · ON" : ""}
                      </button>
                    ) : null}
                    {account ? (
                      <a className="hl-rainopt" href="/welcome">
                        SETUP
                      </a>
                    ) : null}
                    {account === null ? (
                      <a className="hl-rainopt" href="/login">
                        SIGN IN
                      </a>
                    ) : account ? (
                      <button
                        type="button"
                        className="hl-rainopt"
                        onClick={() => void signOut({ redirectTo: "/" })}
                      >
                        SIGN OUT
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            {/* SETTINGS — re-opens /welcome ("Your setup": watchlist + feeds).
                Session-only: signed out and unconfigured instances never show it. */}
            {account ? (
              <a
                className="hl-ctl"
                href="/welcome"
                title="Your setup"
                aria-label="Your setup — watchlist and feeds"
              >
                <GearGlyph />
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {/* R2 — the vertical-centering frame: everything between the top bar and
          the bottom ticker strip; idle state centers in the leftover height
          (comfortable top padding on short viewports — flex 1 0 auto grows
          past the fold and the landing scrolls instead of clipping). */}
      <div className="hl-main">
      {/* the orb — R4 F1: on the front page it is a small live-status mark,
          not the centerpiece; a live conversation gets the full presence */}
      <div className={`hl-orb${!conversationActive ? " hl-orb-mini" : ""}`}>
        <div className="hl-orb-halo" aria-hidden />
        <div className="hl-orb-ring" aria-hidden />
        <div className="hl-orb-core" aria-hidden />
        <div className="hl-orb-gl">
          <Presence3D state={state} theme={theme} orbFraction={ORB_GL_FRACTION} />
        </div>
      </div>

      {/* the heading yielded to the brief's own date + session line (UX2-T2) */}

      {/* CORE V2 P5 — a live conversation replaces the landing's idle body:
          the Claude-style transcript column owns the middle of the screen
          (the fixed composer dock below it is the input, pinned bottom). */}
      {conversationActive ? transcript : null}

      {/* R4 F1 — the FRONT PAGE: the brief owns the layout; the ask bar rides
          INSIDE it, directly under the regime apex (slot below). A live
          conversation replaces all of it with the transcript column. */}
      {!conversationActive ? (
        <HomeBrief
          onAsk={(t, calendarAskId) => onSend(t, calendarAskId)}
          askBar={
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
              <span className="hl-kbd" aria-hidden>
                ⌘K
              </span>
            </form>
          }
        />
      ) : null}
      </div>

      {/* R5 — WATCHING as a thin full-width bottom ticker strip: static chips
          (deliberately no drift — reduced-motion safe by construction), real
          quotes only, absent entirely when none resolve */}
      {!conversationActive && pills.length > 0 ? (
        <div className="hl-tape" aria-label="Watching — live quotes">
          <span className="hl-label hl-tape-label">WATCHING <span className="dtag dtag-delayed" title="Yahoo quotes · 60s poll">DELAYED</span></span>
          <div className="hl-tape-chips">
            {pills.map((p) => (
              <span key={p.label} className="hl-pill">
                {p.label} {fmtPrice(p.price)}{" "}
                <span className={p.chgPct >= 0 ? "hl-up" : "hl-down"}>{fmtChg(p.chgPct)}</span>
              </span>
            ))}
          </div>
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
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(1)}%`; // R3 polish: one minus glyph app-wide
}

// ---------------------------------------------------------------------------
// Glyphs — same stroke language as the app's control icons, sized for the
// landing's quiet cluster.
// ---------------------------------------------------------------------------

// BriefGlyph retired with the popup (UX2-T2) — the brief is the home state.

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

// Settings gear — same stroke language as the rest of the quiet cluster.
function GearGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.4v3M12 18.6v3M2.4 12h3M18.6 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
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

/* Digital-rain glyph — three falling dashed columns, the Matrix theme's cue. */
function RainGlyph() {
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
      <path d="M6 3v4M6 11v3" />
      <path d="M12 5v3M12 12v5" />
      <path d="M18 3v2M18 9v4" />
    </svg>
  );
}
