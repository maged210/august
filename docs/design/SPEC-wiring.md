# SPEC-wiring — /intel redesign DATA WIRING MAP

Branch: `intel-redesign` · Repo: `C:\dev\august`
Design sources: `docs/design/Market Intel Redesign.dc.html` (desktop), `docs/design/Market Intel Mobile.dc.html` (mobile — same `raw[]` mock, subset of bindings).
Implementation reads THIS file. The `.dc.html` design runtime (`sc-for` / `sc-if` / `{{ }}` / `data-props` / `DCLogic` / `support.js`) is **not** ported — only structure, exact styles (see the visual spec), and the data shapes below.

**Ground rule carried over from the codebase (the "law"):** lifecycle states, P&L, and levels come ONLY from stated source levels + recorded observations (`lib/intel/tracker.ts`). Nothing in this reskin may fabricate a state the engine did not compute, and every design element backed by mock data is either wired to a real source listed here or explicitly deferred/hidden.

---

## 1. Real data sources that exist TODAY (inventory)

| Source | File / endpoint | Shape | Cache / cadence | Key |
|---|---|---|---|---|
| Overview (one-shot page payload) | `GET /api/intel/overview` | `{ config:{storage,ai,youtube}, clock:{date,nice,time,session,sessionLabel}, lastSync, lastBriefAt, lastProcessed, sources: IntelSource[], videos: IntelVideo[], brief: DailyBrief\|null }` | `force-dynamic`, client polls on demand | — |
| Quotes + sparkline | `GET /api/intel/quotes?symbols=A,B` (max 20) → `lib/markets.ts getQuoteWithSpark` | `{ quotes: Record<sym, { price, prevClose, chgPct, closes: number[] }> }` | 60s in-process TTL per symbol (`ychart:*`); client polls 30s | keyless (Yahoo v8 chart) |
| **`closes[]` granularity** | `fetchYahooChart` uses `interval=1d&range=1mo` | **~21 DAILY closes**, not intraday | — | — |
| Idea Tracker (lifecycle engine) | `GET /api/intel/tracker` → `runTrackerPass({force:false})` | `{ configured, ran, tracked: TrackedIdea[] }` | server-throttled to 1 pass / 2 min (`PASS_MIN_GAP_MS`); client polls 30s | Upstash Redis |
| Tracker cron | `GET/POST /api/cron/intel-track` (Bearer `CRON_SECRET`, timing-safe) | summary only `{ok, configured, tracked, ingested, quoted, transitions, evicted}` | external pinger ~10–15 min market hours | `CRON_SECRET` |
| Daily brief | `DailyBrief` on overview; history via `GET /api/intel/briefs` + `GET /api/intel/briefs/[date]`; generate via `POST /api/intel/briefs/today` | see §2 field map | Redis-stored per ET date | `ANTHROPIC_API_KEY` to generate |
| Options chain (REAL, keyless) | `GET /api/intel/options/chain?symbol=&expiration=` → `lib/intel/options.ts getOptionChain` | `{ symbol, provider:"yahoo", greeksAvailable:false, status, delayed, quoteTimestamp, expirations[], expiration, underlyingPrice, calls[], puts[] }` | 60s in-process chain cache, cookie+crumb handshake cached 25 min, single-flight | keyless (Yahoo v7 options) |
| Option candidates | `POST /api/intel/options/candidates {symbol, direction}` | `{ symbol, direction, status, candidates[] (ranked) }` | rides chain cache | keyless |
| Brief options sections | `brief.options?: { bestCreatorPlays, augustCandidates, directionalOnly, optionsRisk[], providerStatus, consensus }` (`OptionBriefIdea[]`) | present once any video carries option ideas | — | — |
| F&G (exists, CRYPTO) | `lib/markets.ts getFng()` — `https://api.alternative.me/fng/` | `{ value: number, label: string }` | 30 min TTL | keyless — **NOT exported, not exposed on any /api/intel route; and it is the CRYPTO F&G index** |
| Sectors (exists, keyless) | `lib/markets.ts getSectors()` — 11 SPDR ETFs (XLK…XLC) via the same `yahooChart` | `{ name, etf, chgPct }[]` (NaN rows filtered) | 15 min TTL | keyless — **NOT exported / not exposed to /intel** |
| Ask | `POST /api/intel/ask {question}` | `{ answer, citations[{videoId,videoTitle,channelTitle,startSeconds,note}] }` | — | `ANTHROPIC_API_KEY` |
| Sources / videos / sync | `POST/DELETE /api/intel/sources[...]`, `GET /api/intel/videos/[id]`, `POST .../transcript`, `POST .../reprocess`, `POST /api/intel/sync` | as used by `AddSource` / `VideoDrawer` / `SourceMonitor` | — | `YOUTUBE_API_KEY` for auto-discovery |
| MapLibre globe (different surface) | `components/command/CommandGlobe.tsx` | maplibre-gl, CARTO dark-matter style URL (CDN), globe projection, geojson sources (night/quakes/flights) | — | keyless |

Key types (in `lib/intel/types.ts` / `lib/intel/tracker.ts`):

