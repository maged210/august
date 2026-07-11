// The Pulse — what changed since your last visit. Computed CLIENT-SIDE on
// Presence load from one-shot fetches of the same endpoints the surfaces use
// (no invented data, no new endpoints). A snapshot of "how things stood" lives
// in localStorage ("aug-pulse"); each load diffs the live feeds against it,
// then stamps the fresh snapshot — so THIS load becomes the new "last visit".
// Every feed may fail individually: a dead endpoint just means that delta can't
// fire this time, and its snapshot field carries over instead of resetting (so
// nothing is lost, and nothing re-fires falsely on the next visit).
//
// Client-only: touches localStorage. Server code must never import this.

import { etDateKey } from "@/lib/intel/session";

const KEY = "aug-pulse";
const SEEN_IDEA_CAP = 50;
const CAL_WINDOW_MS = 2 * 60 * 60_000; // "next event" horizon

export type PulseDelta = {
  key: string; // stable identity (React keys / pager dots)
  glyph?: "▲" | "▼";
  tone?: "pos" | "neg";
  line: string;
  sub?: string;
  // Deck surface to slide to on click (a resolveTarget id). Absent = the line
  // is informational — it stays put.
  nav?: string;
};

type Snapshot = {
  ts: number;
  pivotSide: "above" | "below" | null;
  seenIdeaIds: string[];
  unread: number | null;
  lastQuakeTs: number;
  lastWireTs: number;
};

function readSnapshot(): Snapshot | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<Snapshot> | null;
    if (j == null || typeof j !== "object" || typeof j.ts !== "number") return null;
    return {
      ts: j.ts,
      pivotSide: j.pivotSide === "above" || j.pivotSide === "below" ? j.pivotSide : null,
      seenIdeaIds: Array.isArray(j.seenIdeaIds)
        ? j.seenIdeaIds.filter((x): x is string => typeof x === "string")
        : [],
      unread: typeof j.unread === "number" ? j.unread : null,
      lastQuakeTs: Number(j.lastQuakeTs) || 0,
      lastWireTs: Number(j.lastWireTs) || 0,
    };
  } catch {
    return null; // private mode / corrupt entry — treat as a first visit
  }
}

function writeSnapshot(s: Snapshot): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode — the pulse simply recomputes fresh next time */
  }
}

