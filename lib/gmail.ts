// Gmail integration — SERVER ONLY. Read-only access to the owner's inbox.
//
// SECURITY MODEL (non-negotiable):
//   - Scope is gmail.readonly ONLY. No send, no modify, no delete.
//   - The OAuth client secret and ALL tokens live server-side: env + Upstash.
//     Nothing here is ever serialized to the browser. The only thing the client
//     receives (via /api/inbox) is normalized { ts, sender, subject, category }
//     metadata — never tokens, never message bodies.
//   - The code→token exchange happens server-side in the callback route.
//   - Tokens are stored in Upstash PER USER (stage 2): every function takes the
//     session email (resolved once by the route) and scopes its key through
//     scopeKey — null email = single-user fallback = the legacy key, unchanged.
//     Refresh tokens persist; access tokens are refreshed automatically when
//     they near expiry.
//
// We use raw fetch against Google's REST endpoints (no googleapis SDK) to match
// the rest of the codebase and keep the bundle light.

import { Redis } from "@upstash/redis";
import { scopeKey } from "./user-scope";

// ---- endpoints -----------------------------------------------------------
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Read-only scopes. Gmail (inbox metadata) + Calendar events (today's agenda).
// Both are least-privilege readonly; the same single OAuth client + token store
// covers both via incremental authorization (include_granted_scopes). Adding the
// calendar scope requires the user to re-consent once (the Google connect re-grant).
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
// Send is its own least-privilege scope (send-only — cannot read or draft) and is
// ADDITIVE: it never weakens the readonly read path. It only gates the explicit
// user-tap send (lib/calendar.ts is unaffected). gmail.send is "sensitive", not
// "restricted", so it carries the lighter OAuth-verification path.
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE, GMAIL_SEND_SCOPE];

/** Membership test against the space-delimited granted-scope string Google returns
 *  (order isn't guaranteed and it may include extra scopes — never equality-check). */
export function scopeGranted(scopes: string | undefined, scope: string): boolean {
  return !!scopes && scopes.split(/\s+/).includes(scope);
}

const TOKENS_KEY = "august:gmail:tokens";
const tokensKey = (email: string | null) => scopeKey(email, TOKENS_KEY);
const EXPIRY_SKEW_MS = 60_000; // refresh a minute before actual expiry
const INBOX_COUNT = 15;
const INBOX_TTL_MS = 3 * 60_000;

// ---- token store ---------------------------------------------------------
type Tokens = {
  access_token: string;
  refresh_token: string;
  expiry: number; // ms epoch when the access_token expires
  email?: string; // the connected account, for display only
  scopes?: string; // space-delimited granted scopes (so we know if calendar is in)
};

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

export function oauthConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function storageConfigured(): boolean {
  return getRedis() !== null;
}

async function loadTokens(email: string | null): Promise<Tokens | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return (await redis.get<Tokens>(tokensKey(email))) ?? null;
  } catch {
    return null;
  }
}

async function saveTokens(email: string | null, t: Tokens): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(tokensKey(email), t);
  } catch {
    /* best-effort; a failed write just means the next call re-refreshes */
  }
}

async function clearTokens(email: string | null): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(tokensKey(email));
  } catch {
    /* ignore */
  }
  _inboxCache.delete(cacheId(email));
}

/** Whether a Google connection is stored for this user's namespace — the brief
 *  cron's cheap eligibility check (one GET, no refresh, no Google call). */
export async function hasStoredGoogleTokens(email: string | null): Promise<boolean> {
  return (await loadTokens(email)) !== null;
}

// ---- origin / redirect URI -----------------------------------------------
// SECURITY: the origin drives both the OAuth redirect_uri AND the post-callback
// browser redirect, so it must NOT be derived from a client-controllable Host /
// X-Forwarded-Host header — that would allow open redirects and a Secure-cookie
// downgrade. Production hosts come from SERVER-INJECTED config only (an explicit
// APP_ORIGIN, or Vercel's auto-injected URLs). localhost is trusted for dev.

