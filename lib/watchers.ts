// Watchers — standing alerts that ride feeds AUGUST ALREADY has. SERVER ONLY.
//
// Created conversationally (chat tools → runWatcherTool), checked on a schedule
// (/api/cron/watchers → checkWatchers), and fired ONCE per trip via the existing push
// spine (lib/push.ts). NO new data sources: market reuses lib/markets getQuote (Yahoo),
// quake reuses lib/command getQuakes (USGS), intel reuses lib/intel getIntel (RSS).
//
// Anti-spam is the whole game:
//   - COOLDOWN: a tripped watcher goes to "cooldown" for ≥6h and won't re-fire.
//   - For market: it only re-arms once the condition CLEARS (price back across the
//     threshold) — so a persistently-true condition alerts ONCE, never every 6h.
//   - For event types (quake/intel): a `cursor` (last event timestamp alerted on)
//     ensures the same quake/headline never fires twice.
//   - QUIET HOURS: overnight (≈10pm–7am ET) the check is a no-op — never wakes you.

import { Redis } from "@upstash/redis";
import { getQuote } from "./markets";
import { getQuakes } from "./command";
import { getIntel } from "./intel";
import { sendToAll } from "./push";

const KEY = "august:watchers"; // Redis hash: id -> Watcher JSON
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MAX_WATCHERS = 25;
const TZ = "America/New_York"; // Maged's local time (matches the brief/markets layers)
const QUIET_START = 22; // 10pm
const QUIET_END = 7; //  7am

export type WatcherType = "market" | "quake" | "intel";
export type WatcherStatus = "active" | "cooldown" | "paused";

export type MarketParams = { symbol: string; op: "below" | "above"; value: number };
export type QuakeParams = { minMag: number; region?: string };
export type IntelParams = { keyword: string };

export type Watcher = {
  id: string;
  type: WatcherType;
  params: MarketParams | QuakeParams | IntelParams;
  label: string; // human description, for list / confirm / push
  created: number;
  last_fired: number; // 0 = never
  cursor: number; // event types: newest event ts already alerted on; market: unused
  status: WatcherStatus;
};

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

export function watchersConfigured(): boolean {
  return getRedis() !== null;
}

// --- storage --------------------------------------------------------------
async function loadAll(): Promise<Watcher[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const all = await redis.hgetall<Record<string, Watcher>>(KEY);
    return all ? Object.values(all).sort((a, b) => a.created - b.created) : [];
  } catch {
    return [];
  }
}
async function saveOne(w: Watcher): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.hset(KEY, { [w.id]: w });
  } catch {
    /* best-effort */
  }
}
async function removeOne(id: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.hdel(KEY, id);
  } catch {
    /* noop */
  }
}

function newId(): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `w_${rnd}`;
}

const fmtPrice = (n: number): string =>
  n >= 1000 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
const shortPlace = (p: string): string =>
  (p || "").replace(/^\d+\s*km\s+[NSEW]+\s+of\s+/i, "near ").slice(0, 48);

// --- create ---------------------------------------------------------------
// Loose input straight from the LLM tool call — we coerce + validate per type.
export type CreateInput = {
  type?: string;
  symbol?: string;
  op?: string;
  direction?: string;
  value?: number | string;
  threshold?: number | string;
  min_magnitude?: number | string;
  minMag?: number | string;
  region?: string;
  keyword?: string;
};

type CreateResult = { ok: true; label: string; note?: string } | { ok: false; error: string };

export async function createWatcher(input: CreateInput): Promise<CreateResult> {
  if (!watchersConfigured()) return { ok: false, error: "storage_unconfigured" };
  const existing = await loadAll();
  if (existing.length >= MAX_WATCHERS) return { ok: false, error: "too_many" };

  const type = (input.type || "").toLowerCase();

  if (type === "market") {
    const opRaw = `${input.op ?? input.direction ?? ""}`.toLowerCase();
    const op: "below" | "above" =
      opRaw.includes("above") || opRaw.includes("over") || opRaw.includes("up") ? "above" : "below";
    const value = Number(input.value ?? input.threshold);
    const sym = (input.symbol ?? "").trim();
    if (!sym || !Number.isFinite(value)) return { ok: false, error: "market_params" };
    // Validate the ticker resolves now (and capture the current price for confirmation).
    const q = await getQuote(sym);
    if (!q) return { ok: false, error: "unknown_symbol" };
    const params: MarketParams = { symbol: q.symbol, op, value };
    const label = `${q.symbol} ${op} ${fmtPrice(value)}`;
    await saveOne(make("market", params, label));
    return { ok: true, label, note: `${q.symbol} is ${fmtPrice(q.price)} now` };
  }

  if (type === "quake") {
    const minMag = Number(input.min_magnitude ?? input.minMag ?? input.value);
    if (!Number.isFinite(minMag)) return { ok: false, error: "quake_params" };
    const region = (input.region ?? "").trim() || undefined;
    const params: QuakeParams = { minMag, region };
    const label = `quakes ≥ M${minMag}${region ? ` near ${region}` : ""}`;
    const w = make("quake", params, label);
    w.cursor = Date.now(); // only alert on quakes AFTER creation
    await saveOne(w);
    return { ok: true, label };
  }

  if (type === "intel") {
    const keyword = (input.keyword ?? "").trim();
    if (!keyword) return { ok: false, error: "intel_params" };
    const params: IntelParams = { keyword };
    const label = `"${keyword}" on the wires`;
    const w = make("intel", params, label);
    w.cursor = Date.now(); // only alert on headlines published AFTER creation
    await saveOne(w);
    return { ok: true, label };
  }

  return { ok: false, error: "unknown_type" };
}

