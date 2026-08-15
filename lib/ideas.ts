// Trade Ideas — the CORE V2 rail's data model, pure helpers, and store.
//
// Layout follows lib/threads.ts: pure, node:test-friendly helpers up top
// (no Redis/network), then the lazy best-effort Upstash store. The namespace
// `august:ideas:v1:*` is deliberately SHARED, not user-scoped (the lib/intel
// convention): the rail is the owner's published output shown to everyone —
// shared reads, admin-gated writes (see app/api/admin/ideas).
//
// Wire contract: GET /api/ideas serves ONLY status="live" ideas, newest first,
// in the redacted PublicIdea shape — draft/closed rows and provenance (source)
// never reach the public wire.

import { Redis } from "@upstash/redis";

/** ADMIN-1: "invalidated" joins the lifecycle — a call that broke its premise.
 *  Like closed it never reaches the public wire (only "live" is served); the
 *  book manager keeps the two apart so the desk's record stays honest. */
export type IdeaStatus = "draft" | "live" | "closed" | "invalidated";
export type IdeaSource = "manual" | "extracted";
export type IdeaRiskLevel = "low" | "medium" | "high";
/** UX4 — the desk's stated direction. OPTIONAL and absent-by-default: the
 *  extraction pipeline only sets it when the speaker's language makes the
 *  direction unambiguous, and /admin can set/clear it in one click. Absent
 *  side stays honest (the blotter falls back to its derived-from-levels
 *  rendering, clearly marked as derived). */
export type IdeaSide = "long" | "short" | "watch";

export type Idea = {
  id: string;
  /** the traded thing — "NQ", "NVDA", "BTC" — free-form symbol or name */
  instrument: string;
  /** the one-paragraph why */
  thesis: string;
  /** free-form level ("21,450", "break of 600") — honest to the source, never coerced to a number */
  entry: string;
  target: string;
  /** stop / invalidation level — free-form like the others (ADMIN-1) */
  stop?: string;
  riskLevel: IdeaRiskLevel;
  /** stated direction — absent when never stated (see IdeaSide) */
  side?: IdeaSide;
  status: IdeaStatus;
  source: IdeaSource;
  /** prior theses, oldest first — populated when a dedupe-approve REFRESHES a
   *  live idea (ADMIN-1); admin-side only, never on the public wire */
  thesisHistory?: string[];
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
};

/** What the public rail receives: live ideas, provenance stripped. */
export type PublicIdea = Pick<
  Idea,
  | "id"
  | "instrument"
  | "thesis"
  | "entry"
  | "target"
  | "stop"
  | "riskLevel"
  | "side"
  | "createdAt"
  | "updatedAt"
>;

// Field caps — enforced by the validators, mirrored nowhere else.
export const MAX_INSTRUMENT_CHARS = 40;
export const MAX_THESIS_CHARS = 2000;
export const MAX_LEVEL_CHARS = 120;
export const MAX_IDEAS = 500;

export const IDEA_STATUSES: readonly IdeaStatus[] = ["draft", "live", "closed", "invalidated"];
export const MAX_THESIS_HISTORY = 10;
export const IDEA_SOURCES: readonly IdeaSource[] = ["manual", "extracted"];
export const IDEA_RISKS: readonly IdeaRiskLevel[] = ["low", "medium", "high"];
export const IDEA_SIDES: readonly IdeaSide[] = ["long", "short", "watch"];

// --- pure helpers -----------------------------------------------------------

