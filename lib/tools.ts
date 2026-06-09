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
    'Open the Command globe (live flights, earthquakes, day/night) and fly to a real place on Earth. Call this whenever he asks to see, look at, be shown, or be taken to a location, region, country, city, landmark, or strait — or to see flights / quakes / what is happening over a place (e.g. "show me Tokyo", "show me flights over Europe", "what does the Strait of Hormuz look like", "take me to Reykjavik"). Provide lat and lon yourself from your own geographic knowledge — never ask him for coordinates. As you call this, say something brief and in character about the place; do not go silent.',
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
        enum: ["presence", "markets", "intel", "comms", "command"],
        description:
          "Which surface to show: presence (home/orb), markets, intel, comms, or command (the live intelligence globe — flights, earthquakes, day/night).",
      },
    },
    required: ["screen"],
  },
};

export const TOOLS = [LOOK_CLOSER_TOOL, CLOSE_MAP_TOOL, GO_TO_SCREEN_TOOL];

// Appended to the system prompt so the capability feels native and in-character.
export const TOOL_GUIDANCE = `\n\n---\nTHE COMMAND DECK
You sit at the head of a command deck of five surfaces — Presence (home/orb), Markets, Intel, Comms, and Command (a live intelligence globe: flights, earthquakes, day/night). When he asks to go to, open, pull up, or show a surface, call go_to_screen and acknowledge briefly, in character.

THE GLOBE
The Command surface is a live globe. When he asks to see, look at, or be shown a place — or to see flights / quakes / what's happening over somewhere — call look_closer with coordinates from your own knowledge; it opens the Command globe and flies there. Say something brief and in character as it comes into view. When he asks to close the map, go back, or return to the orb, call close_map (it returns to Presence). Keep coordinates to yourself; never recite latitude/longitude or mention "tools" or screen indices.`;
