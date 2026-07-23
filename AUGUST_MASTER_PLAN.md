# AUGUST — MASTER EXECUTION PLAN
# This file lives at C:\dev\august\AUGUST_MASTER_PLAN.md and IS the project's memory.
# Nobody holds the plan in their head. Not Milek. Not Claude. This file does.

---

## PROTOCOL — READ THIS FIRST (Claude Code: follow exactly)

**For Claude Code, every session:**
1. Read this entire file before touching anything.
2. Find the FIRST unchecked `[ ]` task that is not blocked by an open item in BLOCKERS or an unpassed DECISION GATE.
3. Execute ONLY that task. Meet its DONE WHEN criteria. Run the app to verify if the task touches UI.
4. Check the box, commit with message `[TASK-ID] short description`, push.
5. If stuck >15 min or the task needs a human choice: write an entry in BLOCKERS LOG (bottom of file), commit, STOP, and tell Milek exactly what you need in one sentence.
6. In AUTOPILOT mode (Milek says "run the plan"), repeat steps 2–5 until you hit a DECISION GATE, a HUMAN task, a blocker, or 5 completed tasks — then stop and summarize.

**For Milek, every session (this is your whole ritual):**
- Open Claude Code in C:\dev\august and say: **"Read AUGUST_MASTER_PLAN.md and run the plan."**
- That's it. 20 minutes or 2 hours — it does the next thing, the file remembers where you are.
- Tasks marked **HUMAN** are yours; everything else is Claude Code's.
- Time tags: (S) ≤20 min · (M) ~45 min · (L) 90+ min — pick sessions by the time you have.

