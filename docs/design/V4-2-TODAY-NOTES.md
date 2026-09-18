# feat/v4-2-today — branch notes

Base: main at `226262a` (feat/v4-1b-integrity merged). Source of truth: frame 01 TODAY (and
the call anatomy of frame 02) of `docs/design/August Mobile v4 Markets.dc.html`, Claude
Design project 9c07acb8-0f26-4450-93b1-b7d2519e966a. `ios-frame.jsx` is the iPhone bezel and
`support.js` the design tool's runtime — neither carries a token. The audit that preceded the
build (six auditors, each claim re-derived by a skeptic) and the owner's fourteen decisions
are the spec; this file records what was built against them.

## Laws first

- **L1 amended by commit** (`20fe7fa`, wording approved by the owner): PAPER LANGUAGE replaces
  TERMINAL LANGUAGE. Paper is the desk; dark is the arena — THE PIT holds a dark arena as a
  class, /admin is the operator's back room and is exempt.
- Tag **`archive/theme-menu`** on `226262a` is the rebuild point for everything the one-theme
  decision retired (below). Local tag — push it with the merge.

## One theme

- `<html data-theme="light">` is server-rendered (`app/layout.tsx`). The attribute stays because
  the terminal's paper block keys on it. The pre-paint script now does two things: the rail's
  collapse, and a one-time sweep of `aug-theme`, `aug-theme-paperdefault`, `aug-mood`,
  `aug-rain-level` from the visitor's storage (so /privacy's list of browser-held preferences
  stays true).
- **Retired and deleted:** the moon menu (MATRIX / DARK / LIGHT / GOTHAM), `components/MatrixRain.tsx`,
  `lib/rain-symbols.ts` and its two publishers, the rain dial, the batman and matrix `:root`
  blocks, the night/matrix sets on `.home-landing` / `.login-page` / `.welcome-page`, the orb's
  night CSS layers (halo, ring, gradient core) and Presence3D's dark / batman / matrix looks,
  the terminal's matrix block, the theme cross-fade, the dead warm DAY WORLD
  `.command-surface` pins, and the page's theme / mood / rain state.
