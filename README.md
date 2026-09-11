# AUGUST

A one-operator market desk. It publishes a dated directional call on the
Nasdaq every trading day and grades itself against the close, keeps a book of
trade ideas extracted from market commentary, and runs two simulated trading
games — and every surface that says any of it carries the line that it is
research and opinion, not investment advice.

> **Research and opinion, not investment advice.** See [/terms](app/terms) and
> [/privacy](app/privacy), which are real routes in the app.

---

## What it actually is

Three views, one screen, navigated by `?view=`.

| View | What it is |
| --- | --- |
| **the floor** (`/`) | The orb, the command bar, the market regime read, **THE CALL**, NQ levels, sector heat, the desk tape. |
| **the terminal** (`?view=terminal`) | The owner sees the desk: the idea board, the brief, sources, options. Everyone else sees the public ideas blotter — ticker, side, entry, target, stop, performance. |
| **the pit** (`?view=pit`) | THE PIT and the Training floor. Simulated, no real orders. |

**The command bar is the only input.** It has two lanes and they never mix.
Commands (`<TICKER>`, `arm`/`close`, `higher`/`lower`, `call`, `why`, `pit`,
`terminal`, `ideas`, `inbox`, `clear`, `/forget`) resolve deterministically on
the server and **never reach the model**. Anything else is an ask: one message,
no tools, a small stated token budget, cached ten minutes, capped per day. The
answer is one card that the next input replaces. There is no chat history, no
threads, and no conversation UI anywhere — that is a design law, not an
oversight.

**THE CALL** is the spine. Every trading day AUGUST commits to HIGHER or LOWER
on NQ before the close; the direction is deterministic from a regime model, not
from a model call. You can agree or take the other side. At 22:10 UTC the daily
pass settles it against Yahoo's daily bar and both running records update, from
0–0, win or lose.

**The ideas book** is fed by pasting a market-commentary video link in `/admin`.
The transcript is fetched, an extractor pulls out candidate ideas, and every
one of them lands in a review queue. Nothing auto-publishes: approving is a
human tap. An extracted idea has to clear a floor (a stated level or a specific
stated trigger) and its ticker has to resolve to a real instrument before it can
queue at all.

**Not a chatbot, and no voice.** Voice was retired in August 2026 — no TTS, no
STT, no microphone.

---

## Running it locally

```bash
npm install
cp .env.local.example .env.local   # then fill it in — see below
npm run dev                        # http://localhost:3000
npm test                           # node:test, no network
npm run build                      # production build
```

**The minimum that boots something useful** is the two Upstash variables plus
`ANTHROPIC_API_KEY`. Without Upstash there is no sign-in, no PIT, no THE CALL,
no book, no admin queue — and no rate limiting, which means the daily spend cap
on the ask lane silently does not exist. Treat it as required, not optional.

**Sign-in works locally with no key at all.** It is an email magic link via
Resend; outside production with no Resend key the link prints to the server
console, so the whole flow is testable offline.

**Two keys cost money per call:** `ANTHROPIC_API_KEY` and
`TRANSCRIPT_PROVIDER_API_KEY` (Supadata, billed in credits). Everything else is
free or free-tier. `.env.local.example` marks both and explains the cost
discipline built around them.

**A new key goes in two places** — `.env.local` for local dev *and* the Vercel
project's environment variables for deployed builds. Setting only one is the
usual reason something works locally and dies in production.

---

## How it is put together

- **Next.js App Router**, React, TypeScript. Deployed on Vercel.
- **Upstash Redis** is the only database, under `august:*` keys.
- **Auth.js v5** with a single Resend email provider. Sessions are stateless
  JWTs carrying only an email; owner status is derived from `OWNER_EMAIL` at
  request time and never stored.
- **Market data is free and mostly keyless** — Yahoo for quotes and daily bars,
  FRED for macro, Finnhub for earnings dates, CoinGecko and Coinbase for crypto,
  plus public RSS. Delayed data is labelled as delayed rather than dressed up.
- **One scheduled job.** `vercel.json` declares exactly one cron,
  `/api/cron/intel-track` at 22:10 UTC, which settles THE CALL, runs the idea
  tracker, backfills calendar actuals, and sends the day's one push.
- **PWA + Web Push** with VAPID and no third-party push service. The service
  worker does push and notification clicks only — there is no offline caching.

### The laws worth knowing before you change anything

1. **Never invent a number.** Absent data renders as absent. A level the source
   did not state stays missing and the row says so.
2. **The queue is the only way in.** Anything the extractor cannot fully parse
   goes to `/admin` for a human tap. Denial is terminal and carries a reason —
   never a silent deletion.
3. **Commands never reach the model.** A command-shaped parse failure hints
   locally; an unknown ticker says NO SUCH SYMBOL. Neither falls through.
4. **Every surface that publishes a call carries the disclaimer**, as rendered
   text — never a tooltip, never hover-gated. One component, one string, in
   `lib/disclaimer.ts`.

`CLAUDE.md` carries the standing decisions, what was deliberately abandoned, and
why. Read it before a change that touches the extractor, the ticker gate, the
tracker, or the settle cron.
