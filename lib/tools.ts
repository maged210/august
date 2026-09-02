// COMMAND-BAR era (feature/command-bar): the model gets NO tools — the
// command lane does navigation and actions deterministically, and the ask
// lane returns one answer card. The old Claude tool definitions (go_to_screen,
// set_mood, the watcher trio) and the SEP stream-framing are deleted with the
// conversation UI; rebuild from git if a tool-driven surface ever returns.
//
// What survives is the MOOD VOCABULARY: the deck's accent temperature. One
// axis, orthogonal to the light/dark theme; the client repaints the accent
// tokens and re-lights the orb (page.tsx + Presence3D). This list is the
// single source of truth for the mood names.

export const MOODS = ["steel", "ember", "phosphor", "graphite"] as const;
export type Mood = (typeof MOODS)[number];