**Model per phase** (Milek's rule — one-line why):
- Phases A, D, E: **Sonnet 4.6** — routine wiring and config; fast and cheap is correct.
- Phases B, C, F: **Fable 5** — multi-file restructure and design-critical UI; strongest model earns its cost here.
- Phase G: **Fable 5** — 3D/graphics work punishes weak reasoning.

---

## CURRENT STATE (updated 2026-07-23)
- Rig live: PowerSpec G757 (9800X3D / RTX 5080), repo cloned at C:\dev\august, `npm install` + `npm run dev` verified.
- Prod: august-wiiz.vercel.app. /intel blotter live. Feeds/globe/mail pages approved for retirement.
- Monitor at 120Hz — DP 2.1 cable pending (human task).
- Reference docs in repo after A2: `docs/august-build-directive.md` (design tokens, chat/intel specs, acceptance bars).

---

## PHASE A — FOUNDATION ON THE RIG (Sonnet 4.6)

- [x] **A1 (S)** Save this file as `AUGUST_MASTER_PLAN.md` in repo root; save the build directive as `docs/august-build-directive.md`. Commit both.
  DONE WHEN: both files in repo, pushed. ✓ 2026-07-23
- [x] **A2 (S) HUMAN** Install Claude Code on the rig — PowerShell: `irm https://claude.ai/install.ps1 | iex`, then `claude` in C:\dev\august, log in.
  DONE WHEN: `claude` opens in the repo. ✓ verified 2026-07-23 — this session runs in the repo.
- [ ] **A3 (S)** Install Vercel CLI (`npm i -g vercel`), run `vercel link` (HUMAN confirms the august project when prompted), then `vercel env pull .env.local`.
  DONE WHEN: `.env.local` exists containing ANTHROPIC_API_KEY and Upstash vars; file is git-ignored.
- [ ] **A4 (S)** Verify `npm run dev` boots clean with the pulled env; hit `/` and `/intel` locally.
  DONE WHEN: both routes render, no red console errors.
- [ ] **A5 (M)** Set up a Claude Code Notification hook: when Claude Code needs permission, hits a blocker, or finishes a run, play a Windows sound + toast. Claude Code configures its own hooks — ask it to.
  DONE WHEN: killing the network mid-task (or any forced stop) produces an audible/visible ping.
- [ ] **A6 (S)** Create branch `feature/character-page`. All Phase B–C work happens here.
  DONE WHEN: branch pushed.

## PHASE B — PHOTOREAL CHARACTER PAGE, STILL-IMAGE VERSION (Fable 5)
Goal: replace the CSS-drawn room with a real render. Chat overlay sits ON the monitor in the render. Screen relights the room on reply. This ships to prod at the end of the phase.

- [ ] **B1 (M) HUMAN — Midjourney render.** Generate the room. Starting prompt (iterate to taste):
  `cinematic photograph, cozy dark bedroom at dusk, large window on the left with city skyline in deep orange-purple twilight, desk centered against the wall with a single curved ultrawide monitor turned toward camera, screen dimly glowing cyan, warm desk lamp on the right, volumetric window light, dust motes, moody, photorealistic, 8k --ar 16:9 --style raw`
  Requirements: monitor face visible and roughly centered, screen area clean (UI goes there), dusk window left, lamp right. Upscale max. Export ~4K.
  DONE WHEN: final PNG chosen and dropped into `C:\dev\august\public\scene\room-dusk.png`.
  → **DECISION GATE G1:** Milek approves the render before B2.
- [ ] **B2 (M)** Build `<StillScene/>`: full-bleed `next/image` (fill, priority, object-cover) of room-dusk.png inside a `SceneLayer` component with a documented slot for a future `<CinemagraphScene src/>`. No hardcoding the asset into the page.
  DONE WHEN: render fills viewport at 380px→5120px wide with sensible cropping (test object-position values).
- [ ] **B3 (M)** Screen calibration system: CSS vars `--screen-x/y/w/h` (percent-based) define the monitor's screen rect in the image; a dev-only `?calibrate=1` mode draws an outline so the rect can be dragged/tuned to match the render, values saved to the component.
  DONE WHEN: outline sits exactly on the rendered screen at multiple viewport widths.
- [ ] **B4 (L)** Mount the chat thread inside the calibrated screen rect: "august — direct line" header, user msgs amber-edged, august cyan-edged, mono timestamps, typing dots, auto-scroll, floating "Text august…" input bar. Specs + tokens: docs/august-build-directive.md.
  DONE WHEN: full chat loop works over the render with scripted replies.
- [ ] **B5 (M)** Energy relight over the photo: `--energy` var drives (a) cyan halo behind the screen rect, (b) full-scene radial overlay centered on the screen, mix-blend screen, 1.4s ease. Idle .15 → send 1 → decay 2.5s after reply.
  DONE WHEN: sending a message visibly brightens the *photograph*, then decays. This is the product — do not proceed until it feels right.
  → **DECISION GATE G2:** Milek approves the relight feel.
- [ ] **B6 (M)** Wire `/api/august/reply`: server-side Claude call (Haiku-class model), key from env, persona "august — terse, capable, calm, 1–2 sentences," 5 scripted fallbacks on error/no-key, Upstash rate limit (10 msgs/min/IP).
  DONE WHEN: real replies locally; fallbacks fire with key removed; 11th rapid message politely refused.
- [ ] **B7 (M)** Port the Ideas rail onto the page (262px right rail, stacks <760px): CRUD, status chips BUILDING/QUEUED/APPROVED, localStorage now with a `// TODO: Upstash` seam, seeded from the directive's six items.
  DONE WHEN: refresh-proof, add/cycle/delete all work on mobile width.
- [ ] **B8 (M)** Quality pass: reduced-motion kills glow transitions + typing anim; focus-visible outlines; no layout shift; image lazy/priority correct; Lighthouse perf ≥85 on the page.
  DONE WHEN: checklist above verified, results pasted in commit message.
- [ ] **B9 (S)** Merge `feature/character-page` → main, deploy, verify on prod from the phone.
  DONE WHEN: august-wiiz.vercel.app shows the photoreal page live.

## PHASE C — IA RESTRUCTURE: TWO SURFACES ONLY (Fable 5)

- [ ] **C1 (S)** Inventory routes: list every page/route dir in the app with one line on what it does. Post the list in BLOCKERS as an FYI (no stop).
- [ ] **C2 (M)** Retire feeds, globe, mail: remove nav entries, add permanent redirects → `/`. Keep the code in a `graveyard/` folder or dead branch — delete nothing yet.
  → **DECISION GATE G3:** Milek confirms retirement list before redirects go to prod.
- [ ] **C3 (M)** Unify nav to the two-surface top bar (AUGUST | INTEL segmented control, clock, ONLINE dot) per the directive, on both pages.
  DONE WHEN: only two reachable surfaces; toggle preserves chat state.
- [ ] **C4 (M)** Intel polish to directive spec: ticker tape, table density, conf bars, desk note, visible SIMULATED-FEED tag on any mock data.
  DONE WHEN: /intel matches the mockup's density; nothing mock is presented as live.
- [ ] **C5 (S)** Deploy. Prod now = the two-surface product.

## PHASE D — CINEMAGRAPH UPGRADE (Sonnet 4.6)

- [ ] **D1 (M) HUMAN** Generate a 6–10s seamless loop from the approved B1 still (Midjourney video / Runway image-to-video: "subtle ambient motion only — dust drift, window light shimmer, screen flicker; camera locked"). Export 1080p+ MP4/WebM.
  DONE WHEN: loop file in `public/scene/`, seam invisible.
- [ ] **D2 (M)** Build `<CinemagraphScene/>` into the SceneLayer slot: muted, autoplay, loop, playsinline, poster = the still, falls back to StillScene on reduced-motion or slow connections.
  DONE WHEN: motion on desktop, still on reduced-motion, no layout shift, calibration rect still aligned.
- [ ] **D3 (S)** Deploy behind a `?scene=video` flag first; flip default after Milek approves on the 57".

## PHASE E — ALERTS & DAILY LOOP (Sonnet 4.6)

- [ ] **E1 (M)** Web Push for intel signals: service worker + subscribe button on /intel; server route fires a push when a new signal row lands.
- [ ] **E2 (M)** Daily brief: a cron (Vercel) that has august post one morning message into the chat thread summarizing overnight signal changes.
  DONE WHEN: Milek wakes up to a message from august.

## PHASE F — REVENUE SEAM (Fable 5)
→ **DECISION GATE G4 first:** pricing, what's free vs paid, Stripe vs Lemon Squeezy. Milek decides; nothing builds before this.
- [ ] **F1 (L)** Auth + paywall on /intel (free: delayed signals; paid: live + push).
- [ ] **F2 (M)** Checkout + webhook + entitlement check. SIMULATED-FEED tag must be resolved (real data source) before anyone is charged.

## PHASE G — LONG GAME: LIVE 3D CHARACTER (Fable 5, months, no deadline)

- [ ] **G1 (M)** Research spike, output = a one-page `docs/3d-spike.md`: React Three Fiber vs Babylon for this stack; VRM avatar standard + Ready Player Me vs custom rig; animation triggering from chat events; perf budget on a 5080 at 7680×2160. Recommend a path. No code.
  → **DECISION GATE G5:** Milek picks the path.
- [ ] **G2 (L)** Empty 3D room matching the render's mood (camera locked, dusk lighting, bloom on screen). Ship behind `?scene=3d`.
- [ ] **G3 (L)** Character in the chair, idle animation loop.
- [ ] **G4 (L)** Reaction system: message send → typing animation; reply → look-at-camera + screen relight in-engine.
- [ ] **G5 (L)** Scene state hooks: intel events change the room (ticker on monitor, papers, lighting). This is the Companion-grade build.

## HUMAN BACKLOG (no Claude Code needed)
- [ ] DP 2.1 cable, 54 Gbps UHBR13.5 certified → unlock 240Hz on the Odyssey.
- [ ] Ollama or LM Studio on the 5080 (local models for free tinkering).

---

## DECISION GATES (Claude Code: STOP at these, ask in one sentence)
- **G1** approve bedroom render · **G2** approve relight feel · **G3** confirm page retirements · **G4** pricing/model for paid tier · **G5** 3D tech path

## BLOCKERS LOG (Claude Code appends; newest on top)
- **2026-07-23 · A3** Vercel CLI installed (v56.5.0) but not logged in — device-auth flow started, needs Milek to authorize in browser, then Claude continues `vercel link` + `env pull`. A1/A2 done this session.

## TROUBLESHOOTING APPENDIX (check here before flagging a blocker)
- **PowerShell blocks npm/npx scripts** → `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
- **Weird build errors after pulls** → delete `node_modules` + `.next`, `npm install`, retry.
- **Port 3000 busy** → `npx kill-port 3000` or `npm run dev -- -p 3001`.
- **`vercel env pull` empty/missing keys** → confirm `vercel link` picked the right project/team; re-run; check the Vercel dashboard env list.
- **Git line-ending noise on Windows** → `git config core.autocrlf true` once.
- **next/image huge render slow** → ensure PNG ≤4K, add `priority` on the scene image only, everything else lazy.
- **Render banding in dark gradients** → overlay 2% noise/grain layer via CSS.
- **API route works local, 500 on prod** → env var not set in Vercel dashboard for Production; add + redeploy.
- **Push notifications silent on iPhone** → PWA must be installed to home screen; Web Push on iOS requires it.
- **Claude Code seems lost** → it skipped step 1 of the protocol; tell it: "Re-read AUGUST_MASTER_PLAN.md from the top."
