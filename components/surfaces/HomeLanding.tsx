"use client";

// THE FRONT PAGE (feat/v4-2-today — frame 01 TODAY of docs/design/"August
// Mobile v4 Markets.dc.html", on the paper stage, DESIGN_LAWS L1). Every value
// on screen is real: the clock is the live ET time, THINKING is the live ask
// state, prices come from the ONE quote book the terminal also runs
// (lib/use-quote-book). The modules are HomeBrief's cards; this file owns the
// header, the orb, the command bar + its one answer card, WATCHING and the
// phone Account card.
//
// The theme menu (MATRIX / DARK / LIGHT / GOTHAM + the rain dial) is retired:
// one theme, one front page (archive/theme-menu is the rebuild point).
//
// The orb is gone (feat/v4-2-today, the owner's strike): it carried no data,
// and its WebGL crystal was the last of the retired dark-cinematic language.
// The regime card is the first card under the day line now.

import { useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import type { AugustState } from "@/lib/screens";
import HomeBrief, { PULSE, REGIME_SYMBOLS, chgTone, fmtPx } from "@/components/HomeBrief";
import { suggestFor, type Suggestion } from "@/lib/command-bar";
import { fmtPct } from "@/lib/idea-card";
import { useQuoteBook } from "@/lib/use-quote-book";
import type { AnswerCard } from "@/app/page";
import type { PushState } from "@/lib/push-client";
import DataTag from "@/components/DataTag";
import Disclaimer from "@/components/Disclaimer";
import DeleteAccount from "@/components/DeleteAccount";
import "@/app/today.css";

// WATCHING — the PUBLIC DEFAULT: signed out, or on an instance where auth isn't
// configured, the pills show exactly this macro five — symbols lib/markets
// serves through /api/intel/quotes (Yahoo chart: CME futures, crypto pairs,
// ^VIX). A signed-in session swaps in the user's stored watchlist from GET
// /api/watchlist (≤12 symbols; the store validates the Yahoo-style charset).
const WATCH: Array<{ sym: string; label: string }> = [
  { sym: "NQ=F", label: "NQ" },
  { sym: "ES=F", label: "ES" },
  { sym: "BTC-USD", label: "BTC" },
  { sym: "SOL-USD", label: "SOL" },
  { sym: "^VIX", label: "VIX" },
];

// Session chip state: undefined = unknown (render nothing yet), null = signed
// out (quiet Sign in link), object = signed in.
type Account = { email: string };

type HomeLandingProps = {
  state: AugustState;
  /** The Presence panel is the deck's active surface (gates the ⌘K focus). */
  active: boolean;
  /** COMMAND-BAR era: every submission routes to the page's runInput — the
      parser decides the lane there. */
  onSend: (text: string) => void;
  /** THE ANSWER CARD — the one response surface. The next input replaces it;
      nothing is stored. Rendered directly under the bar. */
  answer: AnswerCard | null;
  onClearAnswer: () => void;
  // "unknown" = the async subscription check hasn't resolved — no bell yet.
  pushState: PushState | "unknown";
  onNotify: () => void;
};

export default function HomeLanding({
  state,
  active,
  onSend,
  answer,
  onClearAnswer,
  pushState,
  onNotify,
}: HomeLandingProps) {
  const [draft, setDraft] = useState("");
  // COMMAND-BAR suggestions — local, max 5, keywords + the live book's tickers
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const [bookTickers, setBookTickers] = useState<string[]>([]);
  const [clock, setClock] = useState(""); // filled client-side (SSR-safe)
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [isOwner, setIsOwner] = useState(false);
  // The symbols WATCHING quotes: the public five until a signed-in session's
  // watchlist loads (see the session effect below).
  const [watch, setWatch] = useState<Array<{ sym: string; label: string }>>(WATCH);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRef = useRef(active);

  // ONE quote book for the page — pulse, regime and WATCHING read it; closes
  // are kept (in this page's own parallel map) for the regime's trend inputs
  const bookSymbols = useMemo(
    () => [...PULSE.map((p) => p.sym), ...REGIME_SYMBOLS, ...watch.map((w) => w.sym)],
    [watch],
  );
  const quotes = useQuoteBook(bookSymbols, { closes: true });

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Live ET clock (24h, America/New_York).
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

  // ⌘K / Ctrl+K focuses the command bar — only while the Presence panel is the
  // active surface, so it never yanks the deck around.
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
  // SessionProvider: the page is one big client component). Signed out (or
  // auth unconfigured) → the endpoint returns JSON null → the Sign in link.
  //
  // A signed-in session additionally:
  //   - folds this device's anonymous identity into the account (the claim);
  //   - swaps WATCHING to the user's stored watchlist (failure or an empty
  //     list keeps the public five — no blank strip, no mock data);
  //   - nudges first-timers to /welcome ONCE per browser session.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: { user?: { email?: string } } | null) => {
        if (cancelled) return;
        const email = j?.user?.email;
        setAccount(email ? { email } : null);
        if (!email) return;
        // AUTH-1a — THE CLAIM: once per email per device (idempotent server-side too)
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
        // owner flag (derived server-side; the session carries only the email)
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

  // The live book's tickers feed the suggestion list — one quiet fetch at
  // mount, refreshed when an arm/close command changes the book (the page
  // dispatches aug:ideas-changed after a confirmed PATCH). Local matching in
  // between: the parser and suggestions never touch the network per input.
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      fetch("/api/ideas", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { ideas?: Array<{ instrument?: string }> }) => {
          if (cancelled || !Array.isArray(j.ideas)) return;
          const seen = new Set<string>();
          for (const i of j.ideas) {
            if (typeof i.instrument === "string" && i.instrument.trim()) seen.add(i.instrument.trim().toUpperCase());
          }
          setBookTickers([...seen]);
        })
        .catch(() => {});
    };
    pull();
    window.addEventListener("aug:ideas-changed", pull);
    return () => {
      cancelled = true;
      window.removeEventListener("aug:ideas-changed", pull);
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return; // a new input supersedes an in-flight ask — never gated
    onSend(text);
    setDraft("");
    setSugs([]);
  };

  // Guard against pointerdown+click double-fire from one gesture: a repeated
  // pick of the same insert inside 350ms is the same gesture, not a second
  // intent (a double arm/close submission would silently CONFIRM the two-tap).
  const lastPickRef = useRef<{ insert: string; at: number }>({ insert: "", at: 0 });
  const pickSuggestion = (s: Suggestion) => {
    const now = Date.now();
    if (lastPickRef.current.insert === s.insert && now - lastPickRef.current.at < 350) return;
    lastPickRef.current = { insert: s.insert, at: now };
    if (s.insert.endsWith(" ")) {
      // arm/close want their ticker — insert and keep typing
      setDraft(s.insert);
      setSugs(suggestFor(s.insert, bookTickers));
      inputRef.current?.focus();
    } else {
      onSend(s.insert);
      setDraft("");
      setSugs([]);
    }
  };

  const watchReads = watch.map((w) => ({ ...w, q: quotes.quoteFor(w.sym) }));
  const watchOk = watchReads.some((r) => r.q.state === "ok");
  const watchSettled = watchReads.every((r) => r.q.state !== "pending");

  return (
    <div className="home-landing">
      {/* header — wordmark · live clock (+ THINKING) · the existing controls */}
      <header className="td-top">
        <span className="td-wordmark">August</span>
        <div className="td-top-right">
          {/* the resting "SYSTEMS STEADY" word is gone: it claimed a health
              check nothing performs (L2). THINKING is real — an ask in flight. */}
          <span className="td-clock">
            {clock}
            {state === "thinking" ? <span className="td-thinking"> · Thinking</span> : null}
          </span>
          {account === null ? (
            <a className="td-link td-signin" href="/login">
              Sign in
            </a>
          ) : account ? (
            <span className="td-session">
              <span className="td-email" title={account.email}>
                {account.email}
              </span>
              {/* owner parity (chore/terminal-cut): the ADMIN chip — a link to
                  /admin, no controls — is the only owner difference */}
              {isOwner ? (
                <a className="td-admin" href="/admin">
                  ADMIN
                </a>
              ) : null}
              <button
                type="button"
                className="td-textbtn"
                onClick={() => void signOut({ redirectTo: "/" })}
                aria-label={`Sign out of ${account.email}`}
              >
                Sign out
              </button>
              <DeleteAccount email={account.email} />
            </span>
          ) : null}
          <div className="td-ctls">
            {/* THE BELL (feature/pwa-push) — the only push control, at every
                width. Unsupported still renders (slashed) so the state is
                stated, never silently absent — but not before the async check
                has actually resolved. */}
            {pushState !== "unknown" && (
              <button
                type="button"
                className={`td-ctl${pushState === "on" ? " on" : ""}`}
                onClick={onNotify}
                title={
                  pushState === "on"
                    ? "THE CALL · DAILY PUSH ON — TAP TWICE TO TURN OFF"
                    : pushState === "ios-install"
                      ? "ADD AUGUST TO YOUR HOME SCREEN TO GET THE CALL"
                      : pushState === "denied"
                        ? "PUSH BLOCKED — RE-ENABLE IN SITE SETTINGS"
                        : pushState === "unsupported"
                          ? "PUSH UNSUPPORTED IN THIS BROWSER"
                          : "GET THE CALL · ONE PUSH PER TRADING DAY"
                }
                aria-pressed={pushState === "on"}
                aria-label={pushState === "on" ? "Daily push on" : "Get the daily call push"}
              >
                <BellGlyph off={pushState === "denied" || pushState === "unsupported"} on={pushState === "on"} />
              </button>
            )}
            {/* SETUP — re-opens /welcome ("Your setup": watchlist + feeds).
                Session-only; on phones it lives in the Account card. */}
            {account ? (
              <a className="td-ctl td-gear" href="/welcome" title="Your setup" aria-label="Your setup — watchlist and feeds">
                <GearGlyph />
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <div className="td-main">
        <HomeBrief
          quotes={quotes}
          onAsk={(t) => onSend(t)}
          askBar={
            <div className="td-cb">
              {sugs.length > 0 ? (
                <div className="td-sugs" role="listbox" aria-label="Command suggestions">
                  {sugs.map((s) => (
                    <button
                      key={s.insert}
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="td-sug"
                      // pointerdown, not click — fires before the input loses
                      // focus so the mobile keyboard stays up mid-completion.
                      // onClick serves the KEYBOARD (Enter/Space synthesize a
                      // click, never a pointerdown); pickSuggestion's 350ms
                      // same-insert guard absorbs any double-fire.
                      onPointerDown={(e) => {
                        e.preventDefault();
                        pickSuggestion(s);
                      }}
                      onClick={() => pickSuggestion(s)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <form className="td-bar" onSubmit={submit}>
                <input
                  ref={inputRef}
                  className="td-input"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setSugs(suggestFor(e.target.value, bookTickers));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && (draft || sugs.length > 0)) {
                      // Esc clears the bar first; empty-bar Esc bubbles to the
                      // page's stack (drawer, then the answer card)
                      e.stopPropagation();
                      setDraft("");
                      setSugs([]);
                    }
                  }}
                  placeholder="TICKER · ARM · CLOSE · HIGHER · LOWER · COMING · WHY · OR ASK"
                  aria-label="Command bar"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  enterKeyHint="go"
                />
                <span className="td-kbd" aria-hidden>
                  ⌘K
                </span>
              </form>
              {answer ? (
                <div className={`td-answer td-answer-${answer.kind}`} role="status">
                  {answer.kind === "quote" ? (
                    <div className="td-answer-quote">
                      <span className="td-answer-head">
                        <span className="td-tkr">{answer.symbol}</span>
                        <DataTag
                          kind="delayed"
                          title="Yahoo quote · 60s cache; the day range is the last daily bar"
                        />
                      </span>
                      <span className="td-answer-px">
                        <span className="td-num td-answer-last">{fmtPx(answer.price)}</span>
                        <span className={`td-num td-chg ${chgTone(answer.chgPct)}`}>
                          {fmtPct(answer.chgPct)}
                        </span>
                      </span>
                      {answer.dayLo !== null && answer.dayHi !== null ? (
                        <span className="td-meta td-num">
                          Day {fmtPx(answer.dayLo)} – {fmtPx(answer.dayHi)}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="td-answer-text">
                      {answer.text}
                      {answer.kind === "ask" && answer.streaming ? (
                        <span className="td-caret" aria-hidden>
                          ▌
                        </span>
                      ) : null}
                    </p>
                  )}
                  <button type="button" className="td-x" aria-label="Dismiss" onClick={onClearAnswer}>
                    ✕
                  </button>
                </div>
              ) : null}
            </div>
          }
        />

        {/* ACCOUNT — phones only (the header carries these on desktop). Sign
            out, setup, and account deletion reachable at every width: /privacy
            and /terms point here. */}
        {account ? (
          <section className="td-card td-account" aria-label="Account">
            <div className="td-head">
              <h2 className="td-label">Account</h2>
            </div>
            <p className="td-meta td-email-full">{account.email}</p>
            <div className="td-account-acts">
              <a className="td-btn" href="/welcome">
                Setup
              </a>
              <button type="button" className="td-btn" onClick={() => void signOut({ redirectTo: "/" })}>
                Sign out
              </button>
            </div>
            <DeleteAccount email={account.email} />
          </section>
        ) : null}
      </div>

      {/* WATCHING — delayed quotes for the watchlist (the macro five signed
          out). Always rendered: a symbol with no fresh price says so, and the
          provenance chip shows at every width (fixed above the tab bar on
          phones). */}
      <section className="td-watch" aria-label="Watching — delayed quotes">
        <span className="td-watch-head">
          <span className="td-label td-watch-label">Watching</span>
          {watchOk ? (
            <DataTag kind="delayed" detail="60s" title="Yahoo quotes · 60s poll" />
          ) : watchSettled ? (
            <DataTag kind="unavail" title="no watched symbol answered the latest quotes round" />
          ) : null}
        </span>
        <div className="td-watch-pills">
          {watchReads.map(({ sym, label, q }) => (
            <span key={sym} className="td-pill">
              <span className="td-tkr">{label}</span>
              {q.state === "ok" ? (
                <>
                  <span className="td-num">{fmtPx(q.price)}</span>
                  {q.chgPct !== null ? (
                    <span className={`td-num td-chg ${chgTone(q.chgPct)}`}>{fmtPct(q.chgPct)}</span>
                  ) : null}
                </>
              ) : (
                <span className="td-num td-muted" title={q.state === "pending" ? "loading" : "no fresh price"}>
                  {q.state === "pending" ? "…" : "—"}
                </span>
              )}
            </span>
          ))}
        </div>
      </section>
      {/* the ask lane's ONE answer card renders model output about markets on
          this surface, and the command bar itself takes HIGHER / LOWER. */}
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Glyphs — one stroke language for the header controls.
// ---------------------------------------------------------------------------

function BellGlyph({ off = false, on = false }: { off?: boolean; on?: boolean }) {
  if (off) {
    return (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4.6 5.2A3.5 3.5 0 0 1 11.5 6c0 2.4.9 3.5 1.2 3.8" />
        <path d="M11.4 11.5H3.2s1.3-1 1.3-4v-.3" />
        <path d="M6.6 12a1.5 1.5 0 0 0 2.8 0" />
        <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2a3.5 3.5 0 0 0-3.5 3.5c0 3-1.3 4-1.3 4h9.6s-1.3-1-1.3-4A3.5 3.5 0 0 0 8 2Z" />
      <path d="M6.6 12a1.5 1.5 0 0 0 2.8 0" />
      {on && <circle cx="12.2" cy="3.8" r="2" fill="currentColor" stroke="none" />}
    </svg>
  );
}

function GearGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.4v3M12 18.6v3M2.4 12h3M18.6 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
    </svg>
  );
}
