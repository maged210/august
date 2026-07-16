// AUGUST Market Intel — source privacy. Internally every brief item keeps full
// provenance (channel, video, segment timestamps) so the owner can audit any
// claim; nothing that leaves the desk may. redactBrief strips attribution while
// keeping the tradecraft — tickers, theses, levels, transparent ranking — so a
// brief reads clean without exposing who was watched. Fields are DELETED (not
// blanked): the wire shape simply omits them, and every cite in the render path
// gates on `videoId`, so a redacted brief renders with no source row.
//
// MULTI-USER ADAPTATION (this repo): the owner flag is no longer an env toggle.
// The retired INTEL_OWNER_VIEW env var is dead config — setting it does nothing.
// ownerView = the session email is OWNER_EMAIL, resolved by ONE definition in
// lib/user-scope.ts (deriveIntelAttributionGate): auth unconfigured → TRUE in
// dev/test (byte-compatible single-user fallback) but FALSE in production (a
// missing env var must never open the privacy boundary), signed-out or
// non-owner → FALSE.

import type { ConsensusItem, DailyBrief, IntelSource, IntelVideo } from "./types";
import { resolveIntelOwnerView } from "../user-scope";
import { listSources, listVideos } from "./store";

// Attribution + evidence keys, dropped wherever they occur on an idea-like item
// (BriefIdea, OptionBriefIdea, IntelLevel, IntelCatalyst all carry a subset).
export const SOURCE_KEYS = [
  "channelTitle",
  "videoTitle",
  "videoId",
  "sourceSegmentIds",
  "sourceStartSeconds",
  "sourceEndSeconds",
  "sourceChapterId",
  "chapter",
] as const;

// The cast is deliberate: the nominal types require these fields, but consumers
// of a redacted brief must never read them — the API's `ownerView` flag is the
// contract for whether attribution exists at all.
function omitSource<T>(item: T): T {
  const out = { ...(item as Record<string, unknown>) };
  for (const k of SOURCE_KEYS) delete out[k];
  return out as T;
}

/** Recursively DELETE the given keys anywhere in a JSON-ish tree. Never mutates
 *  the input — returns a stripped clone. Belt-and-braces for payloads that are
 *  assembled by whitelist (the public feed) but must be provably leak-free. */
export function deepOmitKeys<T>(input: T, keys: readonly string[]): T {
  if (Array.isArray(input)) {
    return input.map((v) => deepOmitKeys(v, keys)) as unknown as T;
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (keys.includes(k)) continue;
      out[k] = deepOmitKeys(v, keys);
    }
    return out as T;
  }
  return input;
}

// Consensus keeps its analytical value (how many sources, how explicit, whether
// they agree) — just not WHO said it or where.
function redactConsensus(c: ConsensusItem): ConsensusItem {
  return {
    ...c,
    sources: c.sources.map((s) => ({ explicitness: s.explicitness })),
  } as ConsensusItem;
}

// ── prose scrub ──────────────────────────────────────────────────────────────
// Field deletion can't catch attribution the LLM wrote INTO the prose (an
// observed leak: a channel name inside brief.invalidation text). Given the
// known identity strings — the brief's own channelTitle/videoTitle values
// plus everything the store knows (sources' channelTitle/channelId/title,
// videos' title/channelTitle/channelId) — every string field of the redacted
// brief is walked generically and occurrences are replaced with "the source".
// Word-boundary matching (alphanumeric lookarounds) so tickers and words that
// merely CONTAIN an identity are never mangled; longest-string-first so a
// full video title wins over a channel name it contains.

/** Recursively apply `fn` to every string VALUE in a JSON-ish tree. Never
 *  mutates the input — returns a mapped clone. */
export function deepMapStrings<T>(input: T, fn: (s: string) => string): T {
  if (typeof input === "string") return fn(input) as unknown as T;
  if (Array.isArray(input)) {
    return input.map((v) => deepMapStrings(v, fn)) as unknown as T;
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = deepMapStrings(v, fn);
    }
    return out as T;
  }
  return input;
}

// Keys whose string values ARE source identity — harvested from the brief
// itself before deletion, so even a caller that threads no store identities
// still scrubs everything the brief could possibly name.
const IDENTITY_VALUE_KEYS = new Set(["channelTitle", "videoTitle", "channelId", "videoId"]);

/** Collect the brief's own identity strings (channel/video names + ids) from
 *  anywhere in the tree — the union with the store-threaded strings feeds the
 *  prose scrubber. */
