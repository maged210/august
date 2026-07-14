// AUGUST's long-term memory layer — SERVER ONLY.
//
// Two stores in Upstash Redis (REST):
//   august:profile    -> a JSON blob of durable facts about the user (merged over time)
//   august:summaries  -> a list of short, timestamped per-conversation summaries
//
// This is what AUGUST has learned about the USER. It is kept entirely separate from
// his persona/backstory (Viv, Cleo, ...) which lives in lib/persona.ts.
//
// Degrades gracefully: if UPSTASH_REDIS_REST_URL / _TOKEN are absent, every function
// is a no-op and the app behaves exactly as before.
//
// MULTI-USER (stage 2): every function takes the session email (resolved once
// by the route via requireSessionEmail) and scopes its keys through scopeKey —
// null email = single-user fallback = the legacy keys, unchanged.

import { Redis } from "@upstash/redis";
import Anthropic from "@anthropic-ai/sdk";
import { USER_NAME } from "./persona";
import { scopeKey } from "./user-scope";

const PROFILE_KEY = "august:profile";
const SUMMARIES_KEY = "august:summaries";
const SUMMARIES_CAP = 50; // how many session summaries we retain
const SUMMARIES_LOAD = 6; // how many we read for the system prompt
const SUMMARIES_PROMPT = 4; // how many actually reach the prompt
const SUMMARY_CHARS = 240; // per-summary cap in the prompt
const ITEM_CHARS = 110; // per-profile-item cap in the prompt

const clip = (s: string, n: number): string =>
  s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;

const MEMORY_MODEL = "claude-haiku-4-5"; // cheap model for the background update

export type Profile = {
  name?: string;
  working_on?: string[];
  preferences?: string[];
  people?: string[];
  facts?: string[];
  updated_at?: string;
};

export type SessionSummary = { sessionId: string; ts: string; text: string };

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

export function memoryEnabled(): boolean {
  return getRedis() !== null;
}

// ---------------------------------------------------------------------------
// Load (used by the chat route to inject memory into the system prompt)
// ---------------------------------------------------------------------------

export async function loadMemory(email: string | null): Promise<{
  profile: Profile | null;
  summaries: SessionSummary[];
}> {
  const redis = getRedis();
  if (!redis) return { profile: null, summaries: [] };
  try {
    // One HTTP round trip, not two. MGET can't combine these (GET + LRANGE are
    // different types), but an Upstash pipeline ships both in a single request.
    const pipe = redis.pipeline();
    pipe.get(scopeKey(email, PROFILE_KEY));
    pipe.lrange(scopeKey(email, SUMMARIES_KEY), 0, SUMMARIES_LOAD - 1);
    const [profile, summaries] = await pipe.exec<[Profile | null, SessionSummary[]]>();
    return { profile: profile ?? null, summaries: summaries ?? [] };
  } catch {
    return { profile: null, summaries: [] };
  }
}

function profileHasContent(p: Profile | null): p is Profile {
  return !!(
    p &&
    (p.name ||
      p.working_on?.length ||
      p.preferences?.length ||
      p.people?.length ||
      p.facts?.length)
  );
}

/** The "WHAT YOU REMEMBER ABOUT <NAME>" block appended to AUGUST's system prompt.
 *  Returns "" when there is nothing to remember (so first runs are unaffected). */
