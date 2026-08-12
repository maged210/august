// Transcript → trade-ideas pipeline (CORE V2 P4).
//
// POST /api/admin/transcripts is the ONE intake: the /admin paste box today,
// a NoteGPT webhook tomorrow — same endpoint, same flow, no manual trigger:
//   store raw transcript → Claude extraction (schema-forced tool call, so the
//   JSON is validated at the API layer) → every candidate that survives
//   validateIdeaCreate lands as a DRAFT idea (source "extracted").
// Nothing goes public from here — the /admin queue's approve step is the only
// door to the rail.
//
// Raw transcripts are never lost: the record is written BEFORE extraction and
// updated with the outcome (processed + ideaIds, or failed + error).
//
// Shape follows the house store pattern (lazy best-effort Redis, shared
// `august:ideas:v1:transcripts*` keys next to the ideas they produce) with
// pure, node:test-friendly helpers up top.

import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";
import {
  MAX_LEVEL_CHARS,
  MAX_THESIS_CHARS,
  validateIdeaCreate,
  type IdeaCreateInput,
} from "@/lib/ideas";
import {
  MAX_TAPE_NOTE_CHARS,
  validateTapeCreate,
  type TapeCreateInput,
} from "@/lib/tape";

export const MAX_TRANSCRIPT_CHARS = 120_000;
export const MAX_TRANSCRIPTS = 100;
export const MAX_IDEAS_PER_TRANSCRIPT = 12;
export const MAX_TAPE_PER_TRANSCRIPT = 12;
export const MAX_SOURCE_CHARS = 200;

const EXTRACT_MODEL = "claude-sonnet-4-6";

export type TranscriptStatus = "processed" | "failed";

export type TranscriptRecord = {
  id: string;
  /** optional label — a video title/URL from the paste box or webhook */
  source: string;
  chars: number;
  receivedAt: number;
  status: TranscriptStatus;
  /** draft ideas created from this transcript */
  ideaIds: string[];
  /** draft tape entries created from this transcript (G3 round 4; absent on older records) */
  tapeIds?: string[];
  error?: string;
};

// --- pure helpers -----------------------------------------------------------

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

/** PURE. Validate the intake body: non-empty transcript under the cap. */
export function validateTranscriptBody(
  body: unknown,
): Ok<{ text: string; source: string }> | Err {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body_not_object" };
  const b = body as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { ok: false, error: "text_required" };
  if (text.length > MAX_TRANSCRIPT_CHARS)
    return { ok: false, error: `text_over_${MAX_TRANSCRIPT_CHARS}_chars` };
  const source =
    typeof b.source === "string" ? b.source.replace(/\s+/g, " ").trim().slice(0, MAX_SOURCE_CHARS) : "";
  return { ok: true, value: { text, source } };
}

/**
 * PURE. Filter the model's candidates down to rows that pass the SAME
 * validator the admin create API uses — anything malformed is dropped, never
 * repaired into existence. Caps the count; stamps source "extracted",
 * status "draft" (the pipeline can never publish).
 */
export function normalizeCandidates(raw: unknown): IdeaCreateInput[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: IdeaCreateInput[] = [];
  for (const c of list.slice(0, MAX_IDEAS_PER_TRANSCRIPT)) {
    if (typeof c !== "object" || c === null) continue;
    const b = c as Record<string, unknown>;
    const parsed = validateIdeaCreate({
      instrument: b.instrument,
      thesis: b.thesis,
      entry: b.entry ?? "",
      target: b.target ?? "",
      riskLevel: b.riskLevel,
      side: b.side, // optional — the validator rejects anything but a known side
      status: "draft",
      source: "extracted",
    });
    if (parsed.ok) out.push(parsed.value);
  }
  return out;
}

/**
 * PURE. Same discipline for tape callouts (G3 round 4): each candidate must
 * pass lib/tape's own create validator; malformed rows are dropped. Stamps
 * source "extracted", status "draft" — extracted tape can never publish
 * itself; the /admin queue's approve step is the only door to the dock.
 */