export function collectBriefIdentityStrings(brief: DailyBrief): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const v of node) walk(v); return; }
    if (node !== null && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (IDENTITY_VALUE_KEYS.has(k) && typeof v === "string" && v) found.push(v);
        walk(v);
      }
    }
  };
  walk(brief);
  return found;
}

/** Identity strings the store knows — all sources' channel titles/ids/titles
 *  and all videos' titles/channels. Threaded into redactBrief wherever its
 *  output reaches a non-owner. */
export function storeIdentityStrings(sources: IntelSource[], videos: IntelVideo[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    if (s.channelTitle) out.push(s.channelTitle);
    if (s.channelId) out.push(s.channelId);
    if (s.title) out.push(s.title);
  }
  for (const v of videos) {
    if (v.title) out.push(v.title);
    if (v.channelTitle) out.push(v.channelTitle);
    if (v.channelId) out.push(v.channelId);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build the case-insensitive, word-boundary, longest-first replacer for a
 *  set of identity strings — or null when nothing usable was given.
 *  Identities under 3 chars are dropped: replacing them would mangle
 *  ordinary words/tickers, which the boundary rule exists to prevent. */
export function buildIdentityScrubber(identities: readonly string[]): ((s: string) => string) | null {
  const uniq = [...new Set(identities.map((s) => s.trim()).filter((s) => s.length >= 3))]
    .sort((a, b) => b.length - a.length); // longest first — full titles win over names they contain
  if (uniq.length === 0) return null;
  const patterns = uniq.map(
    (id) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(id)}(?![A-Za-z0-9])`, "gi"),
  );
  return (s: string) => {
    let out = s;
    for (const re of patterns) out = out.replace(re, "the source");
    return out;
  };
}

/** Strip all source attribution from a brief — structural field deletion plus
 *  the prose scrub over every remaining string field. `knownIdentities` are
 *  the store-side identity strings (see storeIdentityStrings); the brief's
 *  own attribution values are always included. Never mutates the input. */
export function redactBrief(brief: DailyBrief, knownIdentities: readonly string[] = []): DailyBrief {
  const out: DailyBrief = {
    ...brief,
    topIdeas: brief.topIdeas.map(omitSource),
    creatorFavorites: brief.creatorFavorites.map(omitSource),
    consensus: brief.consensus.map(redactConsensus),
    levels: brief.levels.map(omitSource),
    catalysts: brief.catalysts.map(omitSource),
    sourceVideoIds: [],
  };
  if (brief.options) {
    out.options = {
      ...brief.options,
      bestCreatorPlays: brief.options.bestCreatorPlays.map(omitSource),
      augustCandidates: brief.options.augustCandidates.map(omitSource),
      directionalOnly: brief.options.directionalOnly.map(omitSource),
      consensus: brief.options.consensus.map(redactConsensus),
    };
  }
  // prose scrub — identities gathered from the brief PRE-deletion ∪ threaded
  // store identities, applied to every string field of the redacted tree
  const scrub = buildIdentityScrubber([...collectBriefIdentityStrings(brief), ...knownIdentities]);
  return scrub ? deepMapStrings(out, scrub) : out;
}

/** redactBrief for the wire: threads the STORE's identity strings (all
 *  sources + videos) into the prose scrub. Use wherever a redacted brief
 *  reaches a non-owner and the caller hasn't already fetched sources/videos.
 *  A store hiccup never blocks the response — the brief's own attribution
 *  strings are still scrubbed. */
export async function redactBriefForWire(brief: DailyBrief): Promise<DailyBrief> {
  try {
    const [sources, videos] = await Promise.all([listSources(), listVideos()]);
    return redactBrief(brief, storeIdentityStrings(sources, videos));
  } catch {
    return redactBrief(brief);
  }
}

/** Server-side owner flag — attribution is visible only when this resolves
 *  true. Delegates to THE read-boundary definition (user-scope's
 *  deriveIntelAttributionGate): signed-in owner → TRUE; signed-out / non-owner
 *  → FALSE; auth unconfigured → TRUE in dev/test (single-user fallback) but
 *  FALSE in production, where privacy fails closed.
 *
 *  ASYNC CONTRACT — LOAD-BEARING. This function returns a PROMISE, and a
 *  Promise is always truthy: a call site that forgets to await it turns
 *  `if (!intelOwnerView())` into a permanently-false guard that serves full
 *  source attribution to EVERYONE. It must be awaited at every call site.
 *  (An earlier sync version of this function existed; every call site was
 *  converted. tests/intel.test.ts pins the async contract so a regression to
 *  the sync shape is catchable.) */
export async function intelOwnerView(): Promise<boolean> {
  return resolveIntelOwnerView();
}
