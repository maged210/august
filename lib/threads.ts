// AUGUST conversation threads — Upstash Redis store. SERVER ONLY (mirrors the
// getRedis() best-effort pattern in lib/intel/store.ts). Namespace: `august:threads:`.
// The landing's RECENT THREADS section lists these — real conversations, saved
// after each completed exchange, never mock data.
//
// Data model:
//   august:threads:index    zset   member = thread id, score = updatedAt
//   august:threads:t:{id}   string JSON blob of the full Thread
//
// Caps (enforced here regardless of route validation):
//   MAX_THREADS          50   — oldest by updatedAt evicted beyond the cap
//   MAX_THREAD_MESSAGES  40   — keep the most recent 40; `truncated: true` marks the loss
//   MAX_MESSAGE_CHARS  8192   — per-message content sliced with a trailing ellipsis
//
// Threads are BEST-EFFORT: every function degrades to no-op/[]/null when Upstash
// isn't configured or errors — persistence must never break the chat. No LLM
// anywhere in this file: titles are derived mechanically from the first user line.
//
// threadTitle / capThreadMessages / threadDateLabel are PURE (no Redis, no
// clock beyond an injectable `now`) and unit-tested in tests/threads.test.ts.

import { Redis } from "@upstash/redis";

export type ThreadMessage = { role: "user" | "assistant"; content: string };

export type Thread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ThreadMessage[];
  /** Present (true) once older messages have been dropped by the per-thread cap. */
  truncated?: boolean;
};

export type ThreadSummary = { id: string; title: string; updatedAt: number };

export const MAX_THREADS = 50;
export const MAX_THREAD_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 8192;
export const MAX_TITLE_CHARS = 48;

const NS = "august:threads:";
const K = {
  index: NS + "index",
  thread: (id: string) => `${NS}t:${id}`,
};

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

export function threadsConfigured(): boolean {
  return getRedis() !== null;
}

// --- pure helpers -----------------------------------------------------------

/** Auto-title: first user message, whitespace collapsed, capped at 48 chars + '…'. */
export function threadTitle(messages: ThreadMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "";
  const collapsed = first.replace(/\s+/g, " ").trim();
  if (!collapsed) return "Conversation";
  return collapsed.length > MAX_TITLE_CHARS
    ? collapsed.slice(0, MAX_TITLE_CHARS) + "…"
    : collapsed;
}

/** Enforce the per-thread caps: most recent 40 messages, ≤8KB per content. */
export function capThreadMessages(messages: ThreadMessage[]): {
  messages: ThreadMessage[];
  truncated: boolean;
} {
  const truncated = messages.length > MAX_THREAD_MESSAGES;
  const kept = (truncated ? messages.slice(-MAX_THREAD_MESSAGES) : messages).map((m) => ({
    role: m.role,
    content:
      m.content.length > MAX_MESSAGE_CHARS
        ? m.content.slice(0, MAX_MESSAGE_CHARS) + "…"
        : m.content,
  }));
  return { messages: kept, truncated };
}

// Relative date label matching the home design (docs/design/AUGUST Home.dc.html):
// TODAY / YESTERDAY / MON / JUL 3 — ET calendar days, deterministic given `now`.
const ET = "America/New_York";

/** ET calendar day of a timestamp as a whole-day index (differences are day counts). */
function etDayNumber(ts: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000;
}

/**
 * PURE. Same ET day → 'TODAY'; previous ET day → 'YESTERDAY'; 2–6 days back →
 * short weekday ('MON'); anything older (or a future day) → 'JUL 3' style.
 */
export function threadDateLabel(updatedAt: number, now: number = Date.now()): string {
  const diff = etDayNumber(now) - etDayNumber(updatedAt);
  if (diff === 0) return "TODAY";
  if (diff === 1) return "YESTERDAY";
  if (diff >= 2 && diff <= 6) {
    return new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short" })
      .format(new Date(updatedAt))
      .toUpperCase();
  }
  return new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "short", day: "numeric" })
    .format(new Date(updatedAt))
    .toUpperCase();
}

// --- store ------------------------------------------------------------------

function newThreadId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `th_${rand}`;
}

export async function getThread(id: string): Promise<Thread | null> {
  const redis = getRedis();
  if (!redis || !id) return null;
  try {
    const raw = await redis.get<string>(K.thread(id));
    if (!raw) return null;
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as Thread;
  } catch {
    return null;
  }
}

/** Newest first by updatedAt. Empty when Redis is unconfigured or errors. */
export async function listThreads(limit = 3): Promise<ThreadSummary[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const n = Math.max(1, Math.floor(limit));
    const ids = await redis.zrange<string[]>(K.index, 0, n - 1, { rev: true });
    if (!ids || ids.length === 0) return [];
    const threads = await Promise.all(ids.map((id) => getThread(id)));
    return threads
      .filter((t): t is Thread => t !== null)
      .map((t) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/**
 * Create or update a thread from the FULL message array (messages are replaced
 * wholesale — the client always sends the whole capped conversation). Absent or
 * unknown id → a fresh thread with a fresh id, titled from the first user
 * message. Existing threads keep their title and createdAt; the truncated flag
 * is sticky once set. Returns {id, title} even when Redis is unconfigured
 * (computed, not written) so the caller's bookkeeping stays uniform.
 */
export async function upsertThread(input: {
  id?: string | null;
  messages: ThreadMessage[];
}): Promise<{ id: string; title: string }> {
  const { messages: capped, truncated } = capThreadMessages(
    input.messages.filter(
      (m) =>
        (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string",
    ),
  );
  const redis = getRedis();
  const now = Date.now();

  const existing = redis && input.id ? await getThread(input.id) : null;
  const id = existing ? existing.id : newThreadId();
  const title = existing ? existing.title : threadTitle(input.messages);

  if (!redis) return { id, title };

  const thread: Thread = {
    id,
    title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: capped,
    ...(truncated || existing?.truncated ? { truncated: true } : {}),
  };

  try {
    await redis.set(K.thread(id), JSON.stringify(thread));
    await redis.zadd(K.index, { score: thread.updatedAt, member: id });
    // Evict the oldest threads beyond the cap (lowest updatedAt scores first).
    const count = await redis.zcard(K.index);
    if (count > MAX_THREADS) {
      const oldest = await redis.zrange<string[]>(K.index, 0, count - MAX_THREADS - 1);
      for (const old of oldest ?? []) {
        await redis.del(K.thread(old));
        await redis.zrem(K.index, old);
      }
    }
  } catch {
    /* best-effort — persistence never breaks the chat */
  }
  return { id, title };
}
