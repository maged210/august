# AUGUST — FULL BUILD DIRECTIVE (paste this whole file as your first message)

## ROLE
You are the sole engineer and design lead building **AUGUST**: a dark, cinematic, personal ambient-intelligence product. It has exactly two surfaces — a character page where the user texts an AI named "august" whose replies light up the room, and a Bloomberg-density market intel blotter. Premium, precise, zero filler. Build it end to end, verify it, and hand back a working app.

## STACK
- Preferred: **Next.js 15 (App Router) + TypeScript + Tailwind**. If this platform only outputs Vite + React, that is acceptable — but keep ALL feature code in self-contained folders `src/features/august/` and `src/features/intel/` so it ports cleanly to Next.js later.
- No component libraries (no shadcn, no MUI). Tailwind + CSS variables only.
- Fonts via Google Fonts: **Michroma** (display), **IBM Plex Sans** (body), **IBM Plex Mono** (data). Fallbacks: system-ui / ui-monospace.

## DESIGN TOKENS — use these exact values, expose all as CSS variables
- `--ink #0d0e18` app base · `--room #12131f` room shadow · `--wall #1c1e30` upper wall
- `--amber #e8985a` dusk + intel accent · `--ember #c05f4e` horizon mid
- `--screen #9fd8e8` monitor light · `--glow #5fb9d4`
- `--text #e7e9f2` · `--dim #8a8fa8` · `--up #63d68f` · `--down #e0605d`
- hairline borders: `rgba(231,233,242,.09)` · radii 2–3px · `--energy` (0–1, see mechanic below)

Type rules: Michroma ONLY for the wordmark and tiny labels (≤13px, letter-spacing .22–.42em). Plex Mono for every timestamp, ticker, and table cell. Plex Sans for everything else. Aesthetic: dark, cinematic, Westworld-meets-Bloomberg. Hairlines, density, restraint. No glassmorphism cards, no gradients anywhere except the dusk window and the two glow layers.

## INFORMATION ARCHITECTURE — exactly two routes, nothing else
- `/` → AUGUST (character page)
- `/intel` → INTEL (blotter)
- Top bar on both: wordmark "AUGUST" (Michroma, the U in amber), a segmented control `AUGUST | INTEL` (active = amber underline + faint amber fill, `aria-pressed`), right side: live clock (mono) + green ONLINE dot.
- Do NOT build any other pages. No feeds, no globe, no mail, no auth, no footer link farms.

## SURFACE 1 — AUGUST (route `/`)
**Scene.** Full-viewport dusk bedroom built in code (no stock photos):
- Wall gradient `--wall → --room → #0b0c15` top to bottom.
- Window, left side (~25% wide, 54% tall): vertical dusk stack `#181330 → #3a2547 → #7d4150 → #c05f4e → #e8985a → #f2bd7e`, a city-skyline SVG silhouette (`#0b0a14`) across the bottom third, one 3px white star with glow, a 1px center mullion, warm light spill (radial, `rgba(232,152,90,.10)`) cast into the room.
- Desk: dark band across the bottom ~21% with a 1px top highlight. Warm lamp pool (radial `rgba(242,189,126,.22)`) on the right of the desk.
- 4 dust motes drifting upward through the window light (2px, 9s loop, low opacity).
- **Monitor**: a curved ultrawide (32:10-ish aspect) centered on the desk — thin near-black bezel, `perspective(1200px) rotateX(1.6deg)`, trapezoid stand + base bar. The screen hosts the chat.
- **The scene background must be one swappable component**: `<StillScene/>` now; leave a documented slot for `<CinemagraphScene src={video}/>` later. Do not hardcode the background into the page.

**THE SIGNATURE MECHANIC — the screen lights the room.** A root CSS variable `--energy` (0–1) drives two layers: (a) a blurred cyan halo behind the monitor, opacity = energy; (b) a full-scene radial "relight" overlay centered on the monitor, `rgba(95,185,212,…)`, `mix-blend-mode: screen`, opacity = energy, 1.4s ease transition. Idle energy = 0.15. On message send → energy = 1; after the reply lands, decay back to 0.15 over ~2.5s. When august replies, the whole room must visibly brighten. This is the product's identity — get it right before anything else.

**Chat.** Header on the screen: `august — direct line` + status (`idle` / `august is typing`). User messages right-aligned, amber left edge, `rgba(232,152,90,.09)` fill; august messages left-aligned, cyan edge, `rgba(95,185,212,.08)` fill; mono timestamps; auto-scroll; 3-dot typing indicator. Floating input bar bottom-center: placeholder **"Text august…"** + SEND button (Michroma, amber outline).