export function normalizeTapeCandidates(raw: unknown): TapeCreateInput[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: TapeCreateInput[] = [];
  for (const c of list.slice(0, MAX_TAPE_PER_TRANSCRIPT)) {
    if (typeof c !== "object" || c === null) continue;
    const b = c as Record<string, unknown>;
    const parsed = validateTapeCreate({
      symbol: b.symbol,
      note: b.note,
      expiry: b.expiry ?? "",
      premium: b.premium ?? "",
      kind: b.kind,
      sentiment: b.sentiment,
      status: "draft",
      source: "extracted",
    });
    if (parsed.ok) out.push(parsed.value);
  }
  return out;
}

/**
 * PURE (F6). THE PIPELINE RULE: a call WITHOUT a stated entry is not an idea —
 * it's commentary. Any idea candidate whose entry is empty demotes to a TAPE
 * NOTE draft (thesis → note, side → sentiment) and leaves the ideas list.
 * Runs AFTER both normalizers, so every demoted row still passed the idea
 * validator and re-passes the tape validator (drop-on-failure, never repair).
 */
export function applyEntryRule(
  ideas: IdeaCreateInput[],
  tape: TapeCreateInput[],
): { ideas: IdeaCreateInput[]; tape: TapeCreateInput[] } {
  const keptIdeas: IdeaCreateInput[] = [];
  const outTape = [...tape];
  for (const i of ideas) {
    if (i.entry.trim() !== "") {
      keptIdeas.push(i);
      continue;
    }
    const parsed = validateTapeCreate({
      symbol: i.instrument,
      note: i.thesis.slice(0, MAX_TAPE_NOTE_CHARS),
      expiry: "",
      premium: "",
      kind: "note",
      sentiment: i.side === "long" ? "bull" : i.side === "short" ? "bear" : "neutral",
      status: "draft",
      source: "extracted",
    });
    if (parsed.ok) outTape.push(parsed.value);
    // a demotion that can't re-validate simply drops — never repaired
  }
  return { ideas: keptIdeas, tape: outTape.slice(0, MAX_TAPE_PER_TRANSCRIPT) };
}

// --- extraction -------------------------------------------------------------

export function aiConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  // `vercel env pull` writes literal "[SENSITIVE]" for sensitive-type vars —
  // treat masked placeholders as absent so callers 503 instead of 401-ing.
  return key.length > 0 && !key.includes("[SENSITIVE]");
}

const EXTRACT_SYSTEM = `You extract trade ideas AND options/flow callouts from trading-video transcripts for a human review queue. Rules, in order:
- Extract ONLY what the speaker actually states. Never invent an instrument, level, direction, or trade the transcript does not contain.

TRADE IDEAS (the "ideas" list):
- thesis: a tight 1-3 sentence paraphrase of the speaker's ACTUAL reasoning for this idea, in plain prose (max ${MAX_THESIS_CHARS} chars).
- entry / target: the speaker's stated levels or conditions, near-verbatim ("21,450", "break of 600", "under the pivot") — an EMPTY STRING when the speaker states none (max ${MAX_LEVEL_CHARS} chars). Never guess a number.
- A call WITHOUT a stated entry is NOT an idea — emit it as a TAPE NOTE (the "tape" list, kind "note") instead. Ideas require an actionable entry.
- riskLevel: "high" when the speaker frames the idea as aggressive, speculative, or a lottery; "low" when framed as conservative, core, or highest-conviction; otherwise "medium".
- side: "long" ONLY when the speaker's entry language points up ("break above", "clears", "reclaims", "retest higher", buying calls/going long); "short" ONLY when it points down ("break below", "breakdown", "loses", "rejection at", shorting/buying puts); "watch" ONLY when they explicitly frame it as watch-only, no trade yet. When the direction is genuinely ambiguous, OMIT the field entirely — a wrong side is worse than no side. Never infer it from the thesis mood alone.
- Skip pure market commentary with no actionable idea. Merge repeats of the same idea into one row.

TAPE CALLOUTS (the "tape" list) — specific options or order-flow trades the speaker mentions seeing or making ("someone swept the 7600 SPX puts", "I bought the 600 calls for Friday"):
- note: the callout in a short plain phrase, near-verbatim ("Buy 7600 SPX Put") (max ${MAX_TAPE_NOTE_CHARS} chars).
- expiry / premium: ONLY when the speaker states them ("0DTE", "Friday", "$1.2M") — an EMPTY STRING otherwise. Never guess.
- kind: "sweep" or "block" or "split" ONLY when the speaker uses that word or describes that mechanic; otherwise "note".
- sentiment: "bull" for bullish positioning (calls bought / puts sold), "bear" for bearish, "neutral" when unclear or two-sided.
- A tape callout that is ALSO a full trade idea with reasoning may appear in both lists — the idea carries the why, the tape row carries the flow.

Nothing found → emit empty lists. Everything goes to a DRAFT queue a human approves — completeness matters less than never fabricating.`;

