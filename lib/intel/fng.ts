// AUGUST Market Intel — CNN Fear & Greed (the EQUITY index). SERVER ONLY. Keyless.
//
// SPEC-wiring §2.5: this is CNN's index for the equity desk — NEVER the
// alternative.me CRYPTO index (that one stays on the Markets deck). On total
// failure the caller HIDES the chip + gauge: no fake neutral-50, no silent
// crypto substitution. If a crypto fallback is ever wanted it must be labeled
// CRYPTO F&G — deliberately not built here.
//
// Caching: in-process 30-min TTL (mirrors the lib/markets.ts cached() pattern —
// a stale in-process hit is served when the fetch throws) PLUS a best-effort
// Redis stale-fallback key so cold serverless instances don't hammer CNN and a
// CNN outage on a cold instance serves the last known reading instead of
// blanking the gauge.

import { Redis } from "@upstash/redis";

export type FngReading = { value: number; rating: string; asOf: number };

const CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
const REDIS_KEY = "august:intel:fng";
const TTL_MS = 30 * 60_000;

// same standard UA as lib/markets.ts — CNN's dataviz endpoint rejects UA-less requests
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

// single-key in-process TTL cache (the cached() pattern collapsed to one entry)
let hit: { exp: number; data: FngReading } | null = null;

function isReading(x: unknown): x is FngReading {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.value === "number" && Number.isFinite(r.value) &&
    typeof r.rating === "string" && r.rating.length > 0 &&
    typeof r.asOf === "number" && Number.isFinite(r.asOf)
  );
}

async function fetchCnnFng(): Promise<FngReading> {
  const res = await fetch(CNN_URL, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`cnn ${res.status}`);
  const j: unknown = await res.json();
  const fg = (j as { fear_and_greed?: { score?: unknown; rating?: unknown; timestamp?: unknown } })
    ?.fear_and_greed;
  const raw = Number(fg?.score);
  const rating = String(fg?.rating ?? "").trim();
  if (!Number.isFinite(raw) || raw < 0 || raw > 100 || !rating) throw new Error("cnn bad payload");
  const ts = Date.parse(String(fg?.timestamp ?? ""));
  return { value: Math.round(raw), rating, asOf: Number.isFinite(ts) ? ts : Date.now() };
}

/** best-effort — a Redis outage must never fail the fng read */
async function writeStale(data: FngReading): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(REDIS_KEY, JSON.stringify(data));
  } catch {
    /* best-effort */
  }
}

async function readStale(): Promise<FngReading | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<string>(REDIS_KEY);
    if (!raw) return null;
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    return isReading(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * CNN equity Fear & Greed. Resolution order: fresh in-process hit → live CNN
 * fetch (also refreshes the Redis stale key) → stale in-process hit → Redis
 * stale value → null (callers hide the chip + gauge — never a fake neutral).
 */
export async function getEquityFng(): Promise<FngReading | null> {
  const now = Date.now();
  if (hit && hit.exp > now) return hit.data;
  try {
    const data = await fetchCnnFng();
    hit = { exp: now + TTL_MS, data };
    await writeStale(data);
    return data;
  } catch {
    if (hit) return hit.data; // stale in-process beats a Redis roundtrip
    return readStale();
  }
}
