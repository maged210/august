# Market Intel — Pass 3 Audit (options-first + TradingView)

Branch `feature/market-intel` (worktree `..\august-market-intel`), HEAD `f5f8b18`, clean tree.
The existing AUGUST app (`..\aug`, `main`) is untouched. This pass is **purely additive**.

## Existing implementation discovered (from passes 1 + 2)

Built last pass, all present and working (tsc + build + 18 tests + runtime-smoke green):

- **Route**: `app/intel/page.tsx` + `app/intel/intel.css` + `components/intel/IntelDashboard.tsx` (the ONE Market Intel page). `INTEL →` link on the orb page.
- **Pipeline (chapter-first)**: `lib/intel/pipeline.ts` (`addSource`, `processManualTranscript` fast→full, `reprocessVideo`, `syncSources`, enrichment via `getQuote`).
- **Extraction**: `lib/intel/extract.ts` — direct `@anthropic-ai/sdk` FORCED tool-call returning the strict schema; anti-hallucination enforced in code (segment-cited, number-verified, ticker-validated, explicit/inferred).
- **Chapters**: `lib/intel/chapters.ts` — creator (YouTube/description) vs AUGUST-inferred; `favorite_setups`/`predictions`/`watchlist` = high priority; channel templates (StockedUp).
- **Brief**: `lib/intel/brief.ts` — cross-video synthesis, transparent ranking, consensus/conflict, markdown export.
- **Store**: `lib/intel/store.ts` — Upstash `august:intel:*` (sources/videos/transcript/chapters/analysis/jobs/brief/settings/logs/ticker-index).
- **Providers**: `youtube.ts` (URL parse + oEmbed + Data API), `transcript.ts` (manual + timedtext), `ask.ts` (cited retrieval), `tickers.ts`, `session.ts`, `types.ts`.
- **API**: `app/api/intel/{overview,sources[,/id],videos[,/id,/id/transcript,/id/reprocess],sync,briefs[,/date],ask,export/[date],settings}` + `app/api/cron/intel`.
- **Tests**: `tests/intel.test.ts` (18, node:test).
- **Charts already in repo**: `components/markets/PriceChart.tsx` + `Sparkline.tsx` use the **`lightweight-charts`** dep (Markets surface). This is the open-source canvas lib — NOT the licensed TradingView Advanced Charts library, and not used by Intel.

## Status of pass-3 requirements

| Feature | Status before pass 3 |
|---|---|
| Options data model / OptionIdea | **missing** |
| Options extraction from transcripts | **missing** (generic tradeIdeas only) |
| Best Options Ideas / Creator Options Plays / AUGUST candidates | **missing** |
| Options ranking | **missing** (stock-idea ranking exists) |
| Options provider | **missing** (no options chain anywhere) |
| TradingView chart + symbol sync | **missing** (lightweight-charts exists for Markets only) |
| Relative-expiration resolution | **missing** |
| Workspace visual upgrade | partial (dense terminal exists; not chart-centered) |
| Chapter-first priority | **complete** — extend, don't replace |
| Honest provider/empty states | complete pattern to reuse |

## Provider decisions (no new vendor, no new key)

- **Options chain** → reuse the existing **Yahoo** source (already in `markets.ts`) via the keyless `query1.finance.yahoo.com/v7/finance/options/{SYMBOL}` endpoint. Returns expirations, strikes, bid/ask, last, volume, open interest, implied volatility, `contractSymbol`. **Greeks are NOT provided by Yahoo → reported `null` / "Greeks unavailable from this provider"** (never fabricated). Data is **delayed** → labeled `delayed` with a quote timestamp. Honest provider states: `connected | delayed | rate_limited | unsupported_symbol | provider_error | missing_configuration`.
- **TradingView** → **Path A**: official Advanced Real-Time Chart **widget** (script embed; no package, no license). It's iframe-based, so programmatic overlays aren't possible → a synchronized **Creator Levels rail** sits beside it (§14.2). The existing `lightweight-charts` PriceChart stays untouched (available as a future "AUGUST Analysis" tab).

## Exact additive changes planned

