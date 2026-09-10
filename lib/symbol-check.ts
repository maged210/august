// fix/ticker-validation — every extracted symbol must resolve to a real
// instrument, and be the RIGHT one, before it can become an idea. SERVER ONLY.
//
// WHY THIS EXISTS: the extractor names tickers from model memory. Across runs
// it produced SPCE, SPXS and SPXL for SpaceX, which is not publicly traded.
// A missing level is honest — it shows as NEEDS LEVEL. A wrong ticker is not:
// it becomes a live published call on a security the desk never meant to
// watch. SPCE LONG "confirmation candle above $150" reached the live book
// from exactly this.
//
// WHAT WE VALIDATE AGAINST: Yahoo's chart endpoint, through
// lib/markets.probeInstrument — the SAME keyless source the desk already
// grades ideas against, already in this repo, no new dependency and no new
// spend. Finnhub is wired here only as an earnings calendar (lib/intel/
// earnings.ts) and exposes no symbol lookup we use; FMP is not integrated at
// all (one mention in docs/design/SPEC-wiring.md, saying no FMP/Finnhub key
// is needed). Validating against the grader's own source has a property the
// others don't: a symbol the grader can't quote is useless as an idea anyway.
//
// THE THREE GATES, in order — the first two are free, the third costs a call:
//   1. UNTRADEABLE SUBJECT. The speaker named a real company that has no
//      listed equity (SpaceX, OpenAI, Stripe). This is NOT a lookup failure
//      and must never be treated as one: verified live 2026-09-10, Yahoo
//      happily returns SPCX / LOFF / SPCF for "SpaceX" and tokenized-stock
//      wrappers for "OpenAI". Anything that resolved here would be a
//      substitution. Refused by name, before any lookup.
//   2. SYMBOL RESOLVES. Yahoo 404 → the symbol does not exist → refused.
//      A source failure (429, 5xx, timeout) is NOT nonexistence and never
//      drops a row; it is reported as unverified instead.
//   3. THE NAME AGREES. The resolved instrument's name is checked against the
//      company the speaker actually named. SPCE resolves fine — as "Virgin
//      Galactic Holdings, Inc.", which is how a wrong ticker is caught.
//
// NOTHING IS EVER SUBSTITUTED. There is no "nearest match" path in this file
// by design. A row that fails a gate is dropped and named; it is never
// repointed at a different security.

import { probeInstrument } from "@/lib/markets";
import { Redis } from "@upstash/redis";

export type SymbolRefusal = "private_company" | "unresolved_symbol" | "name_mismatch";

export type SymbolVerdict =
  | { ok: true; symbol: string; name: string; verified: true }
  /** the source could not be reached — NOT a refusal; the row survives */
  | { ok: true; symbol: string; name: ""; verified: false; note: string }
  | { ok: false; reason: SymbolRefusal; detail: string };

/** Real companies with no ordinary listed equity. Naming one is not a typo
 *  and not a lookup failure — it is an untradeable subject, and the honest
 *  answer is to say so rather than reach for the nearest ticker. Kept short
 *  and specific on purpose: this list refuses, so a wrong entry here would
 *  silently delete real ideas. Matched on the SPOKEN name, never the ticker. */
export const UNTRADEABLE_SUBJECTS: readonly string[] = [
  "spacex",
  "space exploration technologies",
  "starlink",
  "openai",
  "anthropic",
  "stripe",
  "bytedance",
  "tiktok",
  "databricks",
  "spacex starship",
  "blue origin",
  "xai",
  "x corp",
  "twitter",
  "fanatics",
  "epic games",
  "valve",
  "ikea",
  "deloitte",
  "mars inc",
  "koch industries",
];

/** PURE. Fold a company or subject name to a comparable core: lowercase,
 *  punctuation stripped, corporate suffixes removed. "Enphase Energy, Inc."
 *  and "Enphase" both fold toward the same head. */
