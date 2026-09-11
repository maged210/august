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
  the claim away), the PIT share text, and a `disclaimer` field on /api/ideas,
  /api/call and /api/intel/feed, because consumers of those wires are
  republishing the desk's calls.

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

- LIVE pill dataState wiring (the BAR-2 brand pill stays decorative).
- US10Y tape entry (^TNX ÷10 + basis-point formatting).
- Mobile board defaults (first card open, TODAY horizon).
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
  the pivot and went with the chain. `lib/intel/brief.ts` is NOT this — it is
  the live desk brief compiler the ingest pipeline feeds, and it stays.
- The MapLibre globe. The dep is gone too; the code went several releases ago.

## Kept deliberately, after being proposed for deletion

- `three` and `components/Presence3D.tsx` — the orb is LIVE. HomeLanding
  dynamic-imports it and the root page mounts HomeLanding.
- `components/intel/OptionsWorkspace.tsx` — reachable at
  `IntelDashboard.tsx:36`, and the OPTIONS tab survives the audience filter
  for every viewer.
- `/api/cron/watchers` + `lib/watchers.ts` — unscheduled and uncalled, but
  CLAUDE.md names Watchers as planned work on the push seam. Documented intent
  beats an import graph.
- `/api/cron/intel` — unscheduled, but it imports `lib/intel/brief.ts` and was
  never explicitly approved for deletion.

## Decided

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
