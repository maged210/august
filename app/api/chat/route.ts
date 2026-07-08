import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/persona";
import { loadMemory, buildMemorySection } from "@/lib/memory";
import { TOOLS, TOOL_GUIDANCE, SEP, WATCHER_TOOL_NAMES, MOODS } from "@/lib/tools";
import { resolveTarget, SCREENS } from "@/lib/screens";
import { runWatcherTool } from "@/lib/watchers";
import { getMarketsSnapshot } from "@/lib/markets";
import { getCommandSnapshot } from "@/lib/command";
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

// Claude proxy. The API key lives on the server and never reaches the client.
//
// Runtime: Node, deliberately — not Edge. Nothing in the deps blocks Edge
// (@anthropic-ai/sdk and @upstash/redis are both fetch-based), but on today's
// Vercel the Edge runtime is no longer recommended and runs on the same Fluid
// Compute infrastructure as Node — no cold-start win — while it WOULD fragment
// the in-memory markets/command snapshot caches per isolate. Locally (next dev)
// there are no cold starts at all. The [chat] timing log below shows where the
// time actually goes; fix from measurement, not folklore.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };

// Per-path model. The VOICE loop wants minimum time-to-first-token (speed beats max
// IQ for a spoken companion), so it uses Haiku 4.5 — "Fastest" tier, ~3x cheaper,
// near-frontier quality (verified: claude-haiku-4-5, platform.claude.com models
// overview). The typed path keeps Sonnet 4.6 for the extra headroom. Both share the
// same system/tools, so this is a one-field swap. Note: Haiku's min cacheable prefix
// is 4096 tokens — the [chat] log prints cache_read to confirm the cache is hitting.
const VOICE_MODEL = "claude-haiku-4-5";
const TEXT_MODEL = "claude-sonnet-4-6";

