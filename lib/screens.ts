// The command deck's surfaces, in order. Shared by the deck, the indicators,
// and the go_to_screen tool. Four surfaces. The second slide embeds the full
// intel desk. /intel also remains a real standalone page (its own chrome and
// sign-in affordances) — the deck slide and that route are two hosts for the
// same dashboard, NOT a redirect. The slide's id stays "markets" so
// go_to_screen, watcher deep links, and saved "?screen=markets" URLs keep working.
export const SCREENS = ["presence", "markets", "world", "comms"] as const;
export type ScreenId = (typeof SCREENS)[number];

export const SCREEN_LABELS: Record<ScreenId, string> = {
  presence: "Presence",
  // the second surface embeds the full /intel desk — the label follows what is
  // actually on the slide, while the id stays "markets" (see above)
  markets: "Intel",
  world: "World",
  comms: "Comms",
};

// Legacy / spoken names that should still resolve to a live surface. "command"
// merged into WORLD long ago; the market words (desk/intel/tape — spoken to
// AUGUST, in a watcher deep link, a pulse delta's nav, or a stale bookmark) all
// mean the second slide, which is keyed "markets".
const SCREEN_ALIASES: Record<string, ScreenId> = {
  command: "world",
  globe: "world",
  news: "world",
  home: "presence",
  orb: "presence",
  desk: "markets",
  intel: "markets",
  tape: "markets",
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
