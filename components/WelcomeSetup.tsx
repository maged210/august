"use client";

// The /welcome setup screen — client half. One screen, two light sections
// (watchlist chips + feed toggles), Start / Skip. Everything on screen is the
// user's REAL stored state (GET /api/watchlist + /api/feeds — both fall back
// to the seed defaults server-side); nothing is mocked. Design language is
// the home landing's: Geist + mono, the gold label accent, the day/night
// palettes (styles in globals.css under .welcome-page).

import { useCallback, useEffect, useState } from "react";

// Client-side mirror of the store's validation. lib/user-scope is SERVER ONLY
// (it builds the Upstash client), so the regex + cap are duplicated here —
// keep in sync with WATCHLIST_SYMBOL_RE / WATCHLIST_MAX in lib/user-scope.ts.
// The server re-validates on PUT regardless; this only shapes inline feedback.
const SYMBOL_RE = /^[A-Z0-9.^=-]{1,12}$/;
const MAX_SYMBOLS = 12;

type FeedPrefs = { gmail: boolean; rss: boolean; markets: boolean };

const FEED_ROWS: Array<{ key: keyof FeedPrefs; name: string; hint: string }> = [
  {
    key: "gmail",
    name: "Gmail",
    hint: "Connect in Comms later — mail scopes are a separate consent.",
  },
  {
    key: "rss",
    name: "RSS / World",
    hint: "The world wires — headlines, the globe, quakes.",
  },
  {
    key: "markets",
    name: "Markets",
    hint: "Quotes, the tape, and your WATCHING pills.",
  },
];

