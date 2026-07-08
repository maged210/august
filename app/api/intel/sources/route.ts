// Sources — list + add (resolve a URL/handle/id into a stored source).
// Source privacy: the roster names who is watched, so GET returns it only when
// the server-side INTEL_OWNER_VIEW flag is set — same contract as overview.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { intelStorageConfigured, listSources } from "@/lib/intel/store";
import { intelOwnerView } from "@/lib/intel/redact";
import { addSource } from "@/lib/intel/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!intelOwnerView()) return Response.json({ sources: [] });
  return Response.json({ sources: await listSources() });
}

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  if (!intelStorageConfigured()) return Response.json({ ok: false, error: "storage_unconfigured" }, { status: 501 });

  let url = "";
  try {
    url = String((await req.json())?.url ?? "").trim();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (!url) return Response.json({ ok: false, error: "url_required" }, { status: 400 });

  const res = await addSource(url);
  return Response.json(res, { status: res.ok ? 201 : 400 });
}
