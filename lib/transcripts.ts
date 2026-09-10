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
  entryConflict,
  MAX_LEVEL_CHARS,
  MAX_THESIS_CHARS,
  parseEntryTrigger,
  statesPriceLevel,
  validateIdeaCreate,
  type IdeaCreateInput,
} from "@/lib/ideas";
import {
  MAX_TAPE_NOTE_CHARS,
  validateTapeCreate,
  type TapeCreateInput,
} from "@/lib/tape";
import { checkSymbol, type SymbolRefusal } from "@/lib/symbol-check";

export const MAX_TRANSCRIPT_CHARS = 120_000;
export const MAX_TRANSCRIPTS = 100;
export const MAX_IDEAS_PER_TRANSCRIPT = 12;
export const MAX_TAPE_PER_TRANSCRIPT = 12;
export const MAX_SOURCE_CHARS = 200;

/** feature/ingest-transcripts — a YouTube video id, for the intake's
 *  duplicate check. Deliberately strict: the guard is only as trustworthy as
 *  the ids it stores. */
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

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
  /** feature/ingest-transcripts — the YouTube video this transcript came from,
   *  set when the text arrived via the link fetcher. Absent on hand-pasted
   *  records and on everything stored before this branch, which is why the
   *  duplicate check below also scans `source`. */
  videoId?: string;
};

// --- pure helpers -----------------------------------------------------------

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

/** PURE. Validate the intake body: non-empty transcript under the cap. */
export function validateTranscriptBody(
  body: unknown,
): Ok<{ text: string; source: string; videoId: string }> | Err {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body_not_object" };
  const b = body as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { ok: false, error: "text_required" };
  if (text.length > MAX_TRANSCRIPT_CHARS)
    return { ok: false, error: `text_over_${MAX_TRANSCRIPT_CHARS}_chars` };
  const source =
    typeof b.source === "string" ? b.source.replace(/\s+/g, " ").trim().slice(0, MAX_SOURCE_CHARS) : "";
  // feature/ingest-transcripts — optional provenance. Only a well-formed
  // YouTube id is accepted; anything else is dropped rather than stored as
  // junk that the duplicate check would then trust.
  const rawVideoId = typeof b.videoId === "string" ? b.videoId.trim() : "";
  const videoId = YOUTUBE_ID_RE.test(rawVideoId) ? rawVideoId : "";
  return { ok: true, value: { text, source, videoId } };
}

// Crossing language pointed at a NAMED reference is a specific trigger even
// with no number attached — "on a break of yesterday's high", "if it reclaims
// the 200-day". Both halves are required: "watch for continued breakout" has
// the verb and no reference, and is exactly the commentary the floor exists
// to reject.
const CROSSING_VERB_RE = /\b(?:break(?:s|ing)?|breaks?\s*out|above|below|over|under|reclaim\w*|clear\w*|lose[sn]?\w*|hold\w*|cross\w*|retest\w*)\b/i;
const NAMED_REFERENCE_RE =
  /\b(?:high|low|close|open|vwap|pivot|trend ?line|channel|neckline|gap|range|resistance|support|moving average|\d+\s*-?\s*day|\d+\s*-?\s*(?:d|s|e)ma|earnings|cpi|fomc|print|report|pre-?market)\b/i;

/**
 * PURE. THE IDEA FLOOR (fix/extractor-quality). An extracted idea has to
 * offer the desk something to act on. A row that offers nothing — "watch for
 * continued breakout", "still on the radar", "continuing to move higher" — is
 * the host naming a ticker in passing. It can never be graded, so it lands in
 * NEEDS LEVEL and stays there, and enough of them make the queue unusable.
 *
 * A row is kept when ANY of these hold:
 *   1. the grader can already read a trigger out of the entry,
 *   2. the entry or the target names a price — a human can point a direction
 *      at a stated number; the desk should not throw the number away,
 *   3. the entry states a specific trigger in words: crossing language
 *      attached to a named reference ("break of yesterday's high"). The desk
 *      grades numerically, so these still need a human to set a level, but
 *      they ARE a stated trigger and the owner's rule keeps them.
 *
 * Dropped rows are NOT rewritten as tape notes: tape is for options and
 * order-flow callouts, and a bare mention isn't one of those either. They are
 * reported to the caller by instrument and entry rather than vanishing —
 * note that re-processing the same transcript is deterministic on the same
 * model output, so a drop is a decision, not a queue to be drained later.
 */