export function foldName(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(
      /\b(?:inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|nv|sa|ag|holdings?|group|the|class [a-c]|common stock|etf|trust|fund|shares?)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** PURE. Is this spoken subject a known-untradeable company? */
export function isUntradeableSubject(spokenName: string): boolean {
  const f = foldName(spokenName);
  if (!f) return false;
  return UNTRADEABLE_SUBJECTS.some((s) => {
    const t = foldName(s);
    return t.length > 0 && (f === t || f.startsWith(`${t} `) || f.endsWith(` ${t}`) || f.includes(` ${t} `));
  });
}

/** PURE. Do the spoken company name and the resolved instrument name refer to
 *  the same thing? Deliberately GENEROUS — a false mismatch deletes a real
 *  idea, while the failure this guards against ("SpaceX" vs "Virgin Galactic
 *  Holdings") shares no words at all and is caught by any sane comparison.
 *  Agreement is: either folded name contains the other, or they share a
 *  significant leading word. An absent spoken name is not a disagreement. */
export function namesAgree(spokenName: string, resolvedName: string): boolean {
  const a = foldName(spokenName);
  const b = foldName(resolvedName);
  if (!a || !b) return true; // nothing to compare — never refuse on absence
  if (a.includes(b) || b.includes(a)) return true;
  // Spacing is not disagreement. A transcript writes compound names apart —
  // "B2 Gold", "Solar Edge", "Service Now" — where the listing writes them
  // closed. Verified on a real run: without this, all three were refused as
  // wrong tickers and three genuine ideas were deleted.
  const aSquashed = a.replace(/ /g, "");
  const bSquashed = b.replace(/ /g, "");
  if (aSquashed.includes(bSquashed) || bSquashed.includes(aSquashed)) return true;
  const wordsA = a.split(" ").filter((w) => w.length >= 3);
  const wordsB = b.split(" ").filter((w) => w.length >= 3);
  if (wordsA.length === 0 || wordsB.length === 0) return true;
  if (wordsA.some((w) => wordsB.includes(w))) return true;
  // A transcript mis-hears a name as often as it mis-spaces one — a real run
  // wrote Oklo as "Oaklo" and a correct ticker was refused for it. Allow a
  // tight edit distance, scaled to length, as the last word.
  //
  // This is tolerance in the AGREEMENT test, never a search: it can only ever
  // let a symbol the extractor already named survive, and can never reach for
  // a different one. The bound stays small so genuinely different companies
  // still disagree — "spacex"/"virgingalactic" and "carrierglobal"/
  // "avisbudgetgroup" are nowhere near it.
  const bound = Math.max(1, Math.floor(Math.min(aSquashed.length, bSquashed.length) / 6));
  return editDistanceWithin(aSquashed, bSquashed, bound);
}

/** PURE. Levenshtein distance, but it gives up as soon as it exceeds `bound`
 *  — the answer past that point is only ever "too far apart". */
export function editDistanceWithin(a: string, b: string, bound: number): boolean {
  if (Math.abs(a.length - b.length) > bound) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > bound) return false; // whole row already past the bound
    prev = row;
  }
  return prev[b.length] <= bound;
}

// --- durable verdict cache ---------------------------------------------------
// A symbol's existence and name don't change often, so a verdict is worth
// keeping across cold starts. Positive verdicts hold for 30 days; refusals for
// 7, because a genuinely new listing should be able to start resolving without
// waiting a month. "Unavailable" is NEVER cached — caching a source outage
// would turn a blip into a week of wrongly-refused ideas.

const NS = "august:symcheck:v1";
const OK_TTL_S = 30 * 24 * 60 * 60;
const REFUSED_TTL_S = 7 * 24 * 60 * 60;

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    _redis = url && token && url.startsWith("https://") ? new Redis({ url, token }) : null;
  } catch {
    _redis = null;
  }
  return _redis;
}

type CachedProbe = { state: "ok"; symbol: string; name: string } | { state: "no-such-symbol" };

async function cachedProbe(symbol: string): Promise<CachedProbe | { state: "unavailable" }> {
  const key = `${NS}:${symbol.toUpperCase()}`;
  const redis = getRedis();
  if (redis) {
    try {
      const hit = (await redis.get(key)) as CachedProbe | null;
      if (hit && (hit.state === "ok" || hit.state === "no-such-symbol")) return hit;
    } catch {
      // cache read failure is never fatal — fall through to the live probe
    }
  }
  const probe = await probeInstrument(symbol);
  if (probe.state === "unavailable") return { state: "unavailable" }; // never cached
  const value: CachedProbe =
    probe.state === "ok"
      ? { state: "ok", symbol: probe.symbol, name: probe.name }
      : { state: "no-such-symbol" };
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(value), {
        ex: value.state === "ok" ? OK_TTL_S : REFUSED_TTL_S,
      });
    } catch {
      // best effort — a cache write failure must not fail the check
    }
  }
  return value;
}

/**
 * Resolve one extracted symbol. `spokenName` is the company the speaker
 * actually named, when the extractor could hear one — it is what makes gate 1
 * and gate 3 possible, and without it only gate 2 applies.
 */
export async function checkSymbol(symbol: string, spokenName = ""): Promise<SymbolVerdict> {
  const sym = (symbol || "").trim().toUpperCase();
  if (!sym) return { ok: false, reason: "unresolved_symbol", detail: "no symbol was extracted" };

  // Gate 1 — untradeable subject, refused before any lookup. This has to come
  // first: synthetic vehicles for these names DO resolve, so a lookup would
  // "succeed" onto the wrong thing.
  if (isUntradeableSubject(spokenName)) {
    return {
      ok: false,
      reason: "private_company",
      detail: `${spokenName.trim()} is not publicly traded — no listed equity to point an idea at`,
    };
  }
  // A bare ticker that is itself one of the untradeable names (the model
  // writing "SPACEX" into the instrument field) is the same refusal.
  if (isUntradeableSubject(sym)) {
    return {
      ok: false,
      reason: "private_company",
      detail: `${sym} is not publicly traded — no listed equity to point an idea at`,
    };
  }

  // Gate 2 — does the symbol exist at all?
  const probe = await cachedProbe(sym);
  if (probe.state === "unavailable") {
    return {
      ok: true,
      symbol: sym,
      name: "",
      verified: false,
      note: "the quote source was unavailable — symbol could not be verified",
    };
  }
  if (probe.state === "no-such-symbol") {
    return { ok: false, reason: "unresolved_symbol", detail: `${sym} does not resolve to a listed instrument` };
  }

  // Gate 3 — is it the RIGHT symbol for what the speaker named?
  if (!namesAgree(spokenName, probe.name)) {
    return {
      ok: false,
      reason: "name_mismatch",
      detail: `${sym} is ${probe.name}, but the speaker named ${spokenName.trim()}`,
    };
  }

  return { ok: true, symbol: probe.symbol || sym, name: probe.name, verified: true };
}