export default function WelcomeSetup({ onboarded }: { onboarded: boolean }) {
  const [symbols, setSymbols] = useState<string[] | null>(null);
  const [prefs, setPrefs] = useState<FeedPrefs | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState<"start" | "skip" | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    Promise.all([
      fetch("/api/watchlist", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : Promise.reject(r),
      ),
      fetch("/api/feeds", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : Promise.reject(r),
      ),
    ])
      .then(([w, f]: [{ symbols?: unknown }, { prefs?: FeedPrefs }]) => {
        const syms = Array.isArray(w.symbols)
          ? w.symbols.filter((s): s is string => typeof s === "string" && s.length > 0)
          : [];
        setSymbols(syms);
        setPrefs(
          f.prefs &&
            typeof f.prefs.gmail === "boolean" &&
            typeof f.prefs.rss === "boolean" &&
            typeof f.prefs.markets === "boolean"
            ? f.prefs
            : { gmail: false, rss: true, markets: true },
        );
      })
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function addSymbol(e: React.FormEvent) {
    e.preventDefault();
    if (!symbols) return;
    const sym = draft.trim().toUpperCase();
    if (!sym) return;
    if (!SYMBOL_RE.test(sym)) {
      setNote("Letters, digits and . ^ = - only — up to 12 characters.");
      return;
    }
    if (symbols.includes(sym)) {
      setNote(`${sym} is already on the list.`);
      return;
    }
    if (symbols.length >= MAX_SYMBOLS) {
      setNote(`That's the cap — ${MAX_SYMBOLS} symbols.`);
      return;
    }
    setSymbols([...symbols, sym]);
    setDraft("");
    setNote(null);
  }

  function removeSymbol(sym: string) {
    if (!symbols || symbols.length <= 1) return; // the store requires ≥1
    setSymbols(symbols.filter((s) => s !== sym));
    setNote(null);
  }

  function flip(key: keyof FeedPrefs) {
    setPrefs((p) => (p ? { ...p, [key]: !p[key] } : p));
  }

  // Start / Save: persist both sections, mark onboarded, back to the deck.
  // A 501 (Upstash unconfigured) is a soft pass — the seed simply stands and
  // the onboarded flag has nowhere to live (the nudge already treats that as
  // "don't nag"), so the user still gets home instead of an error wall.
  async function saveAll() {
    if (!symbols || !prefs || saving) return;
    setSaving("start");
    setSaveErr(null);
    try {
      const w = await fetch("/api/watchlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
      if (!w.ok && w.status !== 501) throw new Error("watchlist");
      const f = await fetch("/api/feeds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs, onboarded: true }),
      });
      if (!f.ok && f.status !== 501) throw new Error("feeds");
      window.location.assign("/");
    } catch {
      setSaving(null);
      setSaveErr("Couldn't save just now — try again.");
    }
  }

  // Skip: save nothing (the seed stands), just mark onboarded.
  async function skip() {
    if (saving) return;
    setSaving("skip");
    setSaveErr(null);
    try {
      const f = await fetch("/api/feeds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarded: true }),
      });
      if (!f.ok && f.status !== 501) throw new Error("feeds");
      window.location.assign("/");
    } catch {
      setSaving(null);
      setSaveErr("Couldn't save just now — try again.");
    }
  }

  return (
    <main className="welcome-page">
      <div className="wp-card">
        <header className="wp-head">
          <div className="wp-brand">
            <span className="wp-dot" aria-hidden />
            <span className="wp-wordmark">AUGUST</span>
          </div>
          <h1 className="wp-title">{onboarded ? "Your setup" : "Set up AUGUST"}</h1>
          <p className="wp-sub">
            {onboarded
              ? "Adjust your watchlist and feeds — saved on Save."
              : "Two quick choices. Everything here can be changed later from the gear on the landing."}
          </p>
        </header>

        {loadFailed ? (
          <div className="wp-fallback" role="alert">
            <p className="wp-hint">Couldn&rsquo;t load your setup just now.</p>
            <button type="button" className="wp-ghost" onClick={load}>
              Try again
            </button>
          </div>
        ) : !symbols || !prefs ? (
          <p className="wp-loading" role="status">
            Loading your setup…
          </p>
        ) : (
          <>
            <section className="wp-section" aria-labelledby="wp-watchlist-label">
              <span className="wp-label" id="wp-watchlist-label">
                WATCHLIST
              </span>
              <p className="wp-hint">
                What the landing&rsquo;s WATCHING pills quote — up to {MAX_SYMBOLS} symbols,
                Yahoo style (BRK-B, ^VIX, NQ=F, BTC-USD).
              </p>
              <div className="wp-chips">
                {symbols.map((s) => (
                  <span key={s} className="wp-chip">
                    {s}
                    <button
                      type="button"
                      className="wp-chip-x"
                      onClick={() => removeSymbol(s)}
                      disabled={symbols.length <= 1}
                      aria-label={`Remove ${s} from the watchlist`}
                      title={symbols.length <= 1 ? "Keep at least one symbol" : `Remove ${s}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <form className="wp-add" onSubmit={addSymbol}>
                <input
                  className="wp-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Add a symbol — AAPL, BTC-USD…"
                  aria-label="Add a symbol"
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={12}
                />
                <button
                  type="submit"
                  className="wp-ghost"
                  disabled={!draft.trim() || symbols.length >= MAX_SYMBOLS}
                >
                  Add
                </button>
              </form>
              {note ? (
                <p className="wp-note" role="status">
                  {note}
                </p>
              ) : null}
            </section>

            <section className="wp-section" aria-labelledby="wp-feeds-label">
              <span className="wp-label" id="wp-feeds-label">
                FEEDS
              </span>
              <div className="wp-toggles">
                {FEED_ROWS.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    className={`wp-toggle${prefs[row.key] ? " on" : ""}`}
                    onClick={() => flip(row.key)}
                    aria-pressed={prefs[row.key]}
                  >
                    <span className="wp-switch" aria-hidden>
                      <span className="wp-switch-dot" />
                    </span>
                    <span className="wp-toggle-body">
                      <span className="wp-toggle-name">{row.name}</span>
                      <span className="wp-toggle-hint">{row.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <div className="wp-actions">
              <button
                type="button"
                className="wp-start"
                onClick={saveAll}
                disabled={saving !== null}
              >
                {saving === "start" ? "Saving…" : onboarded ? "Save" : "Start"}
              </button>
              {onboarded ? (
                <a className="wp-skip" href="/">
                  Back
                </a>
              ) : (
                <button
                  type="button"
                  className="wp-skip"
                  onClick={skip}
                  disabled={saving !== null}
                >
                  {saving === "skip" ? "One moment…" : "Skip for now"}
                </button>
              )}
            </div>
            {saveErr ? (
              <p className="wp-note wp-err" role="alert">
                {saveErr}
              </p>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