const EMIT_EXTRACTIONS_TOOL = {
  name: "emit_extractions",
  description:
    "Emit every trade idea and every options/flow tape callout found in the transcript (empty lists when there are none).",
  input_schema: {
    type: "object" as const,
    properties: {
      ideas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            instrument: { type: "string", description: "The traded thing — 'NQ', 'NVDA', 'BTC'." },
            thesis: { type: "string", description: "1-3 sentence paraphrase of the speaker's reasoning." },
            entry: { type: "string", description: "Stated entry level/condition, near-verbatim; empty string if none stated." },
            target: { type: "string", description: "Stated target, near-verbatim; empty string if none stated." },
            riskLevel: { type: "string", enum: ["low", "medium", "high"] },
            side: {
              type: "string",
              enum: ["long", "short", "watch"],
              description:
                "Only when the speaker's entry language makes the direction unambiguous; OMIT when unclear — never guess.",
            },
          },
          // side deliberately NOT required — omission is the honest ambiguous state
          required: ["instrument", "thesis", "entry", "target", "riskLevel"],
        },
      },
      tape: {
        type: "array",
        items: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "The underlying — 'SPX', 'NVDA'." },
            note: { type: "string", description: "The callout, short and near-verbatim — 'Buy 7600 SPX Put'." },
            expiry: { type: "string", description: "Stated expiry ('0DTE', 'DEC 19'); empty string if none stated." },
            premium: { type: "string", description: "Stated premium/size ('$1.2M'); empty string if none stated." },
            kind: { type: "string", enum: ["sweep", "block", "split", "note"] },
            sentiment: { type: "string", enum: ["bull", "bear", "neutral"] },
          },
          required: ["symbol", "note", "expiry", "premium", "kind", "sentiment"],
        },
      },
    },
    required: ["ideas", "tape"],
  },
};

let _client: Anthropic | null = null;
function getClient(apiKey: string): Anthropic {
  if (!_client || (_client.apiKey as string | null) !== apiKey) {
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/**
 * Call Claude with the schema-forced emit_extractions tool and return
 * validated candidates for BOTH categories (G3 round 4: tape callouts ride
 * the same call as ideas — one transcript, one model pass). Throws on API
 * failure — the caller records the failure on the transcript so the raw text
 * survives for a retry.
 */
export async function extractFromTranscript(
  text: string,
): Promise<{ ideas: IdeaCreateInput[]; tape: TapeCreateInput[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !aiConfigured()) throw new Error("ai_not_configured");
  const client = getClient(apiKey);

  const msg = await client.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 4000,
    system: EXTRACT_SYSTEM,
    tools: [EMIT_EXTRACTIONS_TOOL],
    tool_choice: { type: "tool", name: "emit_extractions" },
    messages: [{ role: "user", content: `TRANSCRIPT:\n\n${text}` }],
  });

  const toolUse = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "emit_extractions",
  );
  const input = toolUse?.input as { ideas?: unknown; tape?: unknown } | undefined;
  // F6 — the entry rule is enforced in code, not just prompted: entry-less
  // idea candidates demote to tape notes no matter what the model emitted
  return applyEntryRule(normalizeCandidates(input?.ideas), normalizeTapeCandidates(input?.tape));
}