// One client for the process — reusing it keeps the HTTPS connection pool warm,
// shaving the per-request TLS handshake off time-to-first-token.
let _client: Anthropic | null = null;
function getClient(apiKey: string): Anthropic {
  if (!_client || (_client.apiKey as string | null) !== apiKey) {
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("chat", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.",
      { status: 500 },
    );
  }

  let messages: ChatMessage[] = [];
  let isVoice = false;
  try {
    const body = await req.json();
    messages = Array.isArray(body?.messages) ? body.messages : [];
    isVoice = body?.voice === true; // the hands-free loop sets this → Haiku for snap
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }
  const model = isVoice ? VOICE_MODEL : TEXT_MODEL;

  // Keep only well-formed turns before sending them on.
  const cleaned = messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .map((m) => ({ role: m.role, content: m.content }));

  if (cleaned.length === 0) {
    return new Response("No messages provided.", { status: 400 });
  }

  // Prep everything the system prompt needs in PARALLEL — memory (Upstash) and the
  // live markets/command snapshots — so none of them serialize ahead of the model
  // call. Everything is time-boxed: if Redis is slow we proceed WITHOUT memory
  // (300ms cap) rather than stall the reply; snapshots get 1200ms.
  type Mem = Awaited<ReturnType<typeof loadMemory>>;
  const EMPTY_MEM: Mem = { profile: null, summaries: [] };
  const timeBox = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

  const t0 = Date.now();
  let memMs = -1; // -1 = memory missed the 300ms window (reply went out without it)
  const memTimed = loadMemory()
    .catch(() => EMPTY_MEM)
    .then((r) => {
      memMs = Date.now() - t0;
      return r;
    });
  const [{ profile, summaries }, marketsSnapshot, commandSnapshot] = await Promise.all([
    timeBox(memTimed, 300, EMPTY_MEM),
    timeBox(getMarketsSnapshot().catch(() => ""), 1200, ""),
    timeBox(getCommandSnapshot().catch(() => ""), 1200, ""),
  ]);
  const prepMs = Date.now() - t0;
  // Cache the frozen prefix (persona + tool guidance) so repeat turns skip
  // re-prefilling it — that's the time-to-first-token win. Volatile context (what he
  // remembers + the live snapshots) rides in a second, uncached block after it.
  const stableSystem = SYSTEM_PROMPT + TOOL_GUIDANCE;
  const dynamicSystem = buildMemorySection(profile, summaries) + marketsSnapshot + commandSnapshot;
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: stableSystem, cache_control: { type: "ephemeral" } },
  ];
  if (dynamicSystem.trim()) system.push({ type: "text", text: dynamicSystem });

  const client = getClient(apiKey);
  const encoder = new TextEncoder();

  // Time-to-first-token: marked the first time ANY byte is enqueued to the client.
  let ttftMs = -1;
  const mark = () => {
    if (ttftMs === -1) ttftMs = Date.now() - t0;
  };

  // Cache telemetry — Haiku 4.5 needs a ≥4096-token prefix to cache; if this stays 0
  // the cache silently isn't hitting and every voice turn pays full input price + TTFT.
  let cacheRead = -1;
  let cacheWrite = -1;

  // Client aborts (the stop control, or a superseding send) cancel this stream —
  // that's routine, not an error. Track it so we neither log fake "[chat] stream
  // error"s nor throw on enqueue/close after cancellation.
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
      try {
        // Turn 1 — give AUGUST his tools. Stream any text live (as before).
        const stream1 = await client.messages.create({
          model,
          max_tokens: 700,
          system,
          messages: cleaned,
          tools: TOOLS,
          stream: true,
        });

        const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
        let firstText = "";

        for await (const event of stream1) {
          if (aborted) break;
          if (event.type === "message_start") {
            const u = event.message.usage;
            cacheRead = u.cache_read_input_tokens ?? 0;
            cacheWrite = u.cache_creation_input_tokens ?? 0;
          } else if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block.type === "tool_use") {
              toolBlocks.set(event.index, { id: block.id, name: block.name, json: "" });
            }
          } else if (event.type === "content_block_delta") {
            const delta = event.delta;
            if (delta.type === "text_delta") {
              firstText += delta.text;
              mark();
              send(encoder.encode(delta.text));
            } else if (delta.type === "input_json_delta") {
              const tb = toolBlocks.get(event.index);
              if (tb) tb.json += delta.partial_json;
            }
          }
        }

        // No tool call → it's a plain reply; we're done. Same if the client left —
        // don't pay for a narration turn nobody will see.
        if (toolBlocks.size === 0 || aborted) return;

        // Emit each tool call now (the globe reacts immediately) and prepare a
        // tool_result turn so AUGUST narrates the place he just opened.
        const toolUseContent: unknown[] = [];
        const toolResults: unknown[] = [];
        for (const tb of toolBlocks.values()) {
          let input: Record<string, unknown> = {};
          const raw = tb.json.trim();
          if (raw) {
            try {
              input = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              input = {};
            }
          }
          // Watcher tools are SERVER-side data ops (Upstash) — they need no client
          // action, so they are NOT framed to the client; they're executed here and
          // the REAL result is fed back so AUGUST confirms what actually happened.
          // Nav tools (globe/deck) ARE framed so the client reacts immediately.
          const isWatcher = WATCHER_TOOL_NAMES.has(tb.name);
          if (!isWatcher) {
            mark();
            send(encoder.encode(SEP + JSON.stringify({ tool: tb.name, input }) + SEP));
          }
          toolUseContent.push({ type: "tool_use", id: tb.id, name: tb.name, input });
          const label = typeof input.label === "string" ? input.label : "the location";
          const screen = typeof input.screen === "string" ? input.screen : "presence";
          let resultText: string;
          if (tb.name === "look_closer") {
            resultText = `The globe has opened and is now showing ${label}.`;
          } else if (tb.name === "close_map") {
            resultText = "The globe has closed; you're back to the orb.";
          } else if (tb.name === "go_to_screen") {
            // Aliases (markets/intel → desk) resolve to a canonical surface name.
            const target = resolveTarget(screen);
            resultText = target
              ? `The deck is now on the ${SCREENS[target.index]} surface.`
              : "That surface doesn't exist — the deck stayed where it was.";
          } else if (tb.name === "set_mood") {
            // The client re-tints from the framed event; confirm the new accent.
            const mood = typeof input.mood === "string" ? input.mood.toLowerCase() : "";
            resultText = (MOODS as readonly string[]).includes(mood)
              ? `The deck is re-lit — the accent is ${mood} now.`
              : "No such mood — the lights stayed as they were.";
          } else if (isWatcher) {
            try {
              resultText = await runWatcherTool(tb.name, input);
            } catch (e) {
              console.error("[chat] watcher tool failed:", e instanceof Error ? e.message : e);
              resultText = "That watcher action hit an error on the server.";
            }
          } else {
            resultText = "Done.";
          }
          toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: resultText });
        }

        // Turn 2 — continue with no tools so he speaks about it, in character.
        const assistantContent: unknown[] = [];
        if (firstText.trim()) assistantContent.push({ type: "text", text: firstText });
        assistantContent.push(...toolUseContent);

        const stream2 = await client.messages.create({
          model,
          max_tokens: 400,
          system,
          messages: [
            ...cleaned,
            { role: "assistant", content: assistantContent },
            { role: "user", content: toolResults },
          ] as unknown as Anthropic.MessageParam[],
          stream: true,
        });

        let needSpace = firstText.trim().length > 0;
        for await (const event of stream2) {
          if (aborted) break;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            if (needSpace) {
              send(encoder.encode(" "));
              needSpace = false;
            }
            mark();
            send(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        if (!aborted) {
          const msg = err instanceof Error ? err.message : "unknown error";
          console.error("[chat] stream error:", msg);
          send(encoder.encode(`\n[AUGUST is unreachable — ${msg}]`));
        }
      } finally {
        const mem =
          memMs < 0 ? "miss(>300ms)" : memMs > 300 ? `${memMs}ms(missed window)` : `${memMs}ms`;
        const cache =
          cacheRead > 0 ? `cache=read:${cacheRead}` : cacheWrite > 0 ? `cache=write:${cacheWrite}` : "cache=miss";
        console.log(
          `[chat] model=${model}${isVoice ? "(voice)" : ""} memory=${mem} prep=${prepMs}ms ${cache} ttft=${ttftMs >= 0 ? `${ttftMs}ms` : "n/a"} total=${Date.now() - t0}ms${aborted ? " (client aborted)" : ""}`,
        );
        try {
          controller.close();
        } catch {
          /* already canceled */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