function make(type: WatcherType, params: Watcher["params"], label: string): Watcher {
  return {
    id: newId(),
    type,
    params,
    label,
    created: Date.now(),
    last_fired: 0,
    cursor: 0,
    status: "active",
  };
}

// --- list / remove --------------------------------------------------------
export async function listWatchers(): Promise<Watcher[]> {
  return loadAll();
}

export function describeWatchers(ws: Watcher[]): string {
  if (!ws.length) return "You have no active watchers right now.";
  return ws
    .map((w) => {
      const tail =
        w.status === "cooldown"
          ? " (recently alerted — cooling down)"
          : w.status === "paused"
            ? " (paused)"
            : "";
      return `${w.label}${tail}`;
    })
    .join("; ");
}

type RemoveResult =
  | { ok: true; removed: string }
  | { ok: false; error: string; candidates?: string[] };

export async function removeWatcher(query: string): Promise<RemoveResult> {
  if (!watchersConfigured()) return { ok: false, error: "storage_unconfigured" };
  const all = await loadAll();
  if (!all.length) return { ok: false, error: "none" };
  const q = (query || "").trim().toLowerCase();
  if (!q) return { ok: false, error: "no_query" };

  let target = all.find((w) => w.id === query);
  if (!target) {
    const matches = all.filter(
      (w) =>
        w.label.toLowerCase().includes(q) || JSON.stringify(w.params).toLowerCase().includes(q),
    );
    if (matches.length === 1) target = matches[0];
    else if (matches.length > 1) return { ok: false, error: "ambiguous", candidates: matches.map((m) => m.label) };
  }
  if (!target) return { ok: false, error: "no_match" };
  await removeOne(target.id);
  return { ok: true, removed: target.label };
}

// --- chat-tool dispatcher (called from /api/chat, server-side) -------------
// Returns a plain confirmation string for the model to speak back in character.
export async function runWatcherTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  if (name === "create_watcher") {
    const r = await createWatcher(input as CreateInput);
    if (r.ok) {
      return `Watcher set: ${r.label}${r.note ? ` — ${r.note}` : ""}. I'll ping you once when it trips, then hold off so you're not spammed.`;
    }
    return `Couldn't set that watcher: ${createError(r.error)}.`;
  }
  if (name === "list_watchers") {
    return describeWatchers(await listWatchers());
  }
  if (name === "remove_watcher") {
    const r = await removeWatcher(String(input.query ?? input.id ?? ""));
    if (r.ok) return `Removed: ${r.removed}.`;
    if (r.error === "ambiguous") return `A few match — which one? ${(r.candidates ?? []).join("; ")}.`;
    if (r.error === "no_match" || r.error === "none") return `I don't have a watcher matching that.`;
    return `Couldn't remove that watcher (${r.error}).`;
  }
  return "Unknown watcher action.";
}

function createError(code: string): string {
  switch (code) {
    case "unknown_symbol":
      return "I couldn't find that ticker";
    case "too_many":
      return "you're at the watcher limit";
    case "storage_unconfigured":
      return "watcher storage isn't set up on the server";
    case "market_params":
      return "I need a ticker and a price";
    case "quake_params":
      return "I need a minimum magnitude";
    case "intel_params":
      return "I need a keyword to watch for";
    default:
      return "missing details";
  }
}

// --- the scheduled check (the core) ---------------------------------------
function isQuietHours(): boolean {
  const hour =
    Number(new Date().toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false })) % 24;
  return hour >= QUIET_START || hour < QUIET_END;
}

const marketTripped = (p: MarketParams, price: number): boolean =>
  p.op === "below" ? price < p.value : price > p.value;

type QFeature = { properties: { mag: number; place: string; time: number } };

type Feeds = {
  quotes: Map<string, { price: number } | null>;
  quakes: { features: QFeature[] } | null;
  intel: { articles: { source: string; headline: string; publishedAt: number }[] } | null;
};

