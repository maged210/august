"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChatTranscript from "@/components/ChatTranscript";
import Composer from "@/components/Composer";
import IdeasRail from "@/components/IdeasRail";
import MatrixRain, { RAIN_PRESETS, type RainPreset } from "@/components/MatrixRain";
import HomeLanding from "@/components/surfaces/HomeLanding";
import IntelDeckSurface from "@/components/surfaces/IntelDeckSurface";
import PitSurface from "@/components/surfaces/PitSurface";
import { resolveView, type ViewId } from "@/lib/screens";
import { MOODS, type Mood } from "@/lib/tools";
import type { AugustState, Theme } from "@/components/Presence3D";
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
// IntelDeckSurface latches its desk/feed bodies on first visit. The old deck
// (Deck, WorldSurface/globe, CommsSurface) is parked, not deleted — the
// components remain, unimported, per the house parking convention.

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

export default function Home() {
  const [state, setState] = useState<AugustState>("boot");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  // B2 — failures are a styled system state, never an AUGUST message
  const [chatError, setChatError] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  // CORE V2 — the single page's two views: Chat (the Presence orb + reply dock)
  // and the Intel Terminal (the embedded desk / public ideas feed). Driven by
  // the top-bar toggle, the go_to_screen tool, ?view=terminal deep links, and
  // browser back/forward. Unlike ?screen/?brief, the ?view param persists.
  const [view, setView] = useState<ViewId>("chat");
  // Trade Ideas drawer (below 1100px; the desktop sidebar ignores this — see
  // .ideas-rail's media query). The ref mirrors it for the Esc handler, which
  // must not resubscribe per toggle.
  const [railOpen, setRailOpen] = useState(false);
  const railOpenRef = useRef(false);
  // UX1 — the DESKTOP sidebar's collapse (folds to a thin "IDEAS · N LIVE"
  // edge tab; the desk reflows into the freed width). Persisted; layout.tsx
  // applies the stored data-rail attribute pre-paint, and the mount effect
  // below adopts it into React state (the first sync run is skipped so the
  // default `false` can't strip the pre-paint attribute for a frame).
  const [railCollapsed, setRailCollapsed] = useState(false);
  const railSyncedRef = useRef(false);
  // (F9 removed the desktop IDEAS-tab behavior — the media-query effect below
  // now only clears stale drawer flags when crossing up past 1100px.)
  // Reply panel controls: dismissible, expandable transcript.
  const [panelOpen, setPanelOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dockClosing, setDockClosing] = useState(false);
  // Matrix / dark / light / gotham theme — persisted; the toggle flips the
  // whole token system. Matrix is the CORE V2 default stage.
  const [theme, setTheme] = useState<Theme>("matrix");
  // Accent mood (steel | ember | phosphor | graphite) — persisted; orthogonal to
  // the theme, it re-tints only the accent family.
  const [mood, setMood] = useState<Mood>("steel");
  // R1-REDO — the rain intensity dial (off | faint | visible | loud), persisted;
  // VISIBLE (~80% of the original loudness) is the default. Lives beside the
  // theme control; applies live to the page-level canvas behind both views.
  const [rainPreset, setRainPreset] = useState<RainPreset>("visible");
  // Web-push enablement state for the (deliberate, never auto-prompted) bell control.
  // Starts "unsupported" so SSR + first client render match; the mount effect resolves it.
  const [pushState, setPushState] = useState<PushState>("unsupported");

  const messagesRef = useRef<ChatMessage[]>([]);
  const sessionIdRef = useRef<string>("");
  // Mirror of `view` for callbacks that outlive a render (switchView reads it
  // to decide whether a switch actually changes anything).
  const viewRef = useRef<ViewId>("chat");
  const replyDockRef = useRef<HTMLDivElement | null>(null);
  const dockWrapRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef(0);
  const themingTimerRef = useRef(0);
  // Generation counter + abort: a new send (or the stop control) supersedes any
  // in-flight stream, so a stale closure can never write over the new turn's UI.
  const genRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // True while AUGUST himself is switching the view (tool nav / deep links) —
  // his narration should stay on screen; only USER view changes dismiss the
  // reply panel.
  const augNavRef = useRef(false);
  const augNavTimerRef = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Keep the reply dock pinned to the newest line as the reply streams in.
  useEffect(() => {
    const el = replyDockRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replyText, historyOpen, messages]);

  // Open/close the reply panel with the dock-in/dock-out animations.
  const openPanel = useCallback(() => {
    window.clearTimeout(closeTimerRef.current);
    setDockClosing(false);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setDockClosing(true);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setPanelOpen(false);
      setHistoryOpen(false);
      setDockClosing(false);
    }, 160); // just under --dur-fast + buffer; reduced-motion makes it instant anyway
  }, []);

  // ONE Esc stack, owned here: the ideas drawer closes first, then the reply
  // panel dismisses. Works even while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (railOpenRef.current) setRailOpen(false);
      else closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closePanel]);

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

  // Clicking anywhere outside the dock + composer cluster dismisses the panel.
  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && dockWrapRef.current && !dockWrapRef.current.contains(t)) closePanel();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [panelOpen, closePanel]);

  // Boot: resolve into idle.
  useEffect(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
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

  // G3 fix 1 — the transcript's bottom clearance follows the dock's REAL
  // height (composer + stop controls change it turn to turn).
  // A ResizeObserver writes --dock-h; .hl-convo-inner pads by it.
  useEffect(() => {
    const el = dockWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--dock-h", `${el.offsetHeight}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--dock-h");
    };
  }, []);

  // G3 fix 1 — on-screen keyboard: where the browser overlays it instead of
  // resizing the layout (iOS), --kb-inset lifts the dock above it and pads
  // the transcript to match. 0 whenever the keyboard is closed or the layout
  // viewport already resized (interactiveWidget: resizes-content).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb-inset", `${Math.round(inset)}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--kb-inset");
    };
  }, []);

  // The bell control (feature/pwa-push) — the ONLY push control. Deliberate,
  // never auto-prompted; feedback rides the reply panel, mono caps,
  // in-character. OFF: tap → permission (the gesture) → subscribe. ON:
  // TWO-tap unsubscribe (first tap arms for 10s). iOS tab: install first.
  const bellArmRef = useRef(0);
  async function handleNotify() {
    const s = await getPushState();
    if (s === "on") {
      if (Date.now() - bellArmRef.current < 10_000) {
        bellArmRef.current = 0;
        const ok = await disablePush();
        setPushState(await getPushState());
        setReplyText(ok ? "PUSH OFF — NO MORE DAILY CALLS ON THIS DEVICE." : "COULDN'T TURN PUSH OFF — TRY AGAIN.");
      } else {
        bellArmRef.current = Date.now();
        setReplyText("PUSH IS ON — ONE NOTIFICATION PER TRADING DAY, THE SETTLE AND TOMORROW'S CALL. TAP THE BELL AGAIN TO TURN IT OFF.");
      }
      openPanel();
      return;
    }
    bellArmRef.current = 0;
    if (s === "ios-install") {
      setReplyText("ADD AUGUST TO YOUR HOME SCREEN TO GET THE CALL — SHARE → ADD TO HOME SCREEN, THEN TAP THE BELL FROM THE INSTALLED APP.");
      openPanel();
      return;
    }
    if (s === "denied") {
      setReplyText("PUSH IS BLOCKED FOR THIS SITE — RE-ENABLE NOTIFICATIONS IN THE BROWSER'S SITE SETTINGS, THEN TAP THE BELL AGAIN.");
      openPanel();
      return;
    }
    if (s === "unsupported") {
      setReplyText("PUSH ISN'T SUPPORTED IN THIS BROWSER.");
      openPanel();
      return;
    }
    // "off" — request permission + subscribe (this tap is the user gesture).
    const r = await enablePush();
    setPushState(await getPushState());
    if (r.ok) {
      setReplyText("PUSH ON — ONE NOTIFICATION PER TRADING DAY: THE SETTLE AND TOMORROW'S CALL.");
    } else if (r.reason === "ios-install") {
      setReplyText("ADD AUGUST TO YOUR HOME SCREEN TO GET THE CALL — SHARE → ADD TO HOME SCREEN, THEN TAP THE BELL FROM THE INSTALLED APP.");
    } else if (r.reason === "denied") {
      setReplyText("PERMISSION DECLINED — THE BELL IS HERE WHENEVER YOU WANT THE CALL.");
    } else if (r.reason === "config" || r.reason === "unsupported") {
      setReplyText("PUSH ISN'T AVAILABLE IN THIS BROWSER.");
    } else {
      setReplyText("COULDN'T ENABLE PUSH JUST NOW — TRY AGAIN IN A MOMENT.");
    }
    openPanel();
  }

  function stopGeneration() {
    // Halts the in-flight stream; the partial text stays on screen.
    abortRef.current?.abort();
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

  // Switch views. USER switches dismiss the reply panel (the old user-swipe
  // semantics); AUGUST-driven switches (tool nav, deep links) call markAugNav
  // first, which keeps his narration on screen.
  const switchView = useCallback(
    (v: ViewId, opts?: { replace?: boolean }) => {
      try {
        const u = new URL(window.location.href);
        if (v === "chat") u.searchParams.delete("view");
        else u.searchParams.set("view", v);
        const url = u.toString();
        if (opts?.replace) window.history.replaceState({}, "", url);
        else if (url !== window.location.href) window.history.pushState({}, "", url);
      } catch {
        /* no-op */
      }
      if (viewRef.current !== v && !augNavRef.current) closePanel();
      setView(v);
    },
    [closePanel],
  );

  // Theme: load the persisted choice once, then keep <html data-theme> + storage
  // in sync (layout.tsx sets the attribute pre-paint to avoid a flash).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("aug-theme");
      if (saved === "light" || saved === "dark" || saved === "batman" || saved === "matrix")
        setTheme(saved);
    } catch {
      /* private mode */
    }
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("aug-theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  // Set the theme with a transient app-wide colour cross-fade — the brief
  // [data-theming] window applies a one-off transition to everything, then
  // clears (no permanent transition cost). F7: the old cycle button became a
  // menu, so this takes the target theme directly.
  const applyTheme = useCallback((t: Theme) => {
    const root = document.documentElement;
    root.setAttribute("data-theming", "");
    window.clearTimeout(themingTimerRef.current);
    themingTimerRef.current = window.setTimeout(() => root.removeAttribute("data-theming"), 460);
    setTheme(t);
  }, []);

  // Mood: same persistence contract as the theme — load the saved choice once,
  // then keep <html data-mood> + storage in sync (layout.tsx sets the attribute
  // pre-paint, so a saved mood boots without a flash, exactly like the theme).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("aug-mood");
      if ((MOODS as readonly string[]).includes(saved ?? "")) setMood(saved as Mood);
    } catch {
      /* private mode */
    }
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-mood", mood);
    try {
      window.localStorage.setItem("aug-mood", mood);
    } catch {
      /* private mode */
    }
  }, [mood]);

  // Rain dial: same persistence contract as theme/mood — load once, then keep
  // storage in sync on every change. No pre-paint step needed: the canvas is
  // client-mounted anyway, so the stored preset applies before it first draws.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("aug-rain-level");
      if ((RAIN_PRESETS as readonly string[]).includes(saved ?? "")) {
        setRainPreset(saved as RainPreset);
      }
    } catch {
      /* private mode */
    }
  }, []);
  const applyRainPreset = useCallback((p: RainPreset) => {
    setRainPreset(p);
    try {
      window.localStorage.setItem("aug-rain-level", p);
    } catch {
      /* private mode — won't persist */
    }
  }, []);

  // Set the accent mood — the switcher and the set_mood tool share this one
  // path. The token swap rides the same transient cross-fade as the theme flip.
  const applyMood = useCallback((m: Mood) => {
    const root = document.documentElement;
    root.setAttribute("data-theming", "");
    window.clearTimeout(themingTimerRef.current);
    themingTimerRef.current = window.setTimeout(() => root.removeAttribute("data-theming"), 460);
    setMood(m);
  }, []);

  // The mood control cycles steel → ember → phosphor → graphite.
  function cycleMood() {
    applyMood(MOODS[(MOODS.indexOf(mood) + 1) % MOODS.length]);
  }

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

  function applyToolEvents(tools: ToolEvent[]) {
    for (const t of tools) {
      if (t.tool === "go_to_screen" && t.input) {
        // Legacy names (desk/markets/intel, presence/home…) resolve to one of
        // the two views. look_closer/close_map are retired with the globe —
        // a stale stream framing one is simply ignored.
        const v = resolveView(String(t.input.screen ?? ""));
        if (v) {
          markAugNav();
          switchView(v);
        }
      } else if (t.tool === "set_mood" && t.input) {
        // Same path as the mood control: re-tint the tokens.
        const m = String(t.input.mood ?? "").toLowerCase();
        if ((MOODS as readonly string[]).includes(m)) applyMood(m as Mood);
      }
    }
  }

  // CORE V2 P5 — the transcript's "+ NEW CHAT": reset the on-screen
  // conversation only. Long-term memory is untouched (unlike /forget).
  function startNewChat() {
    genRef.current += 1; // supersede any in-flight stream
    abortRef.current?.abort();
    messagesRef.current = [];
    setMessages([]);
    setReplyText("");
    setChatError(null);
    setHistoryOpen(false);
    closePanel();
    setState((s) => (s === "boot" ? s : "idle"));
  }

  function forgetMemory() {
    // Wipe persistent memory (Upstash) and reset the on-screen conversation.
    void fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "forget" }),
    }).catch(() => {});
    messagesRef.current = [];
    setMessages([]);
    openPanel();
    setHistoryOpen(false);
    setReplyText("Done. I've let it go — we start clean.");
  }

  // calendarAskId: set only by WHAT'S COMING ask buttons — rides to /api/chat
  // so the server can serve one cached answer per event per day.
  async function handleSend(raw: string, calendarAskId?: string) {
    const text = raw.trim();
    if (!text) return;

    if (text.toLowerCase() === "/forget") {
      forgetMemory();
      return;
    }

    latReset(); // t0 — turn start
    abortRef.current?.abort(); // a new message supersedes any in-flight generation
    const gen = ++genRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    const next = [...messagesRef.current, { role: "user" as const, content: text }];
    messagesRef.current = next;
    setMessages(next);
    setReplyText("");
    setChatError(null);
    openPanel(); // a new reply (re)opens the panel
    setState("thinking");

    let full = "";
    try {
      latMark("t1"); // chat request sent
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, ...(calendarAskId ? { calendarAsk: calendarAskId } : {}) }),
        signal: controller.signal,
      });
      if (gen !== genRef.current) return; // superseded while connecting

      if (res.status === 429) {
        if (gen !== genRef.current) return;
        setChatError("rate cap — give it a minute, then retry");
        setState("idle");
        return;
      }

      if (!res.ok || !res.body) {
        // B2 — the raw error body NEVER reaches the transcript: classify and
        // render the styled system state with a retry affordance instead.
        if (gen !== genRef.current) return;
        setChatError(res.status >= 500 ? "desk unreachable — retry" : `desk declined (${res.status}) — retry`);
        setState("idle");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let appliedTools = 0;

      for (;;) {
        const { value, done } = await reader.read();
        if (gen !== genRef.current) return; // superseded mid-stream — the new turn owns the UI
        if (done) {
          latMark("t2b"); // LLM full response done
          break;
        }
        latMark("t2"); // LLM first token (first-occurrence-only)
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
      }
      setState("idle");
    } catch (err) {
      if (gen !== genRef.current) return; // superseded — stay silent
      if ((err as Error)?.name === "AbortError") {
        // Stop/supersede: intentional halt. The superseding turn owns the next step.
        setState("idle");
        return;
      }
      setChatError("connection lost — retry");
      setState("idle");
    }
  }

  // B2 — retry re-sends the failed user turn through the normal pipeline
  function retryLastTurn() {
    const msgs = messagesRef.current;
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== "user") { setChatError(null); return; }
    messagesRef.current = msgs.slice(0, -1);
    setMessages(msgs.slice(0, -1));
    setChatError(null);
    void handleSend(last.content);
  }

  const statusLabel = state === "thinking" ? "THINKING" : null;

  // The landing is the IDLE state of the Presence panel. Once a conversation is
  // live (messages, a streamed/failed reply, him thinking), the existing reply
  // panel + composer own the screen and the landing's ask bar and chips yield
  // (showSuggestions semantics from the design).
  const conversationActive =
    messages.length > 0 || replyText !== "" || state === "thinking";
  const landingIdle = view === "chat" && !conversationActive;
  // One input per screen: the landing has its ask bar, the intel desk has its
  // own contextual ASK AUGUST bar — the global composer dock renders on
  // neither unless a conversation is live ON SCREEN. conversationActive is
  // deliberately sticky (messages persist all session so the landing stays in
  // its conversation layout); the desk instead keys off what is visibly live —
  // an in-flight reply, or the reply card being open. A dismissed panel with
  // old history must not summon the dock over the desk.
  const conversationLive = state === "thinking" || (panelOpen && replyText !== "");
  const intelPanelIdle = view === "terminal" && !conversationLive;
  // GAME-2 — the PIT owns its surface; the dock composer stands down there
  const pitIdle = view === "pit" && !conversationLive;

  return (
    <main
      className="stage-vignette has-rail relative h-[100dvh] w-screen overflow-hidden"
    >
      {/* BootHud / FrameTicks / PresenceTelemetry retired from the landing —
          the home design's minimalism is the point; the components remain. */}
      {/* the code-rain — the matrix theme's stage layer, behind everything;
          the intensity dial (R1-REDO) can switch it off entirely */}
      {theme === "matrix" && rainPreset !== "off" ? <MatrixRain preset={rainPreset} /> : null}

      {/* CORE V2 — the top-bar view toggle, in the deck dots' old top-center
          slot. Two views only; the segmented control is the page's whole nav. */}
      <nav className="view-bar" aria-label="AUGUST views">
        <button
          type="button"
          className={`view-tab${view === "chat" ? " on" : ""}`}
          aria-pressed={view === "chat"}
          onClick={() => { if (view === "chat") startNewChat(); else switchView("chat"); }}
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
          hides there). IDEAS opens the rail sheet — the book-at-a-glance
          from inside a conversation (the F9 ruling, argued at the gate). */}
      <nav className="tab-bar" aria-label="AUGUST views">
        <button
          type="button"
          className={`tab-item${view === "chat" ? " on" : ""}`}
          aria-pressed={view === "chat"}
          onClick={() => { if (view === "chat") startNewChat(); else switchView("chat"); }}
        >
          AUGUST
        </button>
        <button
          type="button"
          className={`tab-item${view === "terminal" ? " on" : ""}`}
          aria-pressed={view === "terminal"}
          onClick={() => switchView("terminal")}
        >
          TERMINAL
        </button>
        {/* GAME-2 — IDEAS → PIT: the arcade replaced the rail-sheet slot */}
        <button
          type="button"
          className={`tab-item${view === "pit" ? " on" : ""}`}
          aria-pressed={view === "pit"}
          onClick={() => switchView("pit")}
        >
          PIT
        </button>
        {/* R1 A2 — the IDEAS drawer gets its phone opener back (the audit
            found it mounted but unreachable ≤700px) */}
        <button
          type="button"
          className={`tab-item${railOpen ? " on" : ""}`}
          aria-pressed={railOpen}
          onClick={() => setRailOpen((v) => !v)}
        >
          IDEAS
        </button>
      </nav>

      {/* Trade Ideas rail — beside BOTH views: fixed sidebar ≥1100px
          (collapsible to an edge tab, UX1), drawer below */}
      <IdeasRail
        open={railOpen}
        onClose={() => setRailOpen(false)}
        collapsed={railCollapsed}
        onToggleCollapsed={toggleRailCollapsed}
      />

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
            theme={theme}
            active={view === "chat"}
            conversationActive={conversationActive}
            busy={state === "thinking"}
            onSend={handleSend}
            transcript={
              <ChatTranscript
                messages={messages}
                replyText={replyText}
                thinking={state === "thinking"}
                onNewChat={startNewChat}
                error={chatError}
                onRetry={retryLastTurn}
              />
            }
            pushState={pushState}
            onNotify={handleNotify}
            onSetTheme={applyTheme}
            rainPreset={rainPreset}
            onSetRainPreset={applyRainPreset}
          />
          {/* HomeBrief owns the home state (UX2-T2) */}
        </div>
      </section>
      <section
        className={`view-panel${view === "terminal" ? "" : " view-hidden"}`}
        aria-hidden={view !== "terminal"}
      >
        {/* The embedded intel desk keeps its audience split: owner → the full
            desk; everyone else → the public ideas feed. */}
        <IntelDeckSurface
          active={view === "terminal"}
          onExitToChat={() => switchView("chat")}
        />
      </section>
      {/* GAME-2 — THE PIT arcade */}
      <section
        className={`view-panel${view === "pit" ? "" : " view-hidden"}`}
        aria-hidden={view !== "pit"}
      >
        <PitSurface active={view === "pit"} />
      </section>

      {/* reply dock + composer — fixed. The composer serves every surface;
          the overlay reply card is TERMINAL-ONLY now (CORE V2 P5): over the
          desk it stays a contained, dismissible card that never covers the
          widgets, while the chat view renders the conversation as a full
          Claude-style transcript inside the landing instead. */}
      {/* pointer-events-none is load-bearing: the transparent full-width wrapper must
          never eat clicks meant for the surfaces beneath (globe reset, drag, click-
          outside dismissal). The dock and composer row re-enable their own events. */}
      <div
        ref={dockWrapRef}
        className="dock-wrap pointer-events-none fixed inset-x-0 z-20 flex flex-col items-center gap-3 px-4 pb-8 sm:pb-10"
      >
        {view === "terminal" &&
        panelOpen &&
        (replyText || (historyOpen && messages.length > 0)) ? (
          <div
            className={`reply-dock${historyOpen ? " history" : ""}${dockClosing ? " closing" : ""}`}
            role="log"
            onClick={() => {
              // Don't expand when the user was selecting text to copy — the view
              // swap would unmount the node and destroy the selection.
              if (!historyOpen && !window.getSelection()?.toString()) setHistoryOpen(true);
            }}
          >
            <div className="dock-head">
              <button
                type="button"
                className="dock-ctl"
                onClick={(e) => {
                  e.stopPropagation();
                  setHistoryOpen((v) => !v);
                }}
              >
                {historyOpen ? "▾ reply" : "▸ conversation"}
              </button>
              <button
                type="button"
                className="dock-ctl dock-x"
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  closePanel();
                }}
              >
                ✕
              </button>
            </div>
            <div className="dock-body" ref={replyDockRef}>
              {historyOpen ? (
                <>
                  {messages.map((m, i) => (
                    <p key={i} className={`dock-line${m.role === "user" ? " you" : ""}`}>
                      <span className="dock-who">{m.role === "user" ? "YOU" : "AUGUST"}</span>
                      {m.content}
                    </p>
                  ))}
                  {/* Any reply text not yet finalized into messages — a streaming
                      reply, a stopped partial, or the connection-lost line — must
                      stay visible in the transcript view too. */}
                  {(() => {
                    const last = messages[messages.length - 1];
                    const finalized =
                      !!last && last.role === "assistant" && last.content === replyText;
                    return replyText && !finalized ? (
                      <p className="dock-line">
                        <span className="dock-who">AUGUST</span>
                        {replyText}
                      </p>
                    ) : null;
                  })()}
                </>
              ) : (
                <p className="reply-text">{replyText}</p>
              )}
            </div>
          </div>
        ) : view === "terminal" && statusLabel ? (
          // Chat-view thinking cues live inside the transcript now.
          <div className="reply-status">{statusLabel}</div>
        ) : null}

        {/* On the idle landing the design's ask bar IS the input, and the
            intel desk carries its own contextual ASK AUGUST bar — the dock
            composer stands down on both (one input per screen); it returns
            the moment a conversation is live. */}
        {!landingIdle && !intelPanelIdle && !pitIdle ? (
        <div className="composer-row">
          <Composer
            onSend={handleSend}
            busy={state === "thinking"}
            autoFocus={booted}
          />
          <div className="composer-ctls">
            {state === "thinking" ? (
              <button
                type="button"
                className="ctl-round"
                onClick={stopGeneration}
                title="Stop generating"
                aria-label="Stop generating"
              >
                <StopIcon />
              </button>
            ) : null}
            {/* Bell and theme live in the landing's quiet top-bar cluster
                (HomeLanding) — the conversation cluster keeps only the
                in-conversation controls: stop and the mood switcher
                (which has no home on the landing). */}
            <button
              type="button"
              className="ctl-round ctl-mood"
              onClick={cycleMood}
              title={`Mood: ${mood} — tap to cycle`}
              aria-label={`Accent mood: ${mood}. Tap to cycle moods.`}
            >
              <MoodIcon />
            </button>
          </div>
        </div>
        ) : null}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Small control icons.
// ---------------------------------------------------------------------------

function StopIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}

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
// Theme toggle icons — the control lives in the landing's top-bar cluster.
// ---------------------------------------------------------------------------

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

/* Signal icon — a beam ring, the third theme's cue. Same stroke language as
   Sun/Moon; monochrome (currentColor), no decoration. */
function SignalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="8.5" opacity="0.45" />
    </svg>
  );
}

// Mood control — an aperture ring around a live accent swatch: the centre dot is
// painted with var(--steel), so the control always shows the current mood.
function MoodIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="12" cy="12" r="8.4" />
      <circle
        cx="12"
        cy="12"
        r="3.4"
        stroke="none"
        style={{ fill: "var(--steel)", transition: "fill 300ms ease" }}
      />
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
