// THE CALL's daily push (feature/pwa-push) — ONE notification per trading
// day, sent from the daily pass: today's settle and tomorrow's call in a
// single message, PERSONALIZED per principal (their take, their record).
//
// Wiring: registerCallPush() subscribes to the onCallSettled seam
// (lib/call-events — the seam THE CALL branch left for exactly this); the
// handler only STASHES the settle, because it fires mid-pass, BEFORE
// tomorrow's call generates. The cron route calls flushCallPush() after
// runCallPass() returns, when the full evening state (settle + next call)
// exists. No settle stashed → nothing sends: no-call days, weekends, and
// NO_SESSION voids are silent by construction.
//
// Idempotency: an NX marker next to day.settle (august:call:v1:pushed:<date>)
// — a day never sends twice, even across pinger double-runs. Delivery log:
// the last 14 sends (day, recipients, failures) for the owner console.

import {
  fmtClosePct,
  fmtRecord,
  readCallState,
  type CallResult,
  type CallSide,
  type CallState,
} from "@/lib/call";
import { onCallSettled, type CallSettledEvent } from "@/lib/call-events";
import {
  dispatch,
  listAllSubscriptions,
  vapidReady,
  type PushKv,
  type PushTransport,
  type StoredPushSub,
} from "@/lib/push";
import { Redis } from "@upstash/redis";
import type { RegimeRead } from "@/lib/regime";

const PUSHED_KEY = (d: string) => `august:call:v1:pushed:${d}`;
const LOG_KEY = "august:push:calllog";
const LOG_MAX = 14;
const PUSHED_TTL_S = 45 * 86_400;

export type CallPushLogEntry = {
  day: string;
  recipients: number; // distinct principals
  devices: number;
  sent: number;
  pruned: number;
  failed: number;
  at: number;
  test?: boolean;
};

type CallPushKv = {
  set(key: string, value: unknown, opts?: { nx?: true; ex?: number }): Promise<unknown>;
  lpush(key: string, value: unknown): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<unknown>;
};

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

// --- the message (PURE — tested per state) ----------------------------------

const weekdayShort = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

/** PURE. Compose one principal's notification from their evening state.
 *  null = nothing to say (no settle today, or a NO_SESSION void). Shape:
 *  "NQ CLOSED +0.4% · AUGUST ✓ · YOU ✗ · YOU 3–1 · AUGUST 2–2 · TOMORROW:
 *  AUGUST HIGHER" — every value from real state, nothing fabricated. */
export function composeCallPush(state: CallState): { title: string; body: string } | null {
  const s = state.settled;
  if (!s || s.result === "NO_SESSION") return null;

  const parts: string[] = [];
  if (s.result === "FLAT") {
    parts.push("NQ CLOSED FLAT · PUSH");
  } else {
    parts.push(
      `NQ CLOSED ${s.closePct !== null ? fmtClosePct(s.closePct) : (s.result as CallResult)} · AUGUST ${s.augustWin ? "✓" : "✗"}${
        s.youWin !== null ? ` · YOU ${s.youWin ? "✓" : "✗"}` : ""
      }`,
    );
  }
  parts.push(`YOU ${fmtRecord(state.record.you)} · AUGUST ${fmtRecord(state.record.august)}`);

  if (state.active) {
    // the pass generates only when the next weekday is literally tomorrow, so
    // an active call at flush time IS tomorrow's
    parts.push(`TOMORROW: AUGUST ${state.active.side as CallSide}`);
  } else if (state.noCall?.reason === "dead_even") {
    parts.push("TOMORROW: NO CALL — the regime is dead even");
  } else if (state.noCall?.reason === "unavailable") {
    parts.push("TOMORROW: NO CALL — the regime is unavailable");
  } else if (state.noCall) {
    parts.push(`NEXT CALL ${weekdayShort(state.noCall.nextDate).toUpperCase()}`);
  }

  return { title: "THE CALL", body: parts.join(" · ") };
}

// --- the seam + the flush ---------------------------------------------------

let _pending: CallSettledEvent | null = null;
let _registered = false;

/** Subscribe to the settle seam (idempotent). The handler stashes only — the
 *  send happens in flushCallPush, after the pass has also generated
 *  tomorrow's call. */
export function registerCallPush(): void {
  if (_registered) return;
  _registered = true;
  onCallSettled((e) => {
    _pending = e;
  });
}

