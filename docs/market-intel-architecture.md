# AUGUST Market Intel — Architecture

> Status: **Phase 1 (foundation + working manual-transcript slice).** Built on an
> isolated git worktree (`feature/market-intel`). The existing AUGUST app is untouched.

## 1. What this is

A new top-level destination at **`/intel`** that monitors selected YouTube market
channels, ingests their transcripts, and turns hours of livestream/prep video into a
concise, **evidence-backed**, citation-linked nightly market brief — with trade ideas,
levels, catalysts, cross-source consensus, and "Creator Favorites" pulled from the
creators' own designated segments. It is a **decision-support / research** system. It
**never trades** and **never invents** prices, tickers, levels, or catalysts.

## 2. How it fits the existing stack (reuse, don't reinvent)

Inspected from the repo. Market Intel deliberately reuses every one of these:

| Concern | Existing AUGUST | Market Intel uses |
|---|---|---|
| Framework | Next.js 15 App Router, React 19, TS 5.7 | same; new route `app/intel` + `app/api/intel/*` |
| AI | **direct `@anthropic-ai/sdk`** (never Vercel AI SDK) — see `lib/morningbrief.ts`, `app/api/chat` | same SDK; **structured JSON via a forced tool-call** (not free-form parsing) |
| Store | **Upstash Redis (KV)** — `lib/gmail.ts`, `lib/memory.ts`, `lib/morningbrief.ts`, watchers | same Redis; namespaced `august:intel:*` keys. **No new database.** |
| Styling | Tailwind v3.4 + CSS design tokens in `app/globals.css` (`--bone --ash --steel --charcoal`, mono/sans fonts), dark-first, theme-aware | same tokens + a small `intel-*` stylesheet block; matches the terminal aesthetic |
| Rate limit | `lib/ratelimit.ts` (per-IP sliding window, fail-open) | new route keys `intelSync`, `intelAsk`, `intelMutate` |
| Cron | Vercel Cron + `CRON_SECRET` Bearer (`app/api/cron/brief`) | new `app/api/cron/intel` guarded by the **same `CRON_SECRET`** pattern |
| Market data | `lib/markets.ts` `getQuote()` / `getMarkets()` (Yahoo, free), `lib/command.ts`, `lib/intel.ts` (RSS) | enrichment reuses `getQuote()` — **no new market feed** |
| Env convention | server-only keys in `.env.local`, documented in `.env.local.example`; `NEXT_PUBLIC_` only for the VAPID public key | same; new keys are **optional** and documented |
| Auth | single-user app, no login; server holds secrets; cron/secret-gated mutations | same posture; mutations are secret/secure-context gated, scheduled routes need `CRON_SECRET` |

**No second UI framework, DB, state library, or styling system is introduced.**

## 3. The hard constraint: transcripts

YouTube has **no compliant public API for auto-generated captions** without OAuth/owner
access, and scraping protected media is out of scope (and against ToS). So:

- **The manual-transcript-paste path is first-class and works today** with zero external
  keys. Paste a transcript (or a chapter) → AUGUST extracts structured, cited intel.
- **`YouTubeProvider`** uses **oEmbed** (keyless) for title/author/thumbnail today, and the
  **YouTube Data API v3** (`YOUTUBE_API_KEY`, optional) for channel resolution, upload-
  playlist discovery, chapters, and live status when a key is present.
- **`TranscriptProvider`** is an interface with adapters: `manual` (always works),
  `timedtext` (best-effort public-caption fetch — may legitimately fail and is reported
  honestly), and a pluggable `external` adapter slot for an authorized transcription
  provider. **Status is never faked** — a missing transcript shows `unavailable` /
  `permission_required` / `live_caption_pending`, never a hallucinated transcript.

## 4. Provider interfaces (`lib/intel/providers.ts`)

```
YouTubeProvider     resolveUrl, getVideoMeta, resolveChannel, listChannelUploads, getLiveStatus
TranscriptProvider  fetch(videoId) -> { status, segments? }   (adapters: manual | timedtext | external)
IntelligenceProvider analyzeChapter(chunk) , analyzeVideo(...) , synthesizeBrief(...)   (Anthropic)
MarketDataProvider  getQuote (reuses lib/markets)
NotificationProvider send(...)  (reuses lib/push; opt-in only)
```