- `Explicitness = "explicit" | "inferred"` — **TWO levels** (idea-level and per-claim).
- `ValueField = { value: number|null, type?: "price"|"range"|"condition"|"unspecified", text: string }` — nullable on purpose; `text` carries verbatim phrasing or `"Not specified"`.
- `TradeIdea` = ticker, assetName, assetType, direction (`bullish|bearish|neutral|watch`), timeHorizon (`intraday|next_session|swing|long_term|unspecified`), thesis, catalysts[], `entry/invalidation: ValueField`, `targets: ValueField[]`, risks[], confidence (0..1), explicitness, creatorDesignation, optional `enriched`, + Evidence (videoId, sourceSegmentIds, sourceStartSeconds/End, chapter).
- `BriefIdea = TradeIdea & { channelTitle, videoId, videoTitle, rankScore, rankFactors[] }`.
- `TrackedIdea` = id, ideaIds[], ticker, direction, timeframe, thesis, `statedLevels{ trigger, invalidation, targets: TrackedLevel }` (`{value:number|null, text}`), sourceRefs[], explicitness, createdAt, `status: ACTIVE|ARMED|TRIGGERED|TARGET_HIT|INVALIDATED|CLOSED`, statusHistory[{state,at,price,reason}], priceHistory (ring, cap 128), extremes, `basis: "stated_trigger"|"first_snapshot"|null`, basisPrice, lastQuote, conflictKey, lastMentionAt, stale, closedAt/Reason.
- Derived views (pure fns, never stored): `pnlView(t)` → `since_called | since_first_mention | none`; `mfeMaeView(t)`.
- `OptionBriefIdea = OptionIdea & { channelTitle, videoTitle, rankScore, rankFactors }`; `OptionIdea` carries legs[], entryCondition, underlyingTrigger/Invalidation/Targets, expirationText (`ResolvedDate`), quotedPremium (creator's, never overwritten), contractQuote (delayed, Greeks null), breakevens/maxProfit/maxLoss/riskRewardRatio (null when not computable), origin (`creator_explicit|august_candidate|directional_only`), conviction, status.

---

## 2. Binding-by-binding wiring map

Design binding names below are the exact keys returned by the design's `renderVals()` (lines ~726–1078 of `Market Intel Redesign.dc.html`).

### 2.1 `ideas` / `raw[]` — the board rows

| Design field (per `raw[]` item) | Real source | Notes |
|---|---|---|
| `t` | `BriefIdea.ticker` (via `buildBlotter(brief, quotes)` — dedup of `creatorFavorites + topIdeas`, `__fav` flag) | exists in `IntelDashboard.tsx` |
| `dir` (`BULL/BEAR/NEUTRAL`) | `idea.direction` | design has no `watch`; map `watch`→NEUTRAL styling, keep the word in a tooltip |
| `tf` (`NEXT SESSION/SWING/LONG TERM`) | `idea.timeHorizon` via existing `TF_GROUP`/`TF_FULL` maps | design groups: TODAY·TOP IDEAS = `intraday`(+`next_session` per current `TF_GROUP`? — **decision:** design puts NEXT SESSION under TODAY; current code maps `intraday`→TODAY, `next_session`→SHORT-TERM. Follow the DESIGN grouping: `intraday`+`next_session` → "TODAY · TOP IDEAS", `swing` → "SHORT-TERM · SWING", `long_term`+`unspecified` → "LONG-TERM") |
| `life` (`TRIGGERED/ARMED/ACTIVE/INVALIDATED/EXPIRED`) | `TrackedIdea.status` via the `trackedByIdeaId` join (fallback `deriveStatus()` for untracked rows, exactly as today) | mapping: TRIGGERED→TRIGGERED, ARMED→ARMED, ACTIVE→ACTIVE, INVALIDATED→INVALIDATED, **TARGET_HIT → design has no state — keep the current `TGT ✓` badge in the TRIGGERED (green) family**, CLOSED/stale → design `EXPIRED` visual. Never derive TRIGGERED client-side when a tracked record exists. |
| `setup` (one-word: "Breakout", "Squeeze"…) | **NOT in data.** Closest real: first `rankFactors[].factor` or the chapter category (`Evidence.chapter.normalizedCategory` → `CAT_LABEL`). **Decision for implementer:** use `CAT_LABEL[chapter.normalizedCategory]` when present, else omit the setup word. Do NOT invent a classifier. |
| `thesis` | `idea.thesis` (tracked rows: `TrackedIdea.thesis` — latest explicit statement wins) | |
| `entry` (verbatim, e.g. "Breakout above $52.50") | `idea.entry.text` (`ValueField.text`) | verbatim phrasing already preserved |
| `trig` (numeric) | tracked: `tracked.statedLevels.trigger.value`; untracked fallback: `idea.entry.value` | same precedence as current `BlotterRow` |
| `invalKind: 'inferred'\|'narrative'\|'absent'` + `invalText/invalShort` | `idea.invalidation: ValueField`: `value!=null` → numeric; `value==null && text` (not "Not specified") → narrative; else absent. "inferred" vs "narrative" **cannot** be distinguished by ValueField alone — use idea-level `explicitness` for the chip (see 2.2) | |
| `catalyst` | `idea.catalysts[0]` | |
| `live` | `quotes[ticker].price` from `/api/intel/quotes` | |
| `conf` | `idea.confidence * 100` | |
| `src` + `time` (`'StockedUp' @ '10:35'`) | `idea.channelTitle` + `mmss(idea.sourceStartSeconds)`; deep link `watchUrl(videoId, startSeconds)` | |
| `rank` | `idea.rankScore.toFixed(2)` | |
| `delta` (`PAST TRIGGER` / `TO TRIGGER` + %) | computable: trigger + live price (the current `deltaTrig()` logic, re-labeled per design: favored side → green "PAST TRIGGER", else amber "TO TRIGGER") | real |
| `rail` (live/trig positions on a 4–96% rail) | pure client derivation from `live` + `trig` — port the design's `pos()` math as a helper | real |
| `spark` | see 2.4 | |
| P&L (design shows `delta` only; current app has a P&L column) | keep `pnlView(tracked)` — `since_called` signed %, `since_first_mention` marked `°`, ARMED → none. The `°`-basis label is a legal requirement of the engine ("the UI must label it exactly that") — carry it into the new skin. | real |
| AGE | `ageStr(tracked.createdAt)` | real |
| counts per group (`{{count}} IDEAS`) | `groups[g].length` derived | real |

### 2.2 Evidence chips — THREE design levels vs TWO data levels ⚠ DECISION

Design `EV` map (exact): `DIRECT` (`▮`, `#6aa0c8` blue, solid border, bg `rgba(106,160,200,0.14)`), `EXTRACTED` (`◇`, `#5fb0ad` teal, solid, transparent bg), `INFERRED` (`~`, `#9a8fb0` purple, dashed, transparent bg).

Our data has only `Explicitness = "explicit" | "inferred"`.

**Recommended mapping (implementer must pick and document in code):**

| Design chip | Wire to |
|---|---|
| `DIRECT` | `explicitness === "explicit"` AND the specific field has verbatim source text (`ValueField.text` present and not "Not specified") |
| `EXTRACTED` | **Option A (recommended): do not emit.** Keep the CSS/token so the chip exists for a future third provenance level. Option B (only if a third level is wanted now): explicit idea but the *field value* was resolved/derived by AUGUST rather than quoted (e.g. `ResolvedDate.resolved` from relative wording, computed `breakevens`) — this is a real distinction the pipeline already tracks per-field, but it requires threading a per-field flag through the UI. |
| `INFERRED` | `explicitness === "inferred"` (and `origin !== "creator_explicit"` for options) |

Do NOT map anything to EXTRACTED silently; two honest levels beat three decorative ones. The design's per-field `evChip('DIRECT')` on ENTRY/TRIGGER/CATALYST is mock (it hardcodes DIRECT) — real chips must come from the idea/claim `explicitness`.

The design's quoted-value cell treatments are real-data-compatible: `mkQuoted` (❝ glyph, dotted underline) → `ValueField` with `value != null`; `mkInferred` (~ glyph) → inferred; `mkNarr` (❝, no underline) → text-only condition; `ABSENT` → `⌀` (design shows em-dash/absent cell; current app's `⌀ n/s` / "Not stated by source" copy maps 1:1).

