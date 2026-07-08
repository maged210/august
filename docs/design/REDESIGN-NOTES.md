# /intel redesign — shipped notes (stages 1–8)

Branch: `intel-redesign`. Design sources + distilled specs live in this folder
(`SPEC-desktop.md`, `SPEC-mobile.md`, `SPEC-wiring.md`, the two `.dc.html`
artboards). Implementation: `components/intel/IntelDashboard.tsx` +
`app/intel/tokens.css` (rd- namespace); `app/intel/intel.css` holds only the
OptionsWorkspace/TradingView legacy classes.

## What shipped, per stage

1. **Shell reskin** — rd- tokens/fonts (IBM Plex Mono + Hanken Grotesk scoped to `.intel-root`), BAR 1–4 chrome (nav+fkeys, title+counts, honest status bar, marquee tape with the new macro list), augShimmer skeleton. Zero new data.
2. **Board** — grouped blotter (TODAY/SWING/LONG horizon groups), lifecycle accent rails, PAST/TO TRIGGER delta + rail, two-level evidence chips (DIRECT/INFERRED; EXTRACTED deliberately never emitted), sparks from real ~1mo daily closes, design empty/error/loading states wired to real actions.
3. **Inspector** — stats grid, quoted/inferred/narrative/absent cell treatments off ValueFields, 352×92 chart with the honest `1M · DAILY` label + stated-trigger line, trade plan, tracker LifecyclePanel (timeline, P&L-basis `°` labels, conflicts, snapshot spark), `NOTHING SELECTED`.
4. **Left rail + BRIEF/SOURCES/ASK retheme** — TOP STOCKS (rank-derived), brief digest + AT THE OPEN, capture; token retheme of BriefCard/AddSource/SourceMonitor/VideoLibrary/VideoDrawer/AskBar; legacy CSS purge.
5. **Fold-ins** — `GET /api/intel/desk` (CNN equity F&G + exported `getSectors` + Finnhub earnings, per-part nullable); FngChip, SentimentGauge, SectorStrip, CatalystLine — each absent (never faked) when its part is null.
6. **US map** — `scripts/build-us-map.mjs` → committed `lib/intel/us-states-paths.json` (geoAlbersUsa outlines) + curated `lib/intel/hq.json`; flat SVG, dots sized/colored by real chgPct, `LOADING MAP…`/`MAP OFFLINE`, non-US footer. Zero runtime network.
7. **Options** — OPTIONS INTEL panel from `brief.options.bestCreatorPlays`/`augustCandidates` (candidates always INFERRED, never sized), OPTION TICKET inspector mode wired to the keyless Yahoo chain (provider chip, Greeks-null honesty, creator premium never overwritten). Skew heat map NOT rendered (no real source).
8. **Mobile (SPEC-mobile)** — the phone BOARD layout <700px: sticky blurred header (brand + fkeys strip), condensed 30px `TAPE` (50s loop, no dividers, right fade), 3-card scroll-snap summary carousel (Brief digest + real stat tiles / Alerts from tracker `statusHistory` transitions + real system rows / At-the-Open gates) with scroll-bound 44px dots, sticky segmented **horizon** control (ALL/TODAY/SWING/LONG → the board's TF groups; counts over all ideas) with the tracker-state chips kept reachable in the row below, single-expand accordion idea cards (collapsed: pill/ticker/dir/live/delta + setup/tf/spark; expanded: thesis, reused InspChart labeled `PRICE · 1M · DAILY`, shared LEVELS-by-evidence grid, CONF + source deep link), OPTIONS strip + disclaimer in the mobile idiom, mobile P palette re-pin (`#6fbf93`/`#c79a52`), dead-CSS sweep. Desktop ≥701px untouched (every rule scoped to the breakpoint; the mobile tree is `display:none` above it).

## Honesty audit — SPEC-wiring §3 mock inventory, item by item

| # | Mock item (design) | Shipped status |
|---|---|---|
| 1 | `raw[]` — 6 hardcoded ideas (TEM/AAPL/… prices 54.87 etc.) | **wired-real** — blotter = `brief.creatorFavorites + topIdeas`, quotes from `/api/intel/quotes` |
| 2 | `6 TRACKED`, `1/6` denominator, `SAT · JUN 27 2026`, `DESK: MOMENTUM` | **wired-real** — `blotter.length`, derived `rowNo/{visible}`, `clock.nice`; “MOMENTUM” **absent** (`DESK: {sessionLabel}`) |
| 3 | statusItems (`WEEKEND/LIVE/WS·CONNECTED/42ms/1821m/475m/17:05:49`) | **wired-real** — real session, DATA LIVE→STALE→WAITING, `FEED · POLL 30s` (**WS·CONNECTED absent** — no websocket), measured latency, real YT-key flag, TRACKER item retained, human ages, real ET clock; `REC` **absent** |
| 4 | tape macro rows (SPX 5,477.90 …) | **wired-real** — 9 keyless Yahoo symbols via `/api/intel/quotes`; **US10Y absent** (deferred: needs ÷10 + bp formatting) |
| 5 | `priceSeries()` seeded fakes (mulberry32/FNV) | **absent** — all sparks/charts draw the real ~21 daily closes, labeled `1M · DAILY` / `PRICE · 1M · DAILY` |
| 6 | `fearGreed` prop (46) → chip + gauge | **wired-real** — CNN equity F&G via `/api/intel/desk`; chip+gauge absent when null (never a fake neutral) |
| 7 | `sectorRaw` 11 hardcoded pcts | **wired-real** — `getSectors()` (SPDR ETFs, keyless) via desk endpoint; strip absent when null |
| 8 | `optRaw` call/put skew heat map | **absent** — never rendered; `/api/intel/options/skew` is the deferred wiring path |
| 9 | `hq` 4 map points + runtime CDN d3/us-atlas fetches | **wired-real** — build-time `us-states-paths.json` + curated `hq.json`; dots from real chgPct; zero runtime CDN |
| 10 | `optionPlays`/`optionCandidates`/`topOptRaw` (BABA $3.38M, “China risk”…) | **wired-real** — `brief.options.*`; ticket plan cells from underlying trigger/invalidation/targets (null → absent cell); panel absent when the brief has no options |
| 11 | catalysts WEN/UBER + `2 of 6 watchlist · illustrative` | **wired-real** — Finnhub earnings (key-gated), real `{hits} of {watchlist}` copy, “illustrative” dropped; line absent when null/empty |
| 12 | `boardBtns` LIVE/LOADING/EMPTY/ERROR preview switcher | **absent** — states come from real fetch status |
| 13 | `wsTabs` MARKETS/ORB/SCREENER/JOURNAL | **absent** — only INTEL (active) + the real `/` link render |
| 14 | `ERR · SOURCE_UNREACHABLE · 17:05:12 ET` sample | **wired-real** — real failure code + real ET timestamp (`ERR · OVERVIEW_UNREACHABLE · {now} ET`) |
| 15 | hardcoded `evChip('DIRECT')` per field + `EVID: DIRECT` stat | **wired-real** — `fieldEvKind()` per-field honesty; chip only with verbatim source text; EXTRACTED never emitted |
| 16 | “Illustrative.” suffix in the option-ticket footnote | **absent** — ported without it |
| 17 | design-runtime plumbing (`sc-for`, `{{ }}`, data-props) | **absent** — not ported |

Mobile additions (SPEC-mobile §12): iOS status bar + home indicator **absent**; brief paragraph → real `brief.posture` (READ · 60s chip is the **real** `read60` toggle, only when present); stat tiles → derived counts (same as header pills); alerts card → real tracker `statusHistory` transitions (badge counts only <24h ones; `YT_API key unset` system row renders only when the key is really unset, plus a real tracker-offline system row); gates → `brief.levels` + `atOpenState`; segment counts derived; carousel dots **bound to scroll**; Ask August → the real AskBar input (fake block cursor absent); options strip counts real.

Known remaining static element: the BAR-2 `LIVE` brand pill is decorative and always-on (both breakpoints, unchanged from stage 1); the honest feed state is the status bar's `DATA` item (LIVE/STALE/WAITING). Wiring the pill to `dataState` is a small follow-up if wanted.

## Remaining user steps

- **`FINNHUB_API_KEY`** (`.env.local.example` line ~131) — enables the CATALYSTS earnings line (free tier is fine). Unset → the line simply doesn't render.
- **Extending the US map** — when a new ticker joins the watchlist: add its HQ lat/lon to the `HQ` table in `scripts/build-us-map.mjs`, run `node scripts/build-us-map.mjs`, commit the regenerated `lib/intel/hq.json` (+ `us-states-paths.json` if it changed). Unknown tickers are silently dot-less by design — never geocode, never guess.

## Known deferred items

- `/api/intel/options/skew` (call/put volume+OI off the keyless chain) — until built, the options heat map stays absent.
- US10Y tape entry (`^TNX` ÷10 + basis-point change formatting).
- `EXTRACTED` evidence level — chip CSS exists (`.rd-ev-extracted`), never emitted; needs a per-field resolved-by-AUGUST flag threaded through the pipeline.
- OptionsWorkspace (F4) deep-restyle — stage 7 gave it a token-alignment pass only; its layout/classes still live in `intel.css`.
- Mobile accordion default state — the design opens the first card (`expandedIdx: 0`) and defaults the horizon to TODAY; shipped all-closed + ALL so a real (possibly empty or off-horizon) board never opens blank. Revisit if unwanted.
- BAR-2 `LIVE` pill → wire to `dataState` (see audit note above).
