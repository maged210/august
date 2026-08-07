// Desk Tape — flow-style desk commentary rows (G3 round 4).
//
// This is the desk's OWN tape: options/flow callouts entered by the owner in
// /admin (keyboard-fast quick-add) or extracted from transcripts as DRAFTS.
// It is desk commentary, never presented as a market data feed — the module
// header carries a "desk-sourced" tag, and the public wire redacts provenance.
//
// Shape follows lib/ideas.ts exactly (pure validators up top, lazy best-effort
// Upstash store below, shared un-scoped namespace `august:tape:v1` — owner-
// published output shown to everyone; admin-gated writes).
//
// FUTURE FEED SEAM: this module IS the tape's data interface. A licensed
// real-time flow source (Unusual Whales / Polygon) replaces desk sourcing by
// writing the same TapeEntry rows (source: a new value) into this store — or
// by re-implementing listLiveTape() against its own backend. The wire shape
// (PublicTapeEntry) and the UI above it don't change.

import { Redis } from "@upstash/redis";

export type TapeKind = "sweep" | "block" | "split" | "note";
export type TapeSentiment = "bull" | "bear" | "neutral";
export type TapeSource = "desk" | "extracted";
export type TapeStatus = "draft" | "live";

export type TapeEntry = {
  id: string;
  /** event time (epoch ms) — when the desk saw/made the call, defaults to entry time */
  ts: number;
  /** the traded thing — "SPX", "NVDA" — free-form symbol */
  symbol: string;
  /** the callout — "Buy 7600 SPX Put" — plain prose, short */
  note: string;
  /** optional free-form expiry — "0DTE", "DEC 19" */
  expiry?: string;
  /** optional free-form premium — "$1.2M", "420k" — honest to the source, never coerced */
  premium?: string;
  kind: TapeKind;
  sentiment: TapeSentiment;
  source: TapeSource;
  status: TapeStatus;
  updatedAt: number;
};

/** What the public dock receives: live rows, provenance stripped. */
export type PublicTapeEntry = Pick<
  TapeEntry,
  "id" | "ts" | "symbol" | "note" | "expiry" | "premium" | "kind" | "sentiment"
>;

// Field caps — enforced by the validators, mirrored nowhere else.
export const MAX_TAPE_SYMBOL_CHARS = 24;
export const MAX_TAPE_NOTE_CHARS = 200;
export const MAX_TAPE_FIELD_CHARS = 32; // expiry / premium
export const MAX_TAPE = 300;

export const TAPE_KINDS: readonly TapeKind[] = ["sweep", "block", "split", "note"];
export const TAPE_SENTIMENTS: readonly TapeSentiment[] = ["bull", "bear", "neutral"];
export const TAPE_SOURCES: readonly TapeSource[] = ["desk", "extracted"];
export const TAPE_STATUSES: readonly TapeStatus[] = ["draft", "live"];

// --- pure helpers -----------------------------------------------------------

export function toPublicTapeEntry(e: TapeEntry): PublicTapeEntry {
  const out: PublicTapeEntry = {
    id: e.id,
    ts: e.ts,
    symbol: e.symbol,
    note: e.note,
    kind: e.kind,
    sentiment: e.sentiment,
  };
  if (e.expiry) out.expiry = e.expiry;
  if (e.premium) out.premium = e.premium;
  return out;
}

export type TapeCreateInput = {
  symbol: string;
  note: string;
  expiry?: string;
  premium?: string;
  kind: TapeKind;
  sentiment: TapeSentiment;
  source: TapeSource;
  status: TapeStatus;
  /** optional stated event time; defaults to now at create */
  ts?: number;
};

export type TapePatchInput = Partial<Omit<TapeCreateInput, "source" | "ts">>;

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function fieldError(name: string, max: number): string {
  return `${name}_invalid_or_over_${max}_chars`;
}

/**
 * PURE. Validate a create body (house style: manual shape checks, snake_case
 * error strings, never partial). symbol + note required; expiry/premium
 * optional free-form. Unknown kind/sentiment/status/source are rejected, not
 * defaulted — a typo must not silently publish.
 */
