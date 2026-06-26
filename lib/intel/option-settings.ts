// Validation for the AUGUST option-candidate controls. PURE (only ./types) so it is both
// importable from the API route AND unit-testable under `node --test`. Hardened so a
// client cannot poison the controls: wrong types are ignored, only the genuine nullable
// caps may be null, negatives/non-finite are rejected, and everything is clamped to sane
// bounds with min<=max enforced (a corrupt band would otherwise mis-drive pickExpiration).

import { DEFAULT_OPTION_CANDIDATE_SETTINGS, type OptionCandidateSettings } from "./types";

// The only fields that legitimately accept null (no cap). Every other numeric is required.
const NULLABLE = new Set<keyof OptionCandidateSettings>(["maxPremium", "maxLossCap"]);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function clampOptionSettings(s: OptionCandidateSettings): OptionCandidateSettings {
  const out = { ...s };
  out.maxBidAskSpreadPct = clamp(out.maxBidAskSpreadPct, 0, 1);
  out.preferredDeltaMin = clamp(out.preferredDeltaMin, 0, 1);
  out.preferredDeltaMax = clamp(out.preferredDeltaMax, 0, 1);
  out.preferredDteMin = clamp(Math.round(out.preferredDteMin), 0, 1000);
  out.preferredDteMax = clamp(Math.round(out.preferredDteMax), 0, 1000);
  out.minOpenInterest = Math.max(0, Math.round(out.minOpenInterest));
  out.minVolume = Math.max(0, Math.round(out.minVolume));
  out.maxCandidatesPerThesis = clamp(Math.round(out.maxCandidatesPerThesis), 1, 10);
  if (out.maxPremium !== null) out.maxPremium = Math.max(0, out.maxPremium);
  if (out.maxLossCap !== null) out.maxLossCap = Math.max(0, out.maxLossCap);
  // inverted bands → swap so min <= max
  if (out.preferredDteMin > out.preferredDteMax) [out.preferredDteMin, out.preferredDteMax] = [out.preferredDteMax, out.preferredDteMin];
  if (out.preferredDeltaMin > out.preferredDeltaMax) [out.preferredDeltaMin, out.preferredDeltaMax] = [out.preferredDeltaMax, out.preferredDeltaMin];
  return out;
}

/** Merge a client patch onto current settings, field-by-field and type-checked. */
export function mergeOptionSettings(current: OptionCandidateSettings, patch: unknown): OptionCandidateSettings {
  const next: OptionCandidateSettings = { ...current };
  if (!patch || typeof patch !== "object") return clampOptionSettings(next);
  const p = patch as Record<string, unknown>;
  const set = next as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_OPTION_CANDIDATE_SETTINGS) as (keyof OptionCandidateSettings)[]) {
    if (!(k in p)) continue;
    const def = DEFAULT_OPTION_CANDIDATE_SETTINGS[k];
    const val = p[k];
    if (typeof def === "boolean") {
      if (typeof val === "boolean") set[k] = val;
    } else if (val === null) {
      if (NULLABLE.has(k)) set[k] = null; // only maxPremium/maxLossCap may be nulled
    } else if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
      set[k] = val; // reject negatives / NaN / Infinity for every numeric field
    }
  }
  return clampOptionSettings(next);
}
