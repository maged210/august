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

- THE CALL — a one-line thesis under the regime pill plus a daily above/below
  call vs AUGUST; AUGUST's side derived deterministically from the regime
  model, settled in the 21:05 pass, scored as hit rate. It replaces the
  Morning Brief. Sequenced after the What's Coming fix; not part of the
  terminal-integrity branch.
