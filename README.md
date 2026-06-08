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

   Optionally add ElevenLabs for a premium voice (without it, AUGUST uses the browser
   voice):

   ```
   ELEVENLABS_API_KEY=...
   ELEVENLABS_VOICE_ID=...
   ```

   Optionally add Upstash Redis to give AUGUST **persistent memory** of you across
   sessions (without it, he simply doesn't remember between visits):

   ```
   UPSTASH_REDIS_REST_URL=...
   UPSTASH_REDIS_REST_TOKEN=...
   ```

   All keys are read **server-side only** (in the `app/api/*` routes) and never reach
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
- The reply renders as text near the circle **and** is spoken aloud — via ElevenLabs
  (`eleven_turbo_v2_5`) when configured, otherwise the browser voice.
- The circle moves through four states — **idle, listening, thinking, speaking** —
  reacting to live audio amplitude while listening and speaking.

Conversation history lives in memory for the session only. There is no database.

## Where things are

| File | What it is |
| --- | --- |
| `app/page.tsx` | The experience — boot, state machine, send/mic loops |
| `app/api/chat/route.ts` | Claude proxy, streaming (server-side, holds the key) |
| `app/api/speak/route.ts` | ElevenLabs TTS proxy, streaming (server-side, holds the key) |
| `app/api/memory/route.ts` | Background memory updates + `/forget` wipe (server-side) |
| `components/Circle.tsx` | The living circle: SVG smoke + shards + canvas haze, 4 states |
| `components/Composer.tsx` | The input bar + mic button |
| `components/Globe.tsx` | MapLibre dark globe — fly-to + labeled marker |
| `lib/persona.ts` | The AUGUST system prompt + the `USER_NAME` constant |
| `lib/speech.ts` | STT + TTS helpers — `speak()` is isolated for easy swapping |
| `lib/memory.ts` | Long-term memory: Upstash profile + summaries, Haiku merge (server-side) |
| `lib/tools.ts` | Claude tool-use defs (look_closer / close_map) + guidance |

To re-key AUGUST to a different person, change **one constant**: `USER_NAME` in
[`lib/persona.ts`](lib/persona.ts). It defaults to `Maged`.

## Memory

When Upstash is configured, AUGUST remembers you across sessions — kept entirely separate
from his own persona/backstory (Viv, Cleo, …). That's his life; this is what he's learned
about **you**.

- **Two stores in Upstash Redis.** `august:profile` is a JSON blob of durable facts about
  you (name, what you're working on, preferences, recurring people); `august:summaries` is
  a list of short, timestamped per-conversation summaries.
- **On each reply**, the chat route loads your profile + the last ~10 summaries and injects
  them into AUGUST's system prompt as a "What you remember about \<name\>" section — so he
  references them naturally, in his own voice, never "according to my records."
- **After each exchange**, in the background (never blocking the reply), a cheap model
  (`claude-haiku-4-5`) updates the rolling session summary and merges any new durable facts
  into the profile — deduped and kept tight, not just appended.
- **Ask "what do you remember about me?"** and he'll tell you, in character.
- **Type `/forget`** to wipe his memory of you (profile + summaries) and start clean.

Without `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, the memory layer is a no-op
and the app runs exactly as before.

## Look closer (the globe)

Ask AUGUST to see a place — "show me Tokyo", "what does the Strait of Hormuz look like",
"take me to Reykjavik" — and he opens a globe and flies there. No API key required.

- **Claude tool use.** A `look_closer` tool (lat, lon, label, zoom) is defined server-side;
  Claude fills the coordinates from its own knowledge — no geocoding service. The chat route
  runs the tool-use continuation so he both flies the globe **and** says something in
  character about the place.
- **MapLibre GL globe** with Carto's free dark-matter style — it fades in over the orb,
  `flyTo`s the coordinates with a smooth arc, and drops a labeled marker.
- **Dismiss it** with the ✕ control, or just say "close the map" / "go back" (a `close_map`
  tool returns you to the orb).

Scope is the globe + fly-to only — no data layers (conflicts, ships, weather) yet.

## Known v0 limits

- **Voice input is desktop-Chrome.** It uses the browser Web Speech API
  (`SpeechRecognition`), which works on desktop Chrome but is unreliable on iOS Safari.
  Phone voice comes in v1 via cloud STT (Deepgram / Whisper). v0 is desktop-local.
- **TTS uses ElevenLabs** (`eleven_turbo_v2_5`) through `app/api/speak`, played back
  through a Web Audio `AnalyserNode` so the circle pulses to his real voice. If
  `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` aren't set (or the call fails), `speak()`
  falls back to the built-in browser voice with a synthetic envelope, so the app always
  talks. Swapping TTS providers stays a one-function change in
  [`lib/speech.ts`](lib/speech.ts).
- Replies are kept tight and speakable (the system prompt enforces this).

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · `@anthropic-ai/sdk` (server-side) ·
ElevenLabs TTS · Upstash Redis · MapLibre GL · Web Speech API · Canvas + SVG.