function configuredOrigins(): string[] {
  const out: string[] = [];
  const app = process.env.APP_ORIGIN;
  if (app) out.push(app.replace(/\/+$/, ""));
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) out.push(`https://${prod}`);
  const dep = process.env.VERCEL_URL; // per-deployment (preview) URL
  if (dep) out.push(`https://${dep}`);
  return out;
}

function isLocalHost(host: string): boolean {
  const h = host.split(":")[0];
  return h === "localhost" || h === "127.0.0.1";
}

// The redirect_uri used in the auth request MUST byte-for-byte match the one in
// the token exchange, so both routes derive it through this single helper.
export function getOrigin(req: Request): string {
  const url = new URL(req.url);
  // Key the dev decision on the DIRECT Host header, not the forwardable one: a
  // browser sets Host from the URL it navigates to, and Vercel sets it to the
  // real domain — so a client-injected X-Forwarded-Host can't fake localhost.
  const directHost = req.headers.get("host") ?? url.host;

  if (isLocalHost(directHost)) {
    const proto = url.protocol.replace(/:$/, "") || "http";
    return `${proto}://${directHost}`;
  }

  // Production: the request host must match a server-configured origin (sourced
  // only from server-injected env, never client headers). On a match we return
  // the CONFIGURED value (canonical scheme), not whatever the header carried.
  const hostHeader = req.headers.get("x-forwarded-host") ?? directHost;
  const configured = configuredOrigins();
  const match = configured.find((o) => {
    try {
      return new URL(o).host === hostHeader;
    } catch {
      return false;
    }
  });
  if (match) return match;

  // Forged or unknown host → ignore it entirely, use the canonical origin.
  if (configured.length) return configured[0];

  // Nothing configured (non-Vercel deploy without APP_ORIGIN): best effort, but
  // force https so the Secure flag is never downgraded by a forged proto header.
  return `https://${hostHeader}`;
}

export function redirectUri(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

// ---- OAuth: build consent URL --------------------------------------------
export function buildConsentUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "), // gmail.readonly + calendar.events.readonly
    access_type: "offline", // get a refresh token
    prompt: "consent", // force refresh-token issuance even on re-consent
    include_granted_scopes: "true", // incremental: merge with any already-granted scopes
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ---- OAuth: exchange authorization code for tokens -----------------------
export async function exchangeCode(
  email: string | null,
  origin: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!oauthConfigured()) return { ok: false, error: "oauth_not_configured" };
  if (!storageConfigured()) return { ok: false, error: "storage_not_configured" };

  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(origin),
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "network" };
  }

  if (!res.ok) return { ok: false, error: `exchange_${res.status}` };

  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  } | null;

  if (!data?.access_token || !data.refresh_token) {
    // No refresh_token means prompt=consent/access_type=offline didn't take —
    // refuse to store a half-connection we can't refresh.
    return { ok: false, error: "no_refresh_token" };
  }

  // Defense in depth: Gmail readonly must be present. (We intentionally tolerate the
  // ADDITIONAL calendar scope; Google returns the full merged set in arbitrary order,
  // so this is a membership check, never equality.)
  if (data.scope && !data.scope.split(/\s+/).includes(GMAIL_SCOPE)) {
    return { ok: false, error: "unexpected_scope" };
  }

  const tokens: Tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry: Date.now() + (data.expires_in ?? 3600) * 1000,
    scopes: data.scope, // remember what was granted (gmail, and maybe calendar)
  };

  // Fetch the connected address (covered by gmail.readonly) for display.
  tokens.email = await fetchEmail(tokens.access_token);

  await saveTokens(email, tokens);
  _inboxCache.delete(cacheId(email));
  return { ok: true };
}