export function applyIdeaFloor(
  ideas: IdeaCreateInput[],
): { ideas: IdeaCreateInput[]; dropped: Array<{ instrument: string; entry: string }> } {
  const kept: IdeaCreateInput[] = [];
  const dropped: Array<{ instrument: string; entry: string }> = [];
  for (const i of ideas) {
    const readableTrigger = parseEntryTrigger(i.entry) !== null;
    const statesAPrice = statesPriceLevel(i.entry) || statesPriceLevel(i.target);
    const statesACondition = CROSSING_VERB_RE.test(i.entry) && NAMED_REFERENCE_RE.test(i.entry);
    if (readableTrigger || statesAPrice || statesACondition) kept.push(i);
    else dropped.push({ instrument: i.instrument, entry: i.entry });
  }
  return { ideas: kept, dropped };
}

export type SymbolDrop = {
  instrument: string;
  company: string;
  reason: SymbolRefusal;
  detail: string;
  /** which lane the row would have reached — the queue or the dock */
  lane: "idea" | "tape";
};

/** ONE implementation for both lanes. A wrong ticker publishes a call on the
 *  wrong security whether it arrives as an idea or as a tape callout, so the
 *  gates, their order, and their refusals are identical — only the lane label
 *  and the field the symbol lives in differ. */
async function gateRowsBySymbol<T>(
  rows: T[],
  symbolOf: (row: T) => string,
  spokenFor: (symbol: string) => string,
  lane: "idea" | "tape",
): Promise<{ kept: T[]; dropped: SymbolDrop[]; unverified: string[] }> {
  const verdicts = await Promise.all(
    rows.map((r) => {
      const sym = symbolOf(r);
      return checkSymbol(sym, spokenFor(sym.trim().toUpperCase()));
    }),
  );
  const kept: T[] = [];
  const dropped: SymbolDrop[] = [];
  const unverified: string[] = [];
  rows.forEach((r, n) => {
    const v = verdicts[n];
    const sym = symbolOf(r);
    if (!v.ok) {
      dropped.push({
        instrument: sym,
        company: spokenFor(sym.trim().toUpperCase()),
        reason: v.reason,
        detail: v.detail,
        lane,
      });
      return;
    }
    if (!v.verified) unverified.push(sym);
    kept.push(r);
  });
  return { kept, dropped, unverified };
}

/**
 * fix/ticker-validation — THE SYMBOL GATE. Every surviving idea's symbol has
 * to resolve to a real instrument, and be the right one for the company the
 * speaker named, before it can queue. See lib/symbol-check for the gates and
 * for why Yahoo's name-search is deliberately not used.
 *
 * NOT PURE (one cached lookup per distinct symbol) and deliberately not a
 * rewriter: a refused row is dropped and named, never repointed at a nearer
 * ticker, and a row that passes keeps the extractor's own instrument text
 * verbatim. `unverified` carries symbols the quote source couldn't answer for
 * — those rows SURVIVE, because a source outage is not evidence a symbol is
 * fake, and deleting real calls during a Yahoo blip is the worse failure.
 */
export async function applySymbolGate(
  ideas: IdeaCreateInput[],
  spokenFor: (symbol: string) => string,
): Promise<{ ideas: IdeaCreateInput[]; dropped: SymbolDrop[]; unverified: string[] }> {
  const r = await gateRowsBySymbol(ideas, (i) => i.instrument, spokenFor, "idea");
  return { ideas: r.kept, dropped: r.dropped, unverified: r.unverified };
}

/**
 * The same gate on the DOCK lane. Tape rows carry a real security too, so a
 * ticker recalled from memory publishes the same wrong thing here — and this
 * lane also receives the F6 demotions (entry-less ideas rewritten as notes),
 * which arrive carrying the idea's instrument and must be checked with it.
 */
export async function applyTapeSymbolGate(
  tape: TapeCreateInput[],
  spokenFor: (symbol: string) => string,
): Promise<{ tape: TapeCreateInput[]; dropped: SymbolDrop[]; unverified: string[] }> {
  const r = await gateRowsBySymbol(tape, (t) => t.symbol, spokenFor, "tape");
  return { tape: r.kept, dropped: r.dropped, unverified: r.unverified };
}

/** PURE. symbol → the company name the speaker actually said, read off the RAW
 *  model output before validation strips the field. `key` is the field the
 *  symbol lives in: "instrument" for ideas, "symbol" for tape. */
