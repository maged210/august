# feat/v4-1b-integrity — branch notes

Base: main at `2d274cf` (feat/v4-1-terminal merged). Three fixes, no new statuses, no new
fields, no schema change. Tests are unit tests in the existing suite (`tests/ideas.test.ts`,
`tests/idea-card.test.ts`); there is still no component test harness — that decision is open.

## 1 · The pass parser: stop language never arms a trigger

`lib/ideas.ts readEntry(entry, side?)` is the pass's whole read of an entry string:
`{ trigger, stop, rejected }`. `parseEntryTrigger(entry, side?)` is its `trigger`.

- **Stop / invalidation language populates `stop`, never `trigger`.** A stop word
  (`stop`, `stops`, `stopped`, `stop-loss`, `invalidat…`, `invalid`, `cut it`, `cut losses`,
  `cut the position`) claims the FIRST price-like number after it in its own clause, however
  many words sit between — "stop consideration under $34.80", "invalidated if it closes below
  $30", "cut it at 182". A crossing NAMED the stop after it counts too ("under 34.80 is the
  stop", "below $30 invalidates the setup"), and the INTEGRITY-1 adjacency words stay
  (`risk below`, `exit under`). A clause ends at `;` `)` a newline, `, ` a spaced dash, or a
  sentence period — never the `.` in `$34.80` or the `,` in `$1,117.50`. "no stop", "without a
  stop", "non-stop" and "cuts through" are not stop language. A stop word claims only its own
  level: in "break above 50 stop below 45" the entry is 50.
- **A crossing that points against the STATED side is a parse failure.** A long whose crossing
  is below, a short whose crossing is above: `trigger` is null and `rejected` names what was
  refused. A watch row, or a row with no stated side, has nothing to contradict.
- **The entry language excludes stop clauses** (`entryLanguage`). The side suggestion and the
  two-sided keyword rule read it, so "long above 9,450; stop below 9,400" is no longer read as
  two-sided (INTEGRITY-1 would have demoted that clean long to REVIEW).
- **The pass keeps a refused row live as NEEDS LEVEL** (`bookPassConflict`). Two-sided entries
  and side-contradicting entry LANGUAGE still demote to REVIEW. The extractor's side-blind
  `entryConflict` is unchanged, so a contradicting DRAFT still goes to REVIEW before it is ever
  published.
- **The pass records why.** A NEEDS_LEVEL evaluation's reason names the cause:
  - `no crossable entry trigger: below 34.8 is stop language, and a stop never arms an entry trigger`
  - `trigger below 95.3 points against the stated long — a parse failure, not evaluated (restate the level in the inbox)`
  - `no crossable trigger stated in the entry` (unchanged, when nothing is crossable at all)

  The pass's write check now compares direction and reason as well as state, level and price,
  so a new cause is always written.
- **Sticky TRIGGERED stands only while the entry still states that trigger.** A fired call is
  performance history, but AGI's was never an entry crossing: its stop, read as a below-34.80
  entry, fired on the stop-out (SEP 16). When the side-aware read of the UNCHANGED entry no
  longer yields the fired `{dir, level}`, the verdict is withdrawn and the row re-evaluates.
  The reason carries `· withdrawn: the TRIGGERED below 34.8 of 2026-09-16 judged a trigger the
  entry does not state`, and the note is carried forward while the row stays NEEDS_LEVEL, so a
  published-then-withdrawn call does not vanish from the record the next night. A human
  restatement already clears the evaluation (updateIdea), so only a parser correction can
  release a sticky verdict.