export function toPublicIdea(i: Idea): PublicIdea {
  return {
    id: i.id,
    instrument: i.instrument,
    thesis: i.thesis,
    entry: i.entry,
    target: i.target,
    // absent stop/side stay absent on the wire — no key, not null (house absents)
    ...(i.stop ? { stop: i.stop } : {}),
    riskLevel: i.riskLevel,
    ...(i.side ? { side: i.side } : {}),
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

// "2h ago" — coarse, honest buckets for the rail's timestamps. Past a month
// the relative form stops meaning anything; fall back to the plain date.
export function relativeTime(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export type IdeaCreateInput = {
  instrument: string;
  thesis: string;
  entry: string;
  target: string;
  stop?: string;
  riskLevel: IdeaRiskLevel;
  side?: IdeaSide;
  status: IdeaStatus;
  source: IdeaSource;
};

/** `side: undefined` with the key PRESENT is a deliberate clear (the spread
 *  in updateIdea overwrites, and JSON.stringify drops the undefined).
 *  `archiveThesis` (ADMIN-1) rides a patch that REPLACES the thesis: the old
 *  thesis is pushed onto thesisHistory before the new one lands. */
export type IdeaPatchInput = Partial<Omit<IdeaCreateInput, "source">> & {
  archiveThesis?: boolean;
};

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function fieldError(name: string, max: number): string {
  return `${name}_invalid_or_over_${max}_chars`;
}

/**
 * PURE. Validate a create body (house style: manual shape checks, snake_case
 * error strings, never partial). Levels may be empty ("thesis-only" ideas);
 * instrument + thesis are required. Unknown status/source/risk are rejected,
 * not defaulted — a typo must not silently publish.
 */
export function validateIdeaCreate(body: unknown): Ok<IdeaCreateInput> | Err {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body_not_object" };
  const b = body as Record<string, unknown>;

  const instrument = typeof b.instrument === "string" ? collapse(b.instrument) : "";
  if (!instrument || instrument.length > MAX_INSTRUMENT_CHARS)
    return { ok: false, error: fieldError("instrument", MAX_INSTRUMENT_CHARS) };

  const thesis = typeof b.thesis === "string" ? b.thesis.trim() : "";
  if (!thesis || thesis.length > MAX_THESIS_CHARS)
    return { ok: false, error: fieldError("thesis", MAX_THESIS_CHARS) };

  const entry = typeof b.entry === "string" ? collapse(b.entry) : b.entry == null ? "" : null;
  if (entry === null || entry.length > MAX_LEVEL_CHARS)
    return { ok: false, error: fieldError("entry", MAX_LEVEL_CHARS) };

  const target = typeof b.target === "string" ? collapse(b.target) : b.target == null ? "" : null;
  if (target === null || target.length > MAX_LEVEL_CHARS)
    return { ok: false, error: fieldError("target", MAX_LEVEL_CHARS) };

  // stop is optional like side — absent/null/"" all mean "not stated"
  const stopRaw = b.stop === undefined || b.stop === null ? "" : b.stop;
  const stop = typeof stopRaw === "string" ? collapse(stopRaw) : null;
  if (stop === null || stop.length > MAX_LEVEL_CHARS)
    return { ok: false, error: fieldError("stop", MAX_LEVEL_CHARS) };

  const riskLevel = b.riskLevel;
  if (!IDEA_RISKS.includes(riskLevel as IdeaRiskLevel))
    return { ok: false, error: "risk_level_invalid" };

  // side is optional — absent/null/"" all mean "not stated"; anything else
  // must be a known side (a typo must not silently publish a direction)
  const side = b.side === undefined || b.side === null || b.side === "" ? undefined : b.side;
  if (side !== undefined && !IDEA_SIDES.includes(side as IdeaSide))
    return { ok: false, error: "side_invalid" };

  const status = b.status === undefined ? "draft" : b.status;
  if (!IDEA_STATUSES.includes(status as IdeaStatus)) return { ok: false, error: "status_invalid" };

  const source = b.source === undefined ? "manual" : b.source;
  if (!IDEA_SOURCES.includes(source as IdeaSource)) return { ok: false, error: "source_invalid" };

  return {
    ok: true,
    value: {
      instrument,
      thesis,
      entry,
      target,
      ...(stop ? { stop } : {}),
      riskLevel: riskLevel as IdeaRiskLevel,
      ...(side !== undefined ? { side: side as IdeaSide } : {}),
      status: status as IdeaStatus,
      source: source as IdeaSource,
    },
  };
}

/**
 * PURE. Validate a PATCH body: only known fields, each individually validated;
 * an empty patch is rejected. `source` is immutable (provenance is a fact).
 */
export function validateIdeaPatch(body: unknown): Ok<IdeaPatchInput> | Err {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body_not_object" };
  const b = body as Record<string, unknown>;
  const patch: IdeaPatchInput = {};

  if (b.instrument !== undefined) {
    const v = typeof b.instrument === "string" ? collapse(b.instrument) : "";
    if (!v || v.length > MAX_INSTRUMENT_CHARS)
      return { ok: false, error: fieldError("instrument", MAX_INSTRUMENT_CHARS) };
    patch.instrument = v;
  }
  if (b.thesis !== undefined) {
    const v = typeof b.thesis === "string" ? b.thesis.trim() : "";
    if (!v || v.length > MAX_THESIS_CHARS)
      return { ok: false, error: fieldError("thesis", MAX_THESIS_CHARS) };
    patch.thesis = v;
  }
  if (b.entry !== undefined) {
    const v = typeof b.entry === "string" ? collapse(b.entry) : null;
    if (v === null || v.length > MAX_LEVEL_CHARS)
      return { ok: false, error: fieldError("entry", MAX_LEVEL_CHARS) };
    patch.entry = v;
  }
  if (b.target !== undefined) {
    const v = typeof b.target === "string" ? collapse(b.target) : null;
    if (v === null || v.length > MAX_LEVEL_CHARS)
      return { ok: false, error: fieldError("target", MAX_LEVEL_CHARS) };
    patch.target = v;
  }
  if (b.riskLevel !== undefined) {
    if (!IDEA_RISKS.includes(b.riskLevel as IdeaRiskLevel))
      return { ok: false, error: "risk_level_invalid" };
    patch.riskLevel = b.riskLevel as IdeaRiskLevel;
  }
  if (b.stop !== undefined) {
    // null/"" clears (an emptied inline field is a clear — key present,
    // value undefined → the store spread overwrites, stringify drops it)
    const v = b.stop === null ? "" : typeof b.stop === "string" ? collapse(b.stop) : null;
    if (v === null || v.length > MAX_LEVEL_CHARS)
      return { ok: false, error: fieldError("stop", MAX_LEVEL_CHARS) };
    patch.stop = v === "" ? undefined : v;
  }
  if (b.side !== undefined) {
    // null/"" clears the side (the admin one-click setter's un-set path)
    if (b.side === null || b.side === "") patch.side = undefined;
    else if (!IDEA_SIDES.includes(b.side as IdeaSide))
      return { ok: false, error: "side_invalid" };
    else patch.side = b.side as IdeaSide;
  }
  if (b.archiveThesis !== undefined) {
    if (typeof b.archiveThesis !== "boolean")
      return { ok: false, error: "archive_thesis_invalid" };
    if (b.archiveThesis) patch.archiveThesis = true; // meaningful only WITH a thesis
  }
  if (b.status !== undefined) {
    if (!IDEA_STATUSES.includes(b.status as IdeaStatus))
      return { ok: false, error: "status_invalid" };
    patch.status = b.status as IdeaStatus;
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: "empty_patch" };
  return { ok: true, value: patch };
}

// --- store ------------------------------------------------------------------
// `august:ideas:v1` zset (score = createdAt) indexes `august:ideas:v1:{id}`
// JSON blobs. Lazy client, best-effort: unconfigured or erroring Redis
// degrades to []/null — the app never 500s over the rail.

const NS = "august:ideas:v1";
const K = {
  index: NS,
  idea: (id: string) => `${NS}:${id}`,
};

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  // Garbage-tolerant: a `vercel env pull` can write masked "[SENSITIVE]"
  // placeholders for sensitive-type vars, and the Redis constructor THROWS on
  // a non-https URL — best-effort means that degrades to unconfigured, not 500.
  try {
    _redis = url && token && url.startsWith("https://") ? new Redis({ url, token }) : null;
  } catch {
    _redis = null;
  }
  return _redis;
}

export function ideasConfigured(): boolean {
  return getRedis() !== null;
}

function newIdeaId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `idea_${rand}`;
}

function parseIdea(raw: unknown): Idea | null {
  try {
    // Upstash auto-deserializes JSON — handle object OR string (house gotcha).
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof v !== "object" || v === null) return null;
    const i = v as Idea;
    if (typeof i.id !== "string" || typeof i.instrument !== "string") return null;
    return i;
  } catch {
    return null;
  }
}

