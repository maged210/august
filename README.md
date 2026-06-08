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

## Command deck

The app is a horizontally-paginated deck of four full-screen surfaces — **Presence**,
**Markets**, **Intel**, **Comms** — behind fixed chrome (the HUD, the indicator dots, and
the reply + command input, which stay on every surface).

- **Navigate** by swipe / trackpad, the **← →** arrow keys, the indicator dots, or by
  asking AUGUST ("go to markets", "show comms") — a `go_to_screen` tool slides the deck.
- **Presence** (home) is a Three.js centerpiece of slowly-rotating concentric mechanical
  rings, audio-reactive off the mic and his TTS (loads `/public/circle.glb` instead if it
  exists), plus **the Brief** — one synthesis line per surface (stubbed in `lib/brief.ts`;
  live data wires in there later).
- **Markets is live** (see below). **Intel / Comms** remain styled terminal placeholders
  with clear `TODO: live data` markers — their data lands in later passes.
- The look-closer globe stays a global overlay, working from any surface.

Scope so far is the shell — deck + 3D centerpiece + navigation. No live market data, web
search, or email auth yet; those are separate passes.

| Deck file | What it is |
| --- | --- |
| `components/Presence3D.tsx` | Three.js centerpiece — concentric mechanical rings, audio-reactive |
| `components/Deck.tsx` | Horizontal scroll-snap deck + indicator dots + arrow keys + `goTo()` |
| `components/Brief.tsx` | The Brief — per-surface synthesis lines |
| `components/surfaces/*` | Markets / Intel / Comms placeholder surfaces |
| `lib/screens.ts` | Surface ids + labels | 
| `lib/brief.ts` | Brief lines (Markets live; others stubbed) |
| `lib/markets.ts` | Live free market data + per-source caching + AUGUST's snapshot (server) |
| `app/api/markets/route.ts` | Cached JSON feed the Markets surface polls |

## Markets (live, free data)

The Markets surface is live and chart-rich, auto-refreshing on a ~30s poll. Every source is
free and mostly keyless; per-source TTL caching in `lib/markets.ts` keeps us off rate limits.
A graceful skeleton shows while data loads — never an endless spinner.

**Wave 1 adds:** a sparkline on every watchlist row, a main price chart (candlesticks,
1D/1W/1M, click a row to load that symbol — lightweight-charts), a dial-gauge cluster
(Crypto Fear & Greed, VIX, and FRED macro: 10Y-2Y spread + financial stress), and expanded
crypto (8 majors).

| Panel | Source | Key? |
| --- | --- | --- |
| Crypto — 8 majors (price, 24h, sparkline) | CoinGecko | keyless |
| Crypto chart candles | Coinbase (US-friendly) | keyless |
| Price charts + row sparklines | lightweight-charts (lib) | — |
| Index/commodity proxies (QQQ→NQ, SPY→ES, DIA→YM, USO→crude, GLD→gold) + their charts/sparklines | Yahoo chart | keyless |
| NQ levels (R/P/S + O/N high/low) | computed from NDX prior-session OHLC (Yahoo) | keyless |
| Movers (gainers / losers / active) | Yahoo screener | keyless |
| VIX | Yahoo chart | keyless |
| Fear & Greed (crypto) gauge | alternative.me | keyless |
| Macro gauges — 10Y-2Y spread, financial stress | FRED | **free key** (`FRED_API_KEY`) |
| Sector strip (11 SPDRs) | Yahoo chart | keyless |
| Economic calendar (US, today) | faireconomy (ForexFactory mirror) | keyless |
| **FLOW · LITE** | Yahoo screener — *unusual equity volume* | keyless |

Index/ETF quotes are **delayed proxies**, not the live CME tape (labeled as such in the UI).

**FLOW · LITE is honest.** Real options flow (sweeps, blocks, premium) is a paid feed. This
panel is a free stand-in: *unusual volume* among the most-active equities (today's volume vs
the 3-month average). It is **not** institutional options flow. To upgrade, swap `buildFlow()`
in `lib/markets.ts` for a real provider (Unusual Whales / FlowAlgo / CBOE) — the surface only
reads `FlowItem[]`, so nothing else changes.

AUGUST reads this surface: the **Brief**'s Markets line is live, and he answers "where's NQ vs
my levels?" from the live numbers (a cached snapshot is injected into his system prompt).

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
ElevenLabs TTS · Upstash Redis · MapLibre GL · Three.js · Web Speech API · Canvas + SVG.
