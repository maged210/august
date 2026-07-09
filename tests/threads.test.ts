// Conversation threads — deterministic unit tests over the PURE helpers
// (auto-title, per-thread caps, relative date labels) plus the store's
// unconfigured no-op paths. No Redis, no network, no LLM: every timestamp is
// fixed so results never depend on when the suite runs.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  MAX_MESSAGE_CHARS,
  MAX_THREAD_MESSAGES,
  MAX_TITLE_CHARS,
  capThreadMessages,
  getThread,
  listThreads,
  threadDateLabel,
  threadTitle,
  threadsConfigured,
  upsertThread,
  type ThreadMessage,
} from "../lib/threads";

// The store must exercise its unconfigured branches regardless of the shell's
// environment. lib/threads reads env lazily on first use, so clearing here
// (before any store call) pins every test below to the no-Redis path.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const u = (content: string): ThreadMessage => ({ role: "user", content });
const a = (content: string): ThreadMessage => ({ role: "assistant", content });

// ── auto-title ───────────────────────────────────────────────────────────────

test("threadTitle collapses whitespace and trims", () => {
  assert.equal(threadTitle([u("  Why   is\n\nNQ  above\tpivot? ")]), "Why is NQ above pivot?");
});

test("threadTitle caps at 48 chars with an ellipsis — never at exactly 48", () => {
  const long = "x".repeat(60);
  assert.equal(threadTitle([u(long)]), "x".repeat(MAX_TITLE_CHARS) + "…");
  assert.equal(threadTitle([u(long)]).length, MAX_TITLE_CHARS + 1);

  const exact = "y".repeat(MAX_TITLE_CHARS);
  assert.equal(threadTitle([u(exact)]), exact); // no ellipsis at the boundary
});

test("threadTitle uses the FIRST user message, skipping assistant lines", () => {
  assert.equal(
    threadTitle([a("Good morning."), u("Summarize overnight intel"), u("and quakes")]),
    "Summarize overnight intel",
  );
});

test("threadTitle falls back when there is no usable user message", () => {
  assert.equal(threadTitle([]), "Conversation");
  assert.equal(threadTitle([a("hello")]), "Conversation");
  assert.equal(threadTitle([u("   \n\t ")]), "Conversation");
});

// ── per-thread caps ──────────────────────────────────────────────────────────

test("capThreadMessages keeps the most recent 40 and flags truncation", () => {
  const many = Array.from({ length: 45 }, (_, i) => u(`m${i}`));
  const { messages, truncated } = capThreadMessages(many);
  assert.equal(truncated, true);
  assert.equal(messages.length, MAX_THREAD_MESSAGES);
  assert.equal(messages[0].content, "m5"); // oldest five dropped
  assert.equal(messages[messages.length - 1].content, "m44"); // newest kept
});

test("capThreadMessages leaves a within-cap conversation untouched", () => {
  const forty = Array.from({ length: MAX_THREAD_MESSAGES }, (_, i) => u(`m${i}`));
  const { messages, truncated } = capThreadMessages(forty);
  assert.equal(truncated, false);
  assert.equal(messages.length, MAX_THREAD_MESSAGES);
  assert.equal(messages[0].content, "m0");
});

test("capThreadMessages slices oversized content with an ellipsis", () => {
  const big = "z".repeat(MAX_MESSAGE_CHARS + 500);
  const ok = "fine";
  const { messages } = capThreadMessages([u(big), a(ok)]);
  assert.equal(messages[0].content.length, MAX_MESSAGE_CHARS + 1);
  assert.ok(messages[0].content.endsWith("…"));
  assert.equal(messages[1].content, ok); // short content untouched
});

// ── relative date labels (design: TODAY / YESTERDAY / MON / JUL 3) ──────────
// Fixed clock: Wed Jul 8 2026, 12:00 EDT (16:00 UTC). ET days, not UTC days.

const NOW = Date.UTC(2026, 6, 8, 16, 0, 0);

test("threadDateLabel: same ET day → TODAY (ET midnight boundary respected)", () => {
  assert.equal(threadDateLabel(NOW, NOW), "TODAY");
  assert.equal(threadDateLabel(Date.UTC(2026, 6, 8, 4, 0), NOW), "TODAY"); // 00:00 EDT
  // 23:59 EDT the day before — still Jul 8 in UTC terms would be wrong; ET says yesterday.
  assert.equal(threadDateLabel(Date.UTC(2026, 6, 8, 3, 59), NOW), "YESTERDAY");
});

test("threadDateLabel: previous ET day → YESTERDAY", () => {
  assert.equal(threadDateLabel(Date.UTC(2026, 6, 7, 16, 0), NOW), "YESTERDAY");
});

test("threadDateLabel: 2–6 days back → short upper weekday", () => {
  assert.equal(threadDateLabel(Date.UTC(2026, 6, 6, 16, 0), NOW), "MON"); // 2 days
  assert.equal(threadDateLabel(Date.UTC(2026, 6, 3, 16, 0), NOW), "FRI"); // 5 days
  assert.equal(threadDateLabel(Date.UTC(2026, 6, 2, 16, 0), NOW), "THU"); // 6 days — window edge
});

test("threadDateLabel: a week or more back → 'JUL 1' style, ET-correct in winter too", () => {
  assert.equal(threadDateLabel(Date.UTC(2026, 6, 1, 16, 0), NOW), "JUL 1"); // 7 days — past the window
  assert.equal(threadDateLabel(Date.UTC(2025, 11, 25, 12, 0), NOW), "DEC 25"); // EST era
});

test("threadDateLabel: future days fall through to the date style", () => {
  assert.equal(threadDateLabel(Date.UTC(2026, 6, 9, 16, 0), NOW), "JUL 9");
});

// ── store: unconfigured Redis degrades to no-op, never throws ────────────────

test("store degrades gracefully when Upstash is unconfigured", async () => {
  assert.equal(threadsConfigured(), false);
  assert.deepEqual(await listThreads(3), []);
  assert.equal(await getThread("th_missing"), null);
  // upsert still returns usable bookkeeping (computed, not written).
  const res = await upsertThread({ messages: [u("hello there")] });
  assert.match(res.id, /^th_/);
  assert.equal(res.title, "hello there");
});