// ---- OAuth: refresh an expired access token ------------------------------
async function refreshAccessToken(
  email: string | null,
  refreshToken: string,
): Promise<Tokens | null> {
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (!res.ok) {
    // invalid_grant => the refresh token was revoked (user disconnected the app
    // from their Google account). Clear our copy so the UI shows "disconnected".
    if (res.status === 400 || res.status === 401) await clearTokens(email);
    return null;
  }

  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  } | null;
  if (!data?.access_token) return null;

  return {
    access_token: data.access_token,
    // Google usually omits refresh_token on refresh — keep the existing one.
    refresh_token: data.refresh_token ?? refreshToken,
    expiry: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

// Returns a usable access token (refreshing if needed) + the granted scopes, or
// null if not connected / refresh failed. Exported so the calendar layer reuses the
// SAME single token store + refresh path (the token covers both scopes after
// re-consent). The refresh response omits `scope`, so we carry it from storage.
export async function getGoogleAccessToken(
  userEmail: string | null,
): Promise<{ token: string; email?: string; scopes?: string } | null> {
  const stored = await loadTokens(userEmail);
  if (!stored) return null;

  if (stored.expiry - Date.now() > EXPIRY_SKEW_MS) {
    return { token: stored.access_token, email: stored.email, scopes: stored.scopes };
  }

  const refreshed = await refreshAccessToken(userEmail, stored.refresh_token);
  if (!refreshed) return null;

  const updated: Tokens = { ...refreshed, email: stored.email, scopes: stored.scopes };
  await saveTokens(userEmail, updated);
  return { token: updated.access_token, email: updated.email, scopes: updated.scopes };
}

// ---- Gmail API: profile email --------------------------------------------
async function fetchEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${GMAIL_BASE}/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { emailAddress?: string };
    return j.emailAddress;
  } catch {
    return undefined;
  }
}

// ---- Gmail API: inbox ----------------------------------------------------
export type Category = "personal" | "work" | "noise";
export type InboxItem = {
  id: string; // Gmail message id — the client references it to draft/send a reply
  ts: number; // ms epoch
  sender: string;
  subject: string;
  category: Category;
  unread: boolean;
  important: boolean;
};

export type InboxState = {
  connected: boolean;
  oauthConfigured: boolean;
  storageConfigured: boolean;
  email?: string;
  messages: InboxItem[];
  unread: number;
  briefLine: string;
  stale?: boolean; // true when served from cache after a failed refresh
  canSend?: boolean; // send scope granted — gates the reply UI (else: reconnect to enable)
};

// Gmail category labels → our three house tags.
function mapCategory(labelIds: string[]): Category {
  if (labelIds.includes("CATEGORY_PROMOTIONS") || labelIds.includes("CATEGORY_SOCIAL")) {
    return "noise";
  }
  if (labelIds.includes("CATEGORY_UPDATES") || labelIds.includes("CATEGORY_FORUMS")) {
    return "work";
  }
  // Primary tab = CATEGORY_PERSONAL or no category label at all.
  return "personal";
}

