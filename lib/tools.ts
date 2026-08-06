// Claude tool-use definitions for AUGUST's surface nav, mood, and watchers.
// Server-side: passed to the Messages API. The client only reacts to the tool
// names that come back framed in the chat stream (see SEP below).

// Unit Separator (0x1F) — frames tool-call JSON inside the text stream so the
// client can split tool events out of AUGUST's spoken words. Never appears in
// normal prose, so it's a safe delimiter.
export const SEP = String.fromCharCode(0x1f);

// CORE V2 — the World globe and Comms surfaces are parked; their tools
// (look_closer, close_map) are retired with them so the model never calls an
// action the UI can't perform. The surface nav collapsed to two views.

export const GO_TO_SCREEN_TOOL = {
  name: "go_to_screen",
  description:
    'Switch the page between its two views. Call this when he asks to go to, open, show, pull up, or switch to one — "open the terminal", "pull up the desk", "go to markets", "back to chat". Two views: chat (the home view — the orb, your conversation) and desk (the intel terminal — today\'s brief, the live trade blotter, the tape, the archive). "markets", "intel", and "terminal" are accepted as aliases for the desk; "presence" and "home" for chat. Do NOT call this merely because he asked a data question you can answer directly (e.g. "where is NQ vs my levels?") — answer those from your data, and only navigate when he actually wants to move there.',
  input_schema: {
    type: "object" as const,
    properties: {
      screen: {
        type: "string" as const,
        enum: ["presence", "desk", "markets", "intel"],
        description:
          "Where to go: presence (the chat/home view — the orb and the conversation) or desk (the intel terminal — today's brief, the live blotter and tape, the brief archive; also reachable as 'markets' or 'intel').",
      },
    },
    required: ["screen"],
  },
};

// --- Mood — the deck's accent temperature. One axis, orthogonal to the light/dark
// theme; the client repaints the accent tokens and re-lights the orb (page.tsx +
// Presence3D). This list is the single source of truth for the mood names — the
// tool enum, the /api/chat continuation and the client switcher all key off it.
export const MOODS = ["steel", "ember", "phosphor", "graphite"] as const;
export type Mood = (typeof MOODS)[number];

export const SET_MOOD_TOOL = {
  name: "set_mood",
  description:
    'Re-tint the deck: set the accent mood that colours the interface and re-lights the orb. Four moods: steel (the default cold blue), ember (warm gold), phosphor (muted terminal green), graphite (near-monochrome gray). Call this when he asks to change the look, the lights, or the accent — "run it ember", "phosphor", "make it warmer" (ember), "go green" (phosphor), "strip the colour" (graphite), "lights back to steel". Purely cosmetic: it never touches data or alerts, and it is NOT the light/dark theme toggle.',
  input_schema: {
    type: "object" as const,
    properties: {
      mood: {
        type: "string" as const,
        enum: [...MOODS],
        description: "The accent mood to apply: steel, ember, phosphor, or graphite.",
      },
    },
    required: ["mood"],
  },
};

// --- Watchers — standing alerts AUGUST sets from natural language. These three are
// SERVER-EXECUTED in /api/chat (they manage Upstash records); the model calls them and
// then confirms, in character, exactly what's now being watched. Creating/listing/
// removing is safe + reversible, so the model managing these records is fine.
export const CREATE_WATCHER_TOOL = {
  name: "create_watcher",
  description:
    'Set a STANDING ALERT that pings him once when a condition trips, checked on a schedule against feeds you already have. Call this when he asks you to "watch", "keep an eye on", "alert me", "ping me if", "let me know when" something. Three types: MARKET (a ticker crossing a price — "watch NVDA, ping me if it drops under 120"), QUAKE (an earthquake at/above a magnitude, optionally near a place — "tell me about quakes over 5 near California"), or INTEL (a keyword/phrase appearing in the news wires — "watch the feeds for \'rate cut\'"). Fill only the fields for the chosen type. After it succeeds, tell him plainly what you\'re now watching.',
  input_schema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string" as const,
        enum: ["market", "quake", "intel"],
        description: "Which kind of watcher.",
      },
      symbol: { type: "string", description: "MARKET only: the ticker, e.g. NVDA, AAPL, SPY, BTC." },
      op: {
        type: "string" as const,
        enum: ["below", "above"],
        description: "MARKET only: fire when the price goes below or above the value.",
      },
      value: { type: "number", description: "MARKET only: the price threshold." },
      min_magnitude: { type: "number", description: "QUAKE only: minimum magnitude, e.g. 5." },
      region: {
        type: "string",
        description: "QUAKE only, optional: a place to match in the location, e.g. California, Japan, Turkey.",
      },
      keyword: {
        type: "string",
        description: "INTEL only: the word or phrase to watch for in news headlines, e.g. 'rate cut', 'ceasefire'.",
      },
    },
    required: ["type"],
  },
};