**Reply wiring.** `POST /api/august/reply` — server-side only — calls Anthropic's API (model: a fast/cheap Claude model, e.g. Haiku-class), key from `ANTHROPIC_API_KEY` env var, NEVER exposed client-side. System prompt: august is terse, capable, calm — a quiet operator, 1–2 sentences max. If the key is missing or the call fails, fall back silently to rotating scripted replies:
1. "On it. I'll have it staged before you're back."
2. "Flagged. Two names moved after hours — ranked on the intel desk."
3. "Done. Queued under Ideas, reminder set for tonight."
4. "Copy. Renders clean on the 57 — I checked."
5. "Working. Give me a minute, then check the blotter."
Add a simple per-session rate limit (in-memory is fine) and a code comment marking where Upstash Redis replaces it in production.

**Idea rail.** Right rail, 262px (stacks below the scene under 760px). Header `IDEAS` + open count. Each item: title (13px), tag (mono, dim), status chip — `BUILDING` (amber outline) / `QUEUED` (dim outline) / `APPROVED` (green outline). Full CRUD: add via a small input at the top of the rail, tap a chip to cycle status, × to delete. Persist to localStorage, schema `{id, title, tag, status, createdAt}`. Seed with:
- Character page — still → cinemagraph loop · phase 2 · BUILDING
- Retire feeds / globe / mail surfaces · ia restructure · APPROVED
- DP 2.1 cable (54 Gbps) — unlock 240Hz · battlestation · QUEUED
- Transcript ingestion pipeline · phase 2 · QUEUED
- Intel alerts → push notifications · retention · QUEUED
- Subscription tier + paywall · revenue · QUEUED

## SURFACE 2 — INTEL (route `/intel`)
- **Ticker tape**: full-width marquee strip under the top bar — mono, symbols bold with colored ±% (`--up`/`--down`), content duplicated for a seamless 34s linear loop.
- **Signals table**: columns `TIME | SYM | SIGNAL | CONF | Δ SESSION | NOTE`. Sticky Michroma header row (8px, letterspaced, amber bottom rule). Hairline row borders, row hover = faint amber tint. SYM in amber. CONF rendered as a 52px × 4px amber bar plus the number. Δ colored up/down. Dense padding (8px 14px), mono everywhere.
- **Desk note**: right panel, 250px (hidden under 760px) — heading `DESK NOTE`, two short paragraphs of analyst-style context.
- Data comes from one typed mock module `signals.ts` exporting `SignalRow[]` with 9 plausible rows. Render a small visible mono tag **"SIMULATED FEED"** until a real data source is wired. Never present mock data as live market data.

## GLOBAL QUALITY BAR
- Responsive to 380px: rail stacks below scene, monitor goes ~94% width, desk note hides, no horizontal scroll.
- `prefers-reduced-motion`: disable motes, marquee, typing animation, and glow transitions; keep all functionality.
- Visible `:focus-visible` outlines (1px amber), labeled inputs, `aria-pressed` on the toggle.
- No lorem ipsum anywhere — use only the copy in this directive. No extra pages, no placeholder nav items.
- No layout shift when toggling surfaces; chat thread state survives switching tabs.

## BUILD ORDER — complete and verify each phase before starting the next
1. Scaffold + tokens + fonts + top bar with working surface toggle
2. August scene statics: wall, window, skyline, desk, lamp, motes, monitor shell
3. Chat thread + energy/relight mechanic + `/api/august/reply` with fallback replies
4. Idea rail CRUD + localStorage persistence + seeds
5. Intel: tape, table from `signals.ts`, desk note
6. Responsive + reduced-motion + accessibility pass

## ACCEPTANCE CHECKLIST — self-verify before handing back; fix any failure, then report results line by line
- [ ] Sending a message visibly brightens the entire room, then decays back to idle
- [ ] With no `ANTHROPIC_API_KEY` set, scripted fallback replies still work
- [ ] Ideas survive a page refresh; tapping a chip cycles its status; items can be added and deleted
- [ ] `/intel` renders 9 signal rows; the tape loops with no visible seam
- [ ] At 380px wide: no horizontal scroll, chat + ideas + intel all fully usable
- [ ] Switching AUGUST → INTEL → AUGUST preserves the chat thread
- [ ] Only two routes exist; Michroma never appears above 13px; all data text is Plex Mono
