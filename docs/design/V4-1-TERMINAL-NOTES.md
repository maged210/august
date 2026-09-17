# feat/v4-1-terminal — branch notes

Source of truth: `docs/design/August Mobile v4 Markets.dc.html` (frames 03 TERMINAL and
04 IDEA only; frames 01/02/05/06 are out of scope). Imported from the Claude Design
project "August mobile app design" (`ios-frame.jsx` is the device bezel, `support.js`
the design runtime — neither is ported). Base: main after chore/terminal-cut.

Everything binds to the routes the terminal already reads:

| Value | Source |
| --- | --- |
| the book (cards, question, status, stats, filters, levels, verdict) | `GET /api/ideas` → `PublicIdea[]` (lib/ideas `listLiveIdeas`) |
| last price ("last", % of the way, the dock heatmap's colours) | `GET /api/intel/quotes` — DELAYED (Yahoo, 60s server cache), chunked at the route's 20-symbol cap, read through ONE per-symbol freshness policy |
| 1M daily chart on the idea page | `GET /api/intel/bars?symbol=` — the payload now states `freshness: "delayed"` |

Every derived value is a pure function in `lib/idea-card.ts` (tests: `tests/idea-card.test.ts`).

## What maps to real data

- **Card question** — deterministic template, three tiers, no model:
  1. numeric TARGET + STOP → `{T} reaches {target} before {stop}?` (long) /
     `{T} drops under {target} before {stop}?` (short). The level ordering decides the
     shape; a stated side that contradicts it (a short whose target is above its stop)
     is a conflicted row and gets no odds question.
  2. else, **for a row that has not triggered**, the daily pass's PARSED TRIGGER
     (`evaluation.level` + `dir`) → `{T} breaks above {level}?` / `{T} drops under
     {level}?`. A TRIGGERED row never asks it — a fired trigger is an answered question,
     and the row reads its state instead (tier 1 when target and stop both exist, else
     tier 3). Also not asked for QUOTE SUSPECT rows (the pass refused to grade that
     level) and not asked when the trigger points against the row's stated or derived
     side (AGI: entry "current levels; stop consideration under $34.80" parses as a
     BELOW trigger on a long idea — the parser reads the stop clause as the entry; the
     chip and the LEVELS card still state what the pass read, the headline does not
     publish it as the call). This tier is an extension of the brief: the brief named
     tiers 1 and 3 only, and with the live book as it stands tier 1 never fires.
  3. else `{T}` + a verbatim thesis excerpt (first sentence of ≥24 chars / ≤110 chars).
- **Parsed marks** — a number printed from a zone, ladder or condition ("$37–$40",
  "765, then 762") wears `~` on cards and chart labels. The chart's ENTRY line is the
  pass's parsed trigger when one exists, else the entry text's first price-like numeral
  (unit-qualified and year-like numerals skipped, the pass's own guards). A level more
  than 3× off the month's closes (LITE's 8.40 against an ~880 tape) is left off the
  chart rather than flattening it.
- **Last price — one policy, every surface.** The feed fetches quotes in ≤20-symbol
  batches and merges each round into ONE quote book (`mergeQuoteRound`). Each symbol
  carries its own last-seen time and the time its batch was last asked. `readQuote`
  calls a symbol fresh only when the latest attempt that included it answered with a
  price, within three poll intervals. Otherwise it is DATA UNAVAILABLE, and the price
  from the older round is dropped, never shown as DELAYED. The cards and the dock
  heatmap read the same book through the same reader, so a failed batch is
  UNAVAILABLE in both places. The heatmap no longer fetches on its own; its old
  single call lost every symbol past twenty, silently. A symbol not asked yet shows a
  loading skeleton on a card and a neutral dot on a tile. A tab that comes back
  re-asks at once. All dates stamp in ET, the same calendar "Triggered today" counts in.
- **% of the way** — `(last − stop) / (target − stop)`, clamped 0–100, CALCULATED chip.
  Absent when target, stop or a fresh last is missing; the label names what is missing
  ("no stop", "no target", "no target or stop", "no last price"), never "0%". Bar:
  green ≥ 50, red < 50, no track when absent.
- **Status chip** — 1:1 with INTEGRITY-1: LIVE (ARMED or not yet evaluated) ·
  TRIGGERED · NEEDS LEVEL · QUOTE SUSPECT · STALE. REVIEW rows are never served by
  `/api/ideas`, so a REVIEW chip cannot render from this route.
- **TRIGGERED tint follows the stated side.** Green when the crossing favored it (a
  long crossing above, a short crossing below), red when it went against it, a neutral
  ink tint when no long/short side was stated (a derived side is an inference and does
  not grade the move). The crossing always renders in words beside the tint —
  "Triggered below 768.00", "Triggered below 34.80 · against the long" — on the card's
  meta line and in the status pill, so colour never carries the meaning alone. Today
  SPY, NOW and UBER are shorts that crossed below: green, with the words.
- **Header** — `{n} live` (statline), `Triggered today` (sticky TRIGGERED whose pass
  date is today in ET), `Book bias {L} L · {S} S` (stated + derived sides; the sub-line
  says "incl. ~{d} derived" and names watch / unsided rows when any), `Next eval
  {SETTLE_UTC_LABEL}` (derived from vercel.json's cron, "22:10 UTC" today). Under the
  tiles, while any derived side is on the board, one legend line explains the tilde in
  the idea page's own words: "~ derived from entry vs target".
- **Filters** — All / Triggered / Live / Needs level, with counts. QUOTE SUSPECT sits
  under Needs level (the pass asks for the level to be restated). STALE is under All only.
- **Idea page chart** — last 31 days of daily bars, close line, dashed ENTRY / TARGET /
  STOP levels (stated ones only; on-scale levels extend the range so a far target still
  draws), win / loss zones in the trade's direction, DELAYED chip from the payload. No
  bars → UNAVAILABLE state, never a placeholder line.
- **Idea page, said once each** — the entry shows once, verbatim, in the meta line; the
  status shows once, in the top pill (the desktop detail panel's header pill).
- **Ticker tile colour** — encodes STATUS (same tone as the chip), not a per-ticker
  palette (L4: colour must mean something).

## Additions to frame 04

Frame 04 has a chart card, a thesis card and an activity list. The branch adds two
cards the design does not have, both carrying only what is on the wire:

- **Levels** — the pass's parsed trigger ("below 34.80 · parsed from the entry by the
  daily pass"), the stated target and the stated stop, verbatim; "not stated" when
  absent. It does not repeat the entry text, which lives in the meta line. It exists
  because the design's single "entry 37.35" hides what the book actually holds: zones,
  ladders, conditions, and levels the pass parsed out of free text.
- **Verdict** — the store's one evaluation record: its reason, its pass price, and the
  time the pass concluded it ("concluded SEP 15 · 16h ago"). The record is rewritten
  only when the conclusion changes, and a sticky TRIGGERED keeps its crossing date, so
  it is never labelled "last pass". It does not repeat the status, which lives in the
  top pill. It stands where the design's ACTIVITY list stood, because the store keeps
  no transitions to list.

## The live book as it stands (2026-09-16)

33 live rows. **0 carry a stop, 6 carry a target, 20 carry a parsed trigger.** So on
production today every card's % reads "—" with "no stop" / "no target or stop". The
trigger question is asked only by rows that have not triggered; the 13 triggered rows
read the ticker + excerpt. The odds question and the percentage light up the moment a
row carries a numeric target + stop (stated in /admin). Nothing on this branch fakes
that.

Sticky TRIGGERED rows freeze `evaluation.price` at their crossing pass (IBIT's is from
Aug 27), which is why "last" comes from the quotes route and not from the pass — the
pass price renders under VERDICT with its date instead.

## Cuts from the design

- **Arm this idea** — no backend. Removed. The pattern (a primary ink button that
  writes a user's stance on a desk idea to a per-principal record, claim-ready per
  L10) is parked here, not deleted (L7).
- **Ask** — the command bar has no prefill seam (HomeLanding owns its draft; out of
  scope). Removed. If a seam is ever wanted: an `aug:prefill` event + `switchView("chat")`
  would route it; not built here.
- **Activity** — the store keeps one evaluation record, not transitions. Section omitted;
  VERDICT renders what exists.
- **Ideas tab** — the shell's bottom bar already has three tabs (AUGUST · TERMINAL ·
  PIT, app/page.tsx); untouched.
- **Per-ticker avatar colours** — replaced by status tints (see above).
- **Phone module strip (M2)** — frame 03 has no CHART/BOOK/LEVELS/PULSE/TAPE/WIRE
  segments; phones now render the design (filters · tiles · cards · idea page). The
  modules remain the desktop dock's furniture. The M2 phone tree itself (MobileCard,
  MobileIdeaSheet, the segment strip), the blotter rows and the bottom sheet, with
  their CSS, are DELETED on this branch — the same treatment the terminal cut gave the
  owner desk. The rebuild point is the annotated tag **`archive/phone-m2`** on origin
  (= main `d51a0f5`, this branch's parent). Rebuild from the tag, never from main (L7).
- **The header clock** — dropped with the design's title row; it decided nothing on
  the terminal (L4). The statline is the live count only.
- **The tablet DOCK toggle** — removed: 701–1179px stacks the dock above the cards and
  never hid it, so the toggle toggled nothing (a HEAD-era contradiction, not a
  regression).

## Laws vs the design — flagged

- **L2 / disclaimer rule** — the design's single "calculated · not advice" line is not
  a disclaimer and not a provenance chip. Every card carries DELAYED / DATA UNAVAILABLE
  on its last price and CALCULATED on a computed %; the idea page carries the
  Disclaimer component inline (it is a surface that publishes a call on its own; the
  old sheet did not carry one — fixed).
- **L8** — filter pills are 44px tall (design: 34px) for thumb reach. The idea page is
  a modal dialog: it takes focus on open, traps Tab and Shift+Tab inside itself, makes
  everything behind it inert (the feed's own Terms / Privacy links included), and hands
  focus back on close.
- **L8 — history.** Opening the idea page pushes one history entry that alone carries
  `?idea=`, so the OS/browser back gesture closes the page and lands on a clean list.
  Switching tabs while the page is open replaces that entry and drops the parameter
  (`app/page.tsx` switchView honours the `v4idea` marker — the one shell change on this
  branch), so back never lands on a closed page and a reload never reopens it. Forward
  onto a page entry reopens its page.
- **L1 — TRIGGERED tint follows the stated side** (see above), with the crossing in
  words beside it.
- **AA on paper** — the design's mute grey (#6b7280) is 4.4:1 on its own paper stage.
  The terminal uses one mute token, `--rd-t-dim` = #5d636f (5.6:1 on the stage, 6.1:1 on
  white, 4.6:1 on the Stale pill's tint), and every copy-carrying grey token points at
  it: absence text, the live count, the meta line, module subtitles, the chip text.
- **The selection ring** — desktop only (it means "charted in the dock / shown in the
  detail"); a phone's auto-selection selects nothing visible, so no ring there.
- **L1** — the terminal stage is paper under the light theme only (the app's default);
  dark / batman / matrix keep the dark ramps. The PIT stays dark on every theme.
- **Fonts** — Geist + JetBrains Mono were already loaded by app/layout.tsx; the dock
  modules keep IBM Plex Mono + Hanken Grotesk (unchanged).

## Found on the way (not fixed here)

- `lib/ideas.ts parseEntryTrigger`: `STOP_BEFORE_RE` only guards a stop word directly
  before the direction word, so AGI's "current levels; stop consideration under $34.80"
  parses as a BELOW 34.80 entry trigger on a long idea — a stop-out would mark it
  sticky TRIGGERED. INTEGRITY-1's parser and its evaluations are out of this branch's
  scope; the terminal refuses to headline that trigger (see the conflict rule).
  **Fixed in feat/v4-1b-integrity** (docs/design/V4-1B-INTEGRITY-NOTES.md): the pass reads
  stop language as a stop, refuses crossings against the stated side, and withdraws AGI's
  SEP 16 TRIGGERED; the terminal's question guard is retired with it.
- `/api/intel/bars` is rate-limited at 30/min per IP; a burst of chart opens (or a
  screenshot probe) turns the dock chart's "no chart data" on — the honest state for
  a 429, but easy to misread as a missing symbol.
- The feed's stateful behaviour (the quote book's rounds, the history contract, the
  focus trap) has no automated test: the repo has no component test harness, and
  adding one is its own decision. The pure policies underneath are tested.
