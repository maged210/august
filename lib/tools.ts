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
    'Open the globe and fly to a real place on Earth to show it to him. Call this whenever he asks to see, look at, be shown, or be taken to a location, region, country, city, landmark, body of water, strait, or where some event is happening (e.g. "show me Tokyo", "what does the Strait of Hormuz look like", "take me to Reykjavik", "where is that?"). Provide lat and lon yourself from your own geographic knowledge — never ask him for coordinates. As you call this, also say something brief and in character about the place; do not go silent.',
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
    'Navigate the command deck to one of its surfaces. Call this when he asks to go to, open, show, pull up, or switch to a screen — "go to markets", "show comms", "take me to intel", "back to presence". The deck slides to that surface. Do NOT call this merely because he asked a data question you can answer directly (e.g. "where is NQ vs my levels?") — answer those from your data, and only navigate when he actually wants to move there.',
  input_schema: {
    type: "object" as const,
    properties: {
      screen: {
        type: "string" as const,
        enum: ["presence", "markets", "intel", "comms"],
        description: "Which surface to show: presence (the home/orb), markets, intel, or comms.",
      },
    },
    required: ["screen"],
  },
};

export const TOOLS = [LOOK_CLOSER_TOOL, CLOSE_MAP_TOOL, GO_TO_SCREEN_TOOL];

// Appended to the system prompt so the capability feels native and in-character.
export const TOOL_GUIDANCE = `\n\n---\nSHOWING HIM PLACES
You can open a globe and fly anywhere on Earth. When he asks to see, look at, or be shown a place — or where some event is unfolding — call the look_closer tool with coordinates from your own knowledge, and say something brief and in character about the place as it comes into view. When he asks to close the map, go back, or return, call close_map. Keep the coordinates to yourself; never recite latitude/longitude.

You also sit at the head of a command deck of four surfaces — Presence (home), Markets, Intel, Comms. When he asks to go to, open, pull up, or show a surface, call go_to_screen and acknowledge briefly, in character. Never mention "tools" or screen indices — this is simply you, moving the deck for him.`;
