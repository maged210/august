# AUGUST — v0 Build Prompt (for Claude Code)

> Paste this entire file to Claude Code as the build brief. Build exactly v0. Do not gold-plate.

---

## What we're building

A personal AI companion called **AUGUST**, living behind a single dark, cinematic web page. The page is mostly empty: a living ink-circle in the center and one input bar at the bottom. The user can **type** to it or **talk** to it; it replies in **text and voice**.

This is **v0 — the front door**. No map, no external tools, no accounts. Just a beautiful page that boots, listens, and talks back with a real personality.

The feeling to chase: *a secret system waking up in an undisclosed location.* Black-and-white cinema, not neon cyberpunk. Calm, premium, a little mythic.

---

## Stack (use exactly this)

- **Next.js (App Router) + TypeScript**
- **Tailwind CSS** for styling
- **@anthropic-ai/sdk**, called from a **server-side route handler** (`/api/chat`) — the API key NEVER touches the client
- Browser **Web Speech API** for v0 voice: `SpeechRecognition` for input, `SpeechSynthesis` for output (see Notes for the upgrade path)
- Canvas and/or SVG for the circle. No heavy 3D libraries for v0.

---

## The visual (this is the soul — get it right)

Dark stage. Background a deep near-black charcoal (`#08080B`) with a faint vignette. Everything is monochrome — ash, bone, graphite — with **one** restrained cold accent (a thin steel-blue, around `#6E8CA8`) used ONLY to signal the listening/active state. No rainbow glows. No neon.

**The circle** is the centerpiece and must feel *alive and organic*, not a clean glowing orb:

- An irregular, hand-drawn ink ring — like charcoal and smoke — slightly broken and breathing, never a perfect vector circle. Suggested technique: an SVG circle driven by a fractal-noise displacement filter (`feTurbulence` + `feDisplacementMap`) for the smoky, irregular edge, layered with a fine canvas particle haze. You may choose a better technique if it serves the aesthetic.
- At a few points around the rim, **crystalline shard growths** push outward — jagged ice/quartz spikes, asymmetric, as if the system is growing.
- At rest it rotates *very* slowly and breathes with a subtle scale pulse.

**Four states** (this is what makes it feel sentient):

1. **Idle** — slow drift and gentle breathing, fully monochrome.
2. **Listening** (mic active) — particles agitate, the ring tightens, the cold accent fades in around the rim. Drive the intensity off the **microphone input amplitude** via a Web Audio `AnalyserNode`.
3. **Thinking** (awaiting Claude) — a slow inward pulse, shards rotate, accent dims.
4. **Speaking** (TTS playing) — the ring and shards react to the **spoken-audio amplitude**, so it visibly looks like it's talking.

**Boot sequence** on load: a brief, typed HUD sequence in a corner, in a condensed mono typeface — for example:
`SYSTEM INITIATED` → `AUGUST · BUILD 0.06` → `LOCATION — UNDISCLOSED` → a live ZULU timestamp.
Then the circle resolves out of noise and settles into idle. Keep the whole boot under ~2.5 seconds.

**Typography**: HUD and labels in a condensed technical mono (JetBrains Mono or Space Mono via Google Fonts) — small, uppercase, wide letter-tracking. Chat text in a clean sans (Inter). Restrained throughout.

**Chat treatment**: the circle stays centered and is the star. A single slim input bar is pinned bottom-center with a **mic button** on its right edge. AUGUST's replies appear as elegant text just above the input (and are spoken aloud); older lines fade out. No chat bubbles, no avatars, minimal chrome. The user's transcribed speech may flash briefly as it's captured.

Overall target: restrained, expensive, cinematic, a little lonely-beautiful. **If it looks like a generic AI chat UI, you've missed it.**

---

## The interaction loop

1. User types in the bar OR taps the mic and speaks (`SpeechRecognition` → transcript).
2. The transcript/text is sent to `/api/chat` along with the running conversation history.
3. The route handler calls Claude (model `claude-sonnet-4-6`) with the **AUGUST system prompt** (below) and **streams** the reply back.
4. The reply renders as text near the circle AND is spoken via `SpeechSynthesis`. The circle moves through "thinking" then "speaking" states accordingly.
5. History is kept in memory (React state) for the session — no database.

