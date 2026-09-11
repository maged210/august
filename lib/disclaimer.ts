// THE DISCLAIMERS — one source of truth, imported everywhere (chore/ship-ready).
//
// AUGUST does two different things and they need two different sentences. The
// published calls are research and opinion. The PIT and the Training floor are
// simulated games with no real orders. Collapsing those into one generic line
// would water down the stronger claim, so they stay separate.
//
// THE RULE THESE STRINGS ARE RENDERED UNDER (see components/Disclaimer.tsx):
//   · visible in the rendered layout at rest
//   · no interaction required to read it
//   · NEVER a title attribute, never hover-gated, never sr-only
// That rule exists because this branch found the opposite shipped: THE CALL
// card, the regime line and the NQ levels module each carried "not advice"
// inside a `title` tooltip. On a phone-first app a hover tooltip is not a
// disclaimer — it is the absence of one that happens to pass a keyword grep.

/** Every surface that publishes a directional call, an entry/target/stop, a
 *  regime read, or THE CALL. */
export const DISCLAIMER_CALLS =
  "Research and opinion, not investment advice. AUGUST's calls are its own read of the market and can be wrong. You are responsible for your own trades.";

/** The same claim, compressed for places that carry a hard length budget: a
 *  push notification body, share text, a JSON field. Same meaning, fewer
 *  characters — never a softer claim. */
export const DISCLAIMER_CALLS_SHORT = "Research, not investment advice. Your trades are your own.";

/** THE PIT. Deliberately stronger than the generic line and NOT replaced by
 *  it: this is a simulation, and saying so is a bigger claim than "opinion". */
export const DISCLAIMER_SIM =
  "SIMULATED — entertainment, not investment advice. No real orders.";

/** The Training floor's own long-standing wording, kept verbatim. */
export const DISCLAIMER_TRAINING =
  "SIMULATED — training floor. Education, not investment advice.";

export type DisclaimerVariant = "calls" | "sim" | "training";

export function disclaimerText(variant: DisclaimerVariant): string {
  if (variant === "sim") return DISCLAIMER_SIM;
  if (variant === "training") return DISCLAIMER_TRAINING;
  return DISCLAIMER_CALLS;
}