1. `lib/intel/types.ts` — ADD `OptionLeg`, `OptionIdea`, options chain/contract/quote types, provider-status enum; EXTEND `VideoAnalysis` with `optionIdeas?`, `DailyBrief` with options fields, `IntelSettings` with options-candidate controls. (No type removed.)
2. NEW `lib/intel/dates.ts` — relative-expiration resolution (tomorrow/this Friday/next Friday/EOM/0DTE) from `publishedAt` + ET, storing original wording + resolved date + confidence.
3. NEW `lib/intel/options.ts` — `OptionsDataProvider` (Yahoo, delayed) + options math (breakeven / max-profit / max-loss / risk-reward, null-guarded) + contract-symbol normalize.
4. NEW `lib/intel/options-rank.ts` — transparent ranking with documented default weights + factor breakdown.
5. `lib/intel/extract.ts` — EXTEND the existing tool to ALSO emit `optionIdeas` (options-aware terminology, origin = creator_explicit / directional_only, never inventing strike/expiry/premium); validate + resolve dates. Existing tradeIdeas untouched.
6. `lib/intel/store.ts` / `pipeline.ts` / `brief.ts` — carry `optionIdeas` through; aggregate Best Options Ideas + creator-vs-candidate; enrich with the chain when available.
7. NEW routes `app/api/intel/options/chain` + `app/api/intel/options/candidates`; EXTEND `overview`/`settings`.
8. NEW `components/intel/symbolContext.tsx` (one shared selected-symbol store) + `TradingViewIntelChart.tsx` (Advanced widget).
9. ENHANCE `components/intel/IntelDashboard.tsx` + `intel.css` — chart-centered workspace, Best Options Ideas, Creator Options Plays, AUGUST Candidates, Contract panel, Creator Levels rail, symbol sync, premium visual treatment. (Enhanced in place — not replaced.)
10. EXTEND `tests/intel.test.ts` with options extraction/resolution/math/dedup/0DTE-safety + a TradingView/symbol-context render test.

Anti-hallucination, "Not specified", honest provider states, and the chapter-first priority are preserved and extended — never bypassed.

---

## Pass 3 — DELIVERED (what actually shipped)

All ten planned changes landed additively. Nothing from passes 1–2 was removed or rewritten.

