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
- [ ] Admin paste box for NoteGPT transcripts (manual for now; build POST /api/admin/transcripts so a future webhook can hit the same endpoint).
- [ ] On submit, automatically: store raw transcript → call Claude (claude-sonnet-4-6) with a strict-JSON extraction prompt → write each candidate as a draft idea. No manual trigger.
- [ ] Draft queue in /admin: approve / edit / reject. Nothing goes public without approval.

### GATE G2 — notify Milek: run one real transcript end-to-end (paste → drafts → approve → visible on public rail). WAIT for approval.
- [ ] G2 approved.

## P5 — CHAT SURFACE
- [ ] Clean Claude-style chat: input pinned bottom, streaming reply, message history in client state.
- [ ] Wire to /api/august/chat on claude-sonnet-4-6 (drop to Haiku later if cost matters), minimal "August" system prompt, Upstash rate-limiting like the existing reply route. Verify ANTHROPIC_API_KEY is present.

## P6 — POLISH
- [ ] Blotter UX pass: clearer columns, larger type, sane mobile layout.
- [ ] Loading/empty/error states everywhere. Meta/favicon. Quick Lighthouse sanity check.
- [ ] Deploy a Vercel preview.

### GATE G3 — notify Milek: preview URL for final review. DO NOT merge to main until approved.
- [ ] G3 approved. Merge to main.

---

## BLOCKERS LOG (newest on top)
- **2026-08-05 — local secrets are masked.** Every secret in `.env.local` (ANTHROPIC_API_KEY, UPSTASH_REDIS_REST_URL/TOKEN, DEEPGRAM, FRED) is a literal `"[SENSITIVE]"` placeholder: they are Sensitive-type in Vercel, and `vercel env pull` can never decrypt those (re-verified against both development and preview scopes). Local Upstash/chat has therefore been non-functional since Phase A — the rate limiter fails open, stores no-op. **Not blocking the build**; BLOCKS the G2 live end-to-end run and local chat testing. Fix (Milek): paste the real values into `C:\dev\august\.env.local` from the Upstash/Anthropic dashboards, or unmark them Sensitive in Vercel and say "re-pull env". Milek pinged via hook.

## NOTES
- ADMIN_TOKEN must be added to the Vercel dashboard (Production + Preview) before G2 sign-off — flag at G2.
- Local .env.local = PREVIEW Upstash. Never seed or test against Production.