Everything is constructed behind these seams so a channel/transcript source can be swapped
without touching the UI or the pipeline.

## 5. Data model (Upstash Redis, namespaced `august:intel:`)

Relational-style entities modeled as Redis hashes + index sets (mirrors `lib/gmail` /
watchers patterns). JSON is used for the nested analysis payload where relational shape
adds nothing.

| Key | Type | Holds |
|---|---|---|
| `august:intel:sources` | hash id→Source | monitored channels/videos (id, type, channelId, title, thumb, enabled, lastChecked, lastProcessed, status, template) |
| `august:intel:videos` | hash id→Video | discovered videos (videoId, sourceId, title, publishedAt, duration, liveState, status, transcriptStatus, analysisVersion, counts) |
| `august:intel:transcript:{videoId}` | string(JSON) | normalized `TranscriptSegment[]` (id, startSeconds, endSeconds, text) — timestamps preserved |
| `august:intel:chapters:{videoId}` | string(JSON) | `Chapter[]` (title, normalizedCategory, start/end, priority, detection, creatorDefined) |
| `august:intel:analysis:{videoId}` | string(JSON) | the strict `VideoAnalysis` schema (claims/tradeIdeas/levels/catalysts, each segment-linked) |
| `august:intel:jobs` | hash id→Job | idempotent processing jobs (state machine, attempts, error, version, timestamps) |
| `august:intel:brief:{date}` | string(JSON) | dated `DailyBrief` (synthesis + ranked items + consensus/conflicts) |
| `august:intel:briefdates` | sorted set | brief dates for history |
| `august:intel:settings` | string(JSON) | user settings (brief times, tz, min confidence, show inferred, notif prefs) |
| `august:intel:logs` | list (capped) | structured processing logs (no secrets, no full transcripts) |

Indexes: per-source video set `august:intel:source:{id}:videos`, ticker mention set
`august:intel:ticker:{SYM}` (for "did either creator mention NVDA"), `videos` ordered by
publishedAt. Uniqueness: video keyed by `videoId`; ideas deduped by
`(ticker|direction|round(entry)|segment-overlap)`.

## 6. AI extraction pipeline (chapter-first, evidence-anchored)

1. **Normalize** transcript → `TranscriptSegment[]` with stable ids + start/end seconds.
2. **Chapters**: parse from YouTube chapter metadata / description timestamps; else infer
   from verbal cues — **inferred chapters are labeled AUGUST-detected, never creator-defined.**
3. **Fast pass**: process **priority chapters** (Favorite Setups / Predictions / Watchlist /
   Game Plan — per the channel template) FIRST → a preliminary, clearly-labeled brief.
4. **Full pass**: process the whole transcript in semantic chunks for context,
   contradictions, thesis changes, risk warnings.
5. Each chunk → a **forced-tool-call** returning the strict schema; every claim / idea /
   level / catalyst carries `sourceSegmentIds` + `sourceStartSeconds/EndSeconds` + chapter
   context + `explicitness: explicit|inferred`.
6. **Validate**: numeric prices/levels must appear in the cited segments' text; tickers
   validated/normalized (`lib/intel/tickers.ts`, cross-checked against `getQuote`). Failing
   items are dropped or down-confidenced with a warning — **never invented**.