export async function getIdea(id: string): Promise<Idea | null> {
  const redis = getRedis();
  if (!redis || !id) return null;
  try {
    const raw = await redis.get(K.idea(id));
    return raw ? parseIdea(raw) : null;
  } catch {
    return null;
  }
}

/** Newest first by createdAt. Optionally filter by status. Empty when unconfigured. */
export async function listIdeas(status?: IdeaStatus): Promise<Idea[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const ids = await redis.zrange<string[]>(K.index, 0, MAX_IDEAS - 1, { rev: true });
    if (!ids || ids.length === 0) return [];
    const rows = await Promise.all(ids.map((id) => getIdea(id)));
    const ideas = rows.filter((i): i is Idea => i !== null);
    return status ? ideas.filter((i) => i.status === status) : ideas;
  } catch {
    return [];
  }
}

/** The public wire: live only, redacted, newest first. */
export async function listLiveIdeas(): Promise<PublicIdea[]> {
  return (await listIdeas("live")).map(toPublicIdea);
}

export async function createIdea(input: IdeaCreateInput): Promise<Idea | null> {
  const redis = getRedis();
  if (!redis) return null;
  const now = Date.now();
  const idea: Idea = { id: newIdeaId(), ...input, createdAt: now, updatedAt: now };
  try {
    await redis.set(K.idea(idea.id), JSON.stringify(idea));
    await redis.zadd(K.index, { score: idea.createdAt, member: idea.id });
    // Housekeeping: cap the index; evicted ids keep their blobs (cheap, and a
    // future un-cap can resurrect them) but stop appearing anywhere.
    await redis.zremrangebyrank(K.index, 0, -(MAX_IDEAS + 1));
    return idea;
  } catch {
    return null;
  }
}

