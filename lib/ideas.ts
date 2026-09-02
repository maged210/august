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
 *  book manager keeps the two apart so the desk's record stays honest.
 *  INTEGRITY-1: "review" — the stated side and the entry language disagree
 *  (or the entry is two-sided). A conflicted call never publishes as live;
 *  it waits in review until a human resolves the direction.
 *  DESK-INBOX: "denied" — a human rejected it from the inbox. TERMINAL, with
 *  a stated reason, never a deletion: the record of what was declined is part
 *  of the desk's honesty. Denied rows leave the book and the rail. */
export type IdeaStatus = "draft" | "review" | "live" | "closed" | "invalidated" | "denied";

/** DESK-INBOX — why a human denied it. Fixed vocabulary, shown as a chip. */
export type DenyReason = "no_level" | "not_a_call" | "duplicate" | "stale";
export const DENY_REASONS: readonly DenyReason[] = ["no_level", "not_a_call", "duplicate", "stale"];
export type IdeaSource = "manual" | "extracted";
export type IdeaRiskLevel = "low" | "medium" | "high";
/** UX4 — the desk's stated direction. OPTIONAL and absent-by-default: the
 *  extraction pipeline only sets it when the speaker's language makes the
 *  direction unambiguous, and /admin can set/clear it in one click. Absent
 *  side stays honest (the blotter falls back to its derived-from-levels
 *  rendering, clearly marked as derived). */
export type IdeaSide = "long" | "short" | "watch";

/** INTEGRITY-1 — what the daily close pass concluded about a LIVE idea.
 *  The entry string stays free-form and honest to the source; this is the
 *  machine's read of it, kept separate and recomputed by the pass:
 *  - ARMED        parseable crossing trigger, not yet crossed, freshly stated
 *  - TRIGGERED    the stated crossing was observed at a daily close (sticky —
 *                 a fired call is performance history, it never un-fires)
 *  - STALE        parseable but uncrossed past the stale horizon (3d default —
 *                 STALE narrows to the untriggered book, house law 2026-08-16)
 *  - NEEDS_LEVEL  no crossable trigger in the entry text — the pass cannot
 *                 evaluate it, and the tile must say so instead of "LIVE"
 *  - QUOTE_SUSPECT the resolved quote is more than 3× away from the stated
 *                 level (split, delisting, or symbol mismatch — the NOW bug:
 *                 a 5:1 split made $1,117.50 language grade against a ~$140
 *                 quote). NOT evaluated — grading either way would fabricate;
 *                 the inbox surfaces it for a human restatement */
export type IdeaEvalState = "ARMED" | "TRIGGERED" | "STALE" | "NEEDS_LEVEL" | "QUOTE_SUSPECT";

export type IdeaEvaluation = {
  state: IdeaEvalState;
  /** parsed crossing level (null for NEEDS_LEVEL) */
  level: number | null;
  /** crossing direction the entry language states (null for NEEDS_LEVEL) */
  dir: "above" | "below" | null;
  /** the daily close the conclusion used (null when no quote resolved) */
  price: number | null;
  /** when the pass concluded this (epoch ms) */
  at: number;
  /** honest, human-readable cause */
  reason: string;
};

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
  /** INTEGRITY-1 — set only by the daily book pass (server), never by hand;
   *  absent until the first pass sees the idea */
  evaluation?: IdeaEvaluation;
  /** INTEGRITY-1 — why this row sits in review (side/trigger conflict detail) */
  reviewReason?: string;
  /** DESK-INBOX — the human's stated reason, present only on denied rows */
  denyReason?: DenyReason;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
};

/** What the public rail receives: live ideas, provenance stripped. The
 *  evaluation rides along (INTEGRITY-1) so tiles can say TRIGGERED / STALE /
 *  NEEDS LEVEL instead of a blanket LIVE. */
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
  | "evaluation"
  | "createdAt"
  | "updatedAt"
>;

// Field caps — enforced by the validators, mirrored nowhere else.
export const MAX_INSTRUMENT_CHARS = 40;
export const MAX_THESIS_CHARS = 2000;
export const MAX_LEVEL_CHARS = 120;
export const MAX_IDEAS = 500;

