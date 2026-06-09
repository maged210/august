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

Ask AUGUST to see a place — "show me Tokyo", "show me flights over Europe", "take me to
Reykjavik" — and he flies the **Command** globe there. No API key required.

- **Claude tool use.** A `look_closer` tool (lat, lon, label, zoom) is defined server-side;
  Claude fills the coordinates from its own knowledge — no geocoding service. The chat route
  runs the tool-use continuation so he both flies the globe **and** says something in
  character about the place.
- **One globe.** `look_closer` slides the deck to the Command surface and `flyTo`s the
  coordinates with a smooth arc, dropping a labeled marker — the same live globe described
  below, not a second one.
- **Return** by saying "close the map" / "go back" (a `close_map` tool slides back to the orb).

## Command deck

The app is a horizontally-paginated deck of five full-screen surfaces — **Presence**,
**Markets**, **Intel**, **Comms**, **Command** — behind fixed chrome (the HUD, the indicator
dots, and the reply + command input, which stay on every surface).

- **Navigate** by swipe / trackpad, the **← →** arrow keys, the indicator dots, or by
  asking AUGUST ("go to markets", "show command") — a `go_to_screen` tool slides the deck.
- **Presence** (home) is a Three.js centerpiece of slowly-rotating concentric mechanical
  rings, audio-reactive off the mic and his TTS (loads `/public/circle.glb` instead if it
  exists), plus **the Brief** — one synthesis line per surface (Markets and Command live).
- **Markets** and **Command** are live (see below). **Intel / Comms** remain styled terminal
  placeholders with clear `TODO: live data` markers — their data lands in later passes.
- The look-closer globe **is** the Command surface — one globe AUGUST can fly.

| Deck file | What it is |
| --- | --- |
| `components/Presence3D.tsx` | Three.js centerpiece — concentric mechanical rings, audio-reactive |
| `components/Deck.tsx` | Horizontal scroll-snap deck + indicator dots + arrow keys + `goTo()` |
| `components/Brief.tsx` | The Brief — per-surface synthesis lines (Markets + Command live) |
| `components/command/CommandGlobe.tsx` | MapLibre intelligence globe — flights / quakes / day-night, HUD, toggles |
| `components/surfaces/*` | Markets / Intel / Comms surfaces |
| `lib/screens.ts` | Surface ids + labels |
| `lib/brief.ts` | Brief lines (Markets + Command live; others stubbed) |
| `lib/markets.ts` | Live free market data + per-source caching + AUGUST's snapshot (server) |
| `lib/command.ts` | Live flights (OpenSky) + quakes (USGS) + caching + AUGUST's snapshot (server) |
| `app/api/{markets,flights,quakes,command}/route.ts` | Cached JSON feeds the surfaces poll |

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

## Command (live intelligence globe)

The **Command** surface is a full-screen MapLibre globe (globe projection, Carto's free
dark-matter style) in an OSIRIS-style command aesthetic. It's the same globe `look_closer`
flies. Every layer is drawn in **WebGL** (no DOM markers) and fed by a cached server-side
proxy route, so the free APIs are never hammered.

| Layer | Source | Render | Refresh |
| --- | --- | --- | --- |
| **Flights** | OpenSky via `/api/flights` | symbol layer, rotated by heading | ~15s, viewport bbox |
| **Earthquakes** | USGS all-day GeoJSON via `/api/quakes` | circle layer, sized/coloured by magnitude | 5 min |
| **Day / Night** | computed from the sun (no source) | terminator polygon over the night side | 1 min |

- **Flights** work **anonymously** (sparse, rate-limited). Set `OPENSKY_CLIENT_ID` /
  `OPENSKY_CLIENT_SECRET` (free OAuth2 client creds) to densify. The feed is fetched only
  while you're on the surface, capped (3,000), and viewport-culled for 60fps.
- **HUD** (top): ZULU clock, active-layer count, live "N aircraft" / "M quakes (24h)".
- **Toggles** (left, OSIRIS style): Flights / Quakes / Day-Night — more layers slot in later.
- AUGUST reads it: the **Brief**'s Command line is live, and a cached snapshot in his prompt
  lets him answer "what's on the globe?" and fly it ("show me flights over Europe").

Wave 1 is flights + quakes + day/night. Ships, weather, fires, and conflict layers are
later passes — each is one more cached proxy route + WebGL layer.

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
