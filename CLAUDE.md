# CLAUDE.md — august

Guidance for Claude Code working in this repo.

## Standing decisions

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