- **The mood axis went too** (flagged — not on the owner's list by name): it had no control, but
  a stored mood still re-tinted the shell's accent, i.e. a second palette the L1 amendment rules
  out. Presence3D keeps its internal mood table (the orb is never handed a mood; it runs the
  default rig).
- **The matrix-then-light first paint is gone** (the React theme state that started at `matrix`
  no longer exists).

## Tokens — one source

`app/globals.css` `:root` now holds the shared set, promoted out of `app/intel/frame.css`:

| Token | Value | Job |
|---|---|---|
| `--paper-stage` | `#f4f5f7` | the ground |
| `--paper-card` | `#ffffff` | every card |
| `--paper-ink` | `#0f1115` | primary text |
| `--paper-mute` | `#5d636f` | THE copy grey (AA: 5.5:1 stage, 6.0:1 card) |
| `--paper-hair` | `rgba(15,17,21,.09)` | THE border (the terminal's `--rd-hair-08`, ≈ #e9eaea on a card) |
| `--paper-rule` | `rgba(15,17,21,.06)` | a divider inside a card |
| `--paper-up` / `-down` / `-accent` / `-warn` | `#0e7f41` / `#cf3226` / `#2456d6` / `#7a5a12` | + `-rgb` triplets |
| `--paper-radius` / `-lg` / `-sm` | 14 / 16 / 12px | module card / page card / tile, button, strip |
| `--chip-live-edge` / `-alert-edge` / `-calc-edge` | paper up / down / accent at .35 / .35 / .30 | provenance chip borders |

- `frame.css`'s paper block points 32 `--rd-*` names at these (same values — one source).
- The **warm root light block retired**: its legacy names (`--charcoal`, `--bone`, `--ash`,
  `--line`, `--glass*`, `--steel`, `--pos`/`--neg`, `--amber`, `--rd-app-live/alert/calc`) now
  point at the paper set, so the tab bar, the desktop view bar, IdeasRail, /privacy, /terms and
  the global chips and disclaimer are cool. `--vignette` and `--grain-opacity` keep their old
  values on purpose: both are painted over every view, the PIT's arena included.
- **The terminal pins its own shell values** at the end of its paper block (`--bone #16150f`,
  `--line`, `--amber`, `--rd-app-live/alert/calc`, the three chip edges) — the names its chips,
  disclaimer, dock condition pills and base text read — so its output is unchanged (decision 2).
- **/admin pins** `--accent-line` / `--glow-accent`: both are computed at `:root` from the shell's
  `--steel-rgb`, so the `.admin-page` re-pin block never reached them.
- **/login and /welcome** retire their warm copies and read the paper set under their own short
  local names; the gold dots, hover borders and switch fill take the one blue accent; the
  welcome section labels take the mute grey; the login email field gets a visible focus ring
  (it read the undefined `--green` / `--fg` and had none).
- Name hygiene: the promoted tokens use fresh names. `--dim`, `--hair`, `--label`, `--ink`,
  `--up`, `--down` are read with no fallback by the PIT's Training floor, and `--green` / `--fg`
  are read (undefined) by the PIT and /login, so none of those names is defined at `:root`.

## Type — one scale

| Tier | Token | Value | Terminal literal moved onto it (rendered value unchanged) |
|---|---|---|---|
| figure — the ONE big number | `--type-figure` / `-weight` | 40px / 600 | `.v4-odds-pct` |
| headline — words that carry a card | `--type-headline` / `-weight` | 20px / 600 | — |
| title — card question / heading | `--type-title` / `-weight` | 14px / 600 | `.v4-ic-q`, `.v4-card-h` |
| row — a data row inside a card | `--type-row` | 13px | — |
| body — prose | `--type-body` | 14.5px (lh 1.55) | — |
| foot — a card's closing line | `--type-foot` | 12px | `.v4-card-foot` |
| meta — the line under a title | `--type-meta` | 11.5px | `.v4-ic-meta` |
| label — mono caps card name | `--type-label` / `-weight` / `-track` | 10.5px / 500 / .08em | — |

feed.css keeps its convention: every token carries the old literal as its fallback. Line heights
and letter-spacing stay literal per rule. The compact idea page's 28px override is untouched.
Every front-page size reads a tier except the wordmark (18px, identity) and the command-bar
input (16px — iOS focus-zoom, see below).

**Fonts.** Geist loads 400/500/600, JetBrains Mono 400/500 (`app/layout.tsx`). The frame's 700s
render as 600 (the v4-1 precedent); mono tiles and labels use 500. No weights added. The
front page no longer asks for synthesized mono bold (it did on 18 selectors); the shared chip
(`.dtag`, 700) is unchanged because the terminal renders it.

## What maps to real data

| Card | Source | Chip | Notes |
|---|---|---|---|
| Day line | ET clock | — (a line, not a card) | no exchange calendar exists; holidays read by the clock |
| Market regime | quote book (SPY QQQ ^VIX NQ=F prices + the closes that came with them) + `/api/ideas` → `lib/regime` | CALCULATED / DATA UNAVAILABLE | headline = the label word; gauge = `regimeGauge` (vote sum clamped to ±2, five steps, no step lit when unavailable); agreement = `{agree} of {voting} voting inputs lean …` ("dead even" when null); WHY lists **every** input with its own vote tag |
| THE CALL | `/api/call` (unchanged route) | CALCULATED (+STALE after 2 misses) / DATA UNAVAILABLE | Higher / Lower on the existing vote (`takeSide`); settled line reads the **stored** `close` / `prevClose` (new passthrough fields on `CallState.settled`, no storage change); an open call shows no reference line |
| Command bar + answer card | unchanged lanes | quote card: DELAYED | restyle only; input stays 16px; the ⌘K hint is desktop only |
| Next high-impact print | `/api/calendar` | DELAYED weekly feed / DATA UNAVAILABLE | figure = the countdown |
| Pulse | quote book | DELAYED 60s / DATA UNAVAILABLE; per-row UNAVAILABLE | every symbol always has a row |
| NQ levels | `/api/intel/levels` | DELAYED 60s / DATA UNAVAILABLE; condition CALCULATED | the levels read is a slot with the quote book's rule: a failed attempt or a read older than three polls is UNAVAILABLE, never the last good levels; "last bar HH:MM ET" from `levels.asOf` |
| Desk | `/api/ideas` + `/api/wire` | none — **as of HH:MM ET** (stored records, decision 9) | figure = live calls; DATA UNAVAILABLE only when the store can't be reached; the EARNINGS row stays (open, see below) |
| What's being said | `/api/headlines` | DELAYED 15m / DATA UNAVAILABLE | a list is shown only while its last good read is < 20 min old; publisher + link kept |
| From the desk (env `PUBLIC_FEED_MODE=desk`) | `/api/tape` | none — as-of per row | failure now says so (was "quiet") |
| WATCHING | quote book | DELAYED 60s / DATA UNAVAILABLE, **visible on phones** | per-pill "—" when a symbol has no fresh price; never vanishes |
| Account (phones) | `/api/auth/session` | — | Setup · Sign out · Delete account |

**One quote book.** `chunkSymbols`, `mergeQuoteRound`, `readQuote` and the types moved verbatim
from `lib/idea-card.ts` to `lib/quote-book.ts`; the client loop moved from `IdeasFeed` to
`lib/use-quote-book.ts`. The terminal and the front page import the same code. The front page's
spark closes live in its own parallel map (`mergeRoundCloses` / `readCloses`): closes are only
read through a price the book says is fresh, from the same answer. STALE is retired for prices.
The front page asks for one union of symbols (pulse + regime + WATCHING), chunked.

## Additions beyond frame 01

- The Account card (phones) — account deletion was unreachable on phones while /privacy and
  /terms point at it.
- The ADMIN chip in the desktop header replaces the non-link OWNER badge (terminal-cut parity:
  one owner difference, the same one on every surface). **Flagged** — a behaviour change the
  owner did not name.
- The tab bar carries frame 01's three stroke icons over the three labels; the active tab is
  the one blue accent. Height (`--tabbar-h`, 54px + safe area) is unchanged so no view's layout
  moves.
- The command bar gets a visible focus ring (it had none).

## Cuts from the design

- The chance % on the call and on the buttons, the chance sparkline, the frame 02 chance chart
  and range toggle — no probability engine exists (L2; CLAUDE.md "Confidence percentages not
  computed from a model").
- "August's reads" (event contracts with Yes/No %) and the category chips (decision).
- "· small" — nothing sizes a call.
- "settles 16:00 ET" — the engine grades the NQ=F daily close against the prior close on the
  `SETTLE_UTC_LABEL` pass; the copy stays bound to that label.
- "vs 29,449" on an open call — the call store holds no reference until settlement.
- The avatar and account menu (decision 7), the fourth Ideas tab (three tabs), the frame's
  14.5px input (iOS zooms any input under 16px on focus).
- The frame's "calculated · not advice" caption — it is neither a disclaimer nor a chip; the
  Disclaimer component stays rendered at rest (card line on THE CALL, blocks on the page).

## Laws vs the design — flagged

- **L2 / regime copy** — the frame's "2 of 3 inputs agree" is a fixed denominator; the model has
  1–5 voting inputs and no agreement on a dead-even sum. Rendered from `regime.agreement`.
  "Index trend · 5d" is 1mo in the model and is labelled so.
- **L2 / the WHY defect** — the old list showed three inputs and claimed the rest "vote the same
  read" without checking (Book bias was never disclosed). Every input now renders with its own
  vote.
- **L2 / SYSTEMS STEADY** — dropped (it asserted a health check nothing performs); the clock and
  THINKING stay.
- **L4 / the NQ tile** — kept as the instrument's ticker tile, the same identity tile the terminal's
  cards carry; it states no status.
- **AA** — the frame's mute #6b7280 is 4.4:1 on its own stage; everything uses #5d636f.

## Open — the owner's shortlist (no strike received yet)

Modules whose purpose could not be stated in one line, reskinned in place until struck:
the EARNINGS row (permanently DATA UNAVAILABLE), the orb, `/api/calendar`'s unrendered
reactions + FRED actuals, and the orphan heatmap comment (deleted — it named nothing).

## Found on the way (not fixed here)

- `readCallState` returns `ok:true` with a 0–0 record when its Upstash read throws — the card
  cannot tell a fabricated zero from a real one without a wire change.
- A take made from the command bar doesn't refresh THE CALL card (up to 60s of stale OPEN
  buttons); `call_full` / `rate_limited` rejections are silent on the card and read
  "UNREACHABLE" in the bar; single letters `h` / `l` take a side.
- ~~`lib/markets` serves the last cached quote when Yahoo errors, with no age~~ — FIXED in
  fix/quote-age (merged): every quote carries its own `asOf`, cache hits included, and
  lib/quote-book ages each price from that stamp (aligned to the server clock by the response's
  Date header) instead of from when the round was asked. A price of unknown age reads
  UNAVAILABLE.
- `/api/headlines` answers `200 []` when every feed fails, so a blackout reads "No headlines
  right now".
- `/api/ideas` swallows Redis errors into `[]` — "0 live calls" on an outage.
- /login's and /welcome's inputs are 13px (iOS focus zoom); /welcome's feed toggles decide
  nothing and cite retired features; /login promises "threads".
- The /welcome auto-redirect for non-onboarded users is an interrupt (L5).
- Presence3D's day room is still tuned to the retired warm paper (`#fffdf8` / `#a8a293` /
  bounce `226,218,198`).
- The quotes route never calls its declared rate limiter.

## Strikes and fixes after the first gate (the owner's call)

1. **The orb is deleted** — `components/Presence3D.tsx`, the `three` +
   `@types/three` dependencies, its CSS and the `.presence-3d` shell rules.
   `AugustState` moved to `lib/screens.ts` (the shell still tracks boot / idle /
   thinking; THINKING renders in the header). The regime card is now the first
   card under the day line.
2. **The calendar's unrendered computation is deleted** — the route no longer
   fetches NQ 5m bars or computes `reaction15m` / `reactionWhy`, and the FRED
   `actual` backfill is gone with `lib/calendar-actuals.ts`, its test, and the
   daily pass's warm step (the pass line no longer prints `actuals=`).
   **What still renders, and where:** `getCalendarWeek` → `/api/calendar` →
   `CountdownRow` (the NEXT card: title, ET stamp, countdown), which is the only
   calendar consumer in the app. Also deleted, and reported as a judgement call:
   the **calendar-ask seam** — `/api/chat`'s `calendarAsk` branch with its
   shared per-event answer cache, the canonical prompts and their key builder in
   `lib/calendar-feed`, and the client parameter that fed them. No rendered
   control has sent one since the density pass removed the ask buttons; it was a
   model-spend path reachable only by a hand-made POST.
3. **The EARNINGS row is deleted.** It was market-wide by design and had no
   provider at all (it rendered a hard-coded DATA UNAVAILABLE; "earnings"
   appears in no data path in the repo). Nothing in the app knows which symbols
   in the live book report when, so the book-scoped version the owner would
   keep cannot be built without a new source.
4. **A store read that throws never prints a record.** `readCallState` sets
   `readFailed`; the card then renders `YOU — · AUG —` with DATA UNAVAILABLE,
   says the call and the record can't be read, and carries the chip in its
   header. Pinned by a test with a kv whose `get` throws.
5. **A take from the command bar refreshes THE CALL card.** `runCallSide`
   dispatches `aug:call-taken` on success and the card re-reads, so it never
   sits on OPEN buttons it can no longer honour.

## Gate

Run on `d831e1f`. **No local run touched production data**: both builds (main `226262a` and the
branch) were served from scratch git worktrees with no `.env*` file and a scrubbed environment,
and every `/api/*` request in the browser was fulfilled from fixtures (an unmatched request is
failed at the interception layer, never sent). Fixtures were recorded once as anonymous GETs
against production (`/api/pit` GET was checked read-only first; no POST, and no admin, account,
push, chat, watchlist or feeds route was ever forwarded). The clock is frozen at the capture time
(2026-09-17 14:52:20Z, America/New_York), reduced motion on.

- **Suite** 389/389 (387 + the regime gauge test + the quote-book closes test; the quote-book
  tests moved with the code into `tests/quote-book.test.ts`, listed in `npm test`).
- **Type check** `npx tsc --noEmit` clean. **Production build** green.
- **Determinism**: main captured three times (a rerun, an 8s settle, a server restart): 0 changed
  pixels on all ten PNGs, no masks — the orb included.
- **Terminal, unchanged**: 390 and 1280, main vs branch — **0 changed pixels** outside the shared
  chrome decision 3 moved (the phone tab bar; the desktop rail and the view bar with its 2px
  shadow). Unmasked at 390 the entire change is the tab bar's own 390×54 box (21,060 px).
- **PIT, unchanged inside the arena**: the same result — 0 changed pixels outside the tab bar
  (390) and the rail + view bar (1280).
- **/login** at 390, before/after: the warm paper → the cool paper (the unconfigured-instance
  branch is the only one a keyless local run can render).
- **/welcome**: code review only (it server-redirects when auth is unconfigured).
- **Front page** 390 (top + every card by scroll) and 1280, from production data, plus STAGED
  states through interception, labelled as staged in the evidence page: every source failing
  (UNAVAILABLE on each card), THE CALL open (Higher / Lower), THE CALL settled (a stored
  close / prev close), WHY open (all four inputs, Book bias included), and signed in (the phone
  Account card with Delete account; the desktop header with the ADMIN chip and the delete
  confirmation).
- The branch front page fixes main's 1280 header collision (the clock ran under the view bar).

## fix/quote-age — gate (merged `83171fd`, 2026-09-18)

Branch `fix/quote-age` off main at `7e276bd`. Code `4de75b1`, docs `666432e`, merge `83171fd`.

- **Suite** 386/386 (8 in `tests/quote-book.test.ts`, four of them new: a cached-but-old price,
  a re-ask with no newer stamp, a price of unknown age, and `alignAsOf` skew both ways plus a
  near-future stamp). **Type check** `npx tsc --noEmit` clean. **Production build** green.
- **Pixel gate** — the same keyless-worktree + fixture-replay rig as the v4-2 gate, with one
  trick: the recorded fixtures predate `asOf`, so each quote was stamped with its own fixture's
  `fetchedAt` for the fresh-price comparison. Front page 390 (top + three scrolls) and terminal
  390 + 1280, base `7e276bd` vs branch `4de75b1`: **0 changed pixels on all six pairs**.
- **Negative check** — replaying the UNSTAMPED fixtures (a price of unknown age) turns every
  price off: the terminal cards read "last — DATA UNAVAILABLE" and the front page's Pulse rows
  and WATCHING pills read UNAVAILABLE. Nothing infers freshness from arrival any more.
- **Production, after the deploy went success**: repeated GETs of
  `/api/intel/quotes?symbols=SPY` return the SAME `asOf` while the response `Date` header
  advances — a cache hit is visibly older than its response, which is the whole point.

## fix/failure-visibility — L11 (branch off main `00be3b5`)

The transcript ingest broke on 2026-09-17 and the /admin console could not say
why. The cause was never in this repo: `ANTHROPIC_API_KEY` is an
organization-level key and the Anthropic API now rejects unscoped keys that
don't send `anthropic-workspace-id`, so EVERY model call — extraction, the ask
lane, THE CALL's thesis, memory, intel — 400s before the model or the token cap
is looked at. What this branch fixes is the second failure: that a person could
not see any of it.

- **DESIGN_LAWS L11 — FAILURE IS A STATE, NOT AN ABSENCE** (the owner's wording,
  verbatim), added at the END as the next free number. It briefly shipped as
  L9, which displaced MOTION WITH RESTRAINT to L11; that was wrong and is
  reverted — a law's number is a reference other notes and decisions already
  hold, so an existing law never moves to make room. MOTION keeps **L9**, L10
  is unchanged, and the failure law is **L11**.
- **THE CALL's thesis is a three-state read.** `anthropicThesis` throws instead
  of reporting a dead key as "no line"; `getThesis` returns
  `ok` / `unavailable(reason)` / `none` and STORES the failure against the
  regime fingerprint with a 5-minute expiry, so every view inside the no-spend
  window reads UNAVAILABLE rather than the first viewer getting a warn log and
  the rest a blank card. `none` stays reserved for the two things that are not
  failures: no regime to read from, and a generation already in flight. The card
  renders the failed state with its chip; the call itself is untouched, because
  the direction is derived from the regime model, not written by a model.
- **The transcript route returns the cause** (`extractionFailure`, shared by
  POST and the new PATCH). `code` stays stable for branching.
- **`.adm-trmeta` no longer clips the reason.** It was `nowrap` +
  `text-overflow: ellipsis`, and the cause was appended to the END of that line:
  rendered, then thrown away. It now has its own wrapping line (`.adm-trerr`).
- **RE-RUN EXTRACTION** (`PATCH /api/admin/transcripts`) re-reads the raw text
  already in the store — no second Supadata fetch, no second row, failed rows
  only (re-running a processed row would mint duplicate drafts). Repeated
  attempts at one video collapse under the newest with their history
  (`markRepeats`, pure, in its own module so the client console never imports
  the server module).
- **/api/chat** names the grounding it answered WITHOUT (`x-aug-degraded` →
  a line under the answer), stops filing a failed enqueue as a consumer cancel
  (which had suppressed the error branch and froze the card mid-sentence), makes
  the dead-stream sentinel a shared constant the card renders as an error
  instead of prose, turns an empty stream into an error instead of a vanished
  card, and logs the cache read/write and no-store paths it used to swallow.
- **lib/memory** reports every write. The wipe is the one that mattered:
  `clearMemory` returned void, so `/forget` printed "MEMORY CLEARED." whether or
  not anything was deleted. It also no longer overwrites a profile it failed to
  read (that path could erase everything the desk knew and report success).
- **lib/intel** names the feeds that didn't answer, stops asserting "Wires are
  live." over zero articles, returns `synthesis: null` + a reason instead of a
  cheerful placeholder, and ages a served-stale round from its real fetch time.

**Gate:** suite 394/394 (5 new: the extraction cause, the degraded note, the
repeat rule, and the thesis states including the stored-failure regression).
`npx tsc --noEmit` clean. Production build green. Screenshots at 390 from a
KEYLESS worktree with every `/api/*` answered from a fixture and unmatched ones
FAILED, never sent: THE CALL with `thesisFailed` (CURRENT READ · DATA
UNAVAILABLE, the call and record intact) and an /admin row carrying the real 400.
The same /admin fixture shot against a main build is the before: `FAILED NQ
ope… ▸` with the cause gone entirely. /admin's cramped 390 layout is unchanged
from main — pre-existing, not this branch.

## fix/route-failure-honesty — L11 on the wire (branch off main `be00ea1`)

Four public list routes answered `{ ok: true, <rows>: [] }` whether the source was
empty or unreachable. A Redis outage therefore reached the front page as
"0 live calls" and the terminal as "the desk has published nothing" — claims
about the desk's own record, made while blind. The consumers already HAD the
UNAVAILABLE states; the wire just never gave them anything to fire on.

**One vocabulary — `lib/wire.ts`.** Three answers, never two: `ok` (zero rows is
a real answer), `partial` (rows served AND the dead sources named in
`degraded`), `unavailable` (503 + `{ ok: false, error }`). `readWire` reads the
same three on the consumer side, so a 200 whose body says `ok:false` lands
exactly where a dead socket does.

**The four sites.** `lib/headlines`, `lib/ideas`, `lib/tape` and
`lib/transcripts` each gained a `read*` returning `WireRead` with the existing
`list*` re-expressed on top, so `lib/ideas-eval`, `lib/call` and
`lib/desk-snapshot` are untouched. Blob reads are settled per row: one
unreadable row is counted and named, not allowed to blind a whole store.

**What a public wire may say.** The fact, never the store's words. These routes
are unauthenticated and republished, and the driver's message carries our key
namespace and the literal command, so `storeDown()` logs the cause for the
operator and publishes "the desk's store didn't answer" — the same split
/admin already makes in the other direction. A 200 that isn't a feed at all
(a consent wall, a challenge page) is a failed feed, not an empty one.

**The consumers.** `HomeBrief` and `IdeasFeed` render their existing states from
the route's answer, and no longer gate them on "never answered once" — a
surface that polls spends most of an outage holding a stale successful read.
`listSurfaceState` is the one decision, unit-tested: EMPTY claims the desk
published nothing, and only the LATEST read may say it. The desk wire names
which of its two stores is missing instead of merging an empty list into a
clean one.

**Also fixed, because it spends money:** the transcript duplicate guard read the
ingest log through the flattening `listTranscripts`, so an outage read as
"never ingested" and the route bought a transcript the desk already owned. It
now refuses with the reason and leaves FORCE to the owner.

**Gate:** 426/426 (a new `tests/wire.test.ts` plus per-domain route tests), tsc
clean, build green. 390 screenshots from a keyless worktree with every `/api/*`
answered from a fixture and unmatched ones failed, never sent:
- outage → DESK and WHAT'S BEING SAID both DATA UNAVAILABLE with their copy;
  prices still render, because the quote provider was healthy and only the
  store was down.
- outage → the terminal reads BOOK UNREACHABLE with "— live" and "—" tiles,
  where it used to read NO IDEAS ON THE BOARD with `0 live` and `0 L · 0 S`.
- partial → the surviving Reuters headline renders WITH its DELAYED chip, an
  UNAVAILABLE chip beside it, and the rendered line "BBC and AP didn't answer
  — this list is missing what they carry."

**Found on the way, not fixed here:** /api/admin/ideas and /api/admin/tape still
read through the flattening `list*`, so the OWNER's queue shows an empty board
during an outage — the operator surface is the one place that matters most, and
it is a separate branch. The front page renders the shared disclaimer TWICE
(HomeBrief and HomeLanding each mount one); it predates this branch.