function header(headers: { name: string; value: string }[], name: string): string {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

// "Vivienne Doe" <viv@x.com>  ->  Vivienne Doe
// viv@example.com             ->  viv
function parseSender(from: string): string {
  const named = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (named && named[1].trim()) return named[1].trim();
  const email = from.match(/[<\s]?([^<>\s]+@[^<>\s]+)/);
  if (email) return email[1].split("@")[0];
  return from.trim() || "unknown";
}

type CacheEntry = {
  exp: number;
  fetchedAt: number;
  messages: InboxItem[];
  unread: number;
  email?: string;
};
// Per-user in-process cache — keyed by the session email so one user's inbox
// can NEVER be served to another from a warm instance. Null email (single-user
// fallback) gets its own slot.
const cacheId = (email: string | null) => email ?? "__single_user__";
const _inboxCache = new Map<string, CacheEntry>();
// On a failed refresh we keep serving the last good inbox, but only within this
// bounded window — never indefinitely — and flagged stale so the UI can show it.
const MAX_STALE_SERVE_MS = 15 * 60_000;

async function fetchInboxMessages(
  accessToken: string,
): Promise<{ messages: InboxItem[]; unread: number }> {
  // 1) list the most recent INBOX message ids
  const listRes = await fetch(
    `${GMAIL_BASE}/messages?maxResults=${INBOX_COUNT}&labelIds=INBOX`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
  );
  if (!listRes.ok) throw new Error(`list_${listRes.status}`);
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (list.messages ?? []).map((m) => m.id);

  // 2) fetch metadata for each (parallel). format=metadata => headers only,
  //    NEVER the body — we don't read message content.
  const items = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(
        `${GMAIL_BASE}/messages/${id}?format=metadata` +
          `&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      );
      if (!r.ok) return null;
      const m = (await r.json()) as {
        labelIds?: string[];
        internalDate?: string;
        payload?: { headers?: { name: string; value: string }[] };
      };
      const labelIds = m.labelIds ?? [];
      const headers = m.payload?.headers ?? [];
      const item: InboxItem = {
        id,
        ts: Number(m.internalDate) || 0,
        sender: parseSender(header(headers, "From")),
        subject: header(headers, "Subject") || "(no subject)",
        category: mapCategory(labelIds),
        unread: labelIds.includes("UNREAD"),
        important: labelIds.includes("IMPORTANT"),
      };
      return item;
    }),
  );

  const messages = items
    .filter((x): x is InboxItem => x !== null)
    .sort((a, b) => b.ts - a.ts);

  // 3) a real unread count for the inbox (estimate is fine for a brief line)
  let unread = messages.filter((m) => m.unread).length;
  try {
    const cntRes = await fetch(
      `${GMAIL_BASE}/messages?maxResults=1&labelIds=INBOX&labelIds=UNREAD`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (cntRes.ok) {
      const c = (await cntRes.json()) as { resultSizeEstimate?: number };
      if (typeof c.resultSizeEstimate === "number") unread = c.resultSizeEstimate;
    }
  } catch {
    /* keep the local count */
  }

  return { messages, unread };
}

function buildBriefLine(connected: boolean, messages: InboxItem[], unread: number): string {
  if (!connected) return "I can read your inbox once you connect Gmail.";
  if (!messages.length) return "Inbox is empty — nothing waiting on you.";
  if (unread === 0) return "Inbox's clear. Nothing unread waiting on you.";
  // most recent important sender, else most recent sender
  const lead = messages.find((m) => m.important) ?? messages[0];
  const n = unread === 1 ? "1 unread" : `${unread} unread`;
  return `${n} — latest worth seeing is from ${lead.sender}.`;
}

export async function getInboxState(userEmail: string | null): Promise<InboxState> {
  const base: Omit<InboxState, "messages" | "unread" | "briefLine"> = {
    connected: false,
    oauthConfigured: oauthConfigured(),
    storageConfigured: storageConfigured(),
  };

  const auth = await getGoogleAccessToken(userEmail);
  if (!auth) {
    return {
      ...base,
      connected: false,
      messages: [],
      unread: 0,
      briefLine: buildBriefLine(false, [], 0),
    };
  }
  // Send scope drives the reply UI: connected-for-read but no send scope → "reconnect
  // to let me draft replies". Derived from the live granted-scope set, every call.
  const canSend = scopeGranted(auth.scopes, GMAIL_SEND_SCOPE);

  // serve this user's cache if warm
  const now = Date.now();
  const cached = _inboxCache.get(cacheId(userEmail));
  if (cached && cached.exp > now) {
    return {
      ...base,
      connected: true,
      canSend,
      email: cached.email,
      messages: cached.messages,
      unread: cached.unread,
      briefLine: buildBriefLine(true, cached.messages, cached.unread),
    };
  }

  try {
    const { messages, unread } = await fetchInboxMessages(auth.token);
    _inboxCache.set(cacheId(userEmail), {
      exp: now + INBOX_TTL_MS,
      fetchedAt: now,
      messages,
      unread,
      email: auth.email,
    });
    return {
      ...base,
      connected: true,
      canSend,
      stale: false,
      email: auth.email,
      messages,
      unread,
      briefLine: buildBriefLine(true, messages, unread),
    };
  } catch {
    // Connected but the fetch failed. Serve the last good inbox ONLY within a
    // bounded staleness window, flagged stale — never expired data indefinitely.
    // Past the window, surface the error so the UI shows FEED OFFLINE · RETRY.
    if (cached && Date.now() - cached.fetchedAt < MAX_STALE_SERVE_MS) {
      return {
        ...base,
        connected: true,
        canSend,
        stale: true,
        email: cached.email,
        messages: cached.messages,
        unread: cached.unread,
        briefLine: buildBriefLine(true, cached.messages, cached.unread),
      };
    }
    throw new Error("inbox_fetch_failed");
  }
}

// ---------------------------------------------------------------------------
// Reply DRAFTING + SENDING — the "Hands" layer.
//
// SAFETY MODEL (the whole point): these are TWO separate, explicit layers.
//   - getMessageForReply() is a READ op (gmail.readonly) used to draft. It returns
//     the thread context the model needs. It cannot send.
//   - sendReply() is the ONLY thing that sends. It re-derives the recipient + thread
//     headers SERVER-SIDE from the original message (so neither the client nor an
//     injected draft can redirect the reply to a new address), and sends EXACTLY the
//     body text passed in — no model, no rewrite, no retry. It is called only from
//     the user's explicit tap (/api/comms/send), never from an LLM tool.
// The model NEVER has a send tool (see lib/tools.ts). Drafting and sending are
// different layers on purpose.
// ---------------------------------------------------------------------------

export type ReplyContext = {
  threadId: string;
  to: string; // who we reply to — Reply-To if present, else From (server-derived)
  fromName: string; // display name, for the UI
  subject: string; // the ORIGINAL subject (the reply prefixes "Re:")
  rfcMessageId: string; // the RFC822 Message-ID header value (<...>), for threading
  references: string; // the original References chain (may be empty)
  bodyText: string; // best-effort plain-text body, for the model to draft from
};

const lc = (s: string) => s.toLowerCase();

// Depth-first search for the first text/plain part; decode its base64url data.
function extractPlainText(payload: unknown): string {
  const p = payload as {
    mimeType?: string;
    body?: { data?: string };
    parts?: unknown[];
  } | null;
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) {
    try {
      return Buffer.from(p.body.data, "base64url").toString("utf-8");
    } catch {
      return "";
    }
  }
  if (Array.isArray(p.parts)) {
    for (const part of p.parts) {
      const t = extractPlainText(part);
      if (t) return t;
    }
  }
  return "";
}

// Read a single message in full and pull out everything needed to draft + send a
// threaded reply. Read-only (gmail.readonly); NEVER sends.
export async function getMessageForReply(
  userEmail: string | null,
  messageId: string,
): Promise<ReplyContext | null> {
  const auth = await getGoogleAccessToken(userEmail);
  if (!auth) return null;

  let res: Response;
  try {
    res = await fetch(`${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}?format=full`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const m = (await res.json().catch(() => null)) as {
    threadId?: string;
    snippet?: string;
    payload?: { headers?: { name: string; value: string }[] };
  } | null;
  if (!m?.threadId) return null;

  const headers = m.payload?.headers ?? [];
  const h = (name: string) => headers.find((x) => lc(x.name) === lc(name))?.value ?? "";
  const fromRaw = h("Reply-To") || h("From");
  const body = extractPlainText(m.payload) || (m.snippet ?? "");

  return {
    threadId: m.threadId,
    to: fromRaw,
    fromName: parseSender(h("From")),
    subject: h("Subject"),
    rfcMessageId: h("Message-ID") || h("Message-Id"),
    references: h("References"),
    bodyText: body.replace(/\r\n/g, "\n").slice(0, 6000), // cap the model context
  };
}

// Fresh, authoritative reply headers used at SEND time (metadata only — light, and
// re-read so the recipient/threading come from the live original, not stale state).
async function getReplyHeaders(
  messageId: string,
  token: string,
): Promise<Omit<ReplyContext, "bodyText" | "fromName"> | null> {
  let res: Response;
  try {
    res = await fetch(
      `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}?format=metadata` +
        `&metadataHeaders=Message-ID&metadataHeaders=From&metadataHeaders=Subject` +
        `&metadataHeaders=References&metadataHeaders=Reply-To`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const m = (await res.json().catch(() => null)) as {
    threadId?: string;
    payload?: { headers?: { name: string; value: string }[] };
  } | null;
  if (!m?.threadId) return null;
  const headers = m.payload?.headers ?? [];
  const h = (name: string) => headers.find((x) => lc(x.name) === lc(name))?.value ?? "";
  return {
    threadId: m.threadId,
    to: h("Reply-To") || h("From"),
    subject: h("Subject"),
    rfcMessageId: h("Message-ID") || h("Message-Id"),
    references: h("References"),
  };
}

// RFC 2047 encoded-word for a non-ASCII header (e.g. a "Re: …" subject with accents).
function encodeHeader(s: string): string {
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, "utf-8").toString("base64")}?=` : s;
}

// Build the minimal RFC 2822 plain-text reply. Body is base64 transfer-encoded so any
// UTF-8 rides cleanly. From/Message-ID/Date are intentionally omitted — Gmail sets
// them. In-Reply-To/References (the original RFC822 Message-ID) + a matching Re:
// subject + the threadId on the request are ALL required for Gmail to thread it.
function buildReplyMime(o: {
  to: string;
  subject: string;
  rfcMessageId: string;
  references: string;
  body: string;
}): string {
  const bodyB64 = Buffer.from(o.body, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const lines = [`To: ${o.to}`, `Subject: ${encodeHeader(o.subject)}`];
  if (o.rfcMessageId) {
    lines.push(`In-Reply-To: ${o.rfcMessageId}`);
    lines.push(`References: ${o.references ? o.references.trim() + " " : ""}${o.rfcMessageId}`);
  }
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: base64");
  return lines.join("\r\n") + "\r\n\r\n" + bodyB64 + "\r\n";
}

export type SendResult =
  | { ok: true; to: string; subject: string }
  | { ok: false; error: string };

/** Send a plain-text reply in-thread. The ONLY function that sends mail. Recipient +
 *  threading are re-derived server-side from `messageId`; `body` is sent verbatim. */
export async function sendReply(
  userEmail: string | null,
  messageId: string,
  body: string,
): Promise<SendResult> {
  const auth = await getGoogleAccessToken(userEmail);
  if (!auth) return { ok: false, error: "not_connected" };
  // Hard gate: without the send scope we never even build a message.
  if (!scopeGranted(auth.scopes, GMAIL_SEND_SCOPE)) return { ok: false, error: "needs_send_consent" };

  const ctx = await getReplyHeaders(messageId, auth.token);
  if (!ctx) return { ok: false, error: "message_not_found" };

  const subject = /^\s*re:/i.test(ctx.subject) ? ctx.subject : `Re: ${ctx.subject || "(no subject)"}`;
  const mime = buildReplyMime({
    to: ctx.to,
    subject,
    rfcMessageId: ctx.rfcMessageId,
    references: ctx.references,
    body,
  });
  const raw = Buffer.from(mime, "utf-8").toString("base64url");

  let res: Response;
  try {
    res = await fetch(`${GMAIL_BASE}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw, threadId: ctx.threadId }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "network" };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[gmail.send] ${res.status}: ${detail.slice(0, 300)}`);
    if (res.status === 401) return { ok: false, error: "auth_expired" };
    if (res.status === 403) return { ok: false, error: "insufficient_scope" };
    return { ok: false, error: `send_failed_${res.status}` };
  }

  _inboxCache.delete(cacheId(userEmail)); // the thread just changed — refresh next read
  return { ok: true, to: ctx.to, subject };
}

/** Whether the stored Google connection has the send scope (drives the re-consent
 *  prompt in the Comms UI). */
export async function hasSendScope(userEmail: string | null): Promise<boolean> {
  const auth = await getGoogleAccessToken(userEmail);
  return !!auth && scopeGranted(auth.scopes, GMAIL_SEND_SCOPE);
}
