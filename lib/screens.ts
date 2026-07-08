// The command deck's surfaces, in order. Shared by the deck, the indicators,
// and the go_to_screen tool. INTEL (world news wires + AUGUST's synthesis) now
// lives fused onto the WORLD globe surface — four surfaces, not five.
export const SCREENS = ["presence", "markets", "world", "comms"] as const;
export type ScreenId = (typeof SCREENS)[number];

export const SCREEN_LABELS: Record<ScreenId, string> = {
  presence: "Presence",
  // the second surface now embeds the full /intel desk (id stays "markets" so
  // go_to_screen, watcher deep links, and saved "?screen=markets" URLs keep working)
  markets: "Intel",
  world: "World",
  comms: "Comms",
};

// Legacy / spoken names that should still resolve to a live surface. "intel" and
// "command" merged into WORLD, so any lingering reference — from AUGUST, a market
// snapshot, or a saved deep link — lands there instead of failing to navigate.
const SCREEN_ALIASES: Record<string, ScreenId> = {
  intel: "world",
  command: "world",
  globe: "world",
  news: "world",
  home: "presence",
  orb: "presence",
};

export function screenIndex(id: string): number {
  const k = id.toLowerCase();
  const direct = (SCREENS as readonly string[]).indexOf(k);
  if (direct >= 0) return direct;
  const alias = SCREEN_ALIASES[k];
  return alias ? (SCREENS as readonly string[]).indexOf(alias) : -1;
}