**Data + logic**
- `types.ts` — added the full options block (`OptionIdea`, `OptionLeg`, `OptionContractQuote`, `OptionDirection/StrategyType/Origin/Status`, `ResolvedDate`, `OptionsProviderStatus`, `OptionCandidateSettings` + defaults). `VideoAnalysis.optionIdeas`, `DailyBrief.options`, `IntelVideo.optionCount`, `IntelSettings.options` added. No field removed.
- `dates.ts` (new) — `resolveExpiration()` (ISO / M-D / month-name / 0DTE / today / tomorrow / this·next weekday / this·next week / EOM) keeping original wording + `resolved` + confidence; `null` when unsafe. `dte()`. Self-contained (inlined the ET date key) so it's unit-testable. UTC-noon anchoring avoids DST drift.
- `options.ts` (new) — `OptionsDataProvider` over Yahoo + pure options math (`computeOptionMetrics`, `spreadPct`) that returns `null` when inputs are missing. Greeks always `null`.
- `options-rank.ts` (new) — transparent 100-pt ranking (thesisMatch 25 · liquidity 20 · spreadQuality 15 · timeframeFit 15 · catalystFit 10 · riskDefinition 10 · sourceConfirmation 5); every factor shown; score == sum of shown factors (a unit test asserts this). "Fit + data quality, not expected profit."
- `candidates.ts` (new) — AUGUST contract candidates for a directional thesis, gated on a working provider, honoring every `OptionCandidateSettings` control (DTE band, OI/volume, spread, max premium, max-loss cap, single-leg vs defined-risk, 0DTE off by default, per-thesis cap). Selected by **moneyness** (delta band can't be honored — no Greeks) and labeled as such.
- `extract.ts` — extended the forced tool with `optionIdeas` (origin `creator_explicit` / `directional_only`; never `august_candidate` from a transcript); options anti-hallucination guidance; validation resolves dates, verifies numbers against the transcript, validates the underlying ticker, computes metrics, dedupes.
- `pipeline.ts` / `brief.ts` — carry `optionIdeas` through; enrich with the delayed chain + honest `optionsRisk`; the brief aggregates Best Options Ideas, Creator Plays, Directional-only, and (provider permitting) AUGUST candidates, plus a "Tonight's Options Brief" markdown block.

**Provider reality check (important).** Yahoo's keyless `v7/finance/options` endpoint now returns **401** without Yahoo's standard cookie+crumb handshake. We implemented that handshake server-side (prime cookie at `fc.yahoo.com` → exchange for a crumb at `query2…/v1/test/getcrumb` → call `v7/options` with both; cached ~25 min; one refresh on 401). This is Yahoo's own JSON API with its normal auth, **not** UI scraping. Verified live: real delayed chains for SPY/NVDA. Open interest is an end-of-day figure that reads `0` overnight (exactly when the evening brief runs), so candidate liquidity falls back to **today's real volume** when OI is unpublished — disclosed in each candidate's risk note ("Vol N (OI unpublished overnight)"). After-hours pricing falls back from `mid` to `last` (a real trade), never fabricated.

**Routes** — `app/api/intel/options/chain` (GET) + `app/api/intel/options/candidates` (POST), rate-limited; `settings` POST now validates the `options` sub-object field-by-field.

**UI** — `symbolContext.tsx` (one shared selected symbol — chart, levels rail, chain, candidates all read it), `TradingViewIntelChart.tsx` (official Advanced widget; lazy-loaded via IntersectionObserver; rebuilt on symbol/interval change; dark; attribution kept; honest fallback link if the iframe is blocked), `OptionsWorkspace.tsx` (chart + synchronized Creator Levels rail, Best Options Ideas, the three labeled classes, on-demand candidate generator, contract drawer with delayed quote / metrics / options-risk / rank-factor breakdown). `IntelDashboard.tsx` wrapped in `SymbolProvider` with the workspace inserted full-width; per-video Option Ideas added to the drawer; `intel.css` extended with the premium options-terminal treatment. Existing dashboard untouched.

**Verification (worktree, this pass)**
- `npx tsc --noEmit` → clean.
- `npm run build` (after deleting `.next`) → compiled successfully; `/intel` 10.2 kB; both options routes present.
- `npm test` → **34/34** (13 prior + 21 new: relative-date resolution, 0DTE weekend safety, missing-strike/premium → null, long-call/long-put/debit-spread math, spread%, ranking transparency + invalidation penalty). Runner uses a tiny zero-dep resolve shim (`tests/ts-resolve.mjs`).
- Runtime smoke (dev): `/api/intel/overview` 200 (honest config); `/api/intel/options/chain?symbol=SPY` → real delayed chain (status `delayed`, Greeks off); `/api/intel/options/candidates` NVDA-bullish → call debit spread (BE 202.2 / maxLoss $220 / maxProfit $280) + long calls, SPY-bearish → long put (BE 721.5) + put debit spread; 0DTE excluded, capped at 3, liquidity basis disclosed.

Constraints honored: not merged to main, not deployed, additive migrations only, no second `/intel` / pipeline / symbol store, and no faked integrations or market data (the provider degrades to honest states).

---

## Post-review hardening (adversarial review → fixes)

A multi-dimensional adversarial review (8 dimensions, perspective-diverse verification) confirmed the honesty spine holds in code and surfaced 25 bounded issues; all were fixed:

- **Provider robustness** (`options.ts`): the in-process cache now stores the in-flight promise (single-flight — concurrent cold callers collapse onto one fetch) and **retains only successful results** (a transient `provider_error`/`429`/`401` is never cached, so the next call retries immediately); the cookie+crumb handshake is single-flighted too; `429` surfaces Yahoo's `Retry-After`; the cache is size-bounded + swept. `providerStatusForHttp` factored out (tested).
- **Anti-hallucination gate** extracted to a pure, dependency-light `normalize.ts` (`numbersIn`/`numberSupported`/`normalizeOptionIdea`) and **directly unit-tested**: a strike/premium/trigger not in the cited transcript → null; "calls" → `long_call` strike null + `creatorSpecifiedContract=false`; bullish never forces calls; a transcript can never mint an `august_candidate`; the duplicate-trigger warning is gone (guarded once).
- **dedupeOptionIdeas** now keys on expiration too — "calls this week" vs "next month" stay distinct.
- **dates.ts** rejects impossible days (e.g. `2/30` → `resolved=null`) instead of emitting an invalid ISO string.
- **candidates.ts**: `priceOf` carries a `mid|last` basis and a `last`-priced number is disclosed as "may be a prior-session print"; the decision helpers (`pickExpiration`/`passesLiquidity`/`effLiquidity`/`priceOf`/`convictionFor`) are exported and **unit-tested** (0DTE-off, OI→volume fallback, spread-gate-only-when-two-sided, caps).
- **Settings**: `mergeOptionSettings` moved to a testable lib module; rejects `null` on non-nullable numerics, rejects negatives/non-finite, clamps to sane bounds, and swaps inverted `min/max` bands. Both options routes now validate the symbol format (`/^[A-Z][A-Z0-9.\-^=]{0,15}$/`); the candidates route whitelists `timeHorizon` and caps `targets`.
- **types/back-compat**: `getAnalysis` backfills `optionIdeas ??= []` so the required-array type stays honest for pass-1/2 blobs; the `as never` cast on `spreadPct` is gone (its parameter was widened).
- **UI**: the TradingView widget container stays mounted always with the fallback overlaid + a **Retry** button (a transient/slow load is now recoverable); the candidate-generator warning derives from the **live** response, not the stale brief snapshot; the contract drawer is a proper `role="dialog"` with Escape-to-close + focus management.
- **Ask-AUGUST** now grounds on `optionIdeas` (origin-aware) — options questions are answered from real option data.
- **Idea-status + consensus**: richer point-in-time `OptionStatus` derivation (`approaching_trigger`/`too_extended`/`target_reached`/`expired`) and a cross-channel **options consensus** (agree/conflict per underlying) in the brief + UI.

Verification after fixes: `tsc` clean · production build green · **54/54** `npm test` · runtime smoke re-confirmed.

## Deferred (explicitly out of scope this pass)

- **Cross-day options revision history** — idea status is a *point-in-time* read against the creator's stated levels; there is no multi-session supersede/revision timeline. (Trade-idea side has none either.)
- **`allowEarnings` and the preferred-delta band are documented PROXIES, not hard filters** — this provider supplies no Greeks and no per-symbol earnings calendar, so candidates are selected by **moneyness** (not delta) and earnings is not screened. The code is honest about this in each candidate's risk notes rather than faking it; wiring a Greeks/earnings provider would make these controls exact.
- **General Options Mentions (class D)** beyond creator-plays/directional are not separately surfaced; they fold into the directional/creator classes.
