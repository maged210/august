# Multi-user AUGUST — architecture, setup, and contracts

Branch: `multi-user`, three stages. Stage 1 = identity (next-auth v5 Google
sign-in, `/login`, the middleware gate, the landing session chip). Stage 2 =
per-user data isolation (`lib/user-scope.ts`: key namespacing, first-login
seeding, owner migration, the watchlist store). Stage 3 = the human layer:
`/welcome` onboarding, signed-out surface states, watchlist-driven WATCHING
pills, and this document.

Free tier by design: no billing, no plans — the cost ceiling is auth-gating
the expensive routes plus per-IP rate limits (see "Cost gates" below).

---

## 1. Two Google flows, deliberately separate

| | Sign-in (identity) | Comms (Gmail/Calendar) |
|---|---|---|
| Library | next-auth v5 (`auth.ts`) | hand-rolled OAuth (`lib/gmail.ts`) |
| Scopes | `openid email profile` — **only** | `gmail.readonly` + `calendar.events.readonly` + `gmail.send` |
| Consent | `/login` → Google → done | Comms panel → "Connect Gmail" → its own consent screen |
| Callback | `/api/auth/callback/google` | `/api/auth/google/callback` |
| Storage | stateless JWT cookie (no DB) | refresh token in Redis (`august:gmail:tokens`, scoped per user) |

