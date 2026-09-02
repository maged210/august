import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";
import { askCacheKey, askCapFor, recordAskStat, takeAskBudget, ASK_CACHE_TTL_S } from "@/lib/ask";
import { askCacheKey as calAskCacheKey, getCalendarWeek, matchAskPrompt } from "@/lib/calendar-feed";
import { SYSTEM_PROMPT } from "@/lib/persona";
import { loadMemory, buildMemorySection } from "@/lib/memory";
import { getMarketsSnapshot } from "@/lib/markets";
import { getCommandSnapshot } from "@/lib/command";
import { getDeskSnapshot } from "@/lib/desk-snapshot";
import {
  checkChatDailyCap,
  checkRateLimit,
  dailyCapResponse,
  getIp,
  rateLimitedResponse,
} from "@/lib/ratelimit";
import { resolveChatPrincipal } from "@/lib/user-scope";
import { pidFor } from "@/lib/pit";

// THE ASK LANE (feature/command-bar). The input is a command bar now: the
// deterministic command lane never reaches this route, and there is NO
// conversation — the body carries ONE message, the reply streams into ONE
// answer card, and nothing is stored beyond the caches below. The old
// two-turn tools flow (go_to_screen / set_mood / watcher ops) is gone: the
// command lane does navigation deterministically, so the model gets no tools.
//
// Budget: MAX_TOKENS = 300 — 1–4 sentences or a short structured block, per
// the desk persona. Guards, in order: per-IP rate limit → per-identity
// 10-minute cache (free repeats) → per-identity day cap (20 anonymous / 100
// signed-in, env-tunable ASK_CAP_ANON/ASK_CAP_USER) → the global daily spend
// backstop (CHAT_DAILY_CAP). The calendar-card ask cache (24h, shared,
// memory-free by construction) rides on top, unchanged in spirit.
//
// Runtime: Node, deliberately — the in-memory markets/command snapshot caches
// must not fragment per isolate (measured; see git history for the long note).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 300;
const MAX_ASK_CHARS = 2000;

