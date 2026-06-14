// Gmail integration — SERVER ONLY. Read-only access to the owner's inbox.
//
// SECURITY MODEL (non-negotiable):
//   - Scope is gmail.readonly ONLY. No send, no modify, no delete.
//   - The OAuth client secret and ALL tokens live server-side: env + Upstash.
//     Nothing here is ever serialized to the browser. The only thing the client
//     receives (via /api/inbox) is normalized { ts, sender, subject, category }
//     metadata — never tokens, never message bodies.
//   - The code→token exchange happens server-side in the callback route.
//   - Tokens are stored in Upstash under a single key (this is a single-user
//     app: USER_NAME). Refresh tokens persist; access tokens are refreshed
//     automatically when they near expiry.
//
// We use raw fetch against Google's REST endpoints (no googleapis SDK) to match
// the rest of the codebase and keep the bundle light.

import { Redis } from "@upstash/redis";

// ---- endpoints -----------------------------------------------------------
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Read-only. This is the ONLY scope we ever request.
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const TOKENS_KEY = "august:gmail:tokens";
const EXPIRY_SKEW_MS = 60_000; // refresh a minute before actual expiry
const INBOX_COUNT = 15;
const INBOX_TTL_MS = 3 * 60_000;

// ---- token store ---------------------------------------------------------
type Tokens = {
  access_token: string;
  refresh_token: string;
  expiry: number; // ms epoch when the access_token expires
  email?: string; // the connected account, for display only
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

async function loadTokens(): Promise<Tokens | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return (await redis.get<Tokens>(TOKENS_KEY)) ?? null;
  } catch {
    return null;
  }
}

async function saveTokens(t: Tokens): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(TOKENS_KEY, t);
  } catch {
    /* best-effort; a failed write just means the next call re-refreshes */
  }
}

async function clearTokens(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(TOKENS_KEY);
  } catch {
    /* ignore */
  }
  _inboxCache = null;
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
    scope: GMAIL_SCOPE,
    access_type: "offline", // get a refresh token
    prompt: "consent", // force refresh-token issuance even on re-consent
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ---- OAuth: exchange authorization code for tokens -----------------------
export async function exchangeCode(
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

  // Defense in depth: reject anything but exactly the read-only scope.
  if (data.scope && !data.scope.split(/\s+/).includes(GMAIL_SCOPE)) {
    return { ok: false, error: "unexpected_scope" };
  }

  const tokens: Tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  // Fetch the connected address (covered by gmail.readonly) for display.
  tokens.email = await fetchEmail(tokens.access_token);

  await saveTokens(tokens);
  _inboxCache = null;
  return { ok: true };
}

// ---- OAuth: refresh an expired access token ------------------------------
async function refreshAccessToken(refreshToken: string): Promise<Tokens | null> {
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
    if (res.status === 400 || res.status === 401) await clearTokens();
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

// Returns a usable access token (refreshing if needed), or null if not
// connected / refresh failed.
async function getValidAccessToken(): Promise<{ token: string; email?: string } | null> {
  const stored = await loadTokens();
  if (!stored) return null;

  if (stored.expiry - Date.now() > EXPIRY_SKEW_MS) {
    return { token: stored.access_token, email: stored.email };
  }

  const refreshed = await refreshAccessToken(stored.refresh_token);
  if (!refreshed) return null;

  const updated: Tokens = { ...refreshed, email: stored.email };
  await saveTokens(updated);
  return { token: updated.access_token, email: updated.email };
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
let _inboxCache: CacheEntry | null = null;
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

export async function getInboxState(): Promise<InboxState> {
  const base: Omit<InboxState, "messages" | "unread" | "briefLine"> = {
    connected: false,
    oauthConfigured: oauthConfigured(),
    storageConfigured: storageConfigured(),
  };

  const auth = await getValidAccessToken();
  if (!auth) {
    return {
      ...base,
      connected: false,
      messages: [],
      unread: 0,
      briefLine: buildBriefLine(false, [], 0),
    };
  }

  // serve cache if warm
  const now = Date.now();
  if (_inboxCache && _inboxCache.exp > now) {
    return {
      ...base,
      connected: true,
      email: _inboxCache.email,
      messages: _inboxCache.messages,
      unread: _inboxCache.unread,
      briefLine: buildBriefLine(true, _inboxCache.messages, _inboxCache.unread),
    };
  }

  try {
    const { messages, unread } = await fetchInboxMessages(auth.token);
    _inboxCache = { exp: now + INBOX_TTL_MS, fetchedAt: now, messages, unread, email: auth.email };
    return {
      ...base,
      connected: true,
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
    if (_inboxCache && Date.now() - _inboxCache.fetchedAt < MAX_STALE_SERVE_MS) {
      return {
        ...base,
        connected: true,
        stale: true,
        email: _inboxCache.email,
        messages: _inboxCache.messages,
        unread: _inboxCache.unread,
        briefLine: buildBriefLine(true, _inboxCache.messages, _inboxCache.unread),
      };
    }
    throw new Error("inbox_fetch_failed");
  }
}
