# AUGUST — v0

A personal AI companion behind a single dark, cinematic web page. A living ink-circle
in the center, one input bar at the bottom. Type to it or talk to it; it replies in
text and voice, in its own dry, warm, economical voice.

This is **v0 — the front door**. No map, no external tools, no accounts. A page that
boots, listens, and talks back with a real personality.

## Run it

1. **Install**

   ```bash
   npm install
   ```

2. **Add your key** — open `.env.local` and paste your Anthropic API key:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

   The key is read **server-side only** (in `app/api/chat/route.ts`) and never reaches
   the browser.

3. **Start**

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000>.

## How it works

- The page loads with a short boot HUD, then the circle resolves out of noise into idle.
- Type in the bar **or** tap the mic and speak.
- Your text + the running conversation go to `/api/chat`, which calls Claude
  (`claude-sonnet-4-6`) with the AUGUST persona and **streams** the reply back.
- The reply renders as text near the circle **and** is spoken aloud.
- The circle moves through four states — **idle, listening, thinking, speaking** —
  reacting to live audio amplitude while listening and speaking.

Conversation history lives in memory for the session only. There is no database.

## Where things are

| File | What it is |
| --- | --- |
| `app/page.tsx` | The experience — boot, state machine, send/mic loops |
| `app/api/chat/route.ts` | Claude proxy, streaming (server-side, holds the key) |
| `components/Circle.tsx` | The living circle: SVG smoke + shards + canvas haze, 4 states |
| `components/Composer.tsx` | The input bar + mic button |
| `lib/persona.ts` | The AUGUST system prompt + the `USER_NAME` constant |
| `lib/speech.ts` | STT + TTS helpers — `speak()` is isolated for easy swapping |

To re-key AUGUST to a different person, change **one constant**: `USER_NAME` in
[`lib/persona.ts`](lib/persona.ts). It defaults to `Maged`.

## Known v0 limits

- **Voice input is desktop-Chrome.** It uses the browser Web Speech API
  (`SpeechRecognition`), which works on desktop Chrome but is unreliable on iOS Safari.
  Phone voice comes in v1 via cloud STT (Deepgram / Whisper). v0 is desktop-local.
- **TTS is the built-in browser voice**, which is robotic. `speak()` in
  [`lib/speech.ts`](lib/speech.ts) is deliberately isolated — swapping in
  ElevenLabs / OpenAI TTS later is a one-function change.
- **The "speaking" amplitude is synthetic.** Browser `SpeechSynthesis` output can't be
  tapped by a Web Audio `AnalyserNode`, so the speaking visual is driven by word-boundary
  events plus noise. When you swap in a real TTS that returns audio, feed its real
  amplitude into the same shared ref and the circle reacts for free.
- Replies are kept tight and speakable (the system prompt enforces this).

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · `@anthropic-ai/sdk` (server-side) ·
Web Speech API · Canvas + SVG. No 3D libraries.
