// Claude tool-use definitions for AUGUST's "look closer" globe.
// Server-side: passed to the Messages API. The client only reacts to the tool
// names that come back framed in the chat stream (see SEP below).

// Unit Separator (0x1F) — frames tool-call JSON inside the text stream so the
// client can split tool events out of AUGUST's spoken words. Never appears in
// normal prose, so it's a safe delimiter.
export const SEP = String.fromCharCode(0x1f);

export const LOOK_CLOSER_TOOL = {
  name: "look_closer",
  description:
    'Open the World globe (live flights, earthquakes, day/night, with the world news wires alongside) and fly to a real place on Earth. Call this whenever he asks to see, look at, be shown, or be taken to a location, region, country, city, landmark, or strait — or to see flights / quakes / what is happening over a place (e.g. "show me Tokyo", "show me flights over Europe", "what does the Strait of Hormuz look like", "take me to Reykjavik"). Provide lat and lon yourself from your own geographic knowledge — never ask him for coordinates. As you call this, say something brief and in character about the place; do not go silent.',
  input_schema: {
    type: "object" as const,
    properties: {
      lat: { type: "number", description: "Latitude in decimal degrees, between -90 and 90." },
      lon: { type: "number", description: "Longitude in decimal degrees, between -180 and 180." },
      label: {
        type: "string",
        description: "A short label for the marker — usually the place's name.",
      },
      zoom: {
        type: "number",
        description:
          "Target zoom: ~3 for a country, ~5 for a region, ~7-9 for a strait/landmark/bay, ~10-11 for a city, ~13 for a neighborhood. Default ~8 if unsure.",
      },
    },
    required: ["lat", "lon", "label"],
  },
};

export const CLOSE_MAP_TOOL = {
  name: "close_map",
  description:
    "Close the globe and return to the orb. Call this when he asks to close the map, hide the globe, go back, take him back, or otherwise dismiss the view. Say a brief word in character as you do.",
  input_schema: {
    type: "object" as const,
    properties: {},
  },
};

export const GO_TO_SCREEN_TOOL = {
  name: "go_to_screen",
  description:
    'Navigate the command deck to one of its surfaces. Call this when he asks to go to, open, show, pull up, or switch to a screen — "go to markets", "show comms", "take me to the world", "show me the news", "back to presence". The deck slides to that surface. Do NOT call this merely because he asked a data question you can answer directly (e.g. "where is NQ vs my levels?") — answer those from your data, and only navigate when he actually wants to move there.',
  input_schema: {
    type: "object" as const,
    properties: {
      screen: {
        type: "string" as const,
        enum: ["presence", "markets", "world", "comms"],
        description:
          "Which surface to show: presence (home/orb), markets, world (the live intelligence globe — flights, earthquakes, day/night — fused with the world news wires and your grounded synthesis), or comms. 'Intel' and the news live on the world surface.",
      },
    },
    required: ["screen"],
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
  LOOK_CLOSER_TOOL,
  CLOSE_MAP_TOOL,
  GO_TO_SCREEN_TOOL,
  CREATE_WATCHER_TOOL,
  LIST_WATCHERS_TOOL,
  REMOVE_WATCHER_TOOL,
];

// Tool names that are SERVER-side data operations (executed in /api/chat), not
// client-side deck/globe actions. The chat route runs these against Upstash and
// feeds the real result back so AUGUST confirms what actually happened.
export const WATCHER_TOOL_NAMES = new Set(["create_watcher", "list_watchers", "remove_watcher"]);

// Appended to the system prompt so the capability feels native and in-character.
export const TOOL_GUIDANCE = `\n\n---\nTHE COMMAND DECK
You sit at the head of a command deck of four surfaces — Presence (home/orb), Markets, World (a live intelligence globe — flights, earthquakes, day/night — fused with the world news wires and your grounded synthesis), and Comms. When he asks to go to, open, pull up, or show a surface, call go_to_screen and acknowledge briefly, in character. If he asks for "intel", "the news", or "the globe", that is the World surface.

THE GLOBE
The World surface is a live globe with the world news wires docked alongside it. When he asks to see, look at, or be shown a place — or to see flights / quakes / what's happening over somewhere — call look_closer with coordinates from your own knowledge; it opens the World globe and flies there. Say something brief and in character as it comes into view. When he asks to close the map, go back, or return to the orb, call close_map (it returns to Presence). Keep coordinates to yourself; never recite latitude/longitude or mention "tools" or screen indices.

WATCHERS — STANDING ALERTS
You can stand watch over what matters to him and reach out when something happens. When he asks you to watch, keep an eye on, or ping/alert/notify him when a condition trips, call create_watcher — market (a ticker crossing a price), quake (a magnitude, optionally near a place), or intel (a keyword on the news wires). When he asks what you're watching, call list_watchers; to stop one, call remove_watcher. After any of these, confirm in your own voice EXACTLY what you're now watching (or no longer watching) — short and plain, e.g. "Done — I'll watch NVDA and ping you the moment it slips under 120." You check these periodically and alert ONCE per trip, so reassure him he won't be spammed. If you can't set one (an unknown ticker, missing detail), say so plainly and ask for what you need. Never invent a confirmation — only confirm what the tool actually returned.`;
