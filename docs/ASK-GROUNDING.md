# ASK GROUNDING — the R1–R3 deliverable (formerly COMMAND-CENTER-FINAL.md)
### 2026-08-16 · R1–R3 complete on feature/command-center · companion to docs/AUDIT-R1-2026-08-15.md

> **Renamed 2026-09-02 (feature/command-bar).** "Command center" in this
> document means the ASK LANE'S GROUNDING — the regime computation, NQ levels,
> VIX-in-context, and the analyst grounding (`getDeskSnapshot`) that every ask
> is answered against. All of it stays in force for asks. The name "command
> bar" is reserved for the input's deterministic command lane, which never
> touches the model or this grounding.

## WHAT WAS WRONG (the audit's headline findings)
Full detail in the audit report; the classes: **no regime computation existed** (the only "regime" was an unrendered LLM transcript label) · **no freshness labeling** outside two components, with a hardcoded LIVE chip contradicting the STALE indicator beside it · **silent failure everywhere** (`catch(() => {})` + last-good-persists; fabricated `LIVE 0/TRACKED 0` zeros) · **ten live-but-dead public routes** left over from parked surfaces, one backing a "Live aircraft" chat claim nothing populated · **raw vendor/config errors served to anonymous callers** (including env-var setup instructions) · **misnamed data** ("overnight H/L" that was a prior daily bar; server NQ silently QQQ×40) · mobile reachability bugs (IDEAS drawer unopenable on phones) · heavy duplication (two idea pipelines, two F&G indexes, 7 sparkline impls, 5 price formatters, 4 status vocabularies).

## WHAT CHANGED
**R1 (merged, production):**
- Hardening: dead routes + their parked callers deleted (rebuildable from git); every public route rate-limited; settings gated; all error bodies generic (vendor detail → logs); module-load fetch fan-out killed; the aircraft claim removed and the model instructed to say flight tracking is unavailable.
- MARKET REGIME apex on the home brief: pure `lib/regime.ts` — index trend (pulse sparks), VIX level + trend, book bias, NQ vs stated book levels → RISK ON/NEUTRAL/RISK OFF + because-list with live values + literal agreement count ("4 of 4 inputs agree" — no fake %). UNAVAILABLE under 2 inputs; the apex never vanishes.
- Integrity vocabulary (`DataTag`): LIVE / DELAYED / SIMULATED / PROXY / DATA UNAVAILABLE / CALCULATED / STALE — spread to home pulse, watching strip, market-pulse module, and the desk's three mislabeled chips. Honest failure states replace silent nothing; fabricated zeros gone; movers colors follow the sign.
- Mobile: IDEAS restored to the phone tab bar; delete-timer leak fixed. PIT: bestTrade computed (never hardcoded 0), sim benchmark prints INDEX not SPY, tuning panel validates its token.

**R2 (merged, production):**
- NQ LEVELS, first-class on the real `NQ=F`: prev H/L/C + pivot from daily bars; **VWAP from genuinely captured volume** (the Yahoo payload always carried it; the pipeline discarded it) and **overnight H/L from timestamped 5m bars** — each omitted with a stated reason when unsupported; closed days slice the last real session (`lastSession`) instead of approximating. CALCULATED bias (majority of price vs prev close/pivot/VWAP), BOOK LEVELS chips from stated idea levels. Terminal module + phone LEVELS segment + home brief chip.
- VIX IN CONTEXT: level, change, fixed buckets (<15/<20/<28), and a context sentence **generated from the numbers** (five tested shapes).

**R3 (this gate):**
- ANALYST GROUNDING: `getDeskSnapshot()` injects the app's own displayed read into every chat turn — the regime with its because-list, NQ session levels, the live book (sides + stated levels), latest headlines — with unavailability stated per line and a hard rule: cite these, never fabricate a live number; beyond this block, say the desk doesn't carry it.
- PIT POST-TRADE REVIEW: pure `explainTrades()` — one dry line per deliberate close from observable round data, prioritized event-linkage > adverse excursion > entry quality > stated hindsight ("held through the EARNINGS BEAT print (the headline lied)"; "exited 5s before the GUIDANCE CUT window"). On all result screens; live closes get a factual floor line when ≥5% was held against.
- Polish: one minus glyph app-wide; absent TARGET matches absent ENTRY; dead ternary removed; blotter dashes carry explanations.
- QA: suite 285 green (regime 8, levels 7, review 4, fairness ×3, B1 contract); console-clean runtime sweep across all views/widths; career + daily probes green; admin/login/home 200.

## WHAT REMAINS INCOMPLETE
- The duplication tax is reduced but not paid off: two idea pipelines still render side-by-side; sparkline/formatter/vocabulary consolidation was out of R3's sane scope (recommended below).
- OptionsWorkspace has no ≤700px fork (900px breakpoint only); the public feed's phone tree still flashes desktop-first on load.
- STALE on /admin remains a per-browser localStorage judgment.
- F&G gauge holds an `asOf` it still doesn't render.
- The market-reaction line for released events (R4 F2-A) is speced but unbuilt — it lands with the front page.

## DATA STILL REQUIRED (unlocks with revenue; DATA LAW held throughout)
Market breadth / advance-decline · put/call ratio · Fed expectations / rate-probability feed · real options flow (the tape stays desk commentary) · a vetted economic release calendar for display (the free JSON exists; F2's vetting gate decides) · financial stress + yield curve as displayable series (FRED-keyed, currently prose-only) · true real-time quotes (everything today is honestly DELAYED).

## ASSUMPTIONS MADE
Yahoo's 5m volume is truthful enough for a labeled VWAP · a 60s-cached quote is "DELAYED", never "LIVE" · the regime's fixed thresholds (±1% trend, VIX 15/25, ±1pt trend) are reasonable defaults pending owner tuning · deleting parked surfaces is acceptable because git preserves them (owner-authorized in the A1 amendment) · agreement-count is the only honest "confidence" these inputs support.

## RECOMMENDED NEXT BUILDS
1. **R4 — the front page** (queued, speced, F2 amendments recorded).
2. **Consolidation round**: one sparkline, one price/date formatter module, one status+direction vocabulary — pure refactor, big confusion payoff.
3. **AUTH-1b wall** when two of the three PARKED triggers fire (plumbing already lock-ready per L6).
4. **PIT real-replay mode** on the approved `getHistory()` intraday reuse (career day vs the real session's tape).
5. **FRED wiring round**: yield curve + stress as displayed, labeled series (key already supported).
