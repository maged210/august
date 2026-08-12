# AUGUST — CORE V2 MASTER BUILD

> Working file for the CORE V2 build. Tick tasks as they complete. Branch: `feature/core-v2`.

## CONTEXT
Repo: maged210/august, local at C:\dev\august. Next.js 15 / React 19 / TypeScript / Vercel / Upstash Redis. The /intel Terminal Blotter is live. Notification hooks from Phase A are live — use them for all gate/blocker pings. IMPORTANT: local .env.local carries PREVIEW Upstash creds, not Production. Seed and test locally only. Never write test data to Production.

## MISSION
Strip August down to a single-page, two-surface app and add a trade-ideas backend with an approval pipeline. Aesthetics and usability are the point of this build — not feature count.

## OPERATING RULES
- Branch: feature/core-v2 off the default branch.
- FIRST ACTION: write this entire plan to MASTER_PLAN.md in the repo root with checkboxes. Tick tasks as you complete them.
- Execute ONE task at a time, in order. Commit per task with a short message.
- Only stop and notify at the gates below or on a genuine blocker/decision. Otherwise keep moving.
- Never touch Production env vars or data.

## NON-GOALS — DO NOT BUILD
No payments/subscriptions. No NinjaTrader integration. No character/bedroom page. No automated video sync. Park globe/feeds/mail code — hide it, don't delete it.

---

## P0 — SETUP
- [x] Create branch `feature/core-v2` off main.
- [x] Write this plan to MASTER_PLAN.md with checkboxes.

