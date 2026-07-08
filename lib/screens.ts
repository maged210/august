// The command deck's surfaces, in order. Shared by the deck, the indicators,
// and the go_to_screen tool. Four surfaces — the market DESK is a deck slide
// again (it briefly lived at a standalone /intel page; that route now just
// redirects into the deck).
export const SCREENS = ["presence", "desk", "world", "comms"] as const;
export type ScreenId = (typeof SCREENS)[number];

export const SCREEN_LABELS: Record<ScreenId, string> = {
  presence: "Presence",
  desk: "Desk",
  world: "World",
  comms: "Comms",
};

// Legacy / spoken names that should still resolve to a live surface. "command"
// merged into WORLD long ago; the market words (markets/intel/tape — spoken to
// AUGUST, in a watcher deep link, or a stale bookmark) all mean the DESK slide.
const SCREEN_ALIASES: Record<string, ScreenId> = {
  command: "world",
  globe: "world",
  news: "world",
  home: "presence",
  orb: "presence",
  markets: "desk",
  intel: "desk",
  tape: "desk",
};

export function screenIndex(id: string): number {
  const k = id.toLowerCase();
  const direct = (SCREENS as readonly string[]).indexOf(k);
  if (direct >= 0) return direct;
  const alias = SCREEN_ALIASES[k];
  return alias ? (SCREENS as readonly string[]).indexOf(alias) : -1;
}

// Where a named target actually lives. Everything is a deck surface now, but the
// resolver keeps its discriminated shape so consumers (deep links, tool nav,
// telemetry readouts) stay one-line simple and a future route target is a local
// change here, not a refactor. null = unknown name; callers should no-op.
export type NavTarget = { kind: "screen"; index: number } | null;

export function resolveTarget(id: string): NavTarget {
  const index = screenIndex(id);
  return index >= 0 ? { kind: "screen", index } : null;
}