export function buildMemorySection(
  profile: Profile | null,
  summaries: SessionSummary[],
): string {
  if (!profileHasContent(profile) && summaries.length === 0) return "";

  const name = profile?.name || USER_NAME;
  const out: string[] = [];
  out.push(`\n\n---\nWHAT YOU REMEMBER ABOUT ${name.toUpperCase()}`);
  out.push(
    `This is what you have come to know about ${name} across your conversations — his world, not yours. ` +
      `Let it inform you quietly; weave it in only when it genuinely fits, always in your own voice. ` +
      `Never recite it like a file and never say "according to my records." ` +
      `If he asks what you remember about him, tell him plainly and warmly, in your own words.`,
  );

  // Trimmed on purpose: prompt weight slows time-to-first-token. The full memory
  // stays in Redis — only a capped slice reaches the system prompt.
  if (profileHasContent(profile)) {
    out.push(`\nAbout him:`);
    if (profile.name) out.push(`- Name: ${profile.name}`);
    const list = (items: string[] | undefined, cap: number) =>
      (items ?? []).slice(0, cap).map((x) => clip(x, ITEM_CHARS));
    const working = list(profile.working_on, 6);
    if (working.length) out.push(`- Working on: ${working.join("; ")}`);
    const prefers = list(profile.preferences, 6);
    if (prefers.length) out.push(`- Prefers: ${prefers.join("; ")}`);
    const people = list(profile.people, 6);
    if (people.length) out.push(`- People in his life: ${people.join("; ")}`);
    for (const f of list(profile.facts, 8)) out.push(`- ${f}`);
  }

  if (summaries.length) {
    out.push(`\nRecent conversations (most recent first):`);
    for (const s of summaries.slice(0, SUMMARIES_PROMPT)) {
      const date = (s.ts || "").slice(0, 10);
      out.push(`- ${date ? date + ": " : ""}${clip(s.text || "", SUMMARY_CHARS)}`);
    }
  }

  out.push(`---`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Update (called in the background after each exchange — never blocks the reply)
// ---------------------------------------------------------------------------

const EXTRACT_SYSTEM = `You are the silent memory-keeper for a personal AI companion. You are NOT the companion. Your job: given the existing memory profile, the running summary of the current conversation, and the latest exchange, return an updated memory.

Respond with ONLY a JSON object — no prose, no markdown, no code fences — in exactly this shape:
{
  "summary": "2-4 sentence summary of the CURRENT conversation, updated to include the latest exchange. Past tense, factual: what was discussed, asked, decided.",
  "profile": {
    "name": "the user's name if known, else omit",
    "working_on": ["current projects or efforts"],
    "preferences": ["durable preferences about how they like things done"],
    "people": ["recurring people in their life and who they are"],
    "facts": ["other durable facts worth remembering long-term"]
  }
}

Rules:
- MERGE new information into the existing profile. Do not drop existing items unless they are clearly superseded or contradicted.
- DEDUPE hard. Combine overlapping items. Keep every list tight and high-signal — prefer a few well-phrased items over many.
- Record only DURABLE facts: identity, ongoing work, stable preferences, important people/projects. Ignore one-off chit-chat, transient state, and pleasantries.
- NEVER store specific market prices, index levels, quotes, or figures (e.g. "NQ at 29,500", "VIX 18") — they go stale instantly and become wrong. Live market data lives on the Markets surface, not in memory.
- Keep each item a short phrase, not a sentence.
- If nothing new is durable, return the profile essentially unchanged.
- Omit empty fields entirely rather than returning empty arrays.`;

function buildExtractPrompt(
  profile: Profile,
  currentSummary: string,
  userText: string,
  assistantText: string,
): string {
  return [
    `Existing memory profile (JSON):`,
    JSON.stringify(profile ?? {}, null, 2),
    ``,
    `Running summary of the current conversation so far:`,
    currentSummary || "(none yet)",
    ``,
    `Latest exchange:`,
    `USER: ${userText}`,
    `AUGUST: ${assistantText}`,
    ``,
    `Return ONLY the JSON object described in your instructions.`,
  ].join("\n");
}

function asStringArray(v: unknown, cap: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, cap);
  return out.length ? out : undefined;
}

function sanitizeProfile(obj: unknown): Profile {
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const p: Profile = {};
  if (typeof o.name === "string" && o.name.trim()) p.name = o.name.trim();
  const wo = asStringArray(o.working_on, 12);
  if (wo) p.working_on = wo;
  const pr = asStringArray(o.preferences, 12);
  if (pr) p.preferences = pr;
  const pe = asStringArray(o.people, 12);
  if (pe) p.people = pe;
  const fa = asStringArray(o.facts, 20);
  if (fa) p.facts = fa;
  return p;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(s.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function updateMemoryFromExchange(input: {
  email: string | null;
  sessionId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const profileKey = scopeKey(input.email, PROFILE_KEY);
  const summariesKey = scopeKey(input.email, SUMMARIES_KEY);

  // Load current profile + the current session's rolling summary (if it's the head).
  let profile: Profile = {};
  let currentSummary = "";
  let headIsSameSession = false;
  try {
    const [p, head] = await Promise.all([
      redis.get<Profile>(profileKey),
      redis.lindex(summariesKey, 0) as Promise<SessionSummary | null>,
    ]);
    if (p) profile = p;
    if (head && head.sessionId === input.sessionId) {
      currentSummary = head.text || "";
      headIsSameSession = true;
    }
  } catch {
    /* proceed with empties */
  }

  // Ask the cheap model to produce an updated summary + merged profile.
  let summaryText = currentSummary;
  let newProfile = profile;
  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: MEMORY_MODEL,
      max_tokens: 700,
      system: EXTRACT_SYSTEM,
      messages: [
        {
          role: "user",
          content: buildExtractPrompt(profile, currentSummary, input.userText, input.assistantText),
        },
      ],
    });
    const raw = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const parsed = parseJsonObject(raw);
    if (parsed) {
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        summaryText = parsed.summary.trim();
      }
      if (parsed.profile && typeof parsed.profile === "object") {
        newProfile = sanitizeProfile(parsed.profile);
      }
    } else {
      return; // couldn't parse — don't write garbage
    }
  } catch {
    return; // model/network failure — leave memory untouched
  }

  // Write back: upsert this session's summary, save the merged profile.
  try {
    newProfile.updated_at = new Date().toISOString();
    const entry: SessionSummary = {
      sessionId: input.sessionId,
      ts: new Date().toISOString(),
      text: summaryText,
    };
    const pipe = redis.pipeline();
    pipe.set(profileKey, newProfile);
    if (headIsSameSession) {
      // same conversation → update its summary in place
      pipe.lset(summariesKey, 0, entry);
    } else {
      // new conversation → push a fresh summary and cap the list
      pipe.lpush(summariesKey, entry);
      pipe.ltrim(summariesKey, 0, SUMMARIES_CAP - 1);
    }
    await pipe.exec();
  } catch {
    /* ignore write failures */
  }
}

// ---------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------

export async function clearMemory(email: string | null): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(scopeKey(email, PROFILE_KEY), scopeKey(email, SUMMARIES_KEY));
  } catch {
    /* ignore */
  }
}