export const IDEA_STATUSES: readonly IdeaStatus[] = ["draft", "review", "live", "closed", "invalidated", "denied"];
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
    ...(i.evaluation ? { evaluation: i.evaluation } : {}),
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
  /** DESK-INBOX — required with (and only with) status "denied" */
  denyReason?: DenyReason;
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
  // DESK-INBOX — a row cannot be BORN denied: denial is a human resolution of
  // an existing row (and the create shape carries no reason to state)
  if (status === "denied") return { ok: false, error: "status_denied_at_create" };

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
  // DESK-INBOX — a denial must state its reason, and the reason travels only
  // with a denial (never a free-floating field write)
  if (b.denyReason !== undefined) {
    if (!DENY_REASONS.includes(b.denyReason as DenyReason))
      return { ok: false, error: "deny_reason_invalid" };
    if (patch.status !== "denied") return { ok: false, error: "deny_reason_without_denied" };
    patch.denyReason = b.denyReason as DenyReason;
  }
  if (patch.status === "denied" && patch.denyReason === undefined)
    return { ok: false, error: "deny_reason_required" };

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
  // INTEGRITY-1 — a human RESTATEMENT of the call (entry or side changed)
  // re-arms the machine's read: the prior evaluation judged a statement that
  // no longer exists, so even a sticky TRIGGERED clears and the next pass
  // evaluates the NEW statement. Sticky-vs-price stays; sticky-vs-human doesn't.
  const restated =
    (fields.entry !== undefined && fields.entry !== existing.entry) ||
    ("side" in fields && fields.side !== existing.side);
  if (restated) delete updated.evaluation;
  // leaving review by human hand retires the conflict note with it
  if (fields.status !== undefined && fields.status !== "review" && existing.status === "review") {
    delete updated.reviewReason;
  }
  // symmetric for denials — the reason lives only on a denied row
  if (fields.status !== undefined && fields.status !== "denied" && existing.status === "denied") {
    delete updated.denyReason;
  }
  try {
    await redis.set(K.idea(id), JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
}

/** INTEGRITY-1 — the daily book pass records its conclusion WITHOUT bumping
 *  updatedAt: staleness measures the last human statement, and a nightly
 *  evaluation write must never reset that clock. */
export async function setIdeaEvaluation(id: string, evaluation: IdeaEvaluation): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const existing = await getIdea(id);
  if (!existing) return false;
  try {
    await redis.set(K.idea(id), JSON.stringify({ ...existing, evaluation }));
    return true;
  } catch {
    return false;
  }
}

/** INTEGRITY-1 — a live row whose side and entry language disagree leaves the
 *  public wire for REVIEW until a human resolves the direction. updatedAt is
 *  PRESERVED: it measures the last HUMAN statement (the staleness law), and a
 *  machine demotion is not one — a re-armed-unresolved row that ping-pongs
 *  back must not have its stale clock reset by the machine. */
