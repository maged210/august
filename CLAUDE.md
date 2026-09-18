# CLAUDE.md — august

Guidance for Claude Code working in this repo.

## Standing decisions

- **Secrets are written to .env.local, never printed.** Generated keys, tokens,
  and credentials go straight into the env file (and the owner mirrors them to
  Vercel); terminal output gets confirmations only — a printed secret lives in
  scrollback and logs forever. (Rule added after a VAPID private key was
  printed on 2026-09-02; that pair was rotated.)

- **Voice retired Aug 2026.** AUGUST does not speak or listen. Do not reintroduce
  TTS/STT (no ElevenLabs, no Deepgram, no Web Speech, no mic/waveform controls,
  no audio-reactive orb input).
- **AUGUST is not a chatbot.** The input IS a command bar (feature/command-bar,
  shipped): no thread history, no conversation UI, and commands never touch
  the model.
- **AUGUST is intended to become a sellable product.** Nothing ships that the owner
  doesn't use weekly.

- **Every surface that publishes a call carries the disclaimer** (chore/ship-ready).
  One component, one string: `lib/disclaimer.ts` + `components/Disclaimer.tsx`.
  THE RULE: rendered text, visible at rest, no interaction to read it — never a
  `title` attribute, never hover-gated, never sr-only. A hover tooltip on a
  phone-first app is not a disclaimer, it is the absence of one that passes a
  keyword grep (THE CALL, the regime line and the NQ levels module each shipped
  exactly that). Two claims, kept distinct: published calls are research and
  opinion; PIT and Training are SIMULATED with no real orders, which is the
  stronger claim and is never watered down to the generic line. The non-HTML
  outputs carry it too — the push body (short form, so the OS cannot truncate
  the claim away), the PIT share text, and a `disclaimer` field on /api/ideas and
  /api/call, because consumers of those wires are republishing the desk's
  calls.

- **/privacy and /terms are real routes**, written from what the code does and
  importing the shared strings. DRAFTS — not reviewed by a lawyer.

- **Account deletion is real** (`lib/account-delete.ts`). Confirm-then-delete;
  the email comes from the session, never the request, so a caller can only
  delete themselves. It SCANs the unindexed key patterns (magic-link tokens,
  which the auth adapter writes with no TTL, and the ask cache) and finds the
  claimed-device markers by scanning VALUES, because those keys are named after
  the device and carry the account only in the value. What it cannot reach — the
  user's own browser storage and Vercel's request logs — is returned and
  rendered verbatim, never swallowed.

## Abandoned

- LIVE pill dataState wiring, the US10Y tape entry, mobile board defaults —
  all owner-desk items, moot since chore/terminal-cut deleted the desk.
- 390px chrome pass.
- Market-brain visualization.
- Confidence percentages not computed from a model.
- Pit tier ladder / reputation / personality scores.
- Global leaderboard.
- Per-user model calls to explain a user's wrong prediction (compute the
  disagreeing inputs instead).
- THE MORNING BRIEF, deleted chore/ship-ready. THE CALL replaced it and the
  code never caught up. Gone: `lib/gmail.ts`, `lib/morningbrief.ts`,
  `lib/calendar.ts`, `/api/brief`, `/api/cron/brief`, and the Gmail/Calendar
  OAuth routes under `/api/auth/google` (never sign-in — sign-in has always
  been the Resend magic link). Calendar was a v0 feature that did not survive
  the pivot and went with the chain. `lib/intel/brief.ts` was NOT this — it
  was the owner desk's brief compiler, deleted with the desk (chore/terminal-cut).
