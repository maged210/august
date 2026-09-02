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
- **AUGUST is not a chatbot.** The input is headed toward a command bar: no thread
  history, no conversation UI.
- **AUGUST is intended to become a sellable product.** Nothing ships that the owner
  doesn't use weekly.

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

## Decided

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
