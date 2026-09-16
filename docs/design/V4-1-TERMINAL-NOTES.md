# feat/v4-1-terminal — branch notes

Source of truth: `docs/design/August Mobile v4 Markets.dc.html` (frames 03 TERMINAL and
04 IDEA only; frames 01/02/05/06 are out of scope). Imported from the Claude Design
project "August mobile app design" (`ios-frame.jsx` is the device bezel, `support.js`
the design runtime — neither is ported). Base: main after chore/terminal-cut.

Everything binds to the routes the terminal already reads:

| Value | Source |
| --- | --- |
| the book (cards, question, status, stats, filters, levels, last pass) | `GET /api/ideas` → `PublicIdea[]` (lib/ideas `listLiveIdeas`) |
| last price ("last", % of the way) | `GET /api/intel/quotes` — DELAYED (Yahoo, 60s server cache), chunked at the route's 20-symbol cap |
| 1M daily chart on the idea page | `GET /api/intel/bars?symbol=` — the payload now states `freshness: "delayed"` |

Every derived value is a pure function in `lib/idea-card.ts` (tests: `tests/idea-card.test.ts`).

## What maps to real data

- **Card question** — deterministic template, three tiers, no model:
  1. numeric TARGET + STOP → `{T} reaches {target} before {stop}?` (long) /
     `{T} drops under {target} before {stop}?` (short). The level ordering decides the
     shape; a stated side that contradicts it (a short whose target is above its stop)
     is a conflicted row and gets no odds question.
  2. else the daily pass's PARSED TRIGGER (`evaluation.level` + `dir`, the number the
     status chip is judged against) → `{T} breaks above {level}?` / `{T} drops under
     {level}?`. Not asked for QUOTE SUSPECT rows (the pass refused to grade that level)
     and not asked when the trigger points against the row's stated or derived side
     (AGI: entry "current levels; stop consideration under $34.80" parses as a BELOW
     trigger on a long idea — the parser reads the stop clause as the entry; the chip
     and the LEVELS card still state what the pass read, the headline does not publish
     it as the call). This tier is an extension of the brief: the brief named tiers 1
     and 3 only, and with the live book as it stands tier 1 never fires (see below).
  3. else `{T}` + a verbatim thesis excerpt (first sentence of ≥24 chars / ≤110 chars).
- **Parsed marks** — a number printed from a zone, ladder or condition ("$37–$40",
  "765, then 762") wears `~` on cards, chart labels and the meta line; the verbatim
  text is in the LEVELS card. The chart's ENTRY line is the pass's parsed trigger when
  one exists, else the entry text's first price-like numeral (unit-qualified and
  year-like numerals skipped, the pass's own guards). A level more than 3× off the
  month's closes (LITE's 8.40 against an ~880 tape) is left off the chart rather than
  flattening it.
- **Last price** — DELAYED after a fresh quotes round; STALE with its as-of time once
  the route has missed three rounds (nothing is computed from a stale price); DATA
  UNAVAILABLE when the route never returns the symbol; a loading skeleton while the
  first round is out. All dates stamp in ET, the same calendar "Triggered today" counts
  in.
- **Verdict card** — the store's one evaluation record, dated "concluded {date}" (the
  record is rewritten only when the conclusion changes; a sticky TRIGGERED keeps its
  crossing date), never "last pass".
- **% of the way** — `(last − stop) / (target − stop)`, clamped 0–100, CALCULATED chip.
  Absent when target, stop or last is missing; the label names what is missing
  ("no stop", "no target", "no level", "no last price"), never "0%". Bar: green ≥ 50,
  red < 50, no fill when absent.
- **Status chip** — 1:1 with INTEGRITY-1: LIVE (ARMED or not yet evaluated) ·
  TRIGGERED · NEEDS LEVEL · QUOTE SUSPECT · STALE. REVIEW rows are never served by
  `/api/ideas`, so a REVIEW chip cannot render from this route.