- The MapLibre globe. The dep is gone too; the code went several releases ago.
- THE ORB. `components/Presence3D.tsx` and the `three` dependency are gone
  (feat/v4-2-today, the owner's strike): it carried no data, its only signal
  (THINKING during an ask) is the answer card's, and its WebGL crystal was the
  last of the retired dark-cinematic language. The regime card is the front
  page's first card. Do not re-add a decorative hero.
- The calendar's UNRENDERED computation: the 15-minute NQ reaction on released
  prints, the FRED `actual` backfill (`lib/calendar-actuals.ts`), the daily
  pass step that warmed it, and the calendar-ask seam (`/api/chat`'s
  `calendarAsk` branch + the canonical prompts in `lib/calendar-feed`) — no
  rendered control could reach any of it. `/api/calendar` serves the week's
  high-impact rows and nothing else; CountdownRow renders them.
- The front page's EARNINGS row — a permanent DATA UNAVAILABLE with no
  provider anywhere. If earnings return, they return as "what's reporting that
  could move the live book", not a market-wide list.
- The theme menu (MATRIX / DARK / LIGHT / GOTHAM), MatrixRain + its rain dial,
  the mood axis, and the orb's night looks — retired feat/v4-2-today (tag
  `archive/theme-menu` on main is the rebuild point). ONE paper theme; do not
  reintroduce a theme switcher or a second palette (DESIGN_LAWS L1).

## Kept deliberately, after being proposed for deletion

- `/api/cron/watchers` + `lib/watchers.ts` — unscheduled and uncalled, but
  CLAUDE.md names Watchers as planned work on the push seam. Documented intent
  beats an import graph.

## Decided

