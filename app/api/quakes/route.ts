import { getQuakes } from "@/lib/command";

// Recent earthquakes (USGS all-day GeoJSON), proxied + cached 5 min.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const fc = await getQuakes();
    return new Response(JSON.stringify(fc), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    return new Response(JSON.stringify({ type: "FeatureCollection", features: [], count: 0, error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
