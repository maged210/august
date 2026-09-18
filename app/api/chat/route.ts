import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";
import { askCacheKey, askCapFor, recordAskStat, takeAskBudget, ASK_CACHE_TTL_S } from "@/lib/ask";
import { SYSTEM_PROMPT } from "@/lib/persona";
import { loadMemory, buildMemorySection } from "@/lib/memory";
import { getMarketsSnapshot } from "@/lib/markets";
import { getCommandSnapshot } from "@/lib/command";
import { getDeskSnapshot } from "@/lib/desk-snapshot";
import { ASK_DEGRADED_HEADER, ASK_STREAM_FAILURE } from "@/lib/ask-stream";
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
//
// L9: fail-open is a DECISION, not a silence. Without the store there is no
// per-identity day cap at all, and that is worth a line in the log every time
// the route serves without one — an uncapped ask lane that looks exactly like
// a capped one is how a spend goes unnoticed.
let _redis: Redis | null | undefined;
function getKv(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    _redis = url && token && url.startsWith("https://") ? new Redis({ url, token }) : null;
    if (!_redis) console.error("[ask] no ask store — serving with NO cache and NO per-identity cap");
  } catch (e) {
    console.error("[ask] ask store unusable — NO cache, NO cap:", e instanceof Error ? e.message : e);
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
  try {
    const body = (await req.json()) as { message?: unknown };
    message = typeof body.message === "string" ? body.message.trim() : "";
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
    } catch (e) {
      // fail open, but never quietly: this is indistinguishable from a genuine
      // miss at the call site, so the log is the only place it can be seen. A
      // swallowed miss re-spends on an answer that was already bought AND
      // decrements the caller's day cap (L9).
      console.error("[ask] cache read failed — re-spending:", e instanceof Error ? e.message : e);
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
  //
  // L9 — grounding that FAILED is not grounding that was empty. The desk
  // answering with no memory of you, or with no read of the tape, is a
  // materially different answer and the card says which piece was missing
  // (the x-aug-degraded header below). Every branch here is also logged: a
  // timeout and a thrown error are both "missing", and both are named.
  type Mem = Awaited<ReturnType<typeof loadMemory>>;
  const EMPTY_MEM: Mem = { profile: null, summaries: [], failed: "the memory read timed out" };
  const missing: string[] = [];
  const timeBox = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
  /** a grounding block that answered with nothing BECAUSE it failed */
  const ground = (name: string, p: Promise<string>, ms: number): Promise<string> =>
    timeBox(
      p.catch((e) => {
        console.error(`[ask] grounding ${name} failed:`, e instanceof Error ? e.message : e);
        missing.push(name);
        return "";
      }),
      ms,
      `\u0000timeout:${name}`,
    ).then((v) => {
      if (v.startsWith("\u0000timeout:")) {
        console.error(`[ask] grounding ${name} timed out after ${ms}ms`);
        missing.push(name);
        return "";
      }
      return v;
    });
  const t0 = Date.now();
  const [mem, marketsSnapshot, commandSnapshot, deskSnapshot] = await Promise.all([
    timeBox(
      loadMemory(principal).catch((e): Mem => {
        console.error("[ask] grounding memory failed:", e instanceof Error ? e.message : e);
        return { profile: null, summaries: [], failed: e instanceof Error ? e.message : String(e) };
      }),
      300,
      EMPTY_MEM,
    ),
    ground("markets", getMarketsSnapshot(), 1200),
    ground("command", getCommandSnapshot(), 1200),
    ground("desk", getDeskSnapshot(), 1500),
  ]);
  const { profile, summaries } = mem;
  if (mem.failed) {
    console.error("[ask] grounding memory unavailable:", mem.failed);
    missing.push("memory");
  }
  const prepMs = Date.now() - t0;

  const dynamicSystem = buildMemorySection(profile, summaries) + marketsSnapshot + commandSnapshot + deskSnapshot;
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];
  if (dynamicSystem.trim()) system.push({ type: "text", text: dynamicSystem });

  const client = getClient(apiKey);
  const encoder = new TextEncoder();
  let ttftMs = -1;
  /** the CONSUMER went away — a fact about them, not a failure of ours */
  let aborted = false;
  /** the socket refused our bytes — a failure of OURS, and it used to be
   *  filed as a consumer cancel, which suppressed the error branch below and
   *  froze the answer card mid-sentence with no error at all (L9) */
  let sendFailed = false;

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      aborted = true;
    },
    async start(controller) {
      const send = (bytes: Uint8Array) => {
        if (aborted || sendFailed) return;
        try {
          controller.enqueue(bytes);
        } catch (e) {
          sendFailed = true;
          console.error("[ask] stream enqueue failed:", e instanceof Error ? e.message : e);
        }
      };
      let full = "";
      // Cache on COMPLETION of the model stream, INDEPENDENT of the consumer
      // flag: the response plumbing can cancel our ReadableStream in the
      // window between the last text delta and the trailing SSE events
      // (measured in the E2E — a fully delivered answer marked aborted), and
      // a post-completion cancel must not void the cache. modelDone latches
      // on message_stop; an abort-break at a closed block boundary with text
      // in hand counts too. Only a genuine mid-block partial stays uncached.
      let modelDone = false;
      let blockOpen = false;
      try {
        const s = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: message }],
          stream: true,
        });
        // the spend is committed the moment the stream opens — the console's
        // model-call stat counts DISPATCHES, not happy completions, so
        // superseded/errored streams don't underreport spend
        if (cid && kv) void recordAskStat(kv, cid, "model");
        for await (const event of s) {
          if (aborted || sendFailed) break;
          if (event.type === "content_block_start") blockOpen = true;
          else if (event.type === "content_block_stop") blockOpen = false;
          else if (event.type === "message_stop") modelDone = true;
          else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            if (ttftMs === -1) ttftMs = Date.now() - t0;
            full += event.delta.text;
            send(encoder.encode(event.delta.text));
          }
        }
        if (!modelDone && !blockOpen && full.trim()) modelDone = true; // post-block cancel window
        // caches — only a COMPLETE answer is worth storing. JSON.stringify on
        // write so Upstash's get()-side auto-JSON-parse round-trips answers
        // that happen to BE valid JSON (the "1"-sentinel lesson).
        if (modelDone && full.trim() && kv) {
          if (cacheKey)
            await kv.set(cacheKey, JSON.stringify(full), { ex: ASK_CACHE_TTL_S }).catch((e) => {
              // the answer is fine; the SAVING of it failed. Next identical ask
              // pays again and eats a cap slot, so it is logged, not dropped.
              console.error("[ask] cache write failed:", e instanceof Error ? e.message : e);
            });
        }
      } catch (err) {
        if (!aborted) {
          console.error("[ask] stream error:", err instanceof Error ? err.message : "unknown");
          // the sentinel is a SHARED constant the client matches on, so a
          // failed answer renders as an error card instead of arriving as the
          // last sentence of the desk's prose (L9)
          send(encoder.encode(ASK_STREAM_FAILURE));
        }
      } finally {
        console.log(
          `[ask] model=${MODEL} prep=${prepMs}ms ttft=${ttftMs >= 0 ? `${ttftMs}ms` : "n/a"} total=${Date.now() - t0}ms chars=${full.length}${modelDone ? "" : " (aborted mid-stream)"}`,
        );
        try {
          controller.close();
        } catch {
          /* already canceled */
        }
      }
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  };
  // L9 — the answer card shows which grounding the desk answered WITHOUT.
  // Names only (memory / markets / command / desk); the causes are in the log.
  if (missing.length) headers[ASK_DEGRADED_HEADER] = [...new Set(missing)].join(",");
  return withCookie(new Response(stream, { headers }));
}