// One-shot, individually fault-tolerant fetch (same shape as the telemetry pulls).
async function pull(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Newest wire timestamp, clamped to the feed's own updatedAt so one future-dated
// pubDate can't pin the signal on forever (the exact clamp the old WORLD readout
// used — the deck dot inherits the same threshold through this).
function newestWireTs(intel: any): number {
  const cap = Number(intel?.updatedAt) || Infinity;
  let newest = 0;
  for (const a of intel?.articles ?? []) {
    const t = Math.min(Number(a?.publishedAt) || 0, cap);
    if (t > newest) newest = t;
  }
  return newest;
}

function fmtNQ(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function etClockShort(ms: number): string {
  // "9:00" — the meridiem is dropped; the "in 40m" tail carries the urgency.
  return new Date(ms)
    .toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\s?[AP]M$/i, "");
}

function fmtIn(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export type PulseResult = {
  deltas: PulseDelta[]; // at most 4, in speaking order
  // The world line (big quake / new wires) — the page mirrors this onto the
  // World deck dot so the card and the dot never disagree. null = quiet.
  worldLine: string | null;
};

export async function computePulse(now = Date.now()): Promise<PulseResult> {
  const prev = readSnapshot();

  const [markets, briefRes, inbox, command, intel, day] = await Promise.all([
    pull("/api/markets"),
    pull(`/api/intel/briefs/${etDateKey()}`),
    pull("/api/inbox"),
    pull("/api/command"),
    pull("/api/intel"),
    pull("/api/day"),
  ]);

  const deltas: PulseDelta[] = [];

  // — NQ crossed the pivot since the last visit (levels.above flipped) —
  const lv = markets?.levels;
  const live = lv && Number.isFinite(lv.current) && lv.current > 0;
  const side: "above" | "below" | null = live ? (lv.above ? "above" : "below") : null;
  if (prev?.pivotSide && side && side !== prev.pivotSide) {
    deltas.push(
      side === "above"
        ? { key: "pivot", glyph: "▲", tone: "pos", line: `NQ reclaimed the pivot — ${fmtNQ(lv.current)}`, nav: "desk" }
        : { key: "pivot", glyph: "▼", tone: "neg", line: `NQ lost the pivot — ${fmtNQ(lv.current)}`, nav: "desk" },
    );
  }

  // — new desk ideas today (brief ids not yet seen) — a first-ever visit only
  // seeds the seen set; it never announces the whole brief as "new".
  //
  // Candidate ids (oc_*) are re-minted every time the cron regenerates the brief,
  // so diffing on the raw id would re-announce the same candidate as a phantom
  // "new idea" after every re-run. Diff candidates by a stable content
  // fingerprint instead; topIdeas ids (ti_*) are extraction-stable and pass as-is.
  const candidateFingerprint = (c: any): string =>
    `oc:${c?.underlyingSymbol ?? ""}:${c?.strategyType ?? ""}:${c?.legs?.[0]?.strike ?? ""}:${c?.legs?.[0]?.expiration ?? ""}`;
  const brief = briefRes?.brief;
  const ideas: any[] = [
    ...(brief?.topIdeas ?? []),
    ...(brief?.options?.augustCandidates ?? []).map((c: any) => ({ ...c, id: candidateFingerprint(c) })),
  ];
  const ideaIds = ideas
    .map((i) => i?.id)
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  if (prev) {
    const seen = new Set(prev.seenIdeaIds);
    const freshIdeas = ideas.filter((i) => typeof i?.id === "string" && i.id && !seen.has(i.id));
    if (freshIdeas.length > 0) {
      const tickers: string[] = [];
      for (const i of freshIdeas) {
        const t = typeof i?.ticker === "string" ? i.ticker.trim().toUpperCase() : "";
        if (t && !tickers.includes(t)) tickers.push(t);
      }
      const tail = tickers.slice(0, 3).join(" · ");
      deltas.push({
        key: "ideas",
        line: `${freshIdeas.length} new idea${freshIdeas.length === 1 ? "" : "s"} landed${tail ? ` · ${tail}` : ""}`,
        nav: "desk",
      });
    }
  }

  // — unread moved up since the last visit —
  const unread: number | null = inbox?.connected
    ? typeof inbox.unread === "number"
      ? inbox.unread
      : 0
    : null;
  if (prev != null && prev.unread != null && unread != null && unread > prev.unread) {
    deltas.push({ key: "unread", line: `${unread - prev.unread} new unread`, nav: "comms" });
  }

  // — world: a big (M ≥ 6, /api/command's own bar) quake, or wires newer than the
  // last look. Same thresholds as the deck-dot fresh logic, and the aug-world-seen
  // visit stamp joins the baseline so the card and the dot can never disagree:
  // anything already seen on the World slide stays quiet here too.
  let worldSeen = 0;
  try {
    worldSeen = Number(window.localStorage.getItem("aug-world-seen")) || 0;
  } catch {
    /* never visited */
  }
  const bq = command?.bigQuake;
  const quakeTs = bq && typeof bq.mag === "number" ? Number(bq.time) || 0 : 0;
  const wireTs = newestWireTs(intel);
  let worldLine: string | null = null;
  if (prev) {
    if (quakeTs > Math.max(prev.lastQuakeTs, worldSeen)) {
      worldLine = `M${bq.mag.toFixed(1)} quake — ${String(bq.place || "").trim() || "location pending"}`;
    } else if (wireTs > Math.max(prev.lastWireTs, worldSeen)) {
      worldLine = "new wires on the world feed";
    }
    if (worldLine) deltas.push({ key: "world", line: worldLine, nav: "world" });
  }

  // — next calendar event inside 2h — informational; no nav, it stays put —
  if (day?.connected && Array.isArray(day.events)) {
    const next = day.events
      .filter(
        (e: any) => e && !e.allDay && Number(e.startMs) > now && Number(e.startMs) - now <= CAL_WINDOW_MS,
      )
      .sort((a: any, b: any) => Number(a.startMs) - Number(b.startMs))[0];
    if (next && typeof next.title === "string" && next.title) {
      const startMs = Number(next.startMs);
      deltas.push({
        key: "cal",
        line: `${etClockShort(startMs)} — ${next.title} in ${fmtIn(startMs - now)}`,
      });
    }
  }

  // This load is the new "last visit". Fields whose feed failed carry over from
  // the previous snapshot rather than resetting; seen idea ids merge, newest
  // first, capped so the entry never grows unbounded.
  writeSnapshot({
    ts: now,
    pivotSide: side ?? prev?.pivotSide ?? null,
    seenIdeaIds: [...new Set([...ideaIds, ...(prev?.seenIdeaIds ?? [])])].slice(0, SEEN_IDEA_CAP),
    unread: unread ?? prev?.unread ?? null,
    lastQuakeTs: Math.max(prev?.lastQuakeTs ?? 0, quakeTs),
    lastWireTs: Math.max(prev?.lastWireTs ?? 0, wireTs),
  });

  return { deltas: deltas.slice(0, 4), worldLine };
}