export async function updateIdea(id: string, patch: IdeaPatchInput): Promise<Idea | null> {
  const redis = getRedis();
  if (!redis) return null;
  const existing = await getIdea(id);
  if (!existing) return null;
  // ADMIN-1 — a dedupe-approve REFRESH: the replaced thesis is preserved,
  // oldest first, capped (archiveThesis is a directive, never stored)
  const { archiveThesis, ...fields } = patch;
  const archives =
    archiveThesis && typeof fields.thesis === "string" && fields.thesis !== existing.thesis
      ? [...(existing.thesisHistory ?? []), existing.thesis].slice(-MAX_THESIS_HISTORY)
      : undefined;
  const updated: Idea = {
    ...existing,
    ...fields,
    ...(archives ? { thesisHistory: archives } : {}),
    id: existing.id,
    updatedAt: Date.now(),
  };
  try {
    await redis.set(K.idea(id), JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
}

/** ADMIN-1 — hard delete (confirmed in the UI): the blob and its index entry. */
export async function deleteIdea(id: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis || !id) return false;
  try {
    await redis.del(K.idea(id));
    await redis.zrem(K.index, id);
    return true;
  } catch {
    return false;
  }
}

// ADMIN-1 delta — MERGE: two ideas on the same ticker fold into one.

/** PURE. Merge semantics: the KEEPER keeps its levels/side/status/thesis; the
 *  absorbed idea's thesis (and history) folds into the keeper's history,
 *  oldest first, capped. Different tickers refuse ("mismatch"); merging an
 *  idea into itself refuses too. */
export function mergeIdeaRecords(keep: Idea, absorb: Idea, now: number = Date.now()): Idea | "mismatch" {
  if (keep.id === absorb.id) return "mismatch";
  if (keep.instrument.trim().toUpperCase() !== absorb.instrument.trim().toUpperCase()) return "mismatch";
  const history = [
    ...(keep.thesisHistory ?? []),
    ...(absorb.thesisHistory ?? []),
    absorb.thesis,
  ].filter((t) => t && t !== keep.thesis).slice(-MAX_THESIS_HISTORY);
  return { ...keep, thesisHistory: history, updatedAt: now };
}

/** MERGE store op: keeper updated, absorbed idea deleted (blob + index).
 *  Returns the merged keeper, "mismatch" on a ticker clash, null on a store
 *  failure or a missing id. */
export async function mergeIdeas(keepId: string, absorbId: string): Promise<Idea | "mismatch" | null> {
  const redis = getRedis();
  if (!redis) return null;
  const [keep, absorb] = await Promise.all([getIdea(keepId), getIdea(absorbId)]);
  if (!keep || !absorb) return null;
  const merged = mergeIdeaRecords(keep, absorb);
  if (merged === "mismatch") return "mismatch";
  try {
    await redis.set(K.idea(merged.id), JSON.stringify(merged));
    await redis.del(K.idea(absorb.id));
    await redis.zrem(K.index, absorb.id);
    return merged;
  } catch {
    return null;
  }
}

// ADMIN-1 — the F6 entry-language rule as a SUGGESTION (pure, editable in the
// UI): upward entry language → long, downward → short, nothing certain → null.
const LONG_ENTRY_RE =
  /\b(break(s|ing)? above|clears?|reclaims?|retest(s)? higher|above|breakout|hold(s)? support|bounce|calls?\b|long\b|buy(s|ing)?\b)/i;
const SHORT_ENTRY_RE =
  /\b(break(s|ing)? below|breakdown|loses?|below|rejection( at)?|fails? at|resistance holds?|puts?\b|short\b|sell(s|ing)?\b|fade(s)?\b)/i;

/** PURE. Suggest a side from stated entry language; null when ambiguous
 *  (both patterns, neither pattern, or no entry at all — never guess). */
export function suggestSide(entry: string): IdeaSide | null {
  const e = entry.trim();
  if (!e) return null;
  const long = LONG_ENTRY_RE.test(e);
  const short = SHORT_ENTRY_RE.test(e);
  if (long === short) return null;
  return long ? "long" : "short";
}
