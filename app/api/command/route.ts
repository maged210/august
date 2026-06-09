import { getCommandSummary } from "@/lib/command";

// Lightweight summary for the Brief (aircraft + quake counts, brief line).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const s = await getCommandSummary();
    return new Response(JSON.stringify(s), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