/** a no-network regime stub — flush must never trigger a thesis generation */
const NO_REGIME = async (): Promise<RegimeRead> => ({ label: "UNAVAILABLE", because: [], agreement: null });

export type FlushDeps = {
  kv?: CallPushKv | null;
  pushKv?: PushKv | null;
  transport?: PushTransport;
  now?: number;
  readState?: (cid: string) => Promise<CallState>;
  subs?: StoredPushSub[];
};

/** Send the day's ONE notification: per-principal personalized bodies, NX
 *  idempotency, prune-on-410 (inside dispatch), delivery log. Returns null
 *  when there is nothing to send. */
export async function flushCallPush(deps?: FlushDeps): Promise<CallPushLogEntry | null> {
  const e = _pending;
  _pending = null;
  if (!e || e.result === "NO_SESSION") return null;

  const kv = deps?.kv !== undefined ? deps.kv : getRedis();
  if (!kv) return null;
  if (!deps?.transport && !vapidReady()) return null; // VAPID unset — no sender

  // a day never sends twice (pinger double-runs, retries)
  const took = await kv.set(PUSHED_KEY(e.forDate), "x", { nx: true, ex: PUSHED_TTL_S });
  if (took === null) return null;

  const subs = deps?.subs ?? (await listAllSubscriptions(deps?.pushKv !== undefined ? { kv: deps.pushKv } : undefined));
  const byPrincipal = new Map<string, StoredPushSub[]>();
  for (const s of subs) {
    const list = byPrincipal.get(s.principal) ?? [];
    list.push(s);
    byPrincipal.set(s.principal, list);
  }

  const readState =
    deps?.readState ?? ((cid: string) => readCallState(cid, { readRegime: NO_REGIME }));

  const entry: CallPushLogEntry = {
    day: e.forDate,
    recipients: 0,
    devices: 0,
    sent: 0,
    pruned: 0,
    failed: 0,
    at: deps?.now ?? Date.now(),
  };

  for (const [cid, list] of byPrincipal) {
    try {
      const state = await readState(cid);
      const msg = composeCallPush(state);
      if (!msg) continue;
      const r = await dispatch(list, { ...msg, url: "/", tag: `call-${e.forDate}` }, {
        ...(deps?.pushKv !== undefined ? { kv: deps.pushKv } : {}),
        ...(deps?.transport ? { transport: deps.transport } : {}),
      });
      entry.recipients++;
      entry.devices += r.total;
      entry.sent += r.sent;
      entry.pruned += r.pruned;
      entry.failed += r.failed;
    } catch (err) {
      entry.failed += list.length;
      console.warn("[call-push] principal send failed:", err instanceof Error ? err.message : err);
    }
  }

  try {
    await kv.lpush(LOG_KEY, JSON.stringify(entry));
    await kv.ltrim(LOG_KEY, 0, LOG_MAX - 1);
  } catch {
    /* the log is best-effort — the sends already happened */
  }
  console.log(
    `[call-push] day=${entry.day} recipients=${entry.recipients} devices=${entry.devices} sent=${entry.sent} pruned=${entry.pruned} failed=${entry.failed}`,
  );
  return entry;
}

/** The owner console's delivery log — last 14 sends, newest first. */
export async function readCallPushLog(opts?: { kv?: CallPushKv | null }): Promise<CallPushLogEntry[]> {
  const kv = opts?.kv !== undefined ? opts.kv : getRedis();
  if (!kv) return [];
  try {
    const raw = (await kv.lrange(LOG_KEY, 0, LOG_MAX - 1)) as unknown[];
    return (raw ?? [])
      .map((r) => {
        try {
          const v = (typeof r === "string" ? JSON.parse(r) : r) as CallPushLogEntry;
          return v && typeof v.day === "string" ? v : null;
        } catch {
          return null;
        }
      })
      .filter((v): v is CallPushLogEntry => v !== null);
  } catch {
    return [];
  }
}

/** Append a console-triggered test send to the same log (marked). */
export async function logTestSend(partial: Omit<CallPushLogEntry, "test">): Promise<void> {
  const kv = getRedis();
  if (!kv) return;
  try {
    await kv.lpush(LOG_KEY, JSON.stringify({ ...partial, test: true }));
    await kv.ltrim(LOG_KEY, 0, LOG_MAX - 1);
  } catch {
    /* best-effort */
  }
}