export function validateTapeCreate(body: unknown): Ok<TapeCreateInput> | Err {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body_not_object" };
  const b = body as Record<string, unknown>;

  const symbol = typeof b.symbol === "string" ? collapse(b.symbol).toUpperCase() : "";
  if (!symbol || symbol.length > MAX_TAPE_SYMBOL_CHARS)
    return { ok: false, error: fieldError("symbol", MAX_TAPE_SYMBOL_CHARS) };

  const note = typeof b.note === "string" ? collapse(b.note) : "";
  if (!note || note.length > MAX_TAPE_NOTE_CHARS)
    return { ok: false, error: fieldError("note", MAX_TAPE_NOTE_CHARS) };

  const expiry = typeof b.expiry === "string" ? collapse(b.expiry) : b.expiry == null ? "" : null;
  if (expiry === null || expiry.length > MAX_TAPE_FIELD_CHARS)
    return { ok: false, error: fieldError("expiry", MAX_TAPE_FIELD_CHARS) };

  const premium = typeof b.premium === "string" ? collapse(b.premium) : b.premium == null ? "" : null;
  if (premium === null || premium.length > MAX_TAPE_FIELD_CHARS)
    return { ok: false, error: fieldError("premium", MAX_TAPE_FIELD_CHARS) };

  if (!TAPE_KINDS.includes(b.kind as TapeKind)) return { ok: false, error: "kind_invalid" };
  if (!TAPE_SENTIMENTS.includes(b.sentiment as TapeSentiment))
    return { ok: false, error: "sentiment_invalid" };

  const status = b.status === undefined ? "draft" : b.status;
  if (!TAPE_STATUSES.includes(status as TapeStatus)) return { ok: false, error: "status_invalid" };

  const source = b.source === undefined ? "desk" : b.source;
  if (!TAPE_SOURCES.includes(source as TapeSource)) return { ok: false, error: "source_invalid" };

  let ts: number | undefined;
  if (b.ts !== undefined) {
    if (typeof b.ts !== "number" || !Number.isFinite(b.ts) || b.ts <= 0)
      return { ok: false, error: "ts_invalid" };
    ts = Math.floor(b.ts);
  }

  const value: TapeCreateInput = {
    symbol,
    note,
    kind: b.kind as TapeKind,
    sentiment: b.sentiment as TapeSentiment,
    status: status as TapeStatus,
    source: source as TapeSource,
  };
  if (expiry) value.expiry = expiry;
  if (premium) value.premium = premium;
  if (ts !== undefined) value.ts = ts;
  return { ok: true, value };
}

/**
 * PURE. Validate a PATCH body: only known fields, each individually validated;
 * an empty patch is rejected. `source` and `ts` are immutable (provenance and
 * the event time are facts).
 */
export function validateTapePatch(body: unknown): Ok<TapePatchInput> | Err {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body_not_object" };
  const b = body as Record<string, unknown>;
  const patch: TapePatchInput = {};

  if (b.symbol !== undefined) {
    const v = typeof b.symbol === "string" ? collapse(b.symbol).toUpperCase() : "";
    if (!v || v.length > MAX_TAPE_SYMBOL_CHARS)
      return { ok: false, error: fieldError("symbol", MAX_TAPE_SYMBOL_CHARS) };
    patch.symbol = v;
  }
  if (b.note !== undefined) {
    const v = typeof b.note === "string" ? collapse(b.note) : "";
    if (!v || v.length > MAX_TAPE_NOTE_CHARS)
      return { ok: false, error: fieldError("note", MAX_TAPE_NOTE_CHARS) };
    patch.note = v;
  }
  if (b.expiry !== undefined) {
    const v = typeof b.expiry === "string" ? collapse(b.expiry) : null;
    if (v === null || v.length > MAX_TAPE_FIELD_CHARS)
      return { ok: false, error: fieldError("expiry", MAX_TAPE_FIELD_CHARS) };
    patch.expiry = v;
  }
  if (b.premium !== undefined) {
    const v = typeof b.premium === "string" ? collapse(b.premium) : null;
    if (v === null || v.length > MAX_TAPE_FIELD_CHARS)
      return { ok: false, error: fieldError("premium", MAX_TAPE_FIELD_CHARS) };
    patch.premium = v;
  }
  if (b.kind !== undefined) {
    if (!TAPE_KINDS.includes(b.kind as TapeKind)) return { ok: false, error: "kind_invalid" };
    patch.kind = b.kind as TapeKind;
  }
  if (b.sentiment !== undefined) {
    if (!TAPE_SENTIMENTS.includes(b.sentiment as TapeSentiment))
      return { ok: false, error: "sentiment_invalid" };
    patch.sentiment = b.sentiment as TapeSentiment;
  }
  if (b.status !== undefined) {
    if (!TAPE_STATUSES.includes(b.status as TapeStatus))
      return { ok: false, error: "status_invalid" };
    patch.status = b.status as TapeStatus;
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: "empty_patch" };
  return { ok: true, value: patch };
}

