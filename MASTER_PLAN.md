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
- [x] UX2-G1 approved 2026-08-12 (round 1). Merged feature/ux-2 → main (dd0bfe2); production deployed.
- [x] UX2-G1 round-2 feedback (2026-08-12) — fix round F1–F9 (NOTE: round 1 was already merged on the earlier explicit approval; this round ships on feature/ux-2 and holds before a second merge):

## UX ROUND 2 — FIX ROUND (F1–F9)
- [x] F1 EMPTY VALUES: every inline ∅ on the new/public surfaces → dim middot or true blank (blotter cells ·, labeled absents lose the glyph, heatmap ∅ tile → ·). The owner-only IntelDashboard keeps its legacy rd-* treatment (predates these rounds — flag if it should follow).
- [x] F2 COLUMN ECONOMY: REASONING is the only fr track (absorbs ALL surplus); TARGET/STOP/ENTRY are minmax(min, auto) so empties collapse to minimum; LIVE ENTRY wraps to two lines (space-breaks only, hover full — never mid-number ellipsis, max 34ch so it can't eat REASONING); blotter min-width 1000→940. Verified rail-open + rail-collapsed.
- [x] F3 BUG: the ° was the since-first-mention marker (perfOf + detail panel) — removed everywhere; the kind now rides the hover title / basis line in words.
- [x] F4 HEATMAP COLOR: alpha = 0.08 + |%|·0.068 (±1% ≈ 0.15 faint · ±5% ≈ 0.42 clear · ±10% ≈ 0.76 hot, capped for label contrast); tiles sorted by % desc, quote-less tail last; header counts unchanged.
- [x] F5 WIRE TAPE ROWS: tape text clamps to one line; clicking unfolds that row in place (flex-basis 100% expansion, never across the grid).
- [x] F6 PIPELINE RULE + DEMOTE: applyEntryRule (pure, enforced in code AND prompted) demotes entry-less idea candidates to tape-note drafts (side→sentiment); /admin gets DEMOTE → TAPE on every card (thesis → note, live→live/draft→draft, idea closed) + an inline ENTRY editor on live cards (Enter/SET applies); side setter already inline. +2 tests → 231.
- [x] F7 RAIN DIAL PLACEMENT: the separate rain button is gone — the moon button opens ONE theme menu (THEME radio w/ glyphs + TICKER RAIN presets, matrix only), glass-styled to theme. LOUD raised to ~2× the v1 ceiling AND a real bug fixed: columns seeded only above the viewport, leaving tall (4K) screens rain-less for ~30s — heads now seed throughout the field with pre-run trails. 4K LOUD screenshot at the gate.
- [x] F8 HOME RHYTHM: idle orb scaled 0.7 (reclaimed height pulled up), ask bar/brief margins tightened, .hl-main no longer grows — the WATCHING strip rides directly under the content, so no dead band can open above it (the stage + rain own the space below). threadTitle skips greeting-only openers for the first substantive line ("hi" can't title a real exchange).
- [x] F9 IDEAS TAB: it was never a view — it toggled the rail (drawer on mobile, collapse on desktop). The desktop behavior duplicated the rail-header » and the edge tab, so it's now hidden ≥1100px and remains ONLY as the mobile drawer trigger.

### GATE UX2-G1 (round 2) — preview + screenshots (terminal both rail states, home, one LOUD 4K rain shot). HOLD, then merge feature/ux-2 → main.
- [x] UX2-G1 fix round approved 2026-08-12. Merged feature/ux-2 → main; production deploy follows the push. UX ROUND 2 closed out.

---

# HOTFIX — CHAT PRIVACY (2026-08-12, priority over ux-2 gate queue)

> Branch: `hotfix/chat-privacy` off main. AUDIT FINDING (verified live in production): threads/messages live in Upstash via /api/threads (localStorage holds only UI prefs). Auth is UNCONFIGURED in Vercel Production, so `requireSessionEmail()` resolved null and every personal chat store fell back to the LEGACY SHARED keys — any anonymous visitor could list the owner's threads, read full message bodies by id, OVERWRITE them via upsert, share one global chat memory (and wipe it via /forget), and read the owner's personal morning brief. Chat rate limit was per-IP 10/min with NO daily cap.

- [x] Per-visitor isolation: anonymous traffic now resolves a `visitor:{vid}` principal from an httpOnly `aug_vid` cookie (SameSite=Lax, Secure in prod, 1y). Decision table (pure, tested): session → user:{email}; anonymous dev+unconfigured → legacy (single-user fallback unchanged); anonymous PRODUCTION → visitor scope, NEVER legacy; configured+signed-out → visitor (defense-in-depth). threads + memory stores widened to the principal; /api/chat's memory context and /forget are caller-scoped; watcher tools refuse anonymous principals (no per-visitor watcher store exists).
- [x] Owner's Jul–Aug history: DELETED NOTHING — the legacy namespace is simply no longer reachable anonymously; it serves only through new ADMIN-gated GET /api/admin/threads(/[id]) (Bearer ADMIN_TOKEN today; owner session once auth is configured — first owner login also migrates the history into user:{owner} via the existing copyThreads).
- [x] Chat spend: per-visitor per-minute cap now env-tunable (CHAT_RATE_PER_MIN, default 10/min/IP) + NEW global daily cap across all visitors (CHAT_DAILY_CAP, default 400/day, UTC bucket, fail-open on Redis error like the house limiter). 429 with an honest budget message.
- [x] Adjacent leak closed in the same class: /api/brief GET/POST fail closed in unconfigured production (the owner's calendar+inbox brief was public).
- [x] Verified (local prod build = the exact production auth state): visitor A sees only its thread; visitor B and a clean browser profile see []; B reading A's id → 404; anonymous reading the owner's legacy id → 404 (was 200 + full messages in production); ADMIN_TOKEN → legacy history 200; tokenless admin → 403; CHAT_DAILY_CAP=2 → third chat POST 429; /api/brief anonymous → ready:false. Tests 234/234 (+3 for the principal table + key scoping).
- [x] Deployed to production; verified live post-deploy.
- NOTE (owner actions): configure AUTH_SECRET + Google client in Vercel Production to enable the owner session (until then the history is ADMIN_TOKEN-only); ensure ADMIN_TOKEN is present in Production env. /api/speak + /api/deepgram-token remain open in unconfigured production (quota spend, own per-IP limits) — same class, flag for the next round.

---

# ADMIN-1 — MORNING CONTROL ROOM

> Branch: `feature/admin-1` off main (post ux-2 + chat-privacy hotfix, 515c8bc). Runs BEFORE AUTH-1. One gate. Started 2026-08-12.
> DRIVING METRIC: transcript paste → reviewed → approved → clean public board in under 2 minutes on desktop, fully doable from a phone.

## AD-A — LAYOUT + LOOK
- [x] Admin adopts the terminal design language: hairline panels, tiny mono headers, chips, tabular rows — the desk's backstage. *(adm-panel/adm-panel-h module shells over the app tokens)*
- [x] Desktop: two columns — LEFT intake + create; RIGHT draft queue · live book manager · tape queues. Mobile: stacked, 44px buttons, sticky status strip. *(5fr/7fr grid ≥1100px)*
- [x] Header becomes a status strip: LIVE n · TRACKED n · DRAFTS n · TAPE n · last ingest age. *(tracked count off the public feed; counts hidden while locked)*

## AD-B — LIVE BOOK MANAGER (the core of this round)
- [x] Full table of every idea across statuses: inline edit side · entry · target · stop · risk (Enter/SET applies). Status actions: close · invalidate · re-arm. DEMOTE TO TAPE. Delete with confirm. *(model grew stop + "invalidated" + hard DELETE /api/admin/ideas/[id]; status-tinted left rails)*
- [x] STALE surfacing: live ideas past a configurable age (STALE AFTER n D control, persisted, default 5) get an amber STALE chip and float to the top with REFRESH (age reset) / CLOSE. 
## AD-C — DRAFT REVIEW v2
- [x] Draft cards editable inline before approval (side/entry/target/stop/risk/thesis) — the edits ride the approving PATCH. APPROVE / REJECT per card + APPROVE ALL / REJECT ALL (batch runs the unedited per-card logic).
- [x] DEDUPE/ATTACH: a draft matching a LIVE ticker renders the amber "UPDATE to <ticker>" chip — approving PATCHes the existing idea (levels updated, thesis archived into new thesisHistory, age reset) and consumes the draft. Unmatched tickers create new ideas.
- [x] Side auto-suggested from entry language (suggestSide — the F6 rule, pure + tested): rendered as a dashed "LONG?" chip, editable; the suggestion applies on approve unless overridden.

## AD-D — INTAKE POLISH
- [x] Transcript box: drag-drop .txt (name → source label), live character count, auto-title from source label or the first transcript line.
- [x] Ingest log rows expand to exactly what each transcript produced — idea/tape chips with live status labels that scroll to the record (honest "deleted/removed" when gone).

## AD-E — TAPE MANAGEMENT
- [x] REMOVE on live tape gets a 6s undo window (the delete only fires after the grace; UNDO cancels). Draft rejects stay immediate — they were never public.
- [x] Quick-add infers sentiment from the note text (buy/call/long → bull, sell/put/short → bear, both/neither → leave) as an editable default that stops auto-updating once the select is touched.

### GATE AD-G1 — preview + screenshots: desktop two-column, phone view, a draft showing "UPDATE to <ticker>", book manager with a STALE row. Approve → merge → AUTH-1 begins.
- [x] AD-G1 approved 2026-08-13. Merged feature/admin-1 → main; production deploy follows the push. AUTH-1 is next.

---

# MOBILE-1 — MOBILE IS A REDESIGN, NOT A SHRINK

> Branch: `feature/mobile-1` off main (post admin-1, 0208fa5). Runs BEFORE AUTH-1. One gate. Started 2026-08-13.
> PRINCIPLE: below the phone breakpoint (≤700px, the codebase's md), every surface gets a layout DESIGNED for a phone. Nothing horizontal-scrolls, nothing overlaps, nothing renders desktop-sized.

## M1 — NAVIGATION
- [x] Fixed BOTTOM tab bar (AUGUST · TERMINAL · IDEAS) replaces the floating center toggle ≤700px; active tab underlined; the composer dock and surfaces clear it (max(kb-inset, tabbar) keeps it under the keyboard). F9 ruling argued: IDEAS stays — it is the book-at-a-glance from inside a conversation, the compact/expand rail cards don't duplicate the terminal's full cards, and the sheet is gate-required.
- [x] Header = menu (threads) · wordmark · status/clock; the bell/sound/settings/session cluster folds into the moon menu as a phone-only CONTROLS section. Safe-area top respected.

## M2 — TERMINAL, PHONE LAYOUT
- [x] The blotter tree does not render at ≤700px (conditional render, not CSS hiding — no double-mounted charts): LIVE + TRACKED are stacked cards (ticker · side · status chip · entry chip · one-line reasoning · age; TRACKED adds % since call + last).
- [x] TAP → full-screen IDEA DETAIL sheet: CHART 38dvh (same Lightweight Charts module, ENTRY/TARGET/STOP lines + TRIG mark, touch-action pan) → ENTRY chip · side · risk/status · age → full thesis → compact facts + history rendering only what exists. Opaque literal background (a token cascade made it transparent once — fixed), page tree visibility-hidden underneath, fixed × in the safe area, Esc closes.
- [x] Modules = segmented strip (CHART · BOOK · PULSE · TAPE · WIRE), one mounted at a time; the heatmap reflows to a 58px-min phone grid; movers ride the BOOK segment.
- [x] LIVE/status chips + side glyphs + wordmark scale down ≤700px.

## M3 — SHEETS
- [x] Threads + rail are full-height sheets <1100px: dim scrim (touch-action none), page scroll locked (html.sheet-open), slide-in (reduced-motion instant), close via × / scrim / 70px swipe-away; width min(360px, 92vw) + shadow — nothing readable behind.

## M4 — HOME
- [x] Pulse tiles: 2-per-row grid ≤700px (sparks yield — the % tells the story; tiles were clipping the viewport edge with them).
- [x] Brief keeps its order; WATCHING pinned as a fixed strip above the tab bar (glass, safe-area aware, horizontal scroll, label dropped); content padding clears it.

## M5 — CLUTTER + CENTERING PASS
- [x] Audit: view-bar (gone ≤700), MorningBrief popup (gone since ux-2), edge tabs (desktop-only), dock composer (offset above tab bar), reply-dock (terminal/desktop only). Remaining overlays = sheets w/ scrims, the tab bar, fixed ×, pinned WATCHING strip — all sanctioned. (The "purple slider" died in ux-2 F7; re-verified the dial lives in the moon menu.)
- [x] Column axis: --chat-col governs orb/composer/brief; cards/segments share the terminal gutter; tab bar contents centered.

## M6 — HYGIENE
- [x] 100dvh main + dvh sheet/chart heights; no horizontal scroll (entry chips wrap, reasoning clamps, heatmap reflows); ≥44px touch targets (tabs, segments, cards, menu rows, ×); reduced-motion on sheet/segment animation. iPhone-Safari specifics: safe-area insets everywhere fixed elements touch edges, -webkit-backdrop-filter, touch-action pan on the chart.

### GATE MB-G1 — preview + iPhone-width shots of ALL: home, sidebar sheet, rail sheet (compact + expanded), terminal cards, heatmap segment, idea detail sheet w/ chart + entry/target lines. HOLD, then merge.
- [x] MB-G1 approved 2026-08-13 (verification pass ran first: held state, commits, preview URL, and the three per-view behaviors confirmed from the built code — then "MERGE IT"). Merged feature/mobile-1 → main; production deploy follows. AUTH-1 is next.

---

# GAME-2 — THE PIT, ARCADE REWRITE

> Branch: `feature/game-2` off main (7d386db). GAME-1 was NEVER merged — carry its identity/leaderboard/simulated pieces over from `feature/game-1` by hand; the ride/fade + daily pick modes are DEAD, do not port them. One gate: a playable build — the bar is the reviewer playing three runs back-to-back unprompted. Started 2026-08-13.
> NORTH STAR: moment-to-moment fun. One session = one trading day (60–90s). Instantly replayable.

## GA-A — CARRY-OVER (from feature/game-1, unchanged semantics)
- [x] lib/pit identity + leaderboard (pids `v:{vid}`/`u:{email}` for AUTH-1 claims), nickname + validatePitName filter, /api/admin/pit purge route, "pit" rate-limit key, PIT tab/view (bottom tab mobile + desktop toggle, ?view=pit, resolveView "pit"), permanent styled SIMULATED label.
- [x] Boards: TODAY'S TAPE (best run on today's seed) + ALL-TIME BEST RUN. Player record gains { bestRun, bestRunDate, todayRun, todayDate }.

## GA-B — CORE LOOP (v1 scope, this and nothing more)
- [x] Full-screen canvas, Matrix green: perspective grid floor, glowing price line, price chip at the head, entry-line marker while holding, target bar filling across the top, cash counter animating every tick.
- [x] THE TAPE: 60–90s generated day, seeded DAILY by ET date (mulberry32(seed) — one tape a day, identical for everyone). Quotes pipeline is DAILY closes (no intraday) → SHIP SYNTHETIC per the spec ("fun beats purity"): drift segments + spikes + dumps + fakeouts + one clean dip-and-rip arc, fictional ticker name from the seed.
- [x] CONTROLS: BUY (all-in) / SELL (flatten). One position, no sizing. Huge bottom thumb buttons + keyboard space/B/S on desktop.
- [x] RULES: start 10,000 fictional cash; TARGET +15% equity by the bell; MARGIN CALL ends the run if equity < 40% of start.
- [x] JUICE (non-negotiable): PERFECT DIP combo multiplier (entry within 1.5% of the rolling local low / exit near local high — combo multiplies the fill's P&L pop), green screen-glow on up-ticks while holding, red pulse on drawdown (reduced-motion: static tint, no pulse/shake), last-10s closing-bell tension (clock pulses, grid speeds), P&L pop on every fill.
- [x] EVENTS: 2–3 per day from the daily seed, clearly fictional, banner-based, silent ("FLASH CRASH", "SQUEEZE — ×2 WINDOW" doubling gains inside the window).
- [x] END SCREEN: BEAT THE BELL / MISSED THE TARGET / MARGIN CALLED, run stats (trades, win rate, best trade, perfect dips), a NOT-REAL-WINNINGS line with personality, nickname save to boards, RUN IT BACK as the biggest element.

## GA-C — TECH RAILS
- [x] One canvas, rAF, 60fps on a mid-range phone, battery-sane (pause on tab blur/visibilitychange), no network mid-run except the end-of-run score submit (POST /api/pit {action:"run", score, stats} — server clamps/validates).

## V2 — DO NOT BUILD: districts/seasons/meta, sound beyond one off-default toggle, multiple tickers, desk-call integration, share cards.

### GATE GA-G1 — playable preview; three unprompted back-to-back runs is the bar. HOLD.
- [ ] GA-G1 approved.

---

# GAME-3 — THE PIT: CAREER LOOP

> Evolving `feature/game-2` IN PLACE (unmerged, per spec). One gate: playable — the bar is finishing R1 and starting R2 unprompted, then finishing the run. Started 2026-08-13.
> NORTH STAR: finish Round 1 and immediately want Round 2. Terminal × strategy × arcade progression × financial education. NOT a casino.
> V1 SCOPE: ROUND → STOCK SELECTION → MOVEMENT → CATALYST → LONG/SHORT → P&L → SCORE → XP → NEXT ROUND. Nothing else ships.

## GP1 — ROUND ENGINE
- [x] State machine: ROUND BRIEF → LIVE TRADING → BELL → ROUND COMPLETE → NEXT. Run = one career attempt; margin call at 40% of round start ends the run.
- [x] Ladder: R1 OPENING BELL ($10K, 4 stocks, LONG only, 90s, gentle) · R2 MOMENTUM (faster tape, SHORT unlocks, first catalysts) · R3 EARNINGS (one binary catalyst/stock, before/after decision, 2 positions unlock) · R4 THE CRASH (selloff regime, correlated, 45s) · R5 BOSS (simultaneous catalysts, 120s, brutal).
- [x] Controls: per-stock LONG / SHORT / FLATTEN (+WAIT = do nothing). Position model supports N, level/round-gated (1 in R1–R2, 2 from R3).

## GP2 — STOCK UNIVERSE
- [x] Categorized pools w/ per-category vol/drift personality (Mega Cap, Tech/AI, Semis, Banks, Energy, Consumer, Healthcare, Crypto-adj, High-Vol). Round draws 4–6 from theme-appropriate mixes, seeded per round+runSeed so lineups rotate.
- [x] Real tickers, simulated tapes with the category's texture. SIM chip everywhere.

## GP3 — MISSIONS
- [x] One per round: BEAT THE MARKET (vs SPY sim line) · MOMENTUM HUNTER (profit on the day's fastest riser) · SHORT SELLER (profit on a short) · LOW RISK (finish ≥ start w/ max DD < 5%) · SURVIVOR (never breach 20% DD). Shown in the brief, tracked live, scored at the bell.

## GP4 — EVENTS/CATALYSTS
- [x] 2–3/round max; ALWAYS a clue first (ticker flicker + volume swell + countdown banner). Archetype headlines only w/ SIM chip ("EARNINGS BEAT", "ANALYST DOWNGRADE", "SQUEEZE — ×2 WINDOW") — never a factual claim about the real company; no real names in event copy.

## GP5 — SCORE + XP + LEVELS
- [x] PIT SCORE (deterministic, breakdown shown): pnlPts + missionBonus + timingPts (entry/exit vs local extremes) + drawdownPenalty + accuracyPts.
- [x] XP → levels: L1 ROOKIE → L2 SCOUT (bigger universe) → L3 MOMENTUM (high-vol pool) → L4 VOLATILITY (2 positions anywhere) → L5+ reserved (options). Level/XP persist on the visitor pid (AUTH-1 claimable).

## GP6 — FEEDBACK + TRANSITIONS
- [x] Live: P&L pops, GOOD ENTRY / CATALYST CAPTURED / POSITION STOPPED moments.
- [x] ROUND COMPLETE is the reward: $10,000 → $12,480 · +24.8% · SPY +1.2% · OUTPERFORMED MARKET · SCORE breakdown · +XP bar filling · NEXT ROUND → dominant.

## VISUAL LAW: near-black, deep green, terminal type, thin borders, density, subtle grid, glow accents, amber/red warnings. Motion + tension + hierarchy. Never casino.

## ARCHITECTED NOW, BUILT LATER (types/stubs only in lib/pit-stubs.ts): options card iface, Terminal-idea→PIT challenge schema, game-modes registry (CAREER ships), boards + BEST ROUND + streak fields.

## CARRY-OVER unchanged: anonymous identity/nickname/purge · SIMULATED label · reduced-motion · one canvas 60fps · pause on blur · no network mid-round (state GET on entry, POST per round complete).

# GAME-3 TUNING ROUND — MOVEMENT, PACING, CALENDAR (2026-08-14)

> Same gate, still blocked. Movement and pacing are wrong; progression gets reskinned. Branch: feature/game-2 in place.

## T1 — TAPE ENGINE v2 (the core fix)
- [x] Regime-based generator (drift + noise + mean-reversion + impulse segments) replacing the monotonic random walk.
- [x] HARD constraints: max consecutive same-direction ticks; every impulse followed by a 30–60% partial retrace.
- [x] Minimum direction changes per day; every stock gets ≥1 meaningful drawdown AND ≥1 meaningful rally regardless of bias.
- [x] Per-stock drift caps — no guaranteed hold-to-win.
- [x] CRASH DAY: downward regime punctuated by violent bear-market rallies — the bounces are the trap.
- [x] Fakeouts first-class: breaks that reverse, dips that keep dipping.
- [x] Daily seeding stays deterministic.

## T2 — PACING PASS
- [x] Speed is per-day config (Opening Bell calm → Boss fast); dips/spikes humanly reactable (~300–500ms windows minimum).

## T3 — OWNER TUNING OVERLAY
- [x] ?tune=1 (dev/localhost or admin-token tab only): live sliders — tick rate, volatility, drift strength, retrace frequency, event intensity — applied to the running tape in real time; current values copyable. Found values ship as day configs.

## T4 — PROGRESSION RESKIN: LEVELS → CALENDAR
- [x] Rounds → DAYS ("DAY 1 — OPENING BELL" … day 5 = "FRIDAY — OPEX"); five days clear the WEEK.
- [x] Tiers → WEEKS with real unlocks + old trader titles as subtitles; all copy: briefs, "DAY n COMPLETE", WEEK bar with XP under it.

## T5 — TAPE FAIRNESS AUTO-CHECK
- [x] In the test suite: blind buy-and-hold and blind short-and-hold across 100 seeded days must fail every day's mission; a blind win fails the build. Bell settlement no longer counts as trading (no mission flags / trades / wins from forced liquidation).

## T6 — QUIRKS (juice only)
- [x] AUGUST ON THE FLOOR: dry one-liners on play events + day-complete roast/praise, per-event cooldowns.
- [x] STAMPS: PAPER HANDS / DIAMOND HANDS full-screen moments, reduced-motion safe.
- [x] DAY REPLAY: compact full-day tape strip on DAY COMPLETE with entries/exits marked.
- [x] MARKET WEATHER: one truthful telegraph line per day brief wired to the actual regime.
- [x] RISK DESK: sub-55% red edge pulse intensifying toward the 40% margin call + "RISK DESK CALLING…"; reduced-motion static tint.

## T7 — V2 SHELF (recorded, not built)
Rival ghost (August trades the same tape beside you — future flagship) · achievements/titles · share cards from the day replay.

### GATE GC-G1 (unchanged bar + one addition) — reviewer finishes a full week unprompted; report the quit day. Owner plays with ?tune=1; his slider values ship as final configs. HOLD.

---

### GATE GC-G1 — playable preview; bar: finish R1 → start R2 unprompted → finish the run. Report the quit round. HOLD.
- [x] GC-G1 fix round 1 (2026-08-13) — **OPEN THE MARKET mounted nothing.** Confirmed root cause: NOT the /api/auth/session 501 (HomeLanding catches it; the PIT never touches auth). The live scene was gated on `gameRef.current`, which was only assigned inside the live effect, which bailed silently when the canvas (inside that same gate) wasn't mounted — a render/effect deadlock, first click dead forever. Fixes: (1) pure round engine extracted to lib/pit-engine.ts; the RoundRun is created SYNCHRONOUSLY in the OPEN THE MARKET click before the phase flips — the scene can never render against a missing game; (2) the live effect now THROWS on a missing canvas instead of returning, and PitBoundary (error boundary) renders a styled PIT ERROR — RELOAD state; silent dead buttons structurally impossible; (3) /api/auth/session unconfigured → 200 null (valid no-session), other auth endpoints 404 — no 5xx on production paths; (4) lib/sound.ts never creates an AudioContext before the first user gesture (navigator.userActivation guard) — kills the autoplay warning; (5) tests/pit-engine.test.ts: programmatic R1 end-to-end (brief → live → position → bell → scored complete → next brief) + margin/determinism/guard tests, suite 243 green; (6) console-clean R1 click-through verified headless at 1440×900 and 390×844 before redeploy.
- [ ] GC-G1 approved.

---

# ADMIN-1 DELTA — MERGE + CONTROL-ROOM RE-VERIFY (2026-08-15)

> The ADMIN-1 MORNING CONTROL ROOM spec re-arrived 2026-08-15; verified against source: A (layout+strip), B (book manager incl. STALE/demote/re-arm/delete), C (draft review v2 incl. UPDATE-to, APPROVE/REJECT ALL, side suggestion, entry-less→tape), D (drag-drop .txt, char count, auto-title, expandable ingest log), E (tape undo + sentiment quick-add) — ALL already live on main since 0208fa5 (gate AD-G1 approved). The one missing item is B-MERGE. Branch: feature/admin-1 recreated off main. NOTE: the spec's "after feature/game-5 merges" precondition is NOT executed — GAME-5 lives on feature/game-4, holding at G5-G1 for the behavioral report; merging a held gate needs the explicit word.

- [x] B-MERGE model: pure merge semantics (same-ticker guard, keeper's levels/status kept, both theses folded into history oldest-first, capped) + store op (absorbed idea deleted blob+index) + tests.
- [x] B-MERGE API: POST /api/admin/ideas/merge {keepId, absorbId} behind the dual admin gate.
- [x] B-MERGE UI: book-manager flow — MERGE on the keeper → same-ticker twins offer ABSORB → confirm; kills existing twins.
- [x] Evidence for the gate: desktop two-column, phone view, an "UPDATE to <ticker>" draft, a STALE row, a completed MERGE.

### GATE AD2-G1 — preview + the five screenshots. Approve → merge → AUTH-1 next. HOLD.
- [ ] AD2-G1 approved.

---

## BLOCKERS LOG (newest on top)
- **2026-08-05 — local secrets are masked.** Every secret in `.env.local` (ANTHROPIC_API_KEY, UPSTASH_REDIS_REST_URL/TOKEN, DEEPGRAM, FRED) is a literal `"[SENSITIVE]"` placeholder: they are Sensitive-type in Vercel, and `vercel env pull` can never decrypt those (re-verified against both development and preview scopes). Local Upstash/chat has therefore been non-functional since Phase A — the rate limiter fails open, stores no-op. **Not blocking the build**; BLOCKS the G2 live end-to-end run and local chat testing. Fix (Milek): paste the real values into `C:\dev\august\.env.local` from the Upstash/Anthropic dashboards, or unmark them Sensitive in Vercel and say "re-pull env". Milek pinged via hook.

## NOTES
- ADMIN_TOKEN must be added to the Vercel dashboard (Production + Preview) before G2 sign-off — flag at G2.
- Local .env.local = PREVIEW Upstash. Never seed or test against Production.
