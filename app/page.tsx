"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SETTLE_UTC_LABEL } from "@/lib/settle-cron";
import IdeasRail from "@/components/IdeasRail";
import HomeLanding from "@/components/surfaces/HomeLanding";
import IntelDeckSurface from "@/components/surfaces/IntelDeckSurface";
import PitSurface from "@/components/surfaces/PitSurface";
import { resolveView, type ViewId } from "@/lib/screens";
import { parseCommand } from "@/lib/command-bar";
import { deskSymbolFor } from "@/lib/desk-symbols";
import type { AugustState } from "@/components/Presence3D";
import { latMark, latReset } from "@/lib/latency";
import {
  disablePush,
  enablePush,
  getPushState,
  registerServiceWorker,
  resyncPush,
  type PushState,
} from "@/lib/push-client";

// WebGL components load only in the browser, and each heavy view owns its own
// laziness: HomeLanding carries the Presence orb's dynamic import and
// IntelDeckSurface latches the feed body on first visit. The old deck
// (Deck, WorldSurface/globe, CommsSurface) is GONE — those files were deleted,
// not parked; recover them from git history if that surface ever returns.

// THE COMMAND BAR (feature/command-bar) — the input is not a chat. Two lanes:
// COMMANDS resolve deterministically and locally (never a model call, by
// law); ASKS hit /api/chat once and render as ONE answer card that the next
// input replaces. No threads, no history, no conversation UI anywhere.
export type AnswerCard =
  | { kind: "ask"; text: string; streaming: boolean }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string }
  | {
      kind: "quote";
      symbol: string;
      price: number;
      chgPct: number;
      dayLo: number | null;
      dayHi: number | null;
    };

