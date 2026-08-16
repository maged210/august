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
import { resolveChatPrincipal } from "@/lib/user-scope";

// HOTFIX (chat privacy): anonymous production traffic used to fall back to
// the LEGACY SHARED keys — every visitor saw (and could overwrite) the same
// thread list, including the owner's history. Threads now resolve a per-
// visitor principal (httpOnly aug_vid cookie); the legacy namespace is
// reachable only through the ADMIN-gated /api/admin/threads.

function withCookie(res: Response, setCookie: string | null): Response {
  if (setCookie) res.headers.append("Set-Cookie", setCookie);
  return res;
}

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

  // Session → namespace: user / per-visitor / legacy (dev fallback only).
  const { principal, setCookie } = await resolveChatPrincipal(req);

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

  const { id: threadId, title } = await upsertThread(principal, { id, messages });
  return withCookie(
    Response.json({ ok: true, id: threadId, title }, { headers: { "Cache-Control": "no-store" } }),
    setCookie,
  );
}

export async function GET(req: Request): Promise<Response> {
  { const rl = await checkRateLimit("threads", getIp(req)); if (!rl.ok) return rateLimitedResponse(rl.reset); }
  const { principal, setCookie } = await resolveChatPrincipal(req);

  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("limit") ?? "3");
  const limit = Math.min(10, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 3));
  // label: the landing's relative date column (TODAY / YESTERDAY / MON / JUL 3),
  // computed server-side with the tested pure helper so the client stays thin.
  const threads = (await listThreads(principal, limit)).map((t) => ({
    ...t,
    label: threadDateLabel(t.updatedAt),
  }));
  return withCookie(
    Response.json(
      { configured: threadsConfigured(), threads },
      { headers: { "Cache-Control": "no-store" } },
    ),
    setCookie,
  );
}