### 2.3 `tape` — ticker tape

Real path exists: `TAPE_MACRO` fetched via `/api/intel/quotes` + watchlist chips from blotter (one chip per symbol, most-urgent status wins — `URGENCY` map in `IntelDashboard.tsx`).

Design macro list is different from the current one:

| Design sym | Yahoo symbol to use | Note |
|---|---|---|
| SPX | `^GSPC` | or keep SPY (proxy, cheaper mental model) |
| NDX | `^NDX` | |
| DJI | `^DJI` | |
| RUT | `^RUT` | |
| VIX | `^VIX` | already in `TAPE_MACRO` |
| DXY | `DX-Y.NYB` | |
| US10Y | `^TNX` | Yahoo `^TNX` = yield ×10 (42.52 → 4.252%); **needs divide-by-10 + "bp" change formatting** (`+1.8bp` = chg in yield ×100). Special-case in the tape renderer or drop US10Y in stage 1. |
| WTI | `CL=F` | already present |
| GOLD | `GC=F` | already present |
| BTC | `BTC-USD` | already present |

All flow through the existing `getQuoteWithSpark`/`getQuote` (keyless). The watchlist divider (`WATCHLIST`), per-chip `lifeShort` badge, and colors wire to the existing tape composition — no new endpoint. Keep the current honest empty state until first quote lands (design has no tape-empty treatment; current copy is `TAPE · AWAITING FIRST QUOTE`).

### 2.4 Sparklines + inspector chart — ⚠ DAILY, not intraday