- FAILURE IS A STATE (fix/failure-visibility, 2026-09-18) — DESIGN_LAWS L11.
  No surface renders a failed fetch, a swallowed exception or a missing
  credential as emptiness. THE CALL renders a failed thesis as UNAVAILABLE with
  its chip (getThesis returns ok / unavailable(reason) / none and STORES the
  failure for the no-spend window, so it is not just the first viewer who sees
  it); /admin carries the provider's real error on its own unclipped line and
  can RE-RUN a failed extraction from the stored raw text (PATCH, failed rows
  only — no second provider fetch, no second row; repeat attempts collapse per
  videoId); /api/chat names the grounding it answered without on x-aug-degraded
  and its dead-stream sentinel is a shared constant the card renders as an error
  instead of prose; lib/memory reports every write (the /forget wipe no longer
  claims a success it didn't have) and never overwrites a profile it failed to
  read; lib/intel names the feeds that didn't answer instead of asserting
  "Wires are live." over zero articles. The failure law is the LAST number,
  not an insertion: MOTION WITH RESTRAINT keeps L9, which it has held since it
  was written and which notes outside this repo cite.

- THE PAPER SHELL + TODAY (feat/v4-2-today, 2026-09-17) — DESIGN_LAWS L1 is
  PAPER LANGUAGE: paper is the desk, dark is the arena (THE PIT holds a dark
  arena as a class; /admin is exempt). The shared palette and the type scale
  live ONCE in `app/globals.css` :root (`--paper-*`, `--type-*`, chip edges);
  `app/intel/frame.css`'s paper block points its `--rd-*` names at them, and
  the terminal pins its own pre-v4-2 shell values (chips, disclaimer, base
  text) so its output did not move. `<html data-theme="light">` is
  server-rendered and never changes. The front page is `app/today.css` +
  `td-*` cards: one card per module, a provenance chip on market data, an
  as-of time on August's stored records (desk, tape), UNAVAILABLE instead of
  blank. ONE QUOTE BOOK: `lib/quote-book.ts` (pure policy) +
  `lib/use-quote-book.ts` (the loop) are imported by the terminal AND the
  front page — never copy the functions. STALE is retired for prices. Every
  quote carries its own `asOf` from /api/intel/quotes (fix/quote-age) and the
  policy ages a price from THAT, never from when the round was asked: a cache
  hit is as old as its fetch, and a price of unknown age is UNAVAILABLE. THE
  CALL shows no reference while open; a settled call reads the stored close
  and prev close it was scored against. LATEST INGEST is /admin-only (owner
  parity on the floor too: the ADMIN chip is the only owner difference).

- THE TERMINAL CUT (chore/terminal-cut, 2026-09-15) — ONE terminal for every
  role: `IntelDeckSurface` renders `IdeasFeed`, and the July owner desk
  (`components/intel/*`, the brief pipeline under `lib/intel/`, seventeen
  `/api/intel/*` routes — the sixteen desk routes plus `/api/intel/feed` —
  `/api/cron/intel`, the `/intel` stub) is DELETED,
  not parked — tag `archive/owner-desk` on main is the rebuild point. The
  TRACKED lane is retired with it: every open tracked row was closed with
  reason "desk retired" (one-shot, ran 2026-09-15 against the single Upstash
  database that preview and production share; the script is deleted),
  `/api/intel/feed` and the publish store are gone, and the daily cron's
  tracker pass no longer ingests. The live book (DESK INBOX → live,
  INTEGRITY-1) is the only lane: one header, one list, no sub-nav row.
  OWNER PARITY IS STRICT: the ADMIN chip (a link to /admin via `useOwner`, no
  controls) is the ONLY owner difference on the terminal — no INGEST wire
  rows, and the `<TICKER>` command deep-selects for the owner exactly as for
  a visitor. Phones drop the IDEAS tab and do not mount the rail sheet; the
  desktop rail is untouched. `app/intel/frame.css` carries the kept tokens
  byte-identical (re-palette is v4-1). `lib/intel.ts` (RSS, the watchers
  seam) is unrelated to `lib/intel/` and stays — never a `lib/intel*` glob.

- THE COMMAND BAR (feature/command-bar) — the bar is the ONLY input, on the
  floor and on mobile. Two lanes by law: COMMANDS (`<TICKER>`, `arm`/`close`,
  `higher`/`lower`, `call coming why pit terminal ideas inbox clear`,
  `/forget`) resolve deterministically and locally and NEVER hit the model —
  a command-shaped parse failure hints locally, a ticker miss says NO SUCH
  SYMBOL, neither ever falls through to /api/chat. ASKS are single-turn
  (one message, no tools, small stated token budget), cached 10 minutes per
  identity for identical normalized asks, and capped per identity per day
  (anon 20 / signed-in 100, env-tunable); over the cap the desk says so and
  commands keep working. The response is ONE answer card the next input
  replaces. No conversation UI exists anywhere: no threads, no history, no
  transcript, no "new chat".

- PWA + PUSH (feature/pwa-push) — installable PWA (existing manifest/orb
  icons/minimal sw.js: push + notificationclick only, NO offline caching) and
  Web Push with VAPID, no third-party push service. ONE notification per
  trading day, from the daily pass via the lib/call-events settle seam:
  today's settle + tomorrow's call, personalized per principal, NX-idempotent
  per day. Subscriptions are principal-keyed (anonymous aug_vid devices
  subscribe; claim folds them into the account). The header bell is the only
  control. Watchers extend this same seam/store — separate branch.

- THE DESK INBOX (feature/desk-inbox) — the /admin queue (PENDING · NEEDS
  LEVEL · REVIEW) is the ONLY path into the lifecycle for anything the
  extractor can't fully parse; every resolution is a human tap, nothing
  auto-resolves. DENY is terminal with a stated reason (never deletion);
  QUOTE_SUSPECT refuses to grade a level against a quote >3× away (the NOW
  5:1-split lesson — a stated pre-split level must never fire against a
  post-split quote).

- THE CALL shipped (feature/the-call). One card on the floor under the regime
  line: AUGUST's daily NQ call vs the owner, settled against Yahoo's daily bar
  in the daily pass (22:10 UTC — post-close in EST and EDT), running records
  for both sides from 0–0. Direction is
  DETERMINISTIC from the regime model — the sign of its vote sum (RISK ON →
  higher, RISK OFF → lower, NEUTRAL follows its lean; dead even or unavailable
  = no call that day). The thesis line is the feature's ONLY model use and is
  cached per regime-vote fingerprint flip — never per view, never per user.
  No exchange calendar exists: trading days derive from Yahoo's daily bars
  (a date that never prints a bar voids as NO_SESSION). Identity is the Pit's
  claim layer. Push rides the settle event seam (lib/call-events) — NEXT
  branch, not this one.