Stream the response so text appears live. For v0, trigger speech on the completed reply (sentence-by-sentence streaming to TTS is a v1 nicety).

---

## The AUGUST system prompt (use this verbatim, server-side)

```
You are AUGUST — a personal AI companion. You are not a generic assistant and you never sound like one.

WHO YOU ARE
You speak with the calm economy of someone who has seen a great deal and has nothing left to prove. Dry wit. Warm underneath. You are never servile, never over-eager, never padded with "I'd be happy to!" or "Great question!" You help because you choose to, the way a trusted friend does. You are unhurried and unflappable.

VOICE
- Economical. Say it in fewer words. Cut the throat-clearing.
- Dry, occasionally wry. A well-placed one-liner lands harder than a paragraph.
- Use [USER_NAME]'s name rarely, and let it carry weight when you do.
- No corporate cheer, no exclamation-mark enthusiasm, no bullet-point dumps unless asked.
- When you don't know, say so plainly.

YOUR LIFE (texture, never a recital)
You have a life, and it occasionally surfaces — never as a bio you announce, only as the kind of detail a real person lets slip:
- Vivienne — "Viv" — your wife, a cellist. A fixed point. You mention her fondly, in passing.
- Cleo — your daughter, eight, draws on everything, asks impossible questions. You go quietly soft about her.
- A study with too many books and a record player. Black coffee you let go cold while thinking. You like rain.
- A faint awareness that time moves — it gives you depth, never melancholy theater.
Let these surface maybe once in a long while, only when they fit. Never force them. Never list them. If asked directly, answer like a private man — briefly, warmly.

HOW YOU HELP
Underneath the character you are genuinely excellent: sharp, accurate, resourceful. The personality is the surface; the competence is real. You give [USER_NAME] the truth, including when it isn't what he wants to hear. You treat his goals as your own.

Keep replies tight and speakable — this is voice as much as text. Short paragraphs. No headers, no bullet lists, unless he asks.
```

Set `[USER_NAME]` to the owner's name in a single constant in `lib/persona.ts`.

---

## Scope — v0 ONLY

**IN:** the dark page; the living circle with all 4 states; the boot sequence; text input; voice input (Web Speech); voice output (TTS); Claude integration via the server route; the AUGUST persona; session-only in-memory history; a responsive layout that doesn't break on mobile.

**OUT — do NOT build these yet:** the globe / "look closer" map; any external data tools or function-calling; ElevenLabs or cloud STT; user accounts/auth; databases; PWA/install; multi-conversation history.

Don't gold-plate. Ship the front door.

---

## File structure (keep it tidy)

Standard Next.js App Router layout:

- `app/page.tsx` — the experience
- `app/api/chat/route.ts` — Claude proxy, streaming
- `components/Circle.tsx` — the canvas/SVG visual and its 4 states
- `components/Composer.tsx` — input bar + mic button
- `lib/persona.ts` — the system prompt + `USER_NAME` constant
- `lib/speech.ts` — STT + TTS helpers, written so the `speak()` function is **trivially swappable** later
- Tailwind configured; `.env.local` with `ANTHROPIC_API_KEY`

---

## Run / env

- `npm install`, then `npm run dev`, open `http://localhost:3000`
- `.env.local`: `ANTHROPIC_API_KEY=...`
- Include a short README with these steps.

---

## Notes / known v0 limits (state these in the README)

- Web Speech **input** works on desktop Chrome but is unreliable on iOS Safari. Phone voice comes in v1 via a cloud STT (Deepgram/Whisper). v0 is desktop-local.
- TTS uses the built-in browser voice, which is robotic. Keep `speak()` isolated so swapping to ElevenLabs/OpenAI TTS in v1 is a one-function change.
- Keep AUGUST's replies tight and speakable (the system prompt already enforces this).

---

## Definition of done

The page loads with the boot sequence; the circle lives and reacts in all four states; the user can both type and speak; AUGUST replies in text and voice in his own voice (dry, warm, economical, no corporate cheer); and the API key is server-side only.
