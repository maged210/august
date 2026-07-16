# /intel Phase 2 — ideas-first workspace + Idea Tracker + automated ingestion

Branch: `feature/intel-phase2` (never merged to main by the build itself).
Every stage landed as one commit, pushed, with tsc + `next build` + all tests
green at that point. 77 tests total (54 v1 + 23 new tracker tests).

## What shipped

### Stage 1 — triage & polish (`phase2(stage-1)`)
- Console clean: keyless-fragment fix in BlotterTable, FCEL duplicate-key root
  cause (tape now shows one chip per symbol with the most urgent derived
  status), THREE.Clock→Timer in Presence3D (deprecation warnings gone; orb
  behavior unchanged). Remaining X4122 lines are ANGLE/D3D shader-translation
  notes on the orb's stock fresnel math — driver info, not app defects.
- SETUP column: full thesis, 2-line CSS clamp (no more JS `slice(38)`),
  responsive width, full text in tooltip + Inspector.
- Status bar honesty: `FEED WS-CONNECTED` → `POLL 30s` (that is what exists),
  `LATENCY` = measured last `/api/intel/quotes` roundtrip, `DATA LIVE` only
  after a real roundtrip. The static LIVE/LOADING/EMPTY/ERROR "preview state"
  pills (design-file artifacts) were removed.

### Stage 2 — ideas-first restructure (`phase2(stage-2)`)
- BOARD (F1) = blotter + condensed brief + AT THE OPEN + Inspector + Ask.
- All source management lives in SOURCES (F3): workflow hub, add form,
  Source Monitor, Video Library (per-video + transcript status, drawer with
  chapters/reprocess). Board keeps ONE lightweight capture: `+ ADD SOURCE`
  toggle (multi-URL, per-URL ok/exists/error results) + a counts line that
  jumps to F3. Nothing was removed — only relocated.

### Stage 3 — Idea Tracker engine (`phase2(stage-3)`)
- `lib/intel/tracker.ts` — pure engine. TrackedIdea: stated levels
  (value+text), sourceRefs, statusHistory (notification hook), priceHistory
  ring (cap 128 — extremes tracked separately so the trim never loses MFE/MAE
  truth), extremes, explicit P&L basis. Cap 300 ideas; eviction order
  closed → terminal → stale-active; live ideas never silently dropped.
- Lifecycle (computable states only): stated numeric trigger + direction →
  ARMED → TRIGGERED → TARGET_HIT / INVALIDATED → CLOSED (auto after 7 days
  terminal). Thesis-only ideas stay ACTIVE forever; Δ-TRIG stays "—".
  Gap-throughs and already-beyond-trigger first observations record honest
  reasons. Target+invalidation in one observation window → conservative
  INVALIDATED with "order unknowable" stated.
- Identity per source: ticker+direction+compatible trigger (0.5% tolerance)
  merges; latest explicit statement wins the summary; prior statements stay
  via sourceRefs. Incompatible triggers (FCEL $30.80 vs $38.00) become linked
  variants under a visible conflictKey — never merged, never discarded.
- P&L law: signed % vs the STATED trigger only once fired ("P&L since
  called"); thesis-only ideas show "price since first mention" (° marker),
  never presented as trade P&L; ARMED has none.
- `/api/cron/intel-track` (CRON_SECRET Bearer, timing-safe, refuses in prod
  when unset) + `/api/intel/tracker` (page-load pass, server-throttled ~2 min)
  → the board is fresh before any schedule is wired.
- UI: tracker-driven STATUS/Δ-TRIG, new P&L + AGE columns, filter chips
  (ALL/TRACKED/TRIGGERED/ARMED/ACTIVE/INVALIDATED), conflict `!` marker,
  Inspector LIFECYCLE panel (timeline with honest reasons, MFE/MAE, snapshot
  sparkline, conflict variants).
- Storage: `august:intel:tracked:v1` single JSON blob (single-writer cron +
  throttled page pass; bounded by the caps above). `TRACKER_STALE_DAYS`
  configures the stale horizon (default 5; stale is a visible flag, not a
  deletion).

### Stage 4 — automated ingestion (`phase2(stage-4)`)
- YouTube auto-discovery shipped in v1 and is verified: `syncSources()` walks
  uploads playlists (Data API), `/api/cron/intel` chains discover →
  auto-transcript → brief. Key absent → honest banner, everything manual
  still works.
- External transcript adapter implemented against Supadata's documented
  contract (verified live from docs.supadata.ai):
  `GET api.supadata.ai/v1/youtube/transcript?videoId=…` with `x-api-key`;
  206 → unavailable, 401/403 → permission_required, other → provider_error.
  Order: free public captions first, then the provider, else honest
  unavailable. `TRANSCRIPT_PROVIDER` selects the adapter ("supadata" is the
  implemented one; unknown names report not_configured rather than guessing).
  Manual paste remains first-class.

### Stage 5 — states, mobile, docs (`phase2(stage-5)`)
- Mobile at 375px verified: all five tabs on-screen, blotter collapses to
  cards with no horizontal overflow, filter chips at 44px, full v1 regression
  (sources hub/add/monitor/library, brief history, options workspace, ask
  bar, export, history button) green.
- Empty/error states: blotter EMPTY, filter NO-MATCH, tracker-unconfigured
  falls back to derived statuses; transcript statuses render verbatim.

## Exact remaining user steps

1. **YouTube auto-discovery** — create/restrict a YouTube Data API v3 key
   (console.cloud.google.com → enable "YouTube Data API v3" → API key;
   restrict it to that API). Set `YOUTUBE_API_KEY` in `.env.local` and in
   Vercel → Project → Settings → Environment Variables.
2. **Transcript provider** — sign up at https://supadata.ai, create an API
   key, set `TRANSCRIPT_PROVIDER_API_KEY` (and optionally
   `TRANSCRIPT_PROVIDER=supadata`) in `.env.local` + Vercel. Without it,
   public captions + manual paste keep working.
3. **Tracker schedule** — create a QStash schedule (or cron-job.org entry):
   - URL: `https://<your-domain>/api/cron/intel-track`
   - Cron: `*/15 * * * *` (10–15 min during market hours is the design point)
   - Header: `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`
     (QStash forwards it as `Authorization`; a plain pinger sends
     `Authorization: Bearer <CRON_SECRET>` directly.)
   - `CRON_SECRET` must be set in Vercel for the route to accept anything.
4. Redeploy after the env vars land.

## Notes & honest caveats
- The cron auth path mirrors `/api/cron/watchers` byte-for-byte
  (timing-safe compare, 503-in-prod-when-unset). It could not be exercised
  locally because `CRON_SECRET` is empty in this dev environment (by design,
  dev stays open) — set the secret and expect 401 on wrong/missing bearers.
- User-initiated CLOSE (closing a tracked idea from the UI) is deferred:
  auto-close after 7 terminal days exists; a close button/route is a small
  follow-up if wanted.
- The Inspector (and so the LIFECYCLE panel) is hidden below 1100px — the
  pre-existing IA. Mobile shows tracker state via the STATUS/P&L/AGE cells.