export async function demoteIdeaToReview(id: string, reason: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const existing = await getIdea(id);
  if (!existing) return false;
  const updated: Idea = { ...existing, status: "review", reviewReason: reason };
  try {
    await redis.set(K.idea(id), JSON.stringify(updated));
    return true;
  } catch {
    return false;
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

// --- INTEGRITY-1 — reading a crossable trigger out of the entry text --------
// The entry string stays verbatim and free-form (the house law); these helpers
// are the machine's read of it. Only crossing language directly attached to a
// number is evaluable — "holds support", "watch for continuation", "break
// below the trendline" have no crossable level and honestly parse to null.

// "$1,117.50" · "9.45" · "772" — commas tolerated, $ optional.
const LEVEL_NUM = String.raw`\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
// direction keyword immediately followed by a number (optionally a range like
// "772–772.50"); distance matters — "below the short-term uptrend; … $57.70"
// must NOT read 57.70 as the trigger.
const DIR_NUM_RE = new RegExp(
  String.raw`\b(above|over|under|below|loses?|clears?|reclaims?)\s+(?:the\s+)?${LEVEL_NUM}(?:\s*(?:[–—-]|to)\s*${LEVEL_NUM})?`,
  "gi",
);
const ABOVE_WORDS = new Set(["above", "over", "clear", "clears", "reclaim", "reclaims"]);
// A number wearing a UNIT is not a price level: "$100M revenue", "50-day
// moving average", "200dma", "21-day EMA", "30% off highs", "5% yield", "2x".
// Checked against the text immediately after the matched number.
const UNIT_AFTER_RE = /^\s*(?:%|x\b|(?:mm?|bn?|t)\b(?![\w.])|[-‑\s]?(?:day|week|month|year|yr)s?\b|d?ma\b|ema\b|sma\b)/i;
// …but a trailing k is the desk's thousands shorthand ("above 21.5k") — a
// price, multiplied through, not a unit rejection.
const K_AFTER_RE = /^\s*k\b(?![\w.])/i;
// Risk language immediately before a dir keyword marks a STOP, not an entry:
// "long above 9,450; stop below 9,400" is one-directional with its risk
// inline. ("out" is deliberately absent — "break out above X" is an entry.)
const STOP_BEFORE_RE = /\b(?:stop(?:s|ped)?|cut(?:\s+it)?|risk(?:ing)?|invalid\w*|exit\w*)\s*(?:it\s+|is\s+|at\s+)?$/i;
// Bare 19xx/20xx integers (no $, no comma, no decimals) read as YEARS, not
// prices — "loses 2024 support". A real four-digit price is written $2,024 /
// 2,024 / 2024.50 in this book's idiom.
const YEAR_LIKE = (raw: string, value: number) =>
  Number.isInteger(value) && value >= 1990 && value <= 2039 && !/[$,.]/.test(raw);
// two-sided phrasing check by keywords alone (covers "break above X OR break
// below $Y" where only one side carries a number)
const BREAK_ABOVE_RE = /\bbreak\w*(?:\s+out)?\s+above\b/i;
const BREAK_BELOW_RE = /\bbreak\w*(?:\s+out)?\s+below\b/i;

export type ParsedTrigger =
  | { kind: "level"; dir: "above" | "below"; level: number }
  | { kind: "two_sided" };

const toNum = (s: string): number => Number(s.replace(/,/g, ""));

/** PURE. Read the crossable trigger the entry language states. A range takes
 *  its far edge (fully cleared: above 772–772.50 → 772.50; below 766–767 →
 *  766). Unit-qualified numbers ($100M, 50-day, 30%, 200dma, bare years) are
 *  NOT price levels and never match — inventing a trigger is worse than
 *  NEEDS_LEVEL. Inline risk language ("…; stop below 9,400") is a stop, not a
 *  second entry. Both entry directions present → two_sided. Nothing crossable
 *  → null. */
export function parseEntryTrigger(entry: string): ParsedTrigger | null {
  const e = entry.trim();
  if (!e) return null;
  const hits: Array<{ dir: "above" | "below"; level: number }> = [];
  for (const m of e.matchAll(DIR_NUM_RE)) {
    const word = m[1].toLowerCase();
    const dir: "above" | "below" = ABOVE_WORDS.has(word) ? "above" : "below";
    // the text right after the LAST number of this match decides the unit test
    const after = e.slice((m.index ?? 0) + m[0].length);
    const kMult = K_AFTER_RE.test(after) ? 1000 : 1;
    if (kMult === 1 && UNIT_AFTER_RE.test(after)) continue; // "$100M", "50-day", "30%" — not a price
    if (STOP_BEFORE_RE.test(e.slice(0, m.index ?? 0))) continue; // inline stop, not an entry
    const a = toNum(m[2]);
    const b = m[3] != null ? toNum(m[3]) : null;
    if (!Number.isFinite(a) || a <= 0) continue;
    if (b == null && kMult === 1 && YEAR_LIKE(m[2], a)) continue; // "loses 2024 support" — a year
    const level =
      (b != null && Number.isFinite(b) && b > 0 ? (dir === "above" ? Math.max(a, b) : Math.min(a, b)) : a) * kMult;
    hits.push({ dir, level });
  }
  const dirs = new Set(hits.map((h) => h.dir));
  if (dirs.size > 1) return { kind: "two_sided" };
  if (BREAK_ABOVE_RE.test(e) && BREAK_BELOW_RE.test(e)) return { kind: "two_sided" };
  if (hits.length === 0) return null;
  return { kind: "level", dir: hits[0].dir, level: hits[0].level };
}

export type EntryConflict = "two_sided" | "side_mismatch";

/** PURE. Side and trigger direction must agree (INTEGRITY-1): a two-sided
 *  entry, or a stated side that contradicts the entry language, is a conflict
 *  — such a row belongs in REVIEW, never LIVE. */
export function entryConflict(side: IdeaSide | undefined, entry: string): EntryConflict | null {
  const parsed = parseEntryTrigger(entry);
  if (parsed?.kind === "two_sided") return "two_sided";
  if (LONG_ENTRY_RE.test(entry) && SHORT_ENTRY_RE.test(entry)) return "two_sided";
  if (side === "long" || side === "short") {
    const impliedSide: IdeaSide | null =
      parsed?.kind === "level" ? (parsed.dir === "above" ? "long" : "short") : suggestSide(entry);
    if (impliedSide && impliedSide !== side) return "side_mismatch";
  }
  return null;
}

// --- DESK-INBOX — the one queue of everything a human must resolve ----------

/** PURE. The machine-crossable entry string SET LEVEL writes: direction +
 *  $-and-comma formatted number, so the parser can never misread it (bare
 *  four-digit integers read as YEARS by design — the $ is required, not
 *  decoration). Precision is EXACT: as many fraction digits as the human
 *  typed (capped at 8), never quantized — writing "above $0.09" for a stated
 *  0.0945 would grade a level nobody stated. Callers must still round-trip
 *  the result through parseEntryTrigger and refuse on mismatch. */
export function buildLevelEntry(dir: "above" | "below", level: number): string {
  const decimals = Math.min((String(level).split(".")[1] ?? "").length, 8);
  const formatted = level.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${dir} $${formatted}`;
}

export type InboxBuckets = {
  /** drafts from ingest (or the manual form) awaiting APPROVE / DENY */
  pending: Idea[];
  /** live rows the pass can't evaluate: no crossable level, or a suspect quote */
  needsLevel: Idea[];
  /** side/entry-language conflicts awaiting KEEP SIDE / FLIP SIDE */
  review: Idea[];
};

/** PURE. Membership in the inbox — the ONLY path into the lifecycle for
 *  anything the extractor can't fully parse. Newest first inside each group.
 *  NEEDS LEVEL includes fresh rows the pass hasn't seen yet (parse decides,
 *  not the stored evaluation) and QUOTE_SUSPECT rows (a level exists but the
 *  quote can't be trusted against it). */
export function inboxBuckets(ideas: Idea[]): InboxBuckets {
  const newest = (a: Idea, b: Idea) => b.createdAt - a.createdAt;
  const pending = ideas.filter((i) => i.status === "draft").sort(newest);
  const review = ideas.filter((i) => i.status === "review").sort(newest);
  const needsLevel = ideas
    .filter((i) => {
      if (i.status !== "live") return false;
      const ev = i.evaluation;
      if (ev?.state === "NEEDS_LEVEL" || ev?.state === "QUOTE_SUSPECT") return true;
      if (ev) return false; // the pass has a real read (ARMED/TRIGGERED/STALE)
      const parsed = parseEntryTrigger(i.entry);
      return parsed === null || parsed.kind === "two_sided";
    })
    .sort(newest);
  return { pending, needsLevel, review };
}

/** PURE. The console header count: everything awaiting a human tap. */
export function inboxCount(ideas: Idea[]): number {
  const b = inboxBuckets(ideas);
  return b.pending.length + b.needsLevel.length + b.review.length;
}

/** Stale horizon for the untriggered book — same dial as the tracker
 *  (TRACKER_STALE_DAYS overrides; finalized at 3, owner order 2026-08-16). */
export const BOOK_STALE_DAYS = 3;
const DAY_MS = 86_400_000;

/** PURE. One live idea vs one daily close (INTEGRITY-1). Precedence:
 *  TRIGGERED is sticky (a fired call is performance history and never
 *  un-fires) → NEEDS_LEVEL (nothing crossable — the tile must say so, not
 *  "LIVE") → STALE (crossable but uncrossed past the horizon; STALE narrows
 *  to the untriggered book) → ARMED. */
export function evaluateLiveIdea(
  idea: Pick<Idea, "entry" | "updatedAt" | "evaluation">,
  price: number | null,
  now: number,
  staleDays: number = BOOK_STALE_DAYS,
): IdeaEvaluation {
  const prior = idea.evaluation;
  if (prior?.state === "TRIGGERED") return prior; // sticky — performance history

  const parsed = parseEntryTrigger(idea.entry);
  if (!parsed || parsed.kind !== "level") {
    return {
      state: "NEEDS_LEVEL",
      level: null,
      dir: null,
      price,
      at: now,
      reason: "no crossable trigger stated in the entry",
    };
  }
  const { dir, level } = parsed;
  // QUOTE SUSPECT (DESK-INBOX, the NOW bug): a quote more than 3× away from
  // the stated level means the two aren't measuring the same thing — a split
  // (NOW 5:1, 2025-12-18: "$1,117.50" language vs a ~$140 quote), a delisting,
  // or a symbol mismatch. Grading either way would fabricate (a "below" level
  // would spuriously fire sticky TRIGGERED). Refuse to evaluate; the inbox
  // surfaces it for a human restatement.
  if (price != null && price > 0 && (price > level * 3 || price * 3 < level)) {
    return {
      state: "QUOTE_SUSPECT",
      level,
      dir,
      price,
      at: now,
      reason: `quote ${price} is more than 3× away from the stated level ${level} — split, delisting, or symbol mismatch; not evaluated (restate the level in the inbox)`,
    };
  }
  if (price != null) {
    const crossed = dir === "above" ? price >= level : price <= level;
    if (crossed) {
      return {
        state: "TRIGGERED",
        level,
        dir,
        price,
        at: now,
        // "close-pass price", not "daily close" — for 24/7 instruments (BTC)
        // the 22:10 UTC snapshot is a pass price, not an exchange close
        reason: `close-pass price ${price} ${dir === "above" ? "≥" : "≤"} stated trigger ${level} (crossing between passes not directly observed)`,
      };
    }
  }
  const stale = now - idea.updatedAt > staleDays * DAY_MS;
  return {
    state: stale ? "STALE" : "ARMED",
    level,
    dir,
    price,
    at: now,
    reason:
      price == null
        ? stale
          ? `no quote resolved — crossing unconfirmed; no re-statement in ${staleDays}d`
          : "no quote resolved — crossing unevaluated this pass"
        : stale
          ? `trigger uncrossed and no re-statement in ${staleDays}d`
          : "stated trigger not yet crossed",
  };
}
