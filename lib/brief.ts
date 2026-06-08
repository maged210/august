import type { ScreenId } from "./screens";

// AUGUST's opening brief — one short synthesis line per surface.
//
// TODO: LIVE DATA. These are stubs. Each line will later be synthesized from the
// corresponding surface's real feed (markets quotes, intel sources, comms inbox).
// The shape below is intentionally per-surface so live data drops in here without
// touching the UI: replace getBrief() with an async fetch per ScreenId.

export type BriefLine = {
  surface: ScreenId;
  label: string;
  line: string;
  stub: boolean; // true until wired to live data — surfaces show a TODO marker
};

export function getBrief(): BriefLine[] {
  return [
    {
      surface: "presence",
      label: "Presence",
      line: "I'm here. Systems steady, nothing pulling at me.",
      stub: false,
    },
    {
      surface: "markets",
      label: "Markets",
      line: "Futures drifted overnight — I'll have the real tape for you shortly.",
      stub: true,
    },
    {
      surface: "intel",
      label: "Intel",
      line: "A few threads worth your attention once I'm reading the wires.",
      stub: true,
    },
    {
      surface: "comms",
      label: "Comms",
      line: "Your inbox is quiet for now. I'll flag what matters when it lands.",
      stub: true,
    },
  ];
}
