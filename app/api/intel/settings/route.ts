// Intel settings — read / update (brief times, tz, display filters, notif prefs).
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";
import { getSettings, saveSettings } from "@/lib/intel/store";
import { DEFAULT_OPTION_CANDIDATE_SETTINGS, DEFAULT_SETTINGS, type IntelSettings, type OptionCandidateSettings } from "@/lib/intel/types";

// Validate the options sub-object field-by-field so the candidate controls can't be
// poisoned with the wrong shape (numbers stay numbers, the 0DTE/leg flags stay bools).
function mergeOptions(current: OptionCandidateSettings, patch: unknown): OptionCandidateSettings {
  if (!patch || typeof patch !== "object") return current;
  const p = patch as Record<string, unknown>;
  const next: OptionCandidateSettings = { ...current };
  for (const k of Object.keys(DEFAULT_OPTION_CANDIDATE_SETTINGS) as (keyof OptionCandidateSettings)[]) {
    if (!(k in p)) continue;
    const def = DEFAULT_OPTION_CANDIDATE_SETTINGS[k];
    const val = p[k];
    if (def === null || typeof def === "number") {
      // nullable numeric caps (maxPremium / maxLossCap) accept a number or null
      if (val === null || (typeof val === "number" && Number.isFinite(val))) (next as Record<string, unknown>)[k] = val;
    } else if (typeof def === "boolean" && typeof val === "boolean") {
      (next as Record<string, unknown>)[k] = val;
    }
  }
  return next;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ settings: await getSettings() });
}

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("intelMutate", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);
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
  if ("options" in patch) next.options = mergeOptions(current.options, patch.options);
  await saveSettings(next);
  return Response.json({ ok: true, settings: next });
}