- **Everything that reads an entry reads it this way.** The inbox's NEEDS LEVEL membership and
  its quote-suspect detection parse side-aware; SET LEVEL round-trips side-aware and refuses a
  direction the pass would refuse ("below points against the stated long — the pass would
  refuse it; not saved"). The chart's ENTRY line fallback and the derived side read the entry
  language, so a stop's number is never drawn as the entry or used to derive a side.

### The live book, re-run (2026-09-17, read-only)

Main's pass logic and the branch's, run over the 33 live rows with each row's stored pass
price as the quote (so only parser-driven changes show):

| Row | Stored | Main tonight | Branch |
| --- | --- | --- | --- |
| AGI `idea_c8e5041f` — "current levels; stop consideration under $34.80", no stated side | TRIGGERED below 34.8 (SEP 16) | TRIGGERED below 34.8 | **NEEDS_LEVEL** — stop language; the SEP 16 TRIGGERED withdrawn |

The other 32 rows conclude identically. No row moves to or from REVIEW. The one review row
(WMT, two-sided) is untouched — the pass does not evaluate review rows, and its entry is still
two-sided.

Nothing was written. The store is shared by preview and production, and main's 22:10 UTC
pass would re-read AGI with the old parser and re-fire it with a new date. The branch's pass
applies the change on its first run after merge.

AGI also loses its derived "Long ~": the only numeral in its entry is the stop, so there is no
entry-vs-target read left. The Book bias tile reads 25 L · 7 S, 1 without a side.

## 2 · The headline metric — one resolver

`lib/idea-card.ts headlineOf(idea, last)` is the big number on the card, on the phone idea
page, and in the desktop IDEA DETAIL. `triggerOf(idea)` is the trigger every surface reads:
the pass's parsed level for a row it graded that has NOT triggered (ARMED or STALE).

| Row | Big number | Words | Chip |
| --- | --- | --- | --- |
| not triggered, parsed trigger, fresh last | `7.7%` | `to trigger` | CALCULATED — `abs(trigger − last) ÷ last` |
| not triggered, last already past the trigger (≥ above / ≤ below, the pass's own test) | `—` | `beyond trigger · awaiting pass` | none |
| TRIGGERED, stated target + stop, fresh last | `43%` | `to target` | CALCULATED — `(last − stop) / (target − stop)` |
| TRIGGERED, missing target or stop | `—` | `no target or stop` / `no target` / `no stop` / `target = stop` | none |
| any row with a level but no fresh last | `—` | `no last price` | none |
| NEEDS LEVEL | `—` | `no trigger` | none |
| QUOTE SUSPECT | `—` | `level not graded` | none |
| not yet evaluated | `—` | `not yet evaluated` | none |

- The distance is the move from last to the trigger, at one decimal, and it reads "to
  trigger": the same kind of figure as the idea page's "to target", a share of price to
  travel, because both appear on the same card. (The first cut said "below trigger" /
  "above trigger"; renamed on review, math unchanged.) The direction stays where it was
  built, beside the figure: the card's question ("SEDG breaks above 37.35?") and the idea
  page's "to trigger · trigger above 37.35". It is not good or bad, so it renders in ink,
  with no bar.
- A stated target + stop no longer turns an untriggered row into % of the way. That number is
  only for rows the pass has fired.
- **Filters, tiles, question, idea page — one record.** The question's trigger tier asks
  exactly `triggerOf`. A row the pass refused a trigger for is NEEDS LEVEL in the filter and
  "no trigger" on its card. A "beyond trigger · awaiting pass" row stays in LIVE (or STALE) and
  never counts as Triggered or Triggered today, because only the pass fires a trigger. A test
  walks a matrix of rows through headline, bucket, question and tiles together.
- **Retired:** the v4-1 question guard that refused a trigger pointing against a stated OR
  DERIVED side. It was the terminal covering for the AGI parse. The pass now refuses stop
  language and stated-side crossings at the source, so a trigger on the wire is the pass's, and
  a derived side (an inference) no longer vetoes it. Today no ARMED or STALE row has a
  derived-side conflict.

## 3 · The BOOK grid — chunked, per-symbol, and ordered

The dock heatmap has read the feed's one chunked quote book since v4-1 (d10038a). This branch
closes the ordering hole that was left:

- **Each batch merges as it lands, stamped with its round's ASK time.** Before, a round waited
  for every batch (`Promise.allSettled`), so one slow batch held the whole book, cards and
  tiles alike, at "loading".
- **An older round landing late is dropped per symbol** (`mergeQuoteRound`: a slot a newer
  round already asked is never overwritten). Before, a slow round could land after a newer one
  and stamp its older prices fresh.
- **A batch still out after 20s is aborted and counts as failed.** Its symbols read UNAVAILABLE
  with the chip instead of sitting on the pending dot until the platform times out.

Gate evidence at 1280 (live, 2026-09-17 ~12:50 UTC, pre-market): 33 book symbols → 33 tiles,
33 with a %, 0 UNAVAILABLE, 0 pending or blank, none missing or extra. Staged with the batch
holding SEDG failed: 20 with a %, 13 UNAVAILABLE with the chip, 0 pending or blank.

## Not done here

- The extractor (`lib/transcripts.ts`) keeps its own stop-clause regex for
  `stopMasqueradingAsEntry`. It agrees with the pass on every case in its tests, but it is a
  second grammar.
- A stop the entry states is read (`EntryRead.stop`) and named in the reason. It is not
  written to the row's `stop` field and does not feed % of the way — the pass writes only
  evaluations.