export function spokenCompanies(raw: unknown, key: "instrument" | "symbol" = "instrument"): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of Array.isArray(raw) ? raw : []) {
    if (typeof c !== "object" || c === null) continue;
    const b = c as Record<string, unknown>;
    const symbol = typeof b[key] === "string" ? (b[key] as string).trim().toUpperCase() : "";
    const company = typeof b.company === "string" ? b.company.trim() : "";
    if (symbol) out.set(symbol, company);
  }
  return out;
}

/** PURE. One lookup across both lanes' raw candidates. The tape lane needs the
 *  ideas map too: an F6 demotion reaches tape carrying the IDEA's instrument,
 *  and its spoken company was only ever stated on the idea row. */
export function spokenCompanyLookup(rawIdeas: unknown, rawTape: unknown): (symbol: string) => string {
  const ideas = spokenCompanies(rawIdeas, "instrument");
  const tape = spokenCompanies(rawTape, "symbol");
  return (symbol: string) => {
    const k = (symbol || "").trim().toUpperCase();
    return tape.get(k) || ideas.get(k) || "";
  };
}

/**
 * PURE. Filter the model's candidates down to rows that pass the SAME
 * validator the admin create API uses — anything malformed is dropped, never
 * repaired into existence. Caps the count; stamps source "extracted",
 * status "draft" (the pipeline can never publish).
 */