// --- store ------------------------------------------------------------------
// `august:tape:v1` zset (score = ts) indexes `august:tape:v1:{id}` JSON blobs.
// Lazy client, best-effort: unconfigured or erroring Redis degrades to
// []/null — the app never 500s over the tape.

const NS = "august:tape:v1";
const K = {
  index: NS,
  entry: (id: string) => `${NS}:${id}`,
};

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    _redis = url && token && url.startsWith("https://") ? new Redis({ url, token }) : null;
  } catch {
    _redis = null;
  }
  return _redis;
}

export function tapeConfigured(): boolean {
  return getRedis() !== null;
}

function newTapeId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `tape_${rand}`;
}

function parseEntry(raw: unknown): TapeEntry | null {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof v !== "object" || v === null) return null;
    const e = v as TapeEntry;
    if (typeof e.id !== "string" || typeof e.symbol !== "string") return null;
    return e;
  } catch {
    return null;
  }
}

export async function getTapeEntry(id: string): Promise<TapeEntry | null> {
  const redis = getRedis();
  if (!redis || !id) return null;
  try {
    const raw = await redis.get(K.entry(id));
    return raw ? parseEntry(raw) : null;
  } catch {
    return null;
  }
}

/** Newest first by ts. Optionally filter by status. Empty when unconfigured. */
export async function listTape(status?: TapeStatus, limit = MAX_TAPE): Promise<TapeEntry[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const n = Math.max(1, Math.min(MAX_TAPE, Math.floor(limit)));
    const ids = await redis.zrange<string[]>(K.index, 0, n - 1, { rev: true });
    if (!ids || ids.length === 0) return [];
    const rows = await Promise.all(ids.map((id) => getTapeEntry(id)));
    const entries = rows.filter((e): e is TapeEntry => e !== null);
    return status ? entries.filter((e) => e.status === status) : entries;
  } catch {
    return [];
  }
}

/** The public wire: live only, redacted, newest first, capped. */
export async function listLiveTape(limit = 50): Promise<PublicTapeEntry[]> {
  return (await listTape("live")).slice(0, limit).map(toPublicTapeEntry);
}

export async function createTapeEntry(input: TapeCreateInput): Promise<TapeEntry | null> {
  const redis = getRedis();
  if (!redis) return null;
  const now = Date.now();
  const { ts, ...fields } = input;
  const entry: TapeEntry = { id: newTapeId(), ts: ts ?? now, ...fields, updatedAt: now };
  try {
    await redis.set(K.entry(entry.id), JSON.stringify(entry));
    await redis.zadd(K.index, { score: entry.ts, member: entry.id });
    // Housekeeping: cap the index; evicted ids keep their blobs (cheap) but
    // stop appearing anywhere.
    await redis.zremrangebyrank(K.index, 0, -(MAX_TAPE + 1));
    return entry;
  } catch {
    return null;
  }
}

export async function updateTapeEntry(id: string, patch: TapePatchInput): Promise<TapeEntry | null> {
  const redis = getRedis();
  if (!redis) return null;
  const existing = await getTapeEntry(id);
  if (!existing) return null;
  const updated: TapeEntry = { ...existing, ...patch, id: existing.id, ts: existing.ts, updatedAt: Date.now() };
  try {
    await redis.set(K.entry(id), JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
}

/** Hard-remove an entry (the reject path — tape has no "closed" parking state). */
export async function deleteTapeEntry(id: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis || !id) return false;
  try {
    await redis.zrem(K.index, id);
    await redis.del(K.entry(id));
    return true;
  } catch {
    return false;
  }
}
