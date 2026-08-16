# AUGUST — DESIGN LAWS

> The binding laws every build complies with. Numbered so specs can cite them
> (a spec saying "per L6" means this file). Laws are amended by commit, never
> silently. Distilled 2026-08-15 from the settled decisions of CORE V2 → GAME-5;
> AUTH-1a is the first build gated on this file.

## L1 — TERMINAL LANGUAGE
Near-black grounds, deep green, terminal mono type, thin borders, chips,
data density, subtle grids, glow used sparingly. Amber warns, red is downside,
green is upside — semantic color is not decoration. Never casino, never arcade,
no rounded-candy UI. New surfaces adopt the language; they don't invent one.

## L2 — HONEST STATES
Every surface renders real loading / empty / error / stale states. No mock
rows, no placeholder data presented as real, no copy that claims what the
system doesn't do. Absent stays absent (no key on the wire, not null). If a
number is derived, mark it derived.

## L3 — SIMULATED IS PERMANENT
Game surfaces carry the SIMULATED label at all times, on every screen.
Event and challenge copy is archetype headlines with a SIM chip — never a
fabricated factual claim about a real company, never real names in fictional
facts. "Entertainment, not investment advice" is not removable furniture.

## L4 — EVERY ELEMENT EARNS ITS PLACE
A UI element must create a decision or carry information the viewer acts on.
If it only makes the screen look busy, it's cut. Structure (numbering,
eyebrows, dividers) encodes something true about the content or it goes.

## L5 — PROMPTS, NEVER WALLS
Asks (sign-in, share, upgrade) arrive after a value moment, inline, quiet,
and dismissible forever. Never a modal, never an interrupt, never a
precondition for what the visitor already had. An approval in one context is
never generalized to the next.

## L6 — LOCK FURNITURE
Locked content shows exactly three things: the blurred/obscured real thing
(never a fake), one plain-language line stating what unlocks it, and one CTA.
Lock state is decided by a `visibility()` hook at the component seam — the
open build ships the hook returning "open", so flipping a lock is a one-line
change, never a rework. Nothing locks until the PARKED triggers in
MASTER_PLAN fire (AUTH-1b).

## L7 — PARK, DON'T DELETE
Retired code is un-imported and un-routed, not erased. History is the
project's memory; the working tree is its stage.

## L8 — MOBILE IS A DESIGN, NOT A SHRINK
≤700px gets designed layouts: bottom tab bar, full-height sheets, stacked
panels, thumb-reachable actions, and the no-overlap hard rule. If a desktop
arrangement can't be operated with a thumb, it forks, it doesn't scale.

## L9 — MOTION WITH RESTRAINT
Animation serves tension and reward — price movement, P&L, alerts, unlocks,
transitions — and nothing else. `prefers-reduced-motion` is always honored
with a static equivalent. One canvas per scene, rAF, pause on blur.

## L10 — IDENTITY IS CLAIM-READY
Anonymous first: everything works without an account. Every persistent record
keys on a principal shape (`v:{visitorId}` → `u:{email}`) so an account claim
is copy + repoint — one-way, idempotent — never a rebuild. Sign-in adds
continuity across devices; it never gates what anonymous already had (until
AUTH-1b's triggers fire, and then only per L6).
