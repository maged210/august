// Sources — list + add (resolve a URL/handle/id into a stored source).
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { intelStorageConfigured, listSources } from "@/lib/intel/store";
import { addSource } from "@/lib/intel/pipeline";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ sources: await listSources() });
}

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  // Intel data is SHARED; mutating it is OWNER-only (no-op when auth unconfigured).
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
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
