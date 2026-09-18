# AUGUST — DESIGN LAWS

> The binding laws every build complies with. Numbered so specs can cite them
> (a spec saying "per L6" means this file). Laws are amended by commit, never
> silently. Distilled 2026-08-15 from the settled decisions of CORE V2 → GAME-5;
> AUTH-1a is the first build gated on this file.

## L1 — PAPER LANGUAGE
*Amended 2026-09-17 (feat/v4-2-today); replaces TERMINAL LANGUAGE. The terminal
went paper in v4-1; the front page, app shell, /login and /welcome follow in v4-2.*

One theme. Cool paper ground, white cards with one hairline border and rounded
corners, ink text — no theme switcher, no second palette. One card per module,
real boundaries, generous spacing; each card is carried by one big number or
one headline, a small label, and at most one accent with one job. Geist sets
text; mono is for labels, tickers and numbers. Headline, label and body sit on
distinct tiers of the shared type scale. Green is upside, red is downside,
amber warns, blue is the interface accent — semantic color is not decoration,
and copy grey meets AA on paper. Market data wears its provenance chip at every
width; August's own stored records wear an as-of time. Never casino, never
arcade: a call is a question with a side, never odds. Paper is the desk; dark
is the arena. Every intelligence surface — front page, terminal, docs, legal,
account — is paper. A surface that is a game, not a desk, may hold a dark arena,
and THE PIT is the one that does today. /admin is the operator's back room and
keeps its own dark shell; it is not a customer surface and is exempt. New
surfaces adopt the language; they don't invent one.

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

## L11 — FAILURE IS A STATE, NOT AN ABSENCE
No surface may render a failed fetch, a swallowed exception, or a missing credential as emptiness, zero, or a clean blank. Failure renders UNAVAILABLE with its chip and, where the cause is known, the cause. A catch that logs and returns null, [], or 0 is a bug regardless of what it protects. The honest value usually already exists; the surface throws it away.