export function normalizeCandidates(raw: unknown, max = MAX_IDEAS_PER_TRANSCRIPT): IdeaCreateInput[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: IdeaCreateInput[] = [];
  for (const c of list.slice(0, max)) {
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

// A stop marker plus the rest of its clause. The clause ends at ';' or ')' —
// and at a SENTENCE period, which is a period followed by space or end-of-
// string. A bare '.' must not end it: that would cut "$36.70" down to "$36"
// and read the stop as a level nobody said.
const STOP_CLAUSE_RE = /\b(?:stop(?:s|ped)?|invalidat\w*|exit\w*)\b([^;)]*)/gi;
const SENTENCE_END_RE = /\.(?:\s|$)/;
const CLAUSE_NUM_RE = /\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;

/**
 * PURE (fix/extractor-quality). THE STOP IS NOT THE ENTRY. Asking the model
 * to keep a direction word next to the number makes stated levels gradeable,
 * but it also tempts it to reach for whichever number is nearest — and on a
 * real run it emitted "above 36.70 support (stop below 36.70)" for a call
 * whose entry was "near current levels (~$40)" and whose $36.70 was the STOP.
 * Graded literally, that arms a trigger the speaker never gave.
 *
 * When the number the grader would trade on is also stated as this row's
 * stop, the row is contested: it goes to REVIEW for a human rather than out
 * as a clean draft. Detectable in code, so it is decided in code.
 */
/** PURE. Every number this entry states inside a stop clause. An EMPTY set
 *  from a string that HAS a stop clause is the ambiguous case — the stop
 *  names no level of its own, so it is pointing at some other number in the
 *  row (in practice, the trigger). Callers distinguish the two. */
export function stopNumbers(entry: string): { hasStopClause: boolean; numbers: Set<number> } {
  const numbers = new Set<number>();
  let hasStopClause = false;
  for (const m of (entry ?? "").matchAll(STOP_CLAUSE_RE)) {
    hasStopClause = true;
    const clause = (m[1] ?? "").split(SENTENCE_END_RE)[0];
    for (const n of clause.matchAll(CLAUSE_NUM_RE)) {
      const v = Number(n[1].replace(/,/g, ""));
      if (Number.isFinite(v) && v > 0) numbers.add(v);
    }
  }
  return { hasStopClause, numbers };
}

export function stopMasqueradingAsEntry(entry: string): boolean {
  const trigger = parseEntryTrigger(entry);
  if (trigger?.kind !== "level") return false;
  const { hasStopClause, numbers } = stopNumbers(entry);
  if (!hasStopClause) return false;
  // A stop with its own level, different from the trigger, is the normal
  // healthy shape ("break above $50; stop below $47") — leave it alone.
  if (numbers.size > 0) return numbers.has(trigger.level);
  // A stop clause naming no level of its own ("above 36.70 support (stop
  // below)") is pointing back at the trigger. Contested → a human decides.
  return true;
}

/**
 * PURE (INTEGRITY-1). THE CONFLICT RULE: side and trigger direction must
 * agree. A candidate whose stated side contradicts its entry language, or
 * whose entry is two-sided ("break above X for bulls; break below Y for
 * bears" collapsed into one row), lands in REVIEW — never publishable as
 * live until a human resolves the direction. Runs AFTER applyEntryRule, so
 * every row here still passed the idea validator.
 *
 * A stop wearing the entry's clothes (above) lands in the same place, for the
 * same reason: a human decides, the pipeline never guesses.
 */
export function applyConflictRule(ideas: IdeaCreateInput[]): IdeaCreateInput[] {
  return ideas.map((i) => {
    const conflict = entryConflict(i.side, i.entry) !== null || stopMasqueradingAsEntry(i.entry);
    return conflict ? { ...i, status: "review" as const } : i;
  });
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
- instrument / company: give the ticker ONLY when the speaker says it or it is unambiguous, and ALWAYS put the company as they named it in "company". If you are not sure of a ticker, leave instrument as the speaker's own words and fill in "company" — a ticker recalled from memory is worse than none, and the desk verifies every symbol before it queues anything. NEVER map a private company (SpaceX, OpenAI, Stripe) onto a listed ticker: name the company and the desk will refuse it honestly.
- thesis: a tight 1-3 sentence paraphrase of the speaker's ACTUAL reasoning for this idea, in plain prose (max ${MAX_THESIS_CHARS} chars).
- entry / target: the speaker's stated levels or conditions, near-verbatim — an EMPTY STRING when the speaker states none (max ${MAX_LEVEL_CHARS} chars). Never guess a number.
- WHEN THE SPEAKER STATES A CROSSING, KEEP THE DIRECTION WORD NEXT TO THE NUMBER: "break above 775.50", "loses 600", "reclaims 21,450", "below $8.40". Do not scatter them ("break of 600", "below the trendline … 57.70") — the desk reads a direction word immediately followed by the number and nothing else.
- BUT NEVER MANUFACTURE A CROSSING THE SPEAKER DIDN'T STATE, and never borrow a number from another role. These are the traps, all seen in real transcripts:
  · A SUPPORT or RESISTANCE level is not an entry. "It's double-bottoming off $35 support" states support at 35 and NO trigger — write it as their words ("double bottom off $35 support"), NOT as "above $35". "It's close to resistance, 37 to $40" is a zone being watched, NOT "break above $40".
  · A STOP is not an entry. "Buy here, stop below 36.70" states a stop of 36.70 and NO entry trigger.
  · A TARGET is not an entry, and an option STRIKE is not a price level.
  · "At current levels" / "right here" / "on a pullback" IS the entry when that is what they said. Keep it.
- A row honestly carrying no crossable trigger is WANTED — a human sets the level from the desk. A borrowed or invented number is the one outcome that is never acceptable.
- A call WITHOUT a stated entry is NOT an idea — emit it as a TAPE NOTE (the "tape" list, kind "note") instead. Ideas require an actionable entry.
- THE FLOOR — an idea needs a stated level OR a specific stated trigger condition. The host naming a ticker in passing is NOT an idea: "still on the radar", "watch for continuation", "continuing to move higher", "looks good here" with no level and no specific trigger. LEAVE THOSE OUT ENTIRELY. The desk drops them regardless, and a queue full of them is worse than a short queue.
- riskLevel: "high" when the speaker frames the idea as aggressive, speculative, or a lottery; "low" when framed as conservative, core, or highest-conviction; otherwise "medium".
- side: "long" ONLY when the speaker's entry language points up ("break above", "clears", "reclaims", "retest higher", buying calls/going long); "short" ONLY when it points down ("break below", "breakdown", "loses", "rejection at", shorting/buying puts); "watch" ONLY when they explicitly frame it as watch-only, no trade yet. When the direction is genuinely ambiguous, OMIT the field entirely — a wrong side is worse than no side. Never infer it from the thesis mood alone.
- Skip pure market commentary with no actionable idea. Merge repeats of the same idea into one row.

TAPE CALLOUTS (the "tape" list) — specific options or order-flow trades the speaker mentions seeing or making ("someone swept the 7600 SPX puts", "I bought the 600 calls for Friday"):
- symbol / company: same rule as ideas — the ticker ONLY when the speaker says it or it is unambiguous, and ALWAYS the company as they named it in "company". A ticker recalled from memory is worse than none, and every tape symbol is verified before it reaches the dock.
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
            company: {
              type: "string",
              description:
                "The company or subject the speaker NAMED, in their words ('SpaceX', 'Enphase', 'Alamos Gold'). Empty string when they only said a ticker. This is checked against the symbol — do not restate the ticker here.",
            },
            thesis: { type: "string", description: "1-3 sentence paraphrase of the speaker's reasoning." },
            entry: {
              type: "string",
              description:
                "Stated entry level/condition, near-verbatim; empty string if none stated. When the speaker states a crossing, keep the direction word next to the number ('break above 775.50'). Never convert a support/resistance level, a stop, or a target into a crossing they did not state.",
            },
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
            company: {
              type: "string",
              description:
                "The company or subject the speaker NAMED for this underlying, in their words. Empty string when they only said a ticker. Checked against the symbol — do not restate the ticker here.",
            },
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
): Promise<{
  ideas: IdeaCreateInput[];
  tape: TapeCreateInput[];
  dropped: Array<{ instrument: string; entry: string }>;
  symbolDrops: SymbolDrop[];
  unverifiedSymbols: string[];
}> {
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
  // Every rule below is enforced in CODE, not just prompted — the prompt asks,
  // the code decides:
  //   LEVEL CAPTURE — a stated level that the near-verbatim phrasing hides from
  //     the grader is rewritten into canonical form, but only when the number
  //     is actually in the transcript and the result round-trips.
  //   F6 entry rule — entry-less idea candidates demote to tape notes.
  //   THE FLOOR — a row with neither a readable trigger nor a stated price is
  //     commentary, not an idea, and never reaches the queue.
  //   INTEGRITY-1 conflict rule — side vs entry-language disagreement (or a
  //     two-sided entry) lands in REVIEW.
  // The floor runs BEFORE the per-transcript cap, so commentary can't eat the
  // idea budget and push real calls out of the run unseen.
  const ruled = applyEntryRule(
    normalizeCandidates(input?.ideas, MAX_IDEAS_PER_TRANSCRIPT * 4),
    normalizeTapeCandidates(input?.tape),
  );
  const floored = applyIdeaFloor(ruled.ideas);
  // THE SYMBOL GATE runs last, on rows that already earned their place — a
  // wrong ticker is the one failure that publishes a call on a security the
  // desk never meant to watch, so nothing reaches the queue OR the dock
  // without resolving first. Tape is gated after applyEntryRule so the F6
  // demotions it appended are checked too.
  const spokenFor = spokenCompanyLookup(input?.ideas, input?.tape);
  const [gated, gatedTape] = await Promise.all([
    applySymbolGate(floored.ideas, spokenFor),
    applyTapeSymbolGate(ruled.tape, spokenFor),
  ]);
  return {
    ideas: applyConflictRule(gated.ideas).slice(0, MAX_IDEAS_PER_TRANSCRIPT),
    tape: gatedTape.tape,
    dropped: floored.dropped,
    symbolDrops: [...gated.dropped, ...gatedTape.dropped],
    unverifiedSymbols: [...gated.unverified, ...gatedTape.unverified],
  };
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
  videoId = "",
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
    ...(videoId ? { videoId } : {}),
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

/**
 * PURE. Does this stored record refer to the given video? Matches the explicit
 * `videoId` first, then falls back to scanning `source` — records written
 * before feature/ingest-transcripts (and hand-pasted ones where the owner put
 * the URL in the source box) carry the id only in that label.
 */
export function recordMatchesVideo(rec: TranscriptRecord, videoId: string): boolean {
  if (!YOUTUBE_ID_RE.test(videoId)) return false;
  if (rec.videoId === videoId) return true;
  return typeof rec.source === "string" && rec.source.includes(videoId);
}

/**
 * feature/ingest-transcripts — prior intakes of this video, newest first.
 * Scans the whole retained index (MAX_TRANSCRIPTS), not just the recent page,
 * so the duplicate warning doesn't go quiet once a video scrolls off the log.
 */
export async function findTranscriptsForVideo(videoId: string): Promise<TranscriptRecord[]> {
  if (!YOUTUBE_ID_RE.test(videoId)) return [];
  const rows = await listTranscripts(MAX_TRANSCRIPTS);
  return rows.filter((r) => recordMatchesVideo(r, videoId));
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