// One client for the process — keeps the HTTPS pool warm for time-to-first-token.
let _client: Anthropic | null = null;
function getClient(apiKey: string): Anthropic {
  if (!_client || (_client.apiKey as string | null) !== apiKey) {
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

// Lazy route-local Redis (cache + caps + stats + the calendar ask cache) —
// standard fail-open contract: unconfigured/broken → no cache, no caps.
let _redis: Redis | null | undefined;
function getKv(): Redis | null {
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

const textStream = (body: string) =>
  new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store, no-transform" },
  });

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("chat", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  let message = "";
  let calendarAsk: string | null = null;
  try {
    const body = (await req.json()) as { message?: unknown; calendarAsk?: unknown };
    message = typeof body.message === "string" ? body.message.trim() : "";
    calendarAsk =
      typeof body.calendarAsk === "string" && body.calendarAsk.length > 0 && body.calendarAsk.length <= 160
        ? body.calendarAsk
        : null;
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }
  if (!message || message.length > MAX_ASK_CHARS) {
    return new Response("No message provided.", { status: 400 });
  }

  const { principal, setCookie } = await resolveChatPrincipal(req);
  const cid = pidFor(principal);
  const kv = getKv();
  const withCookie = (res: Response): Response => {
    if (setCookie) res.headers.append("Set-Cookie", setCookie);
    return res;
  };

  // Calendar-card ask (whats-coming) — one shared spend per event per day.
  // Honored only for the exact canonical prompt + a state-consistent kind;
  // shared across identities because its answers are memory- and
  // snapshot-free by construction.
  let calAskKey: string | null = null;
  if (calendarAsk && kv) {
    const ev = (await getCalendarWeek().catch(() => [])).find((e) => e.id === calendarAsk);
    const kind = ev ? matchAskPrompt(ev, message) : null;
    const stateOk = ev && kind ? (kind === "released" ? ev.ts <= Date.now() : ev.ts > Date.now()) : false;
    if (ev && kind && stateOk) {
      calAskKey = calAskCacheKey(ev.id, new Date().toISOString().slice(0, 10), kind, message);
      try {
        const hit = await kv.get<string>(calAskKey);
        if (typeof hit === "string" && hit.trim()) {
          console.log("[ask] calendar-ask cache hit");
          if (cid) void recordAskStat(kv, cid, "cache");
          return withCookie(textStream(hit));
        }
      } catch {
        /* fail open */
      }
    }
  }

  // Per-identity 10-minute cache — an identical normalized repeat is free and
  // does not touch the cap. Per identity BY LAW: the grounding carries the
  // caller's own memory, so entries never cross identities.
  const cacheKey = cid && kv ? askCacheKey(cid, message) : null;
  if (cacheKey && kv && cid) {
    try {
      const hit = await kv.get<string>(cacheKey);
      if (typeof hit === "string" && hit.trim()) {
        void recordAskStat(kv, cid, "cache");
        return withCookie(textStream(hit));
      }
    } catch {
      /* fail open */
    }
  }

  // Per-identity day cap — over it, the bar says so; commands are unaffected
  // (they never reach this route).
  if (cid && kv) {
    const budget = await takeAskBudget(kv, cid, askCapFor(cid));
    if (!budget.allowed) {
      return withCookie(
        Response.json(
          { error: "ask_capped", message: "THE DESK IS DONE ANSWERING FOR TODAY — COMMANDS STILL WORK." },
          { status: 429 },
        ),
      );
    }
  }

  // The global daily spend backstop, after everything free.
  const daily = await checkChatDailyCap();
  if (!daily.ok) return withCookie(dailyCapResponse());

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[ask] ANTHROPIC_API_KEY missing — asks unconfigured");
    return Response.json({ ok: false, error: "ask_unconfigured" }, { status: 503 });
  }

  // Grounding (docs/ASK-GROUNDING.md): the caller's memory + the desk's own
  // displayed read, timeboxed so nothing stalls the answer. The shared
  // calendar-ask path stays memory- and snapshot-free (its guidance block
  // replaces them) so its cached answers can serve every identity.
  type Mem = Awaited<ReturnType<typeof loadMemory>>;
  const EMPTY_MEM: Mem = { profile: null, summaries: [] };
  const timeBox = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
  const t0 = Date.now();
  const [{ profile, summaries }, marketsSnapshot, commandSnapshot, deskSnapshot] = calAskKey
    ? [EMPTY_MEM, "", "", ""]
    : await Promise.all([
        timeBox(loadMemory(principal).catch(() => EMPTY_MEM), 300, EMPTY_MEM),
        timeBox(getMarketsSnapshot().catch(() => ""), 1200, ""),
        timeBox(getCommandSnapshot().catch(() => ""), 1200, ""),
        timeBox(getDeskSnapshot().catch(() => ""), 1500, ""),
      ]);
  const prepMs = Date.now() - t0;

  const CAL_ASK_GUIDANCE =
    "\n\n---\nThis is a calendar-card question about a scheduled economic release. You have NO live tape, NO printed value, and no personal memory in context, and this answer may be replayed to other visitors today. Explain the mechanics and the scenarios plainly; do NOT state current prices or levels, and do NOT invent the printed value.";
  const dynamicSystem = calAskKey
    ? CAL_ASK_GUIDANCE
    : buildMemorySection(profile, summaries) + marketsSnapshot + commandSnapshot + deskSnapshot;
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];
  if (dynamicSystem.trim()) system.push({ type: "text", text: dynamicSystem });

  const client = getClient(apiKey);
  const encoder = new TextEncoder();
  let ttftMs = -1;
  let aborted = false;

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      aborted = true;
    },
    async start(controller) {
      const send = (bytes: Uint8Array) => {
        if (aborted) return;
        try {
          controller.enqueue(bytes);
        } catch {
          aborted = true;
        }
      };
      let full = "";
      try {
        const s = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: message }],
          stream: true,
        });
        for await (const event of s) {
          if (aborted) break;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            if (ttftMs === -1) ttftMs = Date.now() - t0;
            full += event.delta.text;
            send(encoder.encode(event.delta.text));
          }
        }
        // caches + stats — only a COMPLETE answer is worth storing
        if (!aborted && full.trim() && kv) {
          if (calAskKey) await kv.set(calAskKey, full, { ex: 86_400 }).catch(() => {});
          else if (cacheKey) await kv.set(cacheKey, full, { ex: ASK_CACHE_TTL_S }).catch(() => {});
          if (cid) void recordAskStat(kv, cid, "model");
        }
      } catch (err) {
        if (!aborted) {
          console.error("[ask] stream error:", err instanceof Error ? err.message : "unknown");
          send(encoder.encode("\n[THE DESK IS UNREACHABLE]"));
        }
      } finally {
        console.log(
          `[ask] model=${MODEL} prep=${prepMs}ms ttft=${ttftMs >= 0 ? `${ttftMs}ms` : "n/a"} total=${Date.now() - t0}ms chars=${full.length}${calAskKey ? " calask" : ""}${aborted ? " (aborted)" : ""}`,
        );
        try {
          controller.close();
        } catch {
          /* already canceled */
        }
      }
    },
  });

  return withCookie(
    new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    }),
  );
}
