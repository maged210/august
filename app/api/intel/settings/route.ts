// Intel settings — read / update (brief times, tz, display filters, notif prefs).
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getSettings, saveSettings } from "@/lib/intel/store";
import { DEFAULT_SETTINGS, type IntelSettings } from "@/lib/intel/types";
import { mergeOptionSettings } from "@/lib/intel/option-settings";
import { gateIntelMutationOrRespond } from "@/lib/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ settings: await getSettings() });
}

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
  // Intel data is SHARED; mutating it is OWNER-only (no-op when auth unconfigured).
  const denied = await gateIntelMutationOrRespond();
  if (denied) return denied;
  const patch = (await req.json().catch(() => ({}))) as Partial<IntelSettings>;
  const current = await getSettings();
  // Only known keys; never trust arbitrary input.
  const next: IntelSettings = { ...current };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof IntelSettings)[]) {
    if (k === "options") continue; // validated per-field below
    if (k in patch && typeof patch[k] === typeof DEFAULT_SETTINGS[k]) {
      (next as Record<string, unknown>)[k] = patch[k];
    }
  }
  if ("options" in patch) next.options = mergeOptionSettings(current.options, patch.options);
  await saveSettings(next);
  return Response.json({ ok: true, settings: next });
}