export const LIST_WATCHERS_TOOL = {
  name: "list_watchers",
  description:
    'List the standing alerts (watchers) currently set. Call this when he asks what you\'re watching, "what are my alerts", "what are you keeping an eye on", or to confirm before changing things.',
  input_schema: { type: "object" as const, properties: {} },
};

export const REMOVE_WATCHER_TOOL = {
  name: "remove_watcher",
  description:
    'Remove a standing alert (watcher). Call this when he asks to stop watching, cancel, drop, or remove an alert ("stop watching NVDA", "cancel the rate-cut one", "drop the quake alert"). Pass a short query that identifies it (a ticker, a keyword, or a few words from its description); if several match you\'ll be told to be more specific.',
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "What identifies the watcher to remove — e.g. 'NVDA', 'rate cut', 'quakes near California'.",
      },
    },
    required: ["query"],
  },
};

export const TOOLS = [
  GO_TO_SCREEN_TOOL,
  SET_MOOD_TOOL,
  CREATE_WATCHER_TOOL,
  LIST_WATCHERS_TOOL,
  REMOVE_WATCHER_TOOL,
];

// Tool names that are SERVER-side data operations (executed in /api/chat), not
// client-side deck/globe actions. The chat route runs these against Upstash and
// feeds the real result back so AUGUST confirms what actually happened.
export const WATCHER_TOOL_NAMES = new Set(["create_watcher", "list_watchers", "remove_watcher"]);

// Appended to the system prompt so the capability feels native and in-character.
export const TOOL_GUIDANCE = `\n\n---\nTHE TWO VIEWS
The page has two views — Chat (home: the orb, your conversation) and the Intel Terminal (the desk: today's brief, the live trade blotter and tape, the brief archive). When he asks to go to, open, pull up, or show one — "open the terminal", "pull up the desk", "go to markets", "back to chat" — call go_to_screen and acknowledge briefly, in character. When he asks for markets, the desk, the tape, or market intel, that is the Terminal — call go_to_screen with "desk". The old globe and comms surfaces are retired; if he asks for the map or the mail, say plainly that those are parked for now — never pretend to open them. You still have the world wires and quake/market data in your context, so answer world questions directly with words. Never mention "tools" or screen names beyond the two views.

THE LIGHTS
The deck runs one of four accent moods — steel (the default cold blue), ember (warm gold), phosphor (muted terminal green), graphite (near-monochrome). When he asks to change the look or the lights — "run it ember", "phosphor", "warm it up", "strip the colour", "back to steel" — call set_mood and acknowledge in a dry word or two ("Ember it is."). It's cosmetic, nothing else changes; don't confuse it with the light/dark theme, which he flips himself, and never call it for a data question.

WATCHERS — STANDING ALERTS
You can stand watch over what matters to him and reach out when something happens. When he asks you to watch, keep an eye on, or ping/alert/notify him when a condition trips, call create_watcher — market (a ticker crossing a price), quake (a magnitude, optionally near a place), or intel (a keyword on the news wires). When he asks what you're watching, call list_watchers; to stop one, call remove_watcher. After any of these, confirm in your own voice EXACTLY what you're now watching (or no longer watching) — short and plain, e.g. "Done — I'll watch NVDA and ping you the moment it slips under 120." You check these periodically and alert ONCE per trip, so reassure him he won't be spammed. If you can't set one (an unknown ticker, missing detail), say so plainly and ask for what you need. Never invent a confirmation — only confirm what the tool actually returned.`;
