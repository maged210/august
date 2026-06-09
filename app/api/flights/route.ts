import { getFlights, type BBox } from "@/lib/command";

// Live aircraft (OpenSky), proxied + cached 15s per viewport bbox.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const nums = ["lamin", "lomin", "lamax", "lomax"].map((k) => Number(u.searchParams.get(k)));
  const bbox: BBox | undefined = nums.every((n) => Number.isFinite(n))
    ? { lamin: nums[0], lomin: nums[1], lamax: nums[2], lomax: nums[3] }
    : undefined;
  try {
    const fc = await getFlights(bbox);
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