// --- store ------------------------------------------------------------------

const NS = "august:ideas:v1:transcripts";
const K = {
  index: NS,
  transcript: (id: string) => `${NS}:${id}`,
  rawText: (id: string) => `${NS}:${id}:text`,
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

export function transcriptsConfigured(): boolean {
  return getRedis() !== null;
}

function newTranscriptId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `tr_${rand}`;
}

function parseRecord(raw: unknown): TranscriptRecord | null {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof v !== "object" || v === null) return null;
    const t = v as TranscriptRecord;
    if (typeof t.id !== "string") return null;
    return t;
  } catch {
    return null;
  }
}

/** Write the record + raw text BEFORE extraction — the raw is never lost. */
export async function storeTranscript(
  text: string,
  source: string,
): Promise<TranscriptRecord | null> {
  const redis = getRedis();
  if (!redis) return null;
  const rec: TranscriptRecord = {
    id: newTranscriptId(),
    source,
    chars: text.length,
    receivedAt: Date.now(),
    status: "failed", // pessimistic until extraction lands
    ideaIds: [],
    error: "pending",
  };
  try {
    await redis.set(K.transcript(rec.id), JSON.stringify(rec));
    await redis.set(K.rawText(rec.id), text);
    await redis.zadd(K.index, { score: rec.receivedAt, member: rec.id });
    await redis.zremrangebyrank(K.index, 0, -(MAX_TRANSCRIPTS + 1));
    return rec;
  } catch {
    return null;
  }
}

export async function updateTranscript(
  id: string,
  patch: Partial<Pick<TranscriptRecord, "status" | "ideaIds" | "tapeIds" | "error">>,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const raw = await redis.get(K.transcript(id));
    const rec = raw ? parseRecord(raw) : null;
    if (!rec) return;
    const next: TranscriptRecord = { ...rec, ...patch };
    if (patch.error === undefined && patch.status === "processed") delete next.error;
    await redis.set(K.transcript(id), JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}

/** The DESK WIRE's public shape (G3 round 5): counts, label, time — never
 *  raw text, never draft contents, never failure detail (admin-only facts). */
export type PublicIngest = {
  id: string;
  ts: number;
  /** the owner-typed label ("video title or URL"); may be empty */
  source: string;
  ideaDrafts: number;
  tapeDrafts: number;
};

/** Public wire view: PROCESSED ingests only, newest first, redacted. */
export async function listPublicIngests(limit = 12): Promise<PublicIngest[]> {
  const rows = await listTranscripts(limit);
  return rows
    .filter((r) => r.status === "processed")
    .map((r) => ({
      id: r.id,
      ts: r.receivedAt,
      source: r.source,
      ideaDrafts: r.ideaIds.length,
      tapeDrafts: r.tapeIds?.length ?? 0,
    }));
}

/** Newest first. Records only — raw text stays server-side unless asked for. */
export async function listTranscripts(limit = 10): Promise<TranscriptRecord[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const n = Math.max(1, Math.min(MAX_TRANSCRIPTS, Math.floor(limit)));
    const ids = await redis.zrange<string[]>(K.index, 0, n - 1, { rev: true });
    if (!ids || ids.length === 0) return [];
    const rows = await Promise.all(
      ids.map(async (id) => parseRecord(await redis.get(K.transcript(id)))),
    );
    return rows.filter((r): r is TranscriptRecord => r !== null);
  } catch {
    return [];
  }
}
