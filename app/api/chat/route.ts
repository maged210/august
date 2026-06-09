import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/persona";
import { loadMemory, buildMemorySection } from "@/lib/memory";
import { TOOLS, TOOL_GUIDANCE, SEP } from "@/lib/tools";
import { getMarketsSnapshot } from "@/lib/markets";
import { getCommandSnapshot } from "@/lib/command";

// Claude proxy. The API key lives on the server and never reaches the client.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.",
      { status: 500 },
    );
  }

  let messages: ChatMessage[] = [];
  try {
    const body = await req.json();
    messages = Array.isArray(body?.messages) ? body.messages : [];
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

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
  // call. The snapshots are time-boxed so a cold fetch never delays the first token.
  const timeBox = (p: Promise<string>, ms: number): Promise<string> =>
    Promise.race([p, new Promise<string>((resolve) => setTimeout(() => resolve(""), ms))]);
  const [{ profile, summaries }, marketsSnapshot, commandSnapshot] = await Promise.all([
    loadMemory().catch(() => ({ profile: null, summaries: [] as Awaited<ReturnType<typeof loadMemory>>["summaries"] })),
    timeBox(getMarketsSnapshot().catch(() => ""), 1200),
    timeBox(getCommandSnapshot().catch(() => ""), 1200),
  ]);
  // Cache the frozen prefix (persona + tool guidance) so repeat turns skip
  // re-prefilling it — that's the time-to-first-token win. Volatile context (what he
  // remembers + the live snapshots) rides in a second, uncached block after it.
  const stableSystem = SYSTEM_PROMPT + TOOL_GUIDANCE;
  const dynamicSystem = buildMemorySection(profile, summaries) + marketsSnapshot + commandSnapshot;
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: stableSystem, cache_control: { type: "ephemeral" } },
  ];
  if (dynamicSystem.trim()) system.push({ type: "text", text: dynamicSystem });

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Turn 1 — give AUGUST his tools. Stream any text live (as before).
        const stream1 = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 700,
          system,
          messages: cleaned,
          tools: TOOLS,
          stream: true,
        });

        const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
        let firstText = "";

        for await (const event of stream1) {
          if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block.type === "tool_use") {
              toolBlocks.set(event.index, { id: block.id, name: block.name, json: "" });
            }
          } else if (event.type === "content_block_delta") {
            const delta = event.delta;
            if (delta.type === "text_delta") {
              firstText += delta.text;
              controller.enqueue(encoder.encode(delta.text));
            } else if (delta.type === "input_json_delta") {
              const tb = toolBlocks.get(event.index);
              if (tb) tb.json += delta.partial_json;
            }
          }
        }

        // No tool call → it's a plain reply; we're done.
        if (toolBlocks.size === 0) return;

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
          controller.enqueue(
            encoder.encode(SEP + JSON.stringify({ tool: tb.name, input }) + SEP),
          );
          toolUseContent.push({ type: "tool_use", id: tb.id, name: tb.name, input });
          const label = typeof input.label === "string" ? input.label : "the location";
          const screen = typeof input.screen === "string" ? input.screen : "presence";
          let resultText: string;
          if (tb.name === "look_closer") {
            resultText = `The globe has opened and is now showing ${label}.`;
          } else if (tb.name === "close_map") {
            resultText = "The globe has closed; you're back to the orb.";
          } else if (tb.name === "go_to_screen") {
            resultText = `The deck is now on the ${screen} surface.`;
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
          model: "claude-sonnet-4-6",
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
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            if (needSpace) {
              controller.enqueue(encoder.encode(" "));
              needSpace = false;
            }
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        controller.enqueue(encoder.encode(`\n[AUGUST is unreachable — ${msg}]`));
      } finally {
        controller.close();
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