export default function Home() {
  const [state, setState] = useState<AugustState>("boot");
  // THE ONE ANSWER CARD — the next command or ask replaces it; Esc/clear
  // dismisses it; nothing is ever stored.
  const [answer, setAnswer] = useState<AnswerCard | null>(null);
  const [booted, setBooted] = useState(false);
  // CORE V2 — the single page's views: the floor (the Presence orb + the
  // command bar), the Intel Terminal (the embedded desk / public ideas feed),
  // and the Pit. Driven by the top-bar toggle, the bar's nav commands,
  // ?view= deep links, and browser back/forward. The ?view param persists.
  const [view, setView] = useState<ViewId>("chat");
  // Trade Ideas drawer (below 1100px; the desktop sidebar ignores this — see
  // .ideas-rail's media query). The ref mirrors it for the Esc handler, which
  // must not resubscribe per toggle.
  const [railOpen, setRailOpen] = useState(false);
  const railOpenRef = useRef(false);
  // chore/terminal-cut — phones (≤700px) do not mount the rail sheet at all;
  // the `ideas` verb opens the terminal there (the book IS the terminal).
  // The ref mirrors the state for the command switch, which outlives renders.
  // null = not measured yet (SSR and the first client render) — the rail
  // mounts only once the breakpoint is known, so a phone never mounts it even
  // for one commit (that commit fired a discarded /api/ideas request).
  const [phone, setPhone] = useState<boolean | null>(null);
  const phoneRef = useRef(false);
  // UX1 — the DESKTOP sidebar's collapse (folds to a thin "IDEAS · N LIVE"
  // edge tab; the desk reflows into the freed width). Persisted; layout.tsx
  // applies the stored data-rail attribute pre-paint, and the mount effect
  // below adopts it into React state (the first sync run is skipped so the
  // default `false` can't strip the pre-paint attribute for a frame).
  const [railCollapsed, setRailCollapsed] = useState(false);
  const railSyncedRef = useRef(false);
  // (F9 removed the desktop IDEAS-tab behavior — the media-query effect below
  // now only clears stale drawer flags when crossing up past 1100px.)
  // (feat/v4-2-today — the theme / mood / rain-dial state is retired: ONE
  //  paper theme, set on <html> in app/layout.tsx. Rebuild point: tag
  //  archive/theme-menu.)
  // Web-push enablement state for the (deliberate, never auto-prompted) bell control.
  // Starts "unsupported" so SSR + first client render match; the mount effect resolves it.
  // "unknown" until the async real-subscription check resolves — the bell
  // renders nothing rather than flashing a slashed UNSUPPORTED at first paint
  const [pushState, setPushState] = useState<PushState | "unknown">("unknown");

  // Mirror of `view` for callbacks that outlive a render (switchView reads it
  // to decide whether a switch actually changes anything).
  const viewRef = useRef<ViewId>("chat");
  // COMMAND BAR — the two-tap confirm for the owner verbs (arm/close): the
  // first submission arms; an identical submission inside 12s executes.
  const pendingConfirmRef = useRef<{ key: string; at: number; run: (gen: number) => Promise<void> } | null>(null);
  // known live tickers (for ticker→terminal routing) — refreshed lazily
  const liveIdeasRef = useRef<Array<{ id: string; instrument: string }> | null>(null);
  // Generation counter + abort: a new send (or the stop control) supersedes any
  // in-flight stream, so a stale closure can never write over the new turn's UI.
  const genRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // True while AUGUST himself is switching the view (tool nav / deep links) —
  // his narration should stay on screen; only USER view changes dismiss the
  // reply panel.
  const augNavRef = useRef(false);
  const augNavTimerRef = useRef(0);

  // Dismiss the answer card — Esc and the card's ✕ share this. It must also
  // SUPERSEDE: an in-flight ask keeps streaming into the card otherwise (the
  // next chunk would repaint what the user just dismissed), so it claims a
  // fresh generation, aborts the stream, and stands the orb down.
  const dismissAnswer = useCallback(() => {
    abortRef.current?.abort();
    genRef.current++;
    // Esc/✕ on the SUBMIT AGAIN TO CONFIRM card must also disarm the pending
    // arm/close — otherwise the next identical command inside 12s executes
    // one-tap with no confirm on screen (adversarial-review finding).
    pendingConfirmRef.current = null;
    setAnswer(null);
    setState((s) => (s === "thinking" ? "idle" : s));
  }, []);

  // ONE Esc stack, owned here: the ideas drawer closes first, then the answer
  // card clears. Works even while typing (the bar's own Esc clears its draft
  // before the event reaches here — see HomeLanding).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (railOpenRef.current) setRailOpen(false);
      else dismissAnswer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissAnswer]);

  useEffect(() => {
    railOpenRef.current = railOpen;
  }, [railOpen]);

  // Crossing up past 1100px turns the drawer into the sidebar — clear the
  // drawer flag so a stale `open` can't silently eat an Esc later. The same
  // query drives what the IDEAS tab toggles (collapse vs drawer).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1100px)");
    const apply = () => {
      if (mq.matches) {
        setRailOpen(false); // drawer → sidebar; clear the drawer flag
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // chore/terminal-cut — the phone breakpoint (the same query the tab bar and
  // IdeasFeed use); below it the rail is not mounted
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const apply = () => {
      setPhone(mq.matches);
      phoneRef.current = mq.matches;
      if (mq.matches) setRailOpen(false); // nothing to open on a phone
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // UX1 — adopt the pre-paint rail state, then keep attribute + storage in
  // sync on every later toggle (theme persistence contract).
  useEffect(() => {
    setRailCollapsed(document.documentElement.getAttribute("data-rail") === "collapsed");
  }, []);
  useEffect(() => {
    if (!railSyncedRef.current) {
      railSyncedRef.current = true; // first run mirrors the pre-paint attribute — never overwrite it
      return;
    }
    const el = document.documentElement;
    if (railCollapsed) el.setAttribute("data-rail", "collapsed");
    else el.removeAttribute("data-rail");
    try {
      window.localStorage.setItem("aug-rail", railCollapsed ? "collapsed" : "open");
    } catch {
      /* private mode — won't persist */
    }
  }, [railCollapsed]);

  const toggleRailCollapsed = useCallback(() => setRailCollapsed((v) => !v), []);

  // M3 — while a sheet is open, the page behind it must not scroll (the
  // sheets scroll internally; the scrim owns the rest of the screen).
  useEffect(() => {
    document.documentElement.classList.toggle("sheet-open", railOpen);
    return () => document.documentElement.classList.remove("sheet-open");
  }, [railOpen]);

  // Boot: resolve into idle.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setState("idle");
      setBooted(true);
    }, 2200);
    return () => window.clearTimeout(id);
  }, []);

  // PWA: register the (minimal) service worker, converge an already-subscribed
  // device into the principal-keyed store (silent re-sync), and resolve the
  // bell's REAL state (an actual subscription, not just permission). Re-check
  // on focus/visibility so installing to the home screen then reopening (the
  // iOS path) flips the bell from "install" to "off" without a hard reload.
  useEffect(() => {
    registerServiceWorker();
    void resyncPush();
    const refresh = () => void getPushState().then(setPushState);
    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // (The old --kb-inset keyboard-lift effect retired with the fixed composer
  // dock: the command bar lives in normal flow inside the brief, and its
  // suggestions render ABOVE the input, so the on-screen keyboard can't cover
  // either — the browser scrolls the focused input into view natively.)

  // The bell control (feature/pwa-push) — the ONLY push control. Deliberate,
  // never auto-prompted; feedback rides the reply panel, mono caps,
  // in-character. OFF: tap → permission (the gesture) → subscribe. ON:
  // TWO-tap unsubscribe (first tap arms for 10s). iOS tab: install first.
  const bellArmRef = useRef(0);
  async function handleNotify() {
    const s = await getPushState();
    if (s === "on") {
      const dt = Date.now() - bellArmRef.current;
      // the two-tap needs a DELIBERATE second tap: under 600ms is a double-fire
      // (mobile double-tap), which must not silently kill the subscription
      if (dt > 600 && dt < 10_000) {
        bellArmRef.current = 0;
        const ok = await disablePush();
        setPushState(await getPushState());
        say(ok ? "PUSH OFF — NO MORE DAILY CALLS ON THIS DEVICE." : "COULDN'T TURN PUSH OFF — TRY AGAIN.");
      } else if (dt > 600) {
        bellArmRef.current = Date.now();
        say("PUSH IS ON — ONE NOTIFICATION PER TRADING DAY, THE SETTLE AND TOMORROW'S CALL. TAP THE BELL AGAIN TO TURN IT OFF.");
      }
      return;
    }
    bellArmRef.current = 0;
    if (s === "ios-install") {
      say("ADD AUGUST TO YOUR HOME SCREEN TO GET THE CALL — SHARE → ADD TO HOME SCREEN, THEN TAP THE BELL FROM THE INSTALLED APP.");
      return;
    }
    if (s === "denied") {
      say("PUSH IS BLOCKED FOR THIS SITE — RE-ENABLE NOTIFICATIONS IN THE BROWSER'S SITE SETTINGS, THEN TAP THE BELL AGAIN.");
      return;
    }
    if (s === "unsupported") {
      say("PUSH ISN'T SUPPORTED IN THIS BROWSER.");
      return;
    }
    // "off" — request permission + subscribe (this tap is the user gesture).
    const r = await enablePush();
    setPushState(await getPushState());
    if (r.ok) {
      say("PUSH ON — ONE NOTIFICATION PER TRADING DAY: THE SETTLE AND TOMORROW'S CALL.");
    } else if (r.reason === "ios-install") {
      say("ADD AUGUST TO YOUR HOME SCREEN TO GET THE CALL — SHARE → ADD TO HOME SCREEN, THEN TAP THE BELL FROM THE INSTALLED APP.");
    } else if (r.reason === "denied") {
      say("PERMISSION DECLINED — THE BELL IS HERE WHENEVER YOU WANT THE CALL.");
    } else if (r.reason === "config") {
      // a deploy gap, not the visitor's browser — say so
      say("PUSH ISN'T CONFIGURED ON THIS DEPLOY — VAPID KEYS MISSING.");
    } else if (r.reason === "unsupported") {
      say("PUSH ISN'T AVAILABLE IN THIS BROWSER.");
    } else {
      say("COULDN'T ENABLE PUSH JUST NOW — TRY AGAIN IN A MOMENT.");
    }
  }

  // --- View routing (CORE V2) ------------------------------------------------
  // Shallow routing in the codebase's native pattern — history + popstate, no
  // useRouter/useSearchParams (none exist in this repo). ?view=terminal persists
  // in the URL; the one-shot params (?screen/?brief/?comms) each strip only
  // their own key, so they coexist. Back/forward walks the view history.
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const apply = () => {
      try {
        const u = new URL(window.location.href);
        const v = u.searchParams.get("view");
        setView(v === "terminal" ? "terminal" : v === "pit" ? "pit" : "chat");
      } catch {
        /* no-op */
      }
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);

  // Switch views. A USER-driven switch clears the answer card (the old
  // panel-dismiss semantics); command-driven switches call markAugNav first,
  // which keeps the card up (e.g. an info card that pointed somewhere).
  const switchView = useCallback(
    (v: ViewId, opts?: { replace?: boolean }) => {
      try {
        const u = new URL(window.location.href);
        if (v === "chat") u.searchParams.delete("view");
        else u.searchParams.set("view", v);
        // feat/v4-1-terminal — the phone idea page pushes its own history
        // entry ({ v4idea: true }, carrying ?idea=). Leaving the terminal from
        // that page REPLACES the entry and drops the parameter, so back never
        // lands on a closed page and a reload never reopens it (IdeasFeed
        // closes the page when its view goes inactive).
        const overIdeaPage = window.history.state?.v4idea === true && viewRef.current !== v;
        if (overIdeaPage) u.searchParams.delete("idea");
        const url = u.toString();
        if (opts?.replace || overIdeaPage) window.history.replaceState({}, "", url);
        else if (url !== window.location.href) window.history.pushState({}, "", url);
      } catch {
        /* no-op */
      }
      if (viewRef.current !== v && !augNavRef.current) dismissAnswer();
      setView(v);
    },
    [dismissAnswer],
  );

  // A ?brief=1 push arrival just lands home (the home IS the brief now); the
  // param is stripped so a reload doesn't linger.
  useEffect(() => {
    if (!booted) return;
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("brief")) {
        u.searchParams.delete("brief");
        window.history.replaceState({}, "", u.toString());
      }
    } catch {
      /* no-op */
    }
  }, [booted]);

  // Deep-link: an old Watcher push or a stale bookmark opens "/?screen=..." —
  // resolve the legacy name to a view, then strip the param (?view is the
  // persistent one now). Runs on MOUNT (not after the ~2.2s boot timer) so deep
  // links land fast; declared AFTER the ?view apply effect so a legacy
  // ?screen=desk link wins over the (absent) ?view param.
  useEffect(() => {
    let screen: string | null = null;
    try {
      const u = new URL(window.location.href);
      screen = u.searchParams.get("screen");
      if (screen) {
        u.searchParams.delete("screen");
        window.history.replaceState({}, "", u.toString());
      }
    } catch {
      /* no-op */
    }
    if (!screen) return;
    const v = resolveView(screen);
    if (v) {
      markAugNav();
      switchView(v, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Gmail OAuth callback still redirects to "/?comms=<status>#comms", but
  // the comms surface is parked (CORE V2) — its only consumer is unmounted.
  // Consume and strip the param so it can't stick in the URL; the connect
  // affordance re-homes if/when comms returns.
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("comms")) {
        u.searchParams.delete("comms");
        u.hash = "";
        window.history.replaceState({}, "", u.toString());
      }
    } catch {
      /* no-op */
    }
  }, []);

  // Flag the next surface change as AUGUST-driven so it doesn't dismiss his reply.
  function markAugNav() {
    augNavRef.current = true;
    window.clearTimeout(augNavTimerRef.current);
    augNavTimerRef.current = window.setTimeout(() => {
      augNavRef.current = false;
    }, 1600);
  }

  // One-line local cards — commands and system feedback, mono caps, local.
  const say = useCallback((text: string) => setAnswer({ kind: "info", text }), []);
  const sayError = useCallback((text: string) => setAnswer({ kind: "error", text }), []);

  function forgetMemory() {
    // Wipe persistent memory (Upstash). The one surviving slash command.
    void fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "forget" }),
    }).catch(() => {});
    say("MEMORY CLEARED.");
  }

  // --- THE COMMAND LANE's executors — deterministic, local, no model, ever --
  // Every input owns ONE generation (runInput bumps genRef): an async
  // executor's late result must never overwrite a newer input's card — the
  // E2E caught a slow 'higher' resurrecting over a later 'clear'.

  const stale = useCallback((gen: number) => genRef.current !== gen, []);

  const scrollFloorTo = useCallback(
    (selector: string) => {
      if (viewRef.current !== "chat") switchView("chat");
      window.setTimeout(() => {
        document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
    },
    [switchView],
  );

  const liveIdeas = useCallback(async (): Promise<Array<{ id: string; instrument: string }>> => {
    if (liveIdeasRef.current) return liveIdeasRef.current;
    try {
      const r = await fetch("/api/ideas", { cache: "no-store" });
      const j = (await r.json()) as { ideas?: Array<{ id: string; instrument: string }> };
      liveIdeasRef.current = Array.isArray(j.ideas) ? j.ideas : [];
      window.setTimeout(() => {
        liveIdeasRef.current = null; // 60s freshness, matching the rail's poll
      }, 60_000);
      return liveIdeasRef.current;
    } catch {
      return [];
    }
  }, []);

  const runTicker = useCallback(
    async (symbol: string, gen: number) => {
      const ideas = await liveIdeas();
      if (stale(gen)) return;
      const idea = ideas.find((i) => i.instrument.trim().toUpperCase() === symbol);
      if (idea) {
        // open the terminal with that idea's chart + row selected via the
        // existing ?idea= deep link + the re-selection event — the SAME seam
        // for every role (chore/terminal-cut: the owner desk is gone)
        try {
          const u = new URL(window.location.href);
          u.searchParams.set("view", "terminal");
          u.searchParams.set("idea", `live:${idea.id}`);
          window.history.pushState({}, "", u.toString());
        } catch {
          /* URL best-effort */
        }
        window.dispatchEvent(new CustomEvent("aug:select-idea", { detail: { key: `live:${idea.id}` } }));
        markAugNav();
        switchView("terminal");
        setAnswer(null);
        return;
      }
      // no idea → a quote card via the classified probe; a true miss is NO
      // SUCH SYMBOL, never an ask (the law) — and never fabricated: a source
      // failure says the source failed (adversarial-review finding).
      const ysym = deskSymbolFor(symbol);
      try {
        const qr = await fetch(`/api/intel/probe?symbol=${encodeURIComponent(ysym)}`, { cache: "no-store" });
        const q = (await qr.json()) as { state: string; price?: number; chgPct?: number };
        if (stale(gen)) return;
        if (q.state === "no-such-symbol") {
          sayError(`NO SUCH SYMBOL — ${symbol}`);
          return;
        }
        if (q.state !== "ok" || !Number.isFinite(q.price) || q.price! <= 0 || !Number.isFinite(q.chgPct)) {
          sayError(`THE QUOTE SOURCE ISN'T ANSWERING — TRY ${symbol} AGAIN.`);
          return;
        }
        let dayLo: number | null = null;
        let dayHi: number | null = null;
        try {
          const br = await fetch(`/api/intel/bars?symbol=${encodeURIComponent(ysym)}`, { cache: "no-store" });
          const bj = (await br.json()) as { bars?: Array<{ h: number; l: number }> };
          const last = bj.bars?.[bj.bars.length - 1];
          if (last && Number.isFinite(last.h) && Number.isFinite(last.l)) {
            dayLo = last.l;
            dayHi = last.h;
          }
        } catch {
          /* range omitted honestly */
        }
        if (stale(gen)) return;
        setAnswer({ kind: "quote", symbol, price: q.price!, chgPct: q.chgPct!, dayLo, dayHi });
      } catch {
        if (!stale(gen)) sayError(`QUOTES UNREACHABLE — TRY ${symbol} AGAIN`);
      }
    },
    [liveIdeas, sayError, switchView, stale],
  );

  // arm/close — owner only, write-gated server-side, two-tap in the bar:
  // the first submission arms, an identical submission inside 12s executes.
  const runOwnerVerb = useCallback(
    async (verb: "arm" | "close", symbol: string, gen: number) => {
      const key = `${verb} ${symbol}`;
      const pending = pendingConfirmRef.current;
      if (pending && pending.key === key && Date.now() - pending.at < 12_000) {
        pendingConfirmRef.current = null;
        await pending.run(gen);
        return;
      }
      // resolve the target through the ADMIN list (arm needs closed rows too);
      // non-owners get the gate's refusal and an honest card
      let rows: Array<{ id: string; instrument: string; status: string }> = [];
      try {
        const r = await fetch("/api/admin/ideas", { cache: "no-store" });
        if (stale(gen)) return;
        if (r.status === 401 || r.status === 403) {
          sayError("OWNER ONLY.");
          return;
        }
        const j = (await r.json()) as { ideas?: Array<{ id: string; instrument: string; status: string }> };
        rows = Array.isArray(j.ideas) ? j.ideas : [];
      } catch {
        if (!stale(gen)) sayError("THE BOOK IS UNREACHABLE — TRY AGAIN.");
        return;
      }
      if (stale(gen)) return;
      const eligible = rows.filter(
        (i) =>
          i.instrument.trim().toUpperCase() === symbol &&
          (verb === "close" ? i.status === "live" || i.status === "review" : i.status !== "live" && i.status !== "draft" && i.status !== "denied"),
      );
      const target = eligible[0];
      if (!target) {
        sayError(verb === "close" ? `NOTHING LIVE ON ${symbol} TO CLOSE.` : `NOTHING ON ${symbol} TO ARM.`);
        return;
      }
      pendingConfirmRef.current = {
        key,
        at: Date.now(),
        run: async (runGen: number) => {
          try {
            const res = await fetch(`/api/admin/ideas/${encodeURIComponent(target.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: verb === "close" ? "closed" : "live" }),
            });
            if (!res.ok) {
              if (!stale(runGen)) sayError(res.status === 401 || res.status === 403 ? "OWNER ONLY." : `${verb.toUpperCase()} FAILED (${res.status}).`);
              return;
            }
            liveIdeasRef.current = null; // the book changed
            // HomeLanding refreshes its suggestion tickers off this; the
            // rail/terminal catch up on their own ~60s polls — the copy
            // says so instead of claiming an instant reflection.
            window.dispatchEvent(new CustomEvent("aug:ideas-changed"));
            if (!stale(runGen)) say(verb === "close" ? `${symbol} CLOSED — OFF THE BOARDS WITHIN THE MINUTE.` : `${symbol} ARMED LIVE — ON THE BOARDS WITHIN THE MINUTE.`);
          } catch {
            if (!stale(runGen)) sayError(`${verb.toUpperCase()} FAILED — TRY AGAIN.`);
          }
        },
      };
      say(`${verb.toUpperCase()} ${symbol} — SUBMIT THE SAME COMMAND AGAIN TO CONFIRM.`);
    },
    [say, sayError, stale],
  );

  const runCallSide = useCallback(
    async (side: "HIGHER" | "LOWER", gen: number) => {
      try {
        const res = await fetch("/api/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ side }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (stale(gen)) return; // the take stands server-side; the card belongs to the newer input
        if (j.ok) {
          // the fourth copy of the settle claim — bound to the cron like the card
          say(`TAKEN: ${side} — SETTLES ON THE ${SETTLE_UTC_LABEL} PASS.`);
          scrollFloorTo(".td-call");
        } else if (j.error === "locked") sayError("LOCKED — 09:30 ET HAS PASSED. TOMORROW'S CALL OPENS TONIGHT.");
        else if (j.error === "already_taken") sayError("ALREADY TAKEN TODAY — ONE SIDE PER TRADING DAY.");
        else if (j.error === "no_active_call") sayError("NO ACTIVE CALL RIGHT NOW.");
        else sayError("THE CALL IS UNREACHABLE — TRY AGAIN.");
      } catch {
        if (!stale(gen)) sayError("THE CALL IS UNREACHABLE — TRY AGAIN.");
      }
    },
    [say, sayError, scrollFloorTo, stale],
  );

  // --- THE ASK LANE — the only path that ever touches the model -------------
  // gen comes from runInput (one generation per input, shared with commands).
  async function runAsk(text: string, gen: number, calendarAskId?: string) {
    latReset();
    const controller = new AbortController();
    abortRef.current = controller;
    setAnswer({ kind: "ask", text: "", streaming: true });
    setState("thinking"); // the orb's thinking state is wired to asks ONLY

    try {
      latMark("t1");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, ...(calendarAskId ? { calendarAsk: calendarAskId } : {}) }),
        signal: controller.signal,
      });
      if (gen !== genRef.current) return;

      if (res.status === 429) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        sayError(j.message ?? "RATE CAP — GIVE IT A MINUTE.");
        setState("idle");
        return;
      }
      if (!res.ok || !res.body) {
        sayError(res.status >= 500 ? "THE DESK IS UNREACHABLE — TRY AGAIN." : `THE DESK DECLINED (${res.status}).`);
        setState("idle");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (gen !== genRef.current) return; // superseded — the new input owns the card
        if (done) {
          latMark("t2b");
          break;
        }
        latMark("t2");
        full += decoder.decode(value, { stream: true });
        setAnswer({ kind: "ask", text: full, streaming: true });
      }
      setAnswer(full.trim() ? { kind: "ask", text: full.trim(), streaming: false } : null);
      setState("idle");
    } catch (err) {
      if (gen !== genRef.current) return;
      if ((err as Error)?.name !== "AbortError") {
        sayError("CONNECTION LOST — TRY AGAIN.");
      }
      setState("idle");
    }
  }

  // THE BAR's single entry point — every submission routes here. Each input
  // claims a fresh generation and aborts any in-flight ask; async executors
  // check the generation before painting, so a late result can never
  // overwrite a newer input's card.
  async function runInput(raw: string, calendarAskId?: string) {
    abortRef.current?.abort();
    const gen = ++genRef.current;
    // a superseded ask can no longer stand the orb down — if THIS input is a
    // command (which never owns the orb), reset thinking → idle here; runAsk
    // re-raises it for the ask lane.
    setState((s) => (s === "thinking" ? "idle" : s));
    // a calendar-card ask button is an ASK by construction
    if (calendarAskId) return runAsk(raw.trim(), gen, calendarAskId);
    const parsed = parseCommand(raw);
    if (!parsed) return;
    // any non-matching submission drops a stale arm/close confirm
    if (parsed.kind !== "arm" && parsed.kind !== "close") pendingConfirmRef.current = null;
    switch (parsed.kind) {
      case "ticker":
        return runTicker(parsed.symbol, gen);
      case "arm":
      case "close":
        return runOwnerVerb(parsed.kind, parsed.symbol, gen);
      case "call-side":
        return runCallSide(parsed.side, gen);
      case "nav":
        switch (parsed.target) {
          case "call":
            return scrollFloorTo(".td-call");
          case "coming":
            return scrollFloorTo(".td-next");
          case "why":
            if (viewRef.current !== "chat") switchView("chat");
            window.dispatchEvent(new CustomEvent("aug:open-why"));
            return;
          case "pit":
            return switchView("pit");
          case "terminal":
            return switchView("terminal");
          case "ideas":
            // phones don't mount the rail sheet (chore/terminal-cut) — there
            // the book IS the terminal
            if (phoneRef.current) return switchView("terminal");
            // ≥1100px the rail is the always-visible sidebar: the drawer flag
            // would only lock the floor's scroll (html.sheet-open) — un-collapse
            // the sidebar instead (review finding, pre-existing on main)
            if (window.matchMedia("(min-width: 1100px)").matches) {
              setRailCollapsed(false);
              return;
            }
            setRailOpen(true);
            return;
          case "inbox":
            window.location.assign("/admin"); // the console gates itself
            return;
        }
        return;
      case "clear":
        dismissAnswer();
        return;
      case "forget":
        return forgetMemory();
      case "incomplete":
        return sayError(`${parsed.command.toUpperCase()} NEEDS A TICKER — ${parsed.command.toUpperCase()} <TICKER>.`);
      case "unknown-slash":
        return sayError(`NO SUCH COMMAND — /FORGET IS THE ONLY SLASH COMMAND.`);
      case "ask":
        return runAsk(parsed.text, gen);
    }
  }

  return (
    <main
      className="stage-vignette has-rail relative h-[100dvh] w-screen overflow-hidden"
    >
      {/* BootHud / FrameTicks / PresenceTelemetry retired from the landing —
          the home design's minimalism is the point; the components remain. */}

      {/* CORE V2 — the top-bar view toggle, in the deck dots' old top-center
          slot. Two views only; the segmented control is the page's whole nav. */}
      <nav className="view-bar" aria-label="AUGUST views">
        <button
          type="button"
          className={`view-tab${view === "chat" ? " on" : ""}`}
          aria-pressed={view === "chat"}
          onClick={() => switchView("chat")}
        >
          AUGUST
        </button>
        <button
          type="button"
          className={`view-tab${view === "terminal" ? " on" : ""}`}
          aria-pressed={view === "terminal"}
          onClick={() => switchView("terminal")}
        >
          TERMINAL
        </button>
        <button
          type="button"
          className={`view-tab${view === "pit" ? " on" : ""}`}
          aria-pressed={view === "pit"}
          onClick={() => switchView("pit")}
        >
          PIT
        </button>
        {/* F9 — IDEAS is NOT a view: it is the rail's MOBILE drawer trigger
            only (hidden ≥1100px, where the rail header » and the edge tab
            own open/collapse — the tab there was a duplicate control). */}
        <button
          type="button"
          className="view-tab view-tab-ideas"
          aria-expanded={railOpen}
          onClick={() => setRailOpen((v) => !v)}
        >
          IDEAS
        </button>
      </nav>

      {/* M1 — the PHONE bottom tab bar (≤700px; the floating center toggle
          hides there). Three tabs: AUGUST · TERMINAL · PIT. The IDEAS opener
          went with the phone rail sheet (chore/terminal-cut, decision 4) —
          on a phone the book IS the terminal. */}
      <nav className="tab-bar" aria-label="AUGUST views">
        <button
          type="button"
          className={`tab-item${view === "chat" ? " on" : ""}`}
          aria-pressed={view === "chat"}
          onClick={() => switchView("chat")}
        >
          <TabGlyph d={TAB_ICON.home} />
          AUGUST
        </button>
        <button
          type="button"
          className={`tab-item${view === "terminal" ? " on" : ""}`}
          aria-pressed={view === "terminal"}
          onClick={() => switchView("terminal")}
        >
          <TabGlyph d={TAB_ICON.terminal} />
          TERMINAL
        </button>
        {/* GAME-2 — IDEAS → PIT: the arcade replaced the rail-sheet slot */}
        <button
          type="button"
          className={`tab-item${view === "pit" ? " on" : ""}`}
          aria-pressed={view === "pit"}
          onClick={() => switchView("pit")}
        >
          <TabGlyph d={TAB_ICON.pit} />
          PIT
        </button>
      </nav>

      {/* Trade Ideas rail — beside BOTH views: fixed sidebar ≥1100px
          (collapsible to an edge tab, UX1), drawer 701–1099px. Phones do not
          mount it at all (chore/terminal-cut, decision 4); it mounts only once
          the breakpoint is measured (phone === false). */}
      {phone === false ? (
        <IdeasRail
          open={railOpen}
          onClose={() => setRailOpen(false)}
          collapsed={railCollapsed}
          onToggleCollapsed={toggleRailCollapsed}
        />
      ) : null}

      {/* The two-view stack. Both panels STAY MOUNTED once visited (chat always;
          the terminal latches its bodies internally) so chat state and desk
          tab/selection state survive toggling — the inactive panel is
          display:none. The orb's IntersectionObserver and the desk's visited
          latch park their own background work while hidden. */}
      <section
        className={`view-panel${view === "chat" ? "" : " view-hidden"}`}
        aria-hidden={view !== "chat"}
      >
        <div className="presence-surface">
          <HomeLanding
            state={state}
            active={view === "chat"}
            onSend={runInput}
            answer={answer}
            onClearAnswer={dismissAnswer}
            pushState={pushState}
            onNotify={handleNotify}
          />
          {/* HomeBrief owns the home state (UX2-T2) */}
        </div>
      </section>
      <section
        className={`view-panel${view === "terminal" ? "" : " view-hidden"}`}
        aria-hidden={view !== "terminal"}
      >
        {/* ONE terminal for every role (chore/terminal-cut): the public ideas
            feed; the owner's only difference is the ADMIN chip inside it. */}
        <IntelDeckSurface active={view === "terminal"} />
      </section>
      {/* GAME-2 — THE PIT arcade */}
      <section
        className={`view-panel${view === "pit" ? "" : " view-hidden"}`}
        aria-hidden={view !== "pit"}
      >
        <PitSurface active={view === "pit"} />
      </section>

      {/* COMMAND-BAR era: no fixed dock, no composer, no reply panel. The bar
          on the floor (HomeLanding's ask bar) is the ONLY input — with no
          exceptions. The carve-out that used to sit here ("the desk's
          contextual ASK AUGUST band is its own surface") described a second
          model input inside the (since deleted) owner desk that bypassed the ask cache and the
          per-identity daily cap; fix/p0-live-trust deleted it. */}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Small control icons.
// ---------------------------------------------------------------------------

// Notification bell — outline by default, with a small "on" dot once enabled.
function BellIcon({ on = false }: { on?: boolean }) {
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

// Bell with a slash — notifications blocked.
function BellOffIcon() {
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

// ---------------------------------------------------------------------------
// Corner frame ticks — thin L-marks in the four corners. The instrument frame:
// precise detail at the periphery while the centre stays calm. Purely decorative.
// ---------------------------------------------------------------------------

function FrameTicks() {
  return (
    <div className="frame-ticks" aria-hidden>
      <span className="frame-tick tl" />
      <span className="frame-tick tr" />
      <span className="frame-tick bl" />
      <span className="frame-tick br" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The phone tab bar's glyphs (feat/v4-2-today, frame 01's stroke icons): the
// home, the terminal's rows, the PIT's bars. Decorative — the label names it.
// ---------------------------------------------------------------------------

const TAB_ICON = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  terminal: "M4 6h16M4 12h16M4 18h10",
  pit: "M4 19h16M7 16V9M12 16V5M17 16v-4",
} as const;

function TabGlyph({ d }: { d: string }) {
  return (
    <svg className="tab-glyph" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Boot HUD — typed sequence in the corner, then a live ZULU clock.
// ---------------------------------------------------------------------------

// Declutter: the full identity block belongs to the boot sequence only. After
// this dwell it folds — one way, never re-expanding — to the single quiet line
// that earns its permanence: the live ZULU clock.
const HUD_COLLAPSE_MS = 5200;

function BootHud() {
  const LINES = ["SYSTEM INITIATED", "AUGUST · BUILD 0.10", "LOCATION — UNDISCLOSED"];
  const full = LINES.join("\n");
  const [n, setN] = useState(0);
  const [zulu, setZulu] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  // One-way fold to the quiet line (see HUD_COLLAPSE_MS above).
  useEffect(() => {
    const id = window.setTimeout(() => setCollapsed(true), HUD_COLLAPSE_MS);
    return () => window.clearTimeout(id);
  }, []);

  // Typewriter driven by ONE character index over the joined block, so even if React
  // double-invokes this effect (StrictMode / HMR) the chains converge instead of
  // racing line-by-line — one tidy block, never doubled or overlapping.
  useEffect(() => {
    if (n >= full.length) return;
    const id = window.setTimeout(() => setN((v) => Math.min(full.length, v + 1)), n === 0 ? 260 : 27);
    return () => window.clearTimeout(id);
  }, [n, full.length]);

  // Live ZULU timestamp — time-only; the full ISO date was corner clutter.
  useEffect(() => {
    const fmt = () => setZulu(new Date().toISOString().slice(11, 19) + "Z");
    fmt();
    const id = window.setInterval(fmt, 1000);
    return () => window.clearInterval(id);
  }, []);

  const shown = full.slice(0, n).split("\n");
  const done = n >= full.length;

  return (
    <div className={`boot-hud hud fixed left-5 top-5 z-30 select-none${done ? " settled" : ""}`}>
      <div className={`boot-lines${collapsed ? " boot-lines-out" : ""}`} aria-hidden={collapsed}>
        {LINES.map((_, i) => (
          <div key={i} className={i === 1 ? "boot-brand" : "opacity-70"}>
            {shown[i] ?? ""}
          </div>
        ))}
      </div>
      {done ? <div className="fade-in boot-zulu">{zulu}</div> : null}
    </div>
  );
}
