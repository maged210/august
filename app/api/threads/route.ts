// Conversation threads. The client fires POST here (fire-and-forget, never
// awaited into the chat path) after each completed assistant reply so the
// landing's RECENT THREADS list is honest — real saved conversations, or
// nothing. GET lists the newest thread summaries for that section.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import {
  MAX_MESSAGE_CHARS,
  MAX_THREAD_MESSAGES,
  listThreads,
  threadDateLabel,
  threadsConfigured,
  upsertThread,
  type ThreadMessage,
} from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Strict shape check — bounded input only (the store re-caps defensively, but a
// well-behaved client pre-trims and this rejects anything oversized outright).
function parseMessages(value: unknown): ThreadMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length > MAX_THREAD_MESSAGES) return null;
  const out: ThreadMessage[] = [];
  for (const m of value) {
    const r = (m ?? {}) as Record<string, unknown>;
    if (r.role !== "user" && r.role !== "assistant") return null;
    if (typeof r.content !== "string" || r.content.length > MAX_MESSAGE_CHARS) return null;
    out.push({ role: r.role, content: r.content });
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("threads", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const messages = parseMessages(b.messages);
  if (!messages) {
    return Response.json({ ok: false, error: "invalid_messages" }, { status: 400 });
  }
  // A malformed/oversized id is treated as absent — upsertThread mints a fresh
  // one for unknown ids anyway, so clients can't pollute the key space.
  const id = typeof b.id === "string" && b.id.length > 0 && b.id.length <= 64 ? b.id : undefined;

  const { id: threadId, title } = await upsertThread({ id, messages });
  return Response.json(
    { ok: true, id: threadId, title },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("limit") ?? "3");
  const limit = Math.min(10, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 3));
  // label: the landing's relative date column (TODAY / YESTERDAY / MON / JUL 3),
  // computed server-side with the tested pure helper so the client stays thin.
  const threads = (await listThreads(limit)).map((t) => ({
    ...t,
    label: threadDateLabel(t.updatedAt),
  }));
  return Response.json(
    { configured: threadsConfigured(), threads },
    { headers: { "Cache-Control": "no-store" } },
  );
}