Signing in **never** grants mail access. The `/welcome` Gmail toggle is a
preference, not a connection — the copy says so ("Connect in Comms later —
mail scopes are a separate consent"). One Google Cloud OAuth client can carry
both flows; it just needs both redirect URIs registered.

## 2. The key namespace

Everything personal goes through `scopeKey(email, legacyKey)` in
`lib/user-scope.ts`:

- `email === null` (auth unconfigured) → the **legacy key unchanged, byte for
  byte** — the single-user fallback contract.
- signed-in → `user:{email}:{legacyKey}` (email lowercased, trimmed, and
  rejected outright if it could smuggle key structure).

| Legacy key | What it is |
|---|---|
| `august:profile` | long-term memory profile |
| `august:summaries` | rolling conversation summaries |
| `august:threads:index` + `august:threads:t:{id}` | saved conversations (RECENT THREADS) |
| `august:gmail:tokens` | Comms OAuth refresh token |
| `august:brief:{YYYY-MM-DD}` | the day's compiled morning brief |
| `august:push:subs` | web-push subscriptions (hash) |
| `august:watchers` | standing market/quake/intel alerts (hash) |
| `august:watchlist` | the WATCHING symbols (stage 2 — no legacy equivalent existed) |
| `august:feeds` | feed prefs `{ gmail, rss, markets }` (stage 3 route) |

Per-user flags (no legacy form — they only exist namespaced):
`user:{email}:seeded`, `user:{email}:migrated` (owner only),
`user:{email}:onboarded` (stage 3 — "has seen /welcome").

Global, deliberately **not** namespaced:

- `users:index` — SET of every seeded account; crons iterate this, never SCAN.
- `august:intel:*` — the intel desk is **shared reading** for every signed-in
  user; only its MUTATING routes (sources add/remove, sync, transcript,
  reprocess, brief generation, settings) are owner-gated
  (`checkIntelMutateAllowed`: 401 signed-out, 403 non-owner, open when auth
  is unconfigured). Reads stay public.

## 3. The single-user fallback contract

When `AUTH_SECRET` or the Google client is absent, **nothing changes** from
pre-multi-user behavior — this is load-bearing and test-pinned:

- middleware passes every personal route through (one `console.warn`);
- `scopeKey(null, k) === k` — all data lives on the legacy keys;
- `/login` says sign-in isn't configured; `/welcome` redirects home;
- the landing shows no session chip and **no settings gear**, and WATCHING
  shows the hardcoded public five (NQ ES BTC SOL VIX);
- Comms/Brief show today's states (connect card / compile pill) — the
  "Sign in to personalize" states can never appear (they trigger on 401s the
  middleware never issues when unconfigured).

Defense-in-depth: personal stores resolve their namespace via
`requireSessionEmail()`, which **throws** when auth is configured but there's
no session — a signed-out request can never silently alias onto the legacy
(shared) keys even if a middleware matcher were missed.

## 4. First login, seeding, and the owner migration

On every sign-in (`auth.ts` `events.signIn` → `ensureUserSeeded`, plus a lazy
backfill in `/api/watchlist` and `/api/feeds` GET):

1. `SADD users:index {email}` (idempotent);
2. take `user:{email}:seeded` via SET NX — already held → stop (re-logins
   are no-ops that can never clobber user data);
3. seed `august:watchlist` = SPY QQQ BRK-B NVDA TSLA and `august:feeds` =
   `{ gmail: false, rss: true, markets: true }`, each SET NX.

For the OWNER only, `migrateOwnerLegacyData` then **copies** every legacy
personal store (the table above) into `user:{owner}:*`. Copy, never move:
legacy keys stay behind as the live store for the unconfigured fallback and
as a safety net. Every destination is copy-if-absent; the
`user:{owner}:migrated` flag is written only after the pass, so a crash
mid-migration simply retries next login. TTLs are preserved.

`OWNER_EMAIL` (default `magedmilek@gmail.com`) is also the only account
allowed to mutate the shared intel desk once auth is configured.

## 5. Onboarding — /welcome (stage 3)

One screen, two light sections, skippable, re-editable — setup, not friction.

```
first sign-in ──► lands on /            (signIn redirectTo "/")
                  landing session fetch sees onboarded=false
                  ──► one-time nudge → /welcome        (once per browser
                                                        session, sessionStorage-guarded)
/login visited while signed in:
  not onboarded ──► redirect /welcome   ("Set up AUGUST")
  onboarded     ──► redirect /

/welcome:
  auth unconfigured ──► redirect /      (no accounts to set up)
  signed out        ──► redirect /login
  signed in         ──► WATCHLIST (seed as removable chips + add input,
                                   format-validated client-side, server
                                   re-validates; 1–12 symbols)
                        FEEDS     (three aria-pressed toggles: Gmail — a
                                   preference only, RSS/World, Markets)
       [Start]        ──► PUT /api/watchlist + PUT /api/feeds
                          {prefs, onboarded:true} ──► /
       [Skip for now] ──► PUT /api/feeds {onboarded:true} only (the seed
                          stands) ──► /

later: the landing's gear (session-only control) ──► /welcome, titled
       "Your setup", Start becomes Save, Skip becomes Back.
```

There is deliberately **no other account-settings UI**. The onboarded flag
gates the nudge and nothing else; storage failures fail toward "don't nag".

Signed-out surface states (auth configured, no session):

- **Comms** — centered "Sign in to personalize. / Your Gmail, your
  briefings." + SIGN IN, instead of the connect card (triggered by the
  middleware's 401 on `/api/inbox`).
- **Morning Brief** — the summoned card offers Sign in instead of a compile
  (401 on `/api/brief`).
- **Markets / World / Intel** — untouched; their data is public.
- **WATCHING pills** — the public macro five, exactly as signed-out today.

## 6. Setup — exact user steps

1. **Google Cloud** (console.cloud.google.com → APIs & Services →
   Credentials): reuse the existing Comms OAuth client (or create one, type
   *Web application*) and add NextAuth's redirect URI **alongside** the Comms
   one:
   - `http://localhost:3000/api/auth/callback/google` (dev)
   - `https://YOUR-DOMAIN/api/auth/callback/google` (production)
2. **`.env.local`** (see `.env.local.example`):
   - `AUTH_SECRET` — required to enable sign-in. Generate: `npx auth secret`
     (or `openssl rand -base64 33`).
   - `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — optional; when unset the Comms
     `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are reused.
   - `OWNER_EMAIL` — optional; defaults to `magedmilek@gmail.com`.
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — required for any
     per-user persistence (watchlist, feeds, seeding, migration).
3. **Vercel**: add the same vars in Project → Settings → Environment
   Variables (or `vercel env add`); redeploy. `trustHost` is already set for
   Vercel's proxy. `APP_ORIGIN` pins the Comms OAuth redirect origin in
   production (auto-derived from `VERCEL_PROJECT_PRODUCTION_URL` if unset).
4. Sign in with the owner account once — the legacy data migration runs on
   that first login.

## 7. Cost gates (the free-tier ceiling)

Auth-gated personal routes (middleware → 401 signed out; **unconfigured
passes through**): `/api/chat`, `/api/memory`, `/api/threads(/[id])`,
`/api/day`, `/api/comms/*`, `/api/inbox`, `/api/brief`, `/api/speak`,
`/api/deepgram-token`, `/api/watchlist`, `/api/feeds`,
`/api/push/subscribe`.

Public but separately protected: `/api/cron/*` (CRON_SECRET),
`/api/push/send` (PUSH_SEND_SECRET), intel mutations (owner gate).
Public data: `/api/markets`, `/api/quakes`, `/api/intel/*` reads,
`/api/command`, `/api/flights`.

Per-IP sliding-window limits (60s, `lib/ratelimit.ts`; fail-open when
Upstash is absent): chat 10 · speak 40 · intel 30 · memory 20 · inbox 20 ·
brief 6 · token 30 · intelMutate 30 · intelProcess 8 · intelAsk 20 ·
push 20 · day 30 · draft 15 · commsSend 10 · watchers 10 · intel-track 10 ·
threads 30 · watchlist 30 · feeds 30.

The expensive engines (Anthropic, ElevenLabs, Deepgram, Gmail send) all sit
behind **both** gates.

## 8. Known deferred items

- **Per-user intel** — the desk (sources, ideas, tracker, intel brief) is one
  shared instance; every signed-in user reads the owner's board. Per-user
  boards would need namespaced `august:intel:*` plus per-user cron fan-out.
- **Per-user brief scheduling** — the daily cron compiles and pushes for the
  owner-shaped instance; other accounts get on-demand compiles only. Fan-out
  over `users:index` (with per-user Gmail/Calendar tokens) is wired for but
  not built.
- **Account deletion** — no self-serve wipe of a `user:{email}:*` namespace
  yet (manual Redis cleanup; `users:index` SREM by hand).
- **Feed prefs are stored, lightly consumed** — the three toggles persist per
  user, but surfaces don't yet hide/show wires off them; they're the contract
  for that follow-up.
- **Free tier only** — no plans/billing; the gates above are the ceiling.
