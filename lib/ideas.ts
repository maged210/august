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

export type IdeaStatus = "draft" | "live" | "closed";
export type IdeaSource = "manual" | "extracted";
export type IdeaRiskLevel = "low" | "medium" | "high";

export type Idea = {
  id: string;
  /** the traded thing — "NQ", "NVDA", "BTC" — free-form symbol or name */
  instrument: string;
  /** the one-paragraph why */
  thesis: string;
  /** free-form level ("21,450", "break of 600") — honest to the source, never coerced to a number */
  entry: string;
  target: string;
  riskLevel: IdeaRiskLevel;
  status: IdeaStatus;
  source: IdeaSource;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
};

/** What the public rail receives: live ideas, provenance stripped. */
export type PublicIdea = Pick<
  Idea,
  "id" | "instrument" | "thesis" | "entry" | "target" | "riskLevel" | "createdAt" | "updatedAt"
>;

// Field caps — enforced by the validators, mirrored nowhere else.
export const MAX_INSTRUMENT_CHARS = 40;
export const MAX_THESIS_CHARS = 2000;
export const MAX_LEVEL_CHARS = 120;
export const MAX_IDEAS = 500;

export const IDEA_STATUSES: readonly IdeaStatus[] = ["draft", "live", "closed"];
export const IDEA_SOURCES: readonly IdeaSource[] = ["manual", "extracted"];
export const IDEA_RISKS: readonly IdeaRiskLevel[] = ["low", "medium", "high"];

// --- pure helpers -----------------------------------------------------------

export function toPublicIdea(i: Idea): PublicIdea {
  return {
    id: i.id,
    instrument: i.instrument,
    thesis: i.thesis,
    entry: i.entry,
    target: i.target,
    riskLevel: i.riskLevel,
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
  riskLevel: IdeaRiskLevel;
  status: IdeaStatus;
  source: IdeaSource;
};

export type IdeaPatchInput = Partial<Omit<IdeaCreateInput, "source">>;

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

  const riskLevel = b.riskLevel;
  if (!IDEA_RISKS.includes(riskLevel as IdeaRiskLevel))
    return { ok: false, error: "risk_level_invalid" };

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
      riskLevel: riskLevel as IdeaRiskLevel,
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
  const updated: Idea = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() };
  try {
    await redis.set(K.idea(id), JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
}