7. **Merge/dedupe** across chunks. **Enrich** mentioned tickers with `getQuote()` into a
   SEPARATE field (creator's quoted price and the live price never overwrite each other).
8. **Cross-video synthesis** → consensus / conflicts (latest explicit statement wins for the
   summary; earlier statements preserved with both timestamps).
9. **Daily brief** assembled with transparent ranking (factors shown, not a black-box score).

Confidence scale (documented): `0.0–1.0` — 0.85+ explicit + specific + recent + corroborated;
0.5–0.85 explicit but partial; <0.5 inferred / vague / stale. **Confidence ≠ profitability**,
and creator popularity/view-count is **not** a ranking factor.

## 7. Anti-hallucination (enforced in code, not just prompt)

- Forced JSON tool output (no free-form parsing of core data).
- Every idea/level links ≥1 segment id; the validator rejects orphans.
- Numeric prices/levels regex-checked against cited segment text.
- `entry/invalidation/targets` default to `{ value: null, text: "Not specified" }` — never filled.
- `explicit` vs `inferred` is a required field and surfaced as a badge in the UI.
- Stale videos (publishedAt older than the current market day) carry a visible `STALE` warning.
- "Insufficient evidence" is shown rather than a guess.

## 8. Routes (App Router, `nodejs` runtime, `force-dynamic`)

```
GET/POST/DELETE  /api/intel/sources            list / add (resolve URL) / remove
GET              /api/intel/videos             list (filters)
GET              /api/intel/videos/[id]        detail (meta+chapters+analysis)
POST             /api/intel/videos/[id]/transcript   manual transcript paste → process
POST             /api/intel/videos/[id]/reprocess    re-run extraction (new version)
POST             /api/intel/sync               discover new videos (needs YOUTUBE_API_KEY)
GET              /api/intel/briefs             list dates
GET/POST         /api/intel/briefs/[date]      get / generate dated brief
POST             /api/intel/ask                retrieval Q&A over processed videos (cited)
GET              /api/intel/export/[date]      markdown export
GET/POST         /api/intel/settings          read / update settings
GET (cron)       /api/cron/intel               scheduled discovery + nightly brief (CRON_SECRET)
```

Mutations are gated (secret/secure-context, same posture as the rest of the app); the cron
route requires the `CRON_SECRET` Bearer exactly like `/api/cron/brief`.

## 9. Scheduling

Reuses the Vercel-Cron + `CRON_SECRET` pattern. `app/api/cron/intel` does discovery
(every ~10–15 min when wired) + the nightly brief (≈9:30pm ET) + an optional premarket
refresh (≈8:15am ET) — all **configurable in settings**, not hard-coded. The user wires the
external pinger / Vercel Cron entry after deploy (same as Watchers).

## 10. UI (`app/intel`, matches AUGUST)

Server route shell + a client dashboard using the existing tokens/fonts. Sections:
Command Header · Tonight's Brief (+ "Read in 60s") · Top Trade Ideas · **Creator Favorites** ·
Consensus & Conflicts · Levels & Triggers · Catalyst Map · Source Monitor · Video Library ·
Video Detail (drawer w/ chapter timeline + clickable timestamps) · Ask AUGUST · Daily History ·
Export. Compact tables on desktop, cards on mobile. Honest skeleton / empty / pending / error /
retry states. Status badges: LIVE · PROCESSING · TRANSCRIPT PENDING · VERIFIED · SOURCE CLAIM ·
AUGUST INFERENCE · STALE · CONFLICT · TRIGGERED · INVALIDATED · CREATOR FAVORITE · CREATOR PREDICTION.

## 11. Why coherent authoring over parallel agents

This module is tightly coupled (UI → store → types; routes → extract → schema). It was
authored in dependency order and typechecked as one unit so the contracts stay consistent —
parallel fan-out would risk type/import drift in interdependent greenfield code. The breadth
(many UI sections, providers) is real code, not stubs; anything that needs an external key is
labeled, never faked.

## 12. Phasing (delivered vs. staged)

- **Phase 1 (this build):** worktree + route + nav; source mgmt; URL resolve + oEmbed meta;
  transcript provider (manual works today); chapter parse + fast/full extraction with the
  strict cited schema; video notes + detail drawer; top ideas + Creator Favorites; dated brief
  generate/view; honest states; market enrichment via `getQuote`; tests for the pure logic;
  docs + env.
- **Phase 2 (staged, interfaces ready):** Data-API auto-discovery + caption fetch (needs key);
  scheduled cron discovery + nightly auto-brief; historical diffing; retry/backoff jobs UI.
- **Phase 3 (staged):** cross-source consensus depth; Ask-AUGUST retrieval; level-trigger
  tracking; opt-in notifications; authorized rolling live analysis.