- **Header** — `{n} live` (statline), `Triggered today` (sticky TRIGGERED whose pass
  date is today in ET), `Book bias {L} L · {S} S` (stated + derived sides; a
  "{u} without a side" sub-line when any), `Next eval {SETTLE_UTC_LABEL}` (derived from
  vercel.json's cron, "22:10 UTC" today).
- **Filters** — All / Triggered / Live / Needs level, with counts. QUOTE SUSPECT sits
  under Needs level (the pass asks for the level to be restated). STALE is under All only.
- **Idea page chart** — last 31 days of daily bars, close line, dashed ENTRY / TARGET /
  STOP levels (stated ones only; levels extend the range so a far target still draws),
  DELAYED chip from the payload. No bars → UNAVAILABLE state, never a placeholder line.
- **Last pass** — the one evaluation record the store keeps (state, reason, pass price,
  timestamp), verbatim.
- **Ticker tile colour** — encodes STATUS (same tone as the chip), not a per-ticker
  palette (L4: colour must mean something).

## The live book as it stands (2026-09-16)

33 live rows. **0 carry a stop, 6 carry a target, 20 carry a parsed trigger.** So on
production today every card's % reads "—" with "no stop" / "no level", and 20 cards ask
the trigger question. The odds question and the percentage light up the moment a row
carries a numeric target + stop (stated in /admin). Nothing on this branch fakes that.

Sticky TRIGGERED rows freeze `evaluation.price` at their crossing pass (IBIT's is from
Aug 27), which is why "last" comes from the quotes route and not from the pass — the
pass price renders under LAST PASS with its date instead.

## Cuts from the design

- **Arm this idea** — no backend. Removed. The pattern (a primary ink button that
  writes a user's stance on a desk idea to a per-principal record, claim-ready per
  L10) is parked here, not deleted (L7).
- **Ask** — the command bar has no prefill seam (HomeLanding owns its draft; out of
  scope). Removed. If a seam is ever wanted: an `aug:prefill` event + `switchView("chat")`
  would route it; not built here.
- **Activity** — the store keeps one evaluation record, not transitions. Section omitted;
  LAST PASS renders what exists.
- **Ideas tab** — the shell's bottom bar already has three tabs (AUGUST · TERMINAL ·
  PIT, app/page.tsx); untouched.
- **Per-ticker avatar colours** — replaced by status tints (see above).
- **Phone module strip (M2)** — frame 03 has no CHART/BOOK/LEVELS/PULSE/TAPE/WIRE
  segments; phones now render the design (filters · tiles · cards · idea page). The
  modules remain the desktop dock's furniture, unchanged. The M2 phone tree itself
  (MobileCard, MobileIdeaSheet, the segment strip), the blotter rows and the bottom
  sheet, with their CSS, are DELETED in this commit — the same treatment the terminal
  cut gave the owner desk. The rebuild point is this branch's parent commit on main
  (`d51a0f5`); history is the park (L7).
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
- **L8** — filter pills are 44px tall (design: 34px) for thumb reach; the idea page
  pushes a history entry so the OS/browser back gesture closes it instead of leaving
  the terminal; it takes focus on open and hands it back on close.
- **L1 — TRIGGERED reads green on every side.** The status tint says the call fired
  (the desk's record), not the price direction; a short that triggered downward keeps
  its red "Short" word beside the green tile. Same mapping as the design's status
  colours.
- **The selection ring** — desktop only (it means "charted in the dock / shown in the
  detail"); a phone's auto-selection selects nothing visible, so no ring there.
- **L1** — the terminal stage is paper under the light theme only (the app's default);
  dark / batman / matrix keep the dark ramps. The PIT stays dark on every theme.
- **Fonts** — Geist + JetBrains Mono were already loaded by app/layout.tsx; the dock
  modules keep IBM Plex Mono + Hanken Grotesk (unchanged).

## Found on the way (not fixed here)

- `BookHeatmapModule` asks `/api/intel/quotes` for every live symbol in ONE call; the
  route slices at 20, so with 33 live rows 13 tiles silently show ∅. The card list
  chunks; the heatmap is a dock module and was left as is.
- `lib/ideas.ts parseEntryTrigger`: `STOP_BEFORE_RE` only guards a stop word directly
  before the direction word, so AGI's "current levels; stop consideration under $34.80"
  parses as a BELOW 34.80 entry trigger on a long idea — a stop-out would mark it
  sticky TRIGGERED. INTEGRITY-1's parser and its evaluations are out of this branch's
  scope; the terminal now refuses to headline that trigger (see the conflict rule).
- `/api/intel/bars` is rate-limited at 30/min per IP; a burst of chart opens (or a
  screenshot probe) turns the dock chart's "no chart data" on — the honest state for
  a 429, but easy to misread as a missing symbol.
