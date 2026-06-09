// The command deck's surfaces, in order. Shared by the deck, the indicators,
// and the go_to_screen tool.
export const SCREENS = ["presence", "markets", "intel", "comms", "command"] as const;
export type ScreenId = (typeof SCREENS)[number];

export const SCREEN_LABELS: Record<ScreenId, string> = {
  presence: "Presence",
  markets: "Markets",
  intel: "Intel",
  comms: "Comms",
  command: "Command",
};

export function screenIndex(id: string): number {
  return (SCREENS as readonly string[]).indexOf(id.toLowerCase());
}
