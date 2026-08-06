// Trade Ideas — the CORE V2 rail's data model.
//
// This module holds the shared types and PURE helpers only (node:test-friendly,
// no Redis/network — the lib/intel convention). The Upstash-backed store and
// the admin/approval pipeline land in P3 and build on these shapes.
//
// Wire contract: GET /api/ideas serves ONLY status="live" ideas, newest first,
// in the redacted PublicIdea shape — draft/closed rows and provenance (source)
// never reach the public wire.

export type IdeaStatus = "draft" | "live" | "closed";
export type IdeaSource = "manual" | "extracted";
export type IdeaRiskLevel = "low" | "medium" | "high";

export type Idea = {
  id: string;
  /** the traded thing — "NQ", "NVDA", "BTC" — free-form symbol or name */
  instrument: string;
  /** the one-paragraph why */
  thesis: string;
  /** free-form level ("21,450", "break of 600") — honest to the source, never coerced to a number */
  entry: string;
  target: string;
  riskLevel: IdeaRiskLevel;
  status: IdeaStatus;
  source: IdeaSource;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
};

/** What the public rail receives: live ideas, provenance stripped. */
export type PublicIdea = Pick<
  Idea,
  "id" | "instrument" | "thesis" | "entry" | "target" | "riskLevel" | "createdAt" | "updatedAt"
>;

export function toPublicIdea(i: Idea): PublicIdea {
  return {
    id: i.id,
    instrument: i.instrument,
    thesis: i.thesis,
    entry: i.entry,
    target: i.target,
    riskLevel: i.riskLevel,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

// "2h ago" — coarse, honest buckets for the rail's timestamps. Past a month
// the relative form stops meaning anything; fall back to the plain date.
export function relativeTime(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