// Evaluate one watcher against the shared feed snapshot. Returns the alert (message +
// optional new cursor) when it trips, else null.
function evaluate(w: Watcher, f: Feeds): { message: string; cursor?: number } | null {
  if (w.type === "market") {
    const p = w.params as MarketParams;
    const q = f.quotes.get(p.symbol);
    if (!q || !marketTripped(p, q.price)) return null;
    return { message: `${p.symbol} ${fmtPrice(q.price)} — ${p.op} your ${fmtPrice(p.value)}` };
  }
  if (w.type === "quake") {
    const p = w.params as QuakeParams;
    if (!f.quakes) return null;
    const region = p.region?.toLowerCase();
    const matches = f.quakes.features.filter(
      (q) =>
        q.properties.mag >= p.minMag &&
        q.properties.time > w.cursor &&
        (!region || q.properties.place.toLowerCase().includes(region)),
    );
    if (!matches.length) return null;
    const biggest = matches.reduce((a, b) => (b.properties.mag > a.properties.mag ? b : a));
    const newest = Math.max(...matches.map((m) => m.properties.time));
    return {
      message: `M${biggest.properties.mag.toFixed(1)} — ${shortPlace(biggest.properties.place)} (your alert: M${p.minMag}+)`,
      cursor: newest,
    };
  }
  if (w.type === "intel") {
    const p = w.params as IntelParams;
    if (!f.intel) return null;
    const kw = p.keyword.toLowerCase();
    const matches = f.intel.articles.filter(
      (a) => a.headline.toLowerCase().includes(kw) && a.publishedAt > w.cursor,
    );
    if (!matches.length) return null;
    const newest = matches.reduce((a, b) => (b.publishedAt > a.publishedAt ? b : a));
    return {
      message: `"${p.keyword}" on the wire — ${newest.source}: ${newest.headline.slice(0, 90)}`,
      cursor: Math.max(...matches.map((m) => m.publishedAt)),
    };
  }
  return null;
}

async function fire(w: Watcher, message: string): Promise<void> {
  // Every alert deep-links the deck: market alerts land on the DESK slide, the
  // rest on WORLD (the orb page resolves ?screen= via resolveTarget on mount).
  const url = w.type === "market" ? "/?screen=desk" : "/?screen=world";
  await sendToAll({
    title: "AUGUST",
    body: message,
    url,
    tag: `watcher-${w.id}`, // a fresh alert for this watcher replaces a stale one
  });
}

export type CheckResult = {
  checked: number;
  fired: number;
  skipped?: string;
  details: string[];
};

export async function checkWatchers(): Promise<CheckResult> {
  if (!watchersConfigured()) return { checked: 0, fired: 0, skipped: "storage_unconfigured", details: [] };
  if (isQuietHours()) return { checked: 0, fired: 0, skipped: "quiet_hours", details: [] };

  const active = (await loadAll()).filter((w) => w.status !== "paused");
  if (!active.length) return { checked: 0, fired: 0, details: [] };

  // Pull each needed feed ONCE (reusing the existing fetchers + their TTL caches).
  const types = new Set(active.map((w) => w.type));
  const [quakes, intel] = await Promise.all([
    types.has("quake") ? getQuakes().catch(() => null) : Promise.resolve(null),
    types.has("intel") ? getIntel().catch(() => null) : Promise.resolve(null),
  ]);
  const symbols = [
    ...new Set(active.filter((w) => w.type === "market").map((w) => (w.params as MarketParams).symbol)),
  ];
  const quotes = new Map<string, { price: number } | null>();
  await Promise.all(symbols.map(async (s) => quotes.set(s, await getQuote(s).catch(() => null))));

  const feeds: Feeds = {
    quotes,
    quakes: quakes as Feeds["quakes"],
    intel: intel as Feeds["intel"],
  };

  const now = Date.now();
  let fired = 0;
  const details: string[] = [];

  for (const w of active) {
    let dirty = false;

    if (w.status === "cooldown") {
      if (now - w.last_fired < COOLDOWN_MS) continue; // still cooling — never re-fire
      // Cooldown elapsed. Market re-arms ONLY once the condition has cleared, so a
      // standing true condition never re-spams; event types just re-arm (the cursor
      // already prevents re-alerting the same quake/headline).
      if (w.type === "market") {
        const q = feeds.quotes.get((w.params as MarketParams).symbol);
        if (q && marketTripped(w.params as MarketParams, q.price)) continue; // still tripped → keep cooling
      }
      w.status = "active";
      dirty = true;
    }

    const alert = evaluate(w, feeds);
    if (alert) {
      await fire(w, alert.message);
      w.last_fired = now;
      w.status = "cooldown";
      if (alert.cursor) w.cursor = alert.cursor;
      dirty = true;
      fired++;
      details.push(`${w.label} → ${alert.message}`);
    }

    if (dirty) await saveOne(w);
  }

  return { checked: active.length, fired, details };
}
