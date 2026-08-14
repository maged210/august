// THE PIT — ARCHITECTED NOW, BUILT LATER (GAME-3). Types and registry stubs
// only; no UI, no logic. These exist so later rounds implement against a
// stable shape instead of inventing one mid-build.

/** Options module (L5+): the CALL/PUT card. Each unlock ships with a 2-line
 *  educational primer — education, not casino. */
export type OptionsCard = {
  kind: "call" | "put";
  strike: number;
  /** rounds until expiry, in game time */
  expiryRounds: number;
  premium: number;
  maxRisk: number; // premium paid — the honest cap
  maxReward: number | "unlimited";
  primer: [string, string]; // two lines, plain language
};

/** A Terminal live idea projected into the game ("NVDA approaching $185 —
 *  take the trade?"). Built from PublicIdea only — no new data. */
export type PitChallenge = {
  ideaId: string;
  ticker: string;
  prompt: string; // archetype copy + SIM chip; never a factual claim
  side: "long" | "short" | null;
  entryHint: string;
  expiresAt: number;
};

/** Game-modes registry — CAREER ships in GAME-3; the rest register later. */
export type PitMode = "career" | "quick" | "daily" | "endless";
export const PIT_MODES: Record<PitMode, { label: string; shipped: boolean }> = {
  career: { label: "CAREER", shipped: true },
  quick: { label: "QUICK TRADE", shipped: false },
  daily: { label: "DAILY PIT", shipped: false },
  endless: { label: "ENDLESS", shipped: false },
};