- Design `priceSeries()` is a **seeded random 46-point intraday-looking path** (mulberry32 over ticker hash, "ends exactly at live"). **Mock — must not ship.**
- Real series: `quotes[sym].closes` = **~21 DAILY closes (1mo/1d)** from `getQuoteWithSpark`.
- **Wiring:** render the design's spark (52×20 path + end dot) and inspector chart (352×92 area + trigger line + live dot) from `closes[]`, and **label honestly**: inspector chart axis/footer says `1M · DAILY` (replace the design's implied intraday framing). The trigger dashed line + hi/lo labels wire to `statedLevels.trigger.value` / `Math.max/min(closes)` — same as the current `InspChart`.
- The LIFECYCLE panel's wide sparkline stays wired to `TrackedIdea.priceHistory` (the tracker's own observed ring buffer, cap 128) — that one IS intraday-ish (~15-min snaps) and already honest.
- Optional later: add `interval=5m&range=1d` variant to `fetchYahooChart` for true intraday sparks (new cache key `ychart5m:*`, 120s TTL, same keyless endpoint — mirrors `getHistory`'s existing `TF_YAHOO["1D"]`). Not required for the reskin.

### 2.5 `fng` chip + `gauge` (semicircle) — fold-in #1

- Design: `fearGreed` is a **design prop, default 46** → band chip (EXTREME FEAR ≤24 / FEAR ≤44 / NEUTRAL ≤55 / GREED ≤74 / EXTREME GREED) + a 5-segment semicircle gauge with needle at `180 − 1.8·value`. **Value is mock.**
- Reality check: `lib/markets.ts getFng()` exists (keyless, 30-min TTL) **but it is alternative.me — the CRYPTO Fear & Greed index**, used on the Markets deck. The design chip sits in an equity desk context.
- **Wiring (build):** new source in `lib/markets.ts` (or `lib/intel/fng.ts`): CNN Fear & Greed — `https://production.dataviz.cnn.io/index/fearandgreed/graphdata` (keyless, unofficial; send the standard `UA`). Parse `fear_and_greed.score` + `rating`. Cache: in-process `cached("fng-cnn", 30 * 60_000, …)` **and** Redis fallback key (`august:intel:fng`) so cold serverless instances don't hammer CNN; serve stale on failure (the `cached()` helper already returns the stale hit on throw).
- Expose via the combined `GET /api/intel/desk` endpoint (§4). If the fetch fails and no cache exists → **hide the chip and gauge entirely** (no neutral-50 fake). Band math + needle math from the design are pure client derivations — keep.
- Do NOT silently substitute the crypto index; if CNN proves unreliable, the honest fallback is the alternative.me value **labeled `CRYPTO F&G`**.

### 2.6 `sectors` strip — fold-in #2 (NOT actually key-gated)

- Design: `sectorRaw` = **11 hardcoded name/pct pairs** with a heat-box scale relative to the day's max |Δ|. Mock.
- Reality: `getSectors()` in `lib/markets.ts` already returns the 11 SPDR sector ETFs' `chgPct` — **keyless Yahoo, 15-min TTL**. No FMP/Finnhub key needed. It is currently module-private: **export it** and surface through `/api/intel/desk`.
- Name mapping (markets.ts → design 4-letter codes): Technology→TECH, Comm. Svcs.→COMM, Cons. Disc.→DISC, Financials→FINL, Industrials→INDU, Materials→MATL, Real Estate→REIT, Health Care→HLTH, Cons. Staples→STPL, Utilities→UTIL, Energy→ENGY.
- Heat-box intensity math and the `▾ MOVE` / `A–Z` sort toggle are pure client — port as-is. Empty treatment: if the fetch fails with no cache, hide the strip (design has no sector-error state).

### 2.7 `catalysts` line (watchlist earnings) — fold-in #3 (genuinely missing)

- Design: 2 hardcoded rows (`WEN Mon Jun 30 BMO`, `UBER Wed Jul 02 AMC`) + note `2 of 6 watchlist · <7 sessions · illustrative` — the design itself admits it's illustrative. Mock.
- Partial real data exists: `brief.catalysts: IntelCatalyst[]` (creator-mentioned, `eventTime`, `importance`, `affectedTickers`, `externallyVerified`) — but these are *creator claims*, not a verified earnings calendar, and rarely carry BMO/AMC.
- **Wiring (build):** Finnhub earnings calendar — `GET https://finnhub.io/api/v1/calendar/earnings?from=&to=&symbol=` per tracked ticker (or one range call, filter client-side to watchlist). **Key-gated: `FINNHUB_API_KEY`** (free tier fine at this volume). Watchlist = distinct tickers of live tracked ideas (`tracked.filter(t => t.status !== "CLOSED")`), capped like `MAX_QUOTED_TICKERS`. Response rows: `{ symbol, date, hour: "bmo"|"amc"|"dmh" }` → design's `tag` BMO/AMC (dmh → "—").
- Cache: Redis, 6h TTL (`august:intel:earnings:v1:<etDate>`), earnings dates don't move intraday. Serve via `/api/intel/desk`.
- Note copy becomes real: `"{hits} of {watchlist} watchlist · <7 sessions"` — **drop the word "illustrative"** once wired. If `FINNHUB_API_KEY` unset: hide the line entirely OR show the creator-claimed `brief.catalysts` filtered to `externallyVerified` with an explicit `CREATOR CLAIM` chip — implementer's choice; hiding is the simpler honest default.

### 2.8 `mapPts` / `usStates` — US map ⚠ GAP + rendering decision

- Design: d3-geo `geoAlbersUsa` SVG (300×185) over `us-atlas states-10m.json` fetched from jsDelivr at runtime, with **4 hardcoded HQ points** (`AAPL` Cupertino, `UBER` SF, `TEM` Chicago, `WEN` Columbus/Dublin OH — each with a mock `pct` driving dot radius/color). All mock; the CDN fetch pattern must not ship.
- **The gap:** we track tickers, not HQ geography. Options:
  1. **Static ticker→HQ lookup table (RECOMMENDED — honest minimal path):** `lib/intel/hq.ts` — a hand-curated `Record<ticker, { lat, lon, city }>` seeded with the tickers the user actually tracks (grow it as new tickers appear; unknown tickers simply don't get a dot). Dot size/color from the REAL `chgPct` in the quotes map. A missing entry is silent — never geocode, never guess.
  2. Hide the map panel entirely. Defensible, but the design treats it as a signature panel; option 1 costs one small static file.
  - **Recommendation: option 1.** Non-US HQ tickers (e.g. BABA) fall outside `geoAlbersUsa` — they get no dot; optionally list them in a one-line footer (`+ BABA (non-US)`).
- **Renderer decision:** do **NOT** reuse `CommandGlobe`'s MapLibre stack for this. Reasons: it renders CARTO raster/vector world tiles from a CDN style URL (visual mismatch with the design's flat `#0b0d10` state fills), it's a full WebGL canvas inside an already dense dashboard, and the design is a 300×185 static SVG. Instead: precompute the `geoAlbersUsa` state path strings **once at build/dev time** (script with `d3-geo` + `us-atlas` as devDependencies → commit `lib/intel/us-states-paths.json`) and render plain SVG. Project HQ lat/lon with the same precomputed projection constants (or store projected x/y in `hq.ts` directly — simplest). Zero runtime network. Keep MapLibre where it lives (World surface).
- Design's own map states, verbatim (keep them): `LOADING MAP…` (pending) and `MAP OFFLINE` (error). With precomputed local JSON, "pending" collapses to first paint and OFFLINE should be unreachable — keep the states anyway for the dynamic-import fallback.

### 2.9 `optionPlays` / `optionCandidates` / `topOptions` — REAL source exists, do NOT hide

- Design `optionPlays` (1 hardcoded BABA row) → **`brief.options.bestCreatorPlays: OptionBriefIdea[]`**. Field map: `t`→`underlyingSymbol`, `struct`→`strategyType.replace(/_/g," ")`, `dir`→`direction`, `ref` (quoted/narr) → first leg strike (`legs[0].strike`, `mkQuoted`) or `entryCondition.text` (`mkNarr`), `size`→`quotedPremium` + `expirationText.resolved ?? .text` (absent → design's `∅` cell; current copy "∅ not sized"), `ev`→ `origin === "creator_explicit"` → DIRECT else INFERRED.
- Design `optionCandidates` (3 hardcoded rows) → **`brief.options.augustCandidates`** — always chip INFERRED, `ref` = the quoted equity trigger (`underlyingTrigger` / leg strike), never sized. Keep the current footer disclaimer: *"AUGUST suggests the structure and references the quoted equity trigger — never the strike or size."* The design's inspector option-ticket note (*"AUGUST frames entry / exit / take-profit off the quoted equity level — it never invents the strike or contract size. Illustrative."*) — port it **without** the trailing "Illustrative." once wired to real data.
- Design `topOptions` ticket (ENTRY / EXIT-STOP / TAKE-PROFIT cells, 3 hardcoded tickets): wire to the same `OptionBriefIdea`s — ENTRY = `entryCondition.text` (or `underlyingTrigger`), EXIT/STOP = `underlyingInvalidation` (null → absent cell, `planCell(null)` renders the design's "no" state), TAKE-PROFIT = `underlyingTargets[0]` (usually null → absent). Live contract data (`contractQuote`, bid/ask/mid/OI/IV, `delayed`, Greeks **null** — "Greeks unavailable from this provider") comes from the existing chain endpoint when a ticket is opened; `providerStatus` (`brief.options.providerStatus` / chain `status`) drives an honest provider chip.
- Design options **heat map** (`options` binding — call/put skew `C 72%` per ticker, 6 hardcoded): **no real source is wired today**, but it is computable from the keyless chain (`getOptionChain(sym)` → Σ call volume+OI vs Σ put volume+OI). Cost: one chain fetch per watchlist ticker. **Defer to its own stage (or ship hidden)** — see §4/`/api/intel/options/skew`. Until then the panel must not render with fake percentages.

### 2.10 `statusItems` — status bar

Real facts already exist in `StatusBar` (`IntelDashboard.tsx` lines ~313–353). Map:

| Design item (mock value) | Real wiring |
|---|---|
| `SESSION · WEEKEND` | `overview.clock.sessionLabel.toUpperCase()` — real |
| `DATA · LIVE` (glow dot) | real: `lastQuoteOkAt` — `WAITING` → `LIVE` (<75s) → `STALE`. Keep the degradation; design only drew LIVE. |
| `FEED · WS·CONNECTED` | **MOCK AND WRONG — no websocket exists.** Real value: `POLL 30s` (current honest chrome). Ship `POLL 30s`. |
| `LATENCY · 42ms` | real: measured last `/api/intel/quotes` roundtrip (`latencyMs`), warn >2000ms; fixed ch-slot so neighbors don't shift |
| `KEY · YT_API UNSET` | real: `!overview.config.youtube` → `YT_API UNSET`; when set, either omit the item or show `YT_API OK` (the current app surfaces this hint in SOURCES — moving it to the status bar per design is fine, it's a real fact) |
| *(absent in design)* `TRACKER` | **keep the current real TRACKER ON/OFFLINE/— item** — the design dropped it, but rows silently fall back to derived statuses when the tracker is unreachable and the chrome must say so. Non-negotiable honesty item. |
| `LAST SYNC · 1821m` | real: `ageStr(lastSync)` — note the repo rule: **human ages** (`30h`, not `1821m`). Render `ageStr`, not raw minutes. |
| `BRIEF · 475m` | real: `ageStr(lastBriefAt)` (same human-age rule) |
| `NOW · 17:05:49 ET` | real: existing ET clock (current updates 1/min showing HH:MM; design shows seconds — either add a 1s tick for this element only or keep HH:MM; recommend keeping HH:MM `ET` to avoid a 1 Hz re-render of the bar; put seconds in a `useRef`-driven span if the design's seconds are wanted) |

### 2.11 Header / chrome

| Design binding | Real wiring |
|---|---|
| `SAT · JUN 27 2026` chip | `overview.clock.nice.toUpperCase()` — real |
| `DESK: MOMENTUM · 6 TRACKED` | `DESK: {sessionLabel}` is the current real copy; **"MOMENTUM" is a mock desk name — do not ship**; `6 TRACKED` → `blotter.length` (current) or live tracked count `trackedList.filter(t=>t.status!=="CLOSED").length` — pick ONE and label it; recommend blotter length (matches the board the user sees) |
| `wsTabs` (`INTEL/MARKETS/ORB/SCREENER/JOURNAL`) | **MOCK — MARKETS/ORB/SCREENER/JOURNAL don't exist as /intel workspaces.** Ship only what routes exist (INTEL active; optionally a link back to `/` and `/` Markets deck). Do not render dead tabs. |
| `fkeys` F1–F5 + `F6 SYNC` | real: current tabs BOARD/BRIEF/SOURCES/OPTIONS/ASK (F1–F5). F6→SYNC maps to the real `onSync` action — fine to add. |
| TRIGGERED/ARMED/ACTIVE count pills | real: derived counts (current `PageHeader` logic; keep zero-count dimming behavior) |
| SYNC / BRIEF / EXPORT / ←AUGUST buttons | real: existing handlers (`/api/intel/sync`, `/api/intel/briefs/today`, `/api/intel/export/today`, `/`) |
| Footer disclaimer | identical copy already exists (`.idisc`) — keep |
| `boardBtns` (LIVE/LOADING/EMPTY/ERROR switcher) | **design-preview control only — do not ship.** Real states come from fetch status. |
| Inspector header `▸ TEM · Breakout · 1/6` | real: ticker · setup-word (see 2.1 `setup` decision) · `rowNo/{visible.length}` — the design's `/6` denominator is hardcoded; derive it |
| `topStocks` (left rail top-5 by rank) | real: derived `ideas.sort(rank).slice(0,5)` from the blotter — pure client |

### 2.12 Design's own empty / loading / error treatments (verbatim — adopt these)

| Surface | State | Verbatim copy |
|---|---|---|
| Board | empty | `∅` / `NO IDEAS ON THE BOARD` / "No trade ideas have been extracted yet. Add a source or generate tonight's brief to populate the blotter." + buttons `ADD SOURCE` · `GENERATE BRIEF` (wire to real `AddSource` open + `generateBrief`) |
| Board | error | `△` / `ANALYSIS FAILED` / "Could not reach the source. `YOUTUBE_API_KEY` is not set — channel auto-discovery and live status are disabled." / `ERR · SOURCE_UNREACHABLE · 17:05:12 ET` / button `RETRY SYNC` — **the sample error string + timestamp are mock**; render the REAL failure (`overview` fetch error, or sync error message) with a real ET timestamp |
| Board | loading | shimmer skeleton rows (`augShimmer 1.4s ease-in-out` staggered) — replaces current `bl-skel` blocks |
| Inspector | loading | pulse dot (`augPulse 1s ease-in-out infinite`) + `AWAITING ANALYSIS` + 3 shimmer bars |
| Inspector | empty | `∅` / `NOTHING SELECTED` / "Populate the board, then select a row to inspect its thesis and evidence." (replaces current `SELECT A ROW`) |
| Map | pending | `LOADING MAP…` |
| Map | error | `MAP OFFLINE` |
| Current-app states with no design equivalent — keep them | `NO IDEAS MATCH` (filter miss), `TAPE · AWAITING FIRST QUOTE`, tracker `OFFLINE`, Upstash-unconfigured banner, ASK error/`needs ANTHROPIC_API_KEY` states, brief-history load error + Retry | restyle with design tokens, keep the honest copy |

---

## 3. MOCK DATA INVENTORY — must NOT ship

Everything below is hardcoded/seeded in the `.dc.html` files. Ship = replace with the wiring in §2 or hide.

1. `raw[]` — all 6 ideas (TEM, AAPL, SHOP, WEN, UBER, BABA): tickers, theses, triggers ($52.50/$293/$114.50), invalidations, live prices (54.87/275.15/111.62/7.33/72.25/95.07), confs (70/65/60), ranks (6.05/4.97/4.90/5.05), `src:'StockedUp'`, times.
2. `6 TRACKED` count, `1/6` inspector denominator, `SAT · JUN 27 2026` date chip, `DESK: MOMENTUM` desk name.
3. `statusItems` values: `WEEKEND`, `LIVE`, **`WS·CONNECTED` (no websocket exists — real is `POLL 30s`)**, `42ms`, `YT_API UNSET`, `1821m`, `475m`, `17:05:49 ET` (also: raw-minute ages violate the repo's human-age rule).
4. `tape` — all 10 macro rows with hardcoded prices/changes (SPX 5,477.90 … BTC 61,240).
5. `priceSeries()` — seeded (mulberry32/FNV hash) fake 46-point intraday paths behind every spark and the inspector chart.
6. `fearGreed` design prop (default **46**) → `fng` chip, band, and the whole semicircle `gauge`.
7. `sectorRaw` — 11 hardcoded sector pcts (TECH +0.86 … ENGY −0.52).
8. `optRaw` call/put skew heat map — 6 hardcoded skews (TEM C72% …).
9. `hq` — the **4 map points** (AAPL/UBER/TEM/WEN with lat/lon + pct) and the runtime CDN fetches (`d3-geo`, `topojson-client`, `us-atlas states-10m.json` from jsDelivr).
10. `optionPlays` (1 BABA row), `optionCandidates` (3 rows), `topOptRaw` (3 option tickets with entry/exit/tp strings like `$50.80`, `China risk`, `Open-ended`).
11. `catalysts` (WEN/UBER earnings rows) + `catalystNote` `"2 of 6 watchlist · <7 sessions · illustrative"`.
12. `boardBtns` LIVE/LOADING/EMPTY/ERROR preview switcher; `boardState` in component state.
13. `wsTabs` — MARKETS/ORB/SCREENER/JOURNAL workspace tabs (routes don't exist).
14. Board-error sample line `ERR · SOURCE_UNREACHABLE · 17:05:12 ET`.
15. Per-field `evChip('DIRECT')` hardcoding on ENTRY/TRIGGER/CATALYST inspector fields and `EVID: DIRECT` stat.
16. "Illustrative." suffix in the option-ticket footnote.
17. Design-runtime plumbing itself: `data-props` editors (density/illumination/accent enums), `DCLogic`, `sc-for`/`sc-if`, `{{ }}` bindings.

---

## 4. NEW endpoints to build

| # | Endpoint | Method | Returns | Cache | Env keys |
|---|---|---|---|---|---|
| 1 | `/api/intel/desk` | GET | `{ fng: { value, rating, asOf } \| null, sectors: { code, name, etf, chgPct }[] \| null, earnings: { symbol, date, hour: "bmo"\|"amc"\|"dmh"\|null }[] \| null, watchlistSize: number }` — each part independently nullable (partial failure never blanks the others) | fng: 30 min (in-process `cached()` + Redis `august:intel:fng` stale-fallback); sectors: 15 min (reuse `getSectors`'s existing `cached("sectors")`); earnings: 6 h Redis `august:intel:earnings:v1:<etDate>`; route `force-dynamic`, client polls with the 30s loop but server TTLs absorb it | none for fng/sectors (CNN + Yahoo keyless); **`FINNHUB_API_KEY`** for earnings (unset → `earnings: null`) |
| 2 | `/api/intel/options/skew` *(deferred stage — optional)* | GET `?symbols=A,B` (cap 8) | `{ skews: Record<sym, { callPct: number, basis: "volume+oi", asOf }> }` derived from `getOptionChain` call/put volume+OI sums | rides the existing 60s chain cache; add a 5-min in-process skew memo | keyless |

Also (not an endpoint): export `getSectors` (and optionally `getFng`) from `lib/markets.ts`; new modules `lib/intel/fng.ts` (CNN fetch+parse), `lib/intel/earnings.ts` (Finnhub), `lib/intel/hq.ts` (static ticker→projected x/y HQ table), `lib/intel/us-states-paths.json` (build-time-generated `geoAlbersUsa` path strings; generator script under `scripts/`, `d3-geo` + `us-atlas` as devDependencies only).

No changes to: `/api/intel/quotes`, `/api/intel/tracker`, `/api/cron/intel-track`, `/api/intel/overview`, options chain/candidates, briefs, sources, sync, ask. Caching stays on the repo's existing pattern (in-process `cached()` + Redis) — these are `force-dynamic` route handlers, not `use cache` pages; do not migrate them as part of the reskin.

Env summary — existing: `UPSTASH_REDIS_REST_URL/TOKEN`, `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, `CRON_SECRET`, `TRACKER_STALE_DAYS`. **New: `FINNHUB_API_KEY`** (only fold-in #3; everything else stays keyless).

---

## 5. Reuse vs replace

**Reuse unchanged (logic/data layer):**
- `buildBlotter`, `deriveStatus` (untracked fallback), `effectiveStatus`, `deltaTrig`, `atOpenState`, the `trackedByIdeaId` join + conflict-variant lookup, `URGENCY` tape composition, `ageStr/ago/fmtPx/fmtPct/mmss/watchUrl` helpers.
- All fetch loops in `IntelDashboard`: `load` (overview), `fetchMacroTape`, `fetchBlotterQuotes`, `fetchTracker`, 30s poll effect, latency/lastQuoteOkAt/trackerOk health facts, brief-history loader.
- Engine imports: `pnlView`, `mfeMaeView`, `TrackedIdea`, `TrackedStatus`.
- Whole components: `AddSource`, `SourceMonitor`, `VideoLibrary`, `VideoDrawer`, `BriefCard`, `AskBar`, `IdeaCard`/`LevelRow`/`CatalystRow`/`DrawerOptionRow`/`ConsensusRow` (BRIEF + SOURCES + ASK tabs are restyled, not rewired), `OptionsWorkspace`, `SymbolProvider`, `TradingViewIntelChart`.

**Replace (visual shell, same props/data):**
- `PageHeader` → design header (fkeys, count pills, date chip, real DESK line).
- `StatusBar` → design statusItems row (per §2.10 mapping, TRACKER item retained).
- `LiveTape` → design tape (new macro list per §2.3, WATCHLIST divider, life badges).
- `BlotterTable`/`BlotterRow` → design grouped rows (horizon group headers with counts, accent rails, delta PAST/TO TRIGGER, rail element, evidence chips per §2.2, spark per §2.4).
- `Inspector` (+ `InspChart`, `LifecyclePanel` visuals) → design inspector (stats grid, insFields with quoted/inferred/narrative/absent cell treatments, trade-plan cells wired to ValueFields, chart with DAILY label; LifecyclePanel data stays tracker-driven).
- `LeftPanel` → design left rail (topStocks top-5, brief digest, fold-in chips/strip/line, map panel, capture). Note the mobile-layout memory: `.bl-left` is desktop-only (<700px hidden) — new mobile controls go to header row2 / SOURCES tab, per `Market Intel Mobile.dc.html`.
- `OptionsIntelPanel` → design optionPlays/optionCandidates table + option-ticket inspector mode (`inspectorMode: 'idea' | 'option'` state is new client state).
- `MiniSpark`/`MiniSparkWide` → design spark rendering (data unchanged: closes[] / priceHistory).
- **New components:** `FngChip`+`SentimentGauge`, `SectorStrip` (with MOVE/A–Z sort state), `CatalystLine`, `UsMapPanel` (static SVG; LOADING MAP…/MAP OFFLINE), `TopStocksPanel`, `OptionTicket`.
- `app/intel/intel.css` → new skin (tokens per the visual spec; keep class-name discipline).
- **Not reused:** `CommandGlobe`/MapLibre for the US map (§2.8 — flat SVG instead).

---

## 6. Staged implementation plan (one commit per stage)

1. **Shell reskin, zero new data.** New intel.css tokens + `PageHeader`, `StatusBar`, `LiveTape` redesigns wired to existing overview/quotes/health facts. New macro tape list (defer US10Y bp handling or special-case it here). Design loading skeleton (augShimmer) replaces `bl-skel`. Everything real; no fold-ins.
2. **Board.** `BlotterTable`/`BlotterRow` → grouped design rows: horizon groups (design grouping rule per §2.1), accent rails, PAST/TO TRIGGER delta + rail, evidence chips (two-level mapping per §2.2), sparks from `closes[]`. Board empty/error states with design copy wired to real actions. Filter chips + `TRACKED` semantics unchanged.
3. **Inspector.** Design inspector: stats grid, insFields cell treatments (quoted/inferred/narrative/absent from ValueFields), chart with honest `1M · DAILY` label + trigger line, trade-plan cells, LifecyclePanel restyle (timeline, P&L-basis labels, conflict variants, snapshot spark — all tracker-driven as today), `NOTHING SELECTED` state.
4. **Left rail + BRIEF/SOURCES/ASK restyle.** `TopStocksPanel` (derived), brief digest, capture; retheme `BriefCard`/`AddSource`/`SourceMonitor`/`VideoLibrary`/`VideoDrawer`/`AskBar` to the token set. Mobile header-row2 affordances per the mobile design.
5. **Fold-ins endpoint.** `GET /api/intel/desk` (CNN fng + exported `getSectors` + Finnhub earnings, per-part nullability + TTLs) + `FngChip`/`SentimentGauge`/`SectorStrip`/`CatalystLine`, each hiding cleanly when its part is null. `.env.local.example` gains `FINNHUB_API_KEY`.
6. **US map.** `scripts/build-us-map.ts` → `lib/intel/us-states-paths.json`; `lib/intel/hq.ts` static HQ table for currently tracked tickers; `UsMapPanel` SVG with real chgPct-driven dots, LOADING MAP…/MAP OFFLINE states, non-US footer line.
7. **Options.** `OptionsIntelPanel` redesign mapped to `brief.options.bestCreatorPlays`/`augustCandidates` (§2.9) + `OptionTicket` inspector mode wired to `OptionBriefIdea` + chain endpoint (provider status, Greeks-null honesty). Skew heat map stays OUT (hidden) unless `/api/intel/options/skew` is built as an optional follow-up commit.
8. **Polish pass.** Mobile audit against `Market Intel Mobile.dc.html` (44px targets, header row2 cluster rule), a11y (aria-pressed filters, sr-only busy announcements — both exist, keep), dead-CSS sweep, and a final check that every §3 mock item is either wired or absent.