## P1 — SINGLE-PAGE IA
- [x] One surface at /. Default view: Chat. Top-bar menu toggles Chat ↔ Intel Terminal with no full route change (shallow routing via ?view=terminal is fine).
- [x] Trade Ideas rail visible in BOTH views: right sidebar on desktop, collapsible drawer on mobile.
- [x] Remove nav links to globe/feeds/mail; redirect those routes to /. Park the code — hide it, don't delete it.
  - Parked by un-import (house convention): Deck, WorldSurface/CommandGlobe, CommsSurface; globe tools (look_closer/close_map) retired from the model's tool surface.
  - /intel and /feed → redirect to /?view=terminal (the embed's owner/visitor split replaces the old server gates); legacy /globe //feeds //mail → / via next.config redirects.
  - Owner on a phone now gets the desk's MobileBoard inside the Terminal view (the standalone /intel escape hatch is gone) — verify polish at P6.

## P2 — MATRIX THEME
- [x] Dark base, green code-rain canvas background: low opacity, slow fall, capped FPS, single canvas, requestAnimationFrame, honors prefers-reduced-motion.
- [x] Content sits on translucent dark panels over the rain; text contrast stays AA-readable everywhere.
- [x] Build as a theme (CSS variables) so alternate themes can be added later.
  - Matrix = fourth data-theme value (default via one-time migration; cycle matrix→dark→light→batman). Token swap in globals.css + terminal re-pin in tokens.css; rain rides its own --rain-* tokens so moods can't tint it; orb gets a green LOOK rig.

### GATE G1 — notify Milek: preview of the themed shell, both views. WAIT for approval.
- [x] G1 approved 2026-08-05. *(dev preview at localhost:3000; adversarial review ran, 10 confirmed findings fixed pre-gate)*

## P3 — TRADE IDEAS BACKEND
- [x] Upstash Redis. Idea model: id, instrument, thesis, entry, target, riskLevel, status (draft | live | closed), source (manual | extracted), createdAt, updatedAt. *(lib/ideas — shared august:ideas:v1 namespace, validators + 13 tests)*
- [x] Public: GET /api/ideas returns live ideas only *(redacted — status/source never on the wire)*.
- [x] Admin: POST/PATCH /api/admin/ideas guarded by ADMIN_TOKEN (bearer). Add ADMIN_TOKEN to .env.local and flag it for the Vercel dashboard at G2. *(dual gate: bearer OR owner session; ADMIN_TOKEN generated locally — ADD TO VERCEL AT G2)*
- [x] Admin UI at /admin (token gate): create, edit, approve (draft→live), close. *(+ reject/relist; token tab-scoped in sessionStorage; unlinked + noindex)*
- [x] Public rail renders: instrument, thesis, entry, target, risk level, relative timestamp ("2h ago"). *(wired since P1 — the rail polls /api/ideas)*

## P4 — TRANSCRIPT → IDEAS PIPELINE
- [x] Admin paste box for NoteGPT transcripts (manual for now; build POST /api/admin/transcripts so a future webhook can hit the same endpoint). *(one endpoint, both callers; intake log in /admin)*
- [x] On submit, automatically: store raw transcript → call Claude (claude-sonnet-4-6) with a strict-JSON extraction prompt → write each candidate as a draft idea. No manual trigger. *(schema-forced emit_ideas tool; raw stored BEFORE extraction so failures never lose it; candidates pass the same validator as manual creates and can never publish)*
- [x] Draft queue in /admin: approve / edit / reject. Nothing goes public without approval. *(built at P3)*

### GATE G2 — notify Milek: run one real transcript end-to-end (paste → drafts → approve → visible on public rail). WAIT for approval.
- [x] G2 approved 2026-08-07. *(E2E ran 2026-08-07: transcript tr_974bc2ba → 3 drafts (NQ/NVDA/BTC) → NQ approved + live on /api/ideas redacted, BTC rejected, NVDA left in queue. REMINDER: add ADMIN_TOKEN to the Vercel dashboard before deploy.)*

## P5 — CHAT SURFACE
- [x] Clean Claude-style chat: input pinned bottom, streaming reply, message history in client state. *(ChatTranscript column in the chat view: full scrolling history, user bubbles / plain AUGUST turns, streaming caret + thinking dots, stick-to-bottom follow, + NEW CHAT reset; orb compacts above it. Overlay reply-dock is terminal-view-only now.)*
- [x] Wire to /api/august/chat on claude-sonnet-4-6 (drop to Haiku later if cost matters), minimal "August" system prompt, Upstash rate-limiting like the existing reply route. Verify ANTHROPIC_API_KEY is present. *(Satisfied by the existing /api/chat — already claude-sonnet-4-6, streaming, persona system prompt, Upstash-rate-limited (chat:10/min); no duplicate route built. ANTHROPIC_API_KEY verified present + live E2E: streamed reply, memory 37ms, cache write.)*

## P6 — POLISH
- [x] Blotter UX pass: clearer columns, larger type, sane mobile layout. *(Type comfort floor across the desktop board — headers 8→9.5px at higher contrast, thesis 9→10.5px, nothing under 8px; columns + gaps widened to carry it. Mobile card tree was already the sane layout — unchanged.)*
- [x] Loading/empty/error states everywhere. Meta/favicon. Quick Lighthouse sanity check. *(Rail/feed/brief/admin already carry honest loading/empty/error/stale states; meta+icons+OG existed. Lighthouse (prod, mobile-throttled): a11y 89→100 (pinch-zoom unblocked, 44px view tabs), best-practices 96, CLS 0; perf 62-64 — script eval is the WebGL orb boot, accepted for a live-canvas app.)*
- [x] Deploy a Vercel preview. *(feature/core-v2 pushed → august-wiiz preview: https://august-wiiz-git-feature-core-v2-maged210s-projects.vercel.app)*

### GATE G3 — notify Milek: preview URL for final review. DO NOT merge to main until approved.
- [x] G3 round-1 feedback (2026-08-07) — two revisions, both shipped: **fix 1** composer overlap (measured --dock-h clearance, glass-strong composer, visualViewport keyboard inset, send-jumps/read-holds autoscroll); **fix 2** public Terminal rebuilt as a dense mono blotter (10-col grid, inline expansion, LIVE calls pinned hot above the tracked pipeline, ET clock + counts chrome). Redeployed to the same preview URL.
- [x] G3 rounds 3+4 feedback (2026-08-07) — fill the screen; all shipped: **three-zone desk** (left chart dock ~30% / center blotter / right rail; tablet stacks, phone DOCK toggle); **chart dock modules** A idea chart (Lightweight Charts lib, daily bars off the existing Yahoo pipeline, ENTRY/TARGET/STOP lines + TRIG marker, row-click selection), B market pulse, C desk stats (since-called basis); **desk tape** (lib/tape + public/admin APIs + /admin quick-add & queue + extraction v2 emits tape callouts as drafts; module D flow-density rows, desk-sourced tag), **E bias bars**; grid texture in empty zones. Data rules held: zero new/paid sources — bars ride the same free Yahoo endpoint already in use; tape is desk/extraction-sourced with a clean seam for a licensed feed later. Options flow NOT built (out of round, module stack is its home). Redeployed to the same preview URL.
- [x] G3 round 5 (2026-08-07) — fill the center-bottom: 55/45 band under the blotter (IDEA DETAIL: selection-driven single detail surface, inline expansion removed, ?idea= shareable URL state; DESK WIRE: reverse-chron pipeline log off existing stores via redacted /api/wire). Zero dead zones at 1440p+.
- [x] G3 approved 2026-08-07 (round 5). Merged feature/core-v2 → main; production deploy follows the push. REMINDER: ADMIN_TOKEN must be present in Vercel Production env for the /admin bearer path; production Upstash starts with an empty ideas/tape board (preview seed data stays in preview).

---

# UX ROUND 1

> Branch: `feature/ux-1` off main. Small round, one gate, then merge. Started 2026-08-12.

## UX1 — COLLAPSIBLE TRADE IDEAS RAIL
- [x] Toggle in the rail header (and top bar) that collapses the rail like a tab: collapsed state = thin edge tab on the right showing "IDEAS · N LIVE" vertically; click to reopen. *(rail-header » control + the IDEAS view-tab now lives at every width: drawer <1100px, collapse ≥1100px; edge tab is a vertical writing-mode strip at mid-right)*
- [x] When collapsed, the center desk reflows to use the freed width. Smooth transition, no layout jank. *(--rail-w 276→30px; the offsets it feeds (view-panel/dock right, view-bar left) transition med; the rail slides on its own transform; reduced-motion = instant)*
- [x] Persist open/closed state locally so it survives refresh. *(localStorage "aug-rail"; layout.tsx applies data-rail="collapsed" PRE-PAINT like the theme so a stored collapse never flashes open)*

## UX2 — ENTRY + REASONING HIERARCHY
Reading order in every idea surface becomes: TICKER → ENTRY → REASONING → everything else.
- [x] ENTRY: high-contrast treatment — bright green chip/box, larger mono type. First thing the eye lands on after the ticker. *(rail: .ir-entry chip off --pos tokens, 14px mono; detail: .if-entry-hero off --rd-bull, 15px mono; empty entry stays an honest ∅ "not stated")*
- [x] REASONING (thesis): brighter text than surrounding metadata, left accent border so it reads as a distinct block. Metadata (target/stop/age/risk) stays visually secondary. *(thesis lifts one ramp step — --ash→--bone rail-side, t-body→t-chip desk-side — with a 2px green accent border; meta lines dropped BELOW the thesis)*
- [x] Apply consistently: rail card, idea detail panel, blotter selected-row detail. *(the blotter's selected-row detail IS the IdeaDetailPanel since G3 r5 — both its LIVE and TRACKED branches restructured)*

## UX3 — RAIL DENSITY MODE
- [x] Compact one-line collapsed card mode: TICKER · risk badge · entry one-liner. Tap to expand in place. *(the card head is the toggle at either density; entry one-liner keeps the UX2 green, ∅ "no entry" when absent)*
- [x] "Expand all / collapse all" in the rail header. *(one flip-all control that reads the current predominant state)*
- [x] Default: compact when more than 5 live ideas, expanded otherwise. *(per-card overrides ride on top of the count-driven default)*

## UX4 — SIDE (LONG/SHORT) FIX
- NOTE: the Idea model stored NO side field (blotter SIDE was purely derived from entry-vs-target numerals) — added `side?: long|short|watch` as an OPTIONAL field: existing rows parse unchanged, absent stays absent on the wire (no schema breakage).
- [x] Extraction: infer side from entry language (break above/clears/retest higher → long; break below/breakdown → short). Ambiguous → leave unset, never guess wrong. *(emit_extractions gains an optional side enum + a "OMIT when ambiguous — a wrong side is worse than no side" rule; not in required)*
- [x] Admin: one-click side setter (long / short / watch) on each idea, list and detail views. *(SideSetter chips on every card + inside the edit form; PATCHes immediately; clicking the active side clears it — side:null in the patch validator)*
- [x] Bias bars recompute from corrected sides. *(new sideOf() in dock/derive: stated side wins and renders SOLID in blotter + detail panel; the derived read remains the marked fallback; WATCH weighs nothing in bias)*
- [x] Tests: +5 (create/patch/redaction/extraction pass-through) — 226 pass.

## UX5 — MATRIX RAIN v2: QUIETER + TICKER GLYPHS
- [x] Rain barely perceptible: lower drop opacity, smaller glyphs, tighter columns, slower fall. Panel text contrast untouched. *(--rain-opacity 0.11→0.07 AND canvas alphas head 0.95→0.5 / trail 0.6→0.28; CELL 16→13; STEP 80→115ms; speeds 0.55–1.3→0.4–0.9 rows/step; panels carry their own backgrounds — untouched)*
- [x] Glyphs become stock symbols: live/tracked idea tickers + pulse symbols (SPY, QQQ, NQ, BTC, VIX) + small static filler; pool refreshes on data load. *(new lib/rain-symbols pub/sub pool — the rail's /api/ideas poll and the blotter's feed poll publish tickers they ALREADY fetch, zero extra network; each column spells symbols vertically with word gaps; pool refreshes in place, field never resets)*
- [x] Still one canvas, capped FPS, honors prefers-reduced-motion. No perf regression. *(same skeleton: one canvas, ~8.7 steps/s accumulator (down from 12.5), hidden-tab park, reduced-motion static ticker field; per-frame fillStyle count unchanged)*

## UX6 — CENTER THE MAIN (AUGUST CHAT) PAGE
- [x] Orb, transcript, composer in one centered max-width column (ChatGPT/Claude-style), centered relative to available space (accounting for the rail when open). *(one --chat-col token (720px) on the rail-aware main; the panel already excludes --rail-w, so the column re-centers as the rail opens/collapses)*
- [x] Bubbles, new-chat control, composer all align to this column. No left-drift. *(the drift causes: composer-row was 770px vs the 720px transcript; transcript widths used 92vw (viewport) instead of 92% (panel); the transcript scrollbar nudged its centered content left of the fixed composer — fixed with scrollbar-gutter: stable both-edges; idle ask bar joins the same column)*
- [x] Verify at ultrawide and mobile widths. *(headless-Chrome verified at 2560×1440 — column centered in the rail-aware space, both rail states — and 390×844)*

## UX RULES
- No new data sources, no schema breakage — side is an existing field, just populate it.
- Zero regressions to the desk layout shipped in Core V2.

### GATE UX-G1 — deploy Vercel preview; notify with screenshots: main page centered w/ quiet ticker rain, rail open, rail collapsed, one card w/ new hierarchy. HOLD for approval, then merge to main.
- [x] Preview deployed (Vercel status: success on 3bb01d9). NOTE: the branch preview URL now sits behind Vercel deployment protection (SSO) — open it signed into Vercel; the Vercel MCP couldn't mint a bypass link (404/403 flakiness again). Gate screenshots delivered via Artifact from the identical local prod build against the same preview-scope data (all 6 required states + mobile/ultrawide).
- [x] UX-G1 round-1 feedback (2026-08-12) — NOT approved; 8 revisions:

## UX ROUND 1 — REVISION ROUND 2
- [x] R1 RAIN: midway restored — --rain-opacity 0.07→0.09, canvas head 0.5→0.72 / trail 0.28→0.44 (v1 was 0.11/0.95/0.6); glyph size, column pitch, fall speed untouched.
- [x] R2 TRUE CENTERING: new .hl-main frame between top bar and the ticker strip — idle group (orb · heading · ask bar · chips · threads) centers in the leftover height; flex 1 0 auto = short viewports grow past the fold and scroll with comfortable padding, never clip. Orb's old 6vh top offset removed.
- [x] R3 RAIL DEFAULT: verified as already-built — nothing stored = OPEN; only an explicit toggle writes "collapsed"/"open" to localStorage.
- [x] R4 BRIEF: on-open auto-delivery REMOVED — load lands on the clean home state; the brief opens only from its own top-bar control. (Kept: tapping the brief PUSH notification still opens it — that arrival IS the user pressing the brief's button.)
- [x] R5 BOTTOM DEAD ZONE: WATCHING is now a thin full-width bottom strip (hairline top border, label left, static chips centered — no drift, reduced-motion safe by construction; absent entirely when no quotes resolve). The old two-column activity block keeps only RECENT THREADS, centered with the group.
- [x] R6 LIVE DASH WALL: LIVE section renders its own grid (--if-cols-live): TICKER · SIDE · STATUS · ENTRY minmax(170px,2fr) w/ hover-full · TARGET only-when-stated (blank, not dashed) · REASONING · AGE; per-section column heads; absent SIDE/ENTRY are the desk's quiet ∅, and %SC/SPARK/LAST/STOP simply don't exist there.
- [x] R7 DEAD RIGHT SPACE: both grids end in REASONING minmax(…,fr) + fixed AGE — the surplus right of AGE is spent on a muted one-line thesis preview (CSS ellipsis, click row for full). Blotter min-width 880→1000 (narrower spans keep the existing horizontal scroll).
- [x] R8 IDEA DETAIL POLISH: ENTRY hero chip is the single entry source (STATED LEVELS = TARGET + STOP, both branches); empty PERFORMANCE / STATUS collapse to one compact muted QuietLine each (LIVE always, TRACKED when empty); section spacing tightened 14→10.

### GATE UX-G1 (round 2) — redeploy preview; screenshots: main page (vertically centered, rain quiet-but-visible, rail open) + terminal (LIVE columns, full-width layout, polished detail). HOLD, then merge.
- [x] Round 2 redeployed (Vercel status: success on 9e9dcb1); evidence artifact updated with the three required screenshots. Holding.
- [x] UX-G1 round-2 feedback (2026-08-12) — final revision, then merge:

## UX ROUND 1 — REVISION ROUND 3
- [x] R1-REDO RAIN INTENSITY DIAL: OFF / FAINT / VISIBLE / LOUD presets, each = layer opacity + canvas head/trail alphas tuned together. VISIBLE (default) = 80% of the original pre-ux-1 values (0.09 · 0.76 · 0.48 vs 0.11 · 0.95 · 0.6); FAINT = round-2's quiet pass; LOUD = the original ceiling (panels carry their own backgrounds — text contrast untouched); OFF unmounts the canvas. Control = rain-glyph button beside the theme toggle (matrix only) opening a 4-option menu; persisted as aug-rain-level; applies LIVE through a ref the draw loop reads — no teardown, no field reset, no reload; reduced-motion static field re-inks at the new level. Ticker glyphs / column pitch / fall speed untouched.

### GATE UX-G1 (round 3) — screenshots at all four presets. On approval: merge feature/ux-1 to main.
- [x] UX-G1 approved 2026-08-12 (round 3, via the UX ROUND 2 kickoff: "branch feature/ux-2 off main AFTER ux-1 merges"). Merging feature/ux-1 → main; production deploy follows the push.

---

# UX ROUND 2

> Branch: `feature/ux-2` off main (post ux-1 merge 6dde9a0). One gate at the end. Started 2026-08-12.
> Visual reference: Finviz homepage density, translated to OUR data. HARD RULE: zero new paid data sources — everything runs on existing stores + the existing price pipeline; the single exception is headlines via free public RSS (RSS only, no scraping).

## UX2-T1 — CHAT IA: LEFT THREADS SIDEBAR (Claude-style)
- [x] Recent threads move to a collapsible LEFT sidebar on the chat view: + NEW CHAT at top, thread list (title · age), active thread highlighted. *(new ThreadsSidebar off GET /api/threads?limit=30, 60s poll + post-exchange refresh; activeThreadId now real page state so the highlight tracks open/new/forget/save)*
- [x] Collapses to a thin edge tab; state persists locally. Mobile: slide-over drawer. *(vertical THREADS tab mid-left; aug-threads + data-threads pre-paint, the rail's exact contract; drawer trigger = a lines glyph by the wordmark, mobile only; Esc stack: voice → threads drawer → rail drawer → panel)*
- [x] Main chat column stays centered in the space between sidebar and rail at every open/closed combination. *(--sb-w joins --rail-w: view panels/dock get left+right offsets, the view bar centers on (--sb-w − --rail-w)/2 — terminal view drops .has-threads and reclaims the width)*

## UX2-T2 — DAILY BRIEF = HOME CENTER
- [x] The brief stops existing as a popup entirely; it renders AS the home state of the chat view (no thread open). *(MorningBrief popup + its top-bar control + suggestion chips + the old heading parked; new HomeBrief component owns the idle center under the ask bar; ?brief=1 push arrivals just land home; "brief me" by voice still plays the compiled read when one is waiting)*
- [x] Date + session line (pre-market / open / after-hours by ET clock). *(4:00–9:30 PRE-MARKET · 9:30–16:00 MARKET OPEN w/ live dot · 16:00–20:00 AFTER HOURS · else/weekend CLOSED)*
- [x] PULSE ROW: existing pulse symbols, last · % · spark. *(the dock's pulse five off /api/intel/quotes closes)*
- [x] DESK LINE: N live · N tracked · N triggered · win rate · best + worst today. *(+ avg MFE/MAE per T3; win rate = since_called only, DeskStats semantics; today = tracked quotes' chgPct extremes)*
- [x] LATEST INGEST: most recent transcript → "N idea drafts · N tape drafts" + time. *(/api/wire first row; honest ∅ when nothing ingested)*
- [x] HEADLINES: top 5 from 2–3 quality free RSS feeds, server-cached ~15 min, publisher + timestamp, links out. RSS only — no scraping. *(new lib/headlines: CNBC Top News + MarketWatch Top Stories (Dow Jones public feed) + Yahoo Finance; tolerant no-dependency RSS parse, per-feed failure isolation, in-process 15-min cache that never caches a blackout; /api/headlines rate-limited + CDN 5-min; +3 tests → 229)*
- [x] Opening a thread replaces the brief with the conversation; returning home shows the brief again. *(rides the existing conversationActive split — a thread open = transcript, + NEW CHAT = home/brief)*

## UX2-T3 — KILL BIAS + STATS PANELS
- [x] Remove Desk Bias and Desk Stats from the terminal (park, don't delete). Long/short counts → heatmap header; win rate / MFE / MAE → the brief's DESK LINE. No orphaned data, no empty slots. *(BiasBarsModule + DeskStatsModule parked by un-import; the dock stack is chart → heatmap(+movers) → pulse → tape)*

## UX2-T4 — DESK HEATMAP (takes the freed dock slot)
- [x] Finviz-style treemap of OUR book: one tile per live + tracked idea, equal sizing, color = today's % move (green/red intensity), label = ticker + %. *(equal weights → a filled CSS grid IS the squarified layout; hand-rolled, zero deps; intensity = |%|-scaled alpha capped for label contrast; tracked rows use their existing quote, live instruments ride ONE /api/intel/quotes call via chartSymbolFor; no quote = honest ∅ tile)*
- [x] Tile click = selects the idea (drives chart dock + detail panel, same selection state). *(selectionFromLive/Tracked moved to dock/derive so tiles and blotter rows build byte-identical selections; applySelect keeps ?idea= shareable; selected tile carries the desk's sel ring)*
- [x] Header: "BOOK — n LONG · n SHORT · n unset". Hand-rolled layout, no heavy new dependencies. *(counts from stated/derived sides for LIVE + direction for TRACKED)*

## UX2-T5 — MOVERS STRIP
- [x] Compact strip under the heatmap: top 3 and bottom 3 today across the book — ticker · last · % today. Existing price data only. *(deduped per ticker, non-overlapping when the book is small)*

## UX2-T6 — WIRE v2 (fix, don't delete)
- [x] Collapse batch events: "11 ideas → LIVE · 15:11" renders as ONE expandable row. *(buildWire folds same-minute LIVE approvals into a batch event; the row's caret expands to member ticker chips inline)*
- [x] Individual rows only for distinct events: TRIGGERED @ price · transcript ingested (→ counts) · tape posted · status change. *(single-idea approvals stay individual too)*
- [x] Cap visible rows (~10), digest tone, expand for history. *(10 visible + SHOW ALL · N toggle; buildWire returns the full history now, display owns the cap)*

## UX2 NON-GOALS
No market-wide breadth, screener tables, insider tables, or economic calendar (licensed feeds — behind the revenue gate with options flow).

### GATE UX2-G1 — deploy preview; screenshots: home brief, sidebar open + collapsed, terminal with heatmap + movers + wire v2. HOLD for approval, then merge to main.
- [x] Preview deployed (Vercel status: success on 1edc201, still behind deployment protection — open signed into Vercel); evidence artifact posted with the three required screenshots. 229/229 tests. Holding.
- [x] UX2-G1 approved 2026-08-12. Merged feature/ux-2 → main; production deploy follows the push.

---

## BLOCKERS LOG (newest on top)
- **2026-08-05 — local secrets are masked.** Every secret in `.env.local` (ANTHROPIC_API_KEY, UPSTASH_REDIS_REST_URL/TOKEN, DEEPGRAM, FRED) is a literal `"[SENSITIVE]"` placeholder: they are Sensitive-type in Vercel, and `vercel env pull` can never decrypt those (re-verified against both development and preview scopes). Local Upstash/chat has therefore been non-functional since Phase A — the rate limiter fails open, stores no-op. **Not blocking the build**; BLOCKS the G2 live end-to-end run and local chat testing. Fix (Milek): paste the real values into `C:\dev\august\.env.local` from the Upstash/Anthropic dashboards, or unmark them Sensitive in Vercel and say "re-pull env". Milek pinged via hook.

## NOTES
- ADMIN_TOKEN must be added to the Vercel dashboard (Production + Preview) before G2 sign-off — flag at G2.
- Local .env.local = PREVIEW Upstash. Never seed or test against Production.
