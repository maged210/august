// Command surface intelligence feeds — SERVER ONLY. Free sources, cached so we
// never hammer the free APIs.
//   flights  OpenSky      anonymous (sparse) by default; OAuth2 client credentials
//            (OPENSKY_CLIENT_ID + OPENSKY_CLIENT_SECRET) to densify if present.
//   quakes   USGS GeoJSON keyless.
// (Day/night is computed client-side from the sun position — no data source.)

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

type Entry = { exp: number; data: unknown };
const cache = new Map<string, Entry>();
async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.data as T;
  try {
    const data = await fetcher();
    cache.set(key, { exp: now + ttlMs, data });
    return data;
  } catch (e) {
    if (hit) return hit.data as T; // serve stale on error
    throw e;
  }
}

// --- OpenSky OAuth2 token (cached) — optional, densifies the feed -----------
let _token: { token: string; exp: number } | null = null;
async function openskyToken(): Promise<string | null> {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (_token && _token.exp > Date.now()) return _token.token;
  try {
    const res = await fetch(
      "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: id,
          client_secret: secret,
        }),
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const j = await res.json();
    if (!j?.access_token) return null;
    _token = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 1800) * 1000 - 60_000 };
    return _token.token;
  } catch {
    return null;
  }
}

// --- flights (GeoJSON), optional viewport bbox ------------------------------
export type BBox = { lamin: number; lomin: number; lamax: number; lomax: number };
export type GeoJSON = { type: "FeatureCollection"; features: unknown[] };
export type Flights = GeoJSON & { count: number; source: string };

const FLIGHT_CAP = 3000;
let lastFlightCount: number | null = null;

const r1 = (n: number) => Math.round(n);

export async function getFlights(bbox?: BBox): Promise<Flights> {
  const key = bbox
    ? `flights:${r1(bbox.lamin)},${r1(bbox.lomin)},${r1(bbox.lamax)},${r1(bbox.lomax)}`
    : "flights:global";
  return cached(key, 15_000, async () => {
    const token = await openskyToken();
    const params = bbox
      ? `?lamin=${bbox.lamin}&lomin=${bbox.lomin}&lamax=${bbox.lamax}&lomax=${bbox.lomax}`
      : "";
    const res = await fetch(`https://opensky-network.org/api/states/all${params}`, {
      headers: { "User-Agent": UA, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: "no-store",
    });
    console.log(`[flights] OpenSky ${res.status} (${token ? "authed" : "anon"}, ${bbox ? "bbox" : "global"})`);
    if (!res.ok) throw new Error(`${res.status}`);
    const j = await res.json();
    const states: unknown[] = Array.isArray(j?.states) ? j.states : [];
    console.log(`[flights] OpenSky states=${states.length} -> rendered (cap ${FLIGHT_CAP})`);
    const features: unknown[] = [];
    for (const raw of states) {
      const s = raw as (number | string | boolean | null)[];
      const lon = s[5] as number | null;
      const lat = s[6] as number | null;
      if (lon == null || lat == null || s[8] === true) continue; // skip null pos / on-ground
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          callsign: String(s[1] || "").trim(),
          heading: typeof s[10] === "number" ? s[10] : 0,
          altitude: typeof s[7] === "number" ? Math.round(s[7]) : 0,
          velocity: typeof s[9] === "number" ? Math.round(s[9]) : 0,
          country: String(s[2] || ""),
        },
      });
      if (features.length >= FLIGHT_CAP) break;
    }
    // Only a non-empty fetch updates the shared count. OpenSky's anon tier returns
    // 200 with empty `states` when rate-limited — writing that 0 made the Brief say
    // "0 aircraft tracked" while the HUD still showed the last real count.
    if (features.length > 0) lastFlightCount = features.length;
    return { type: "FeatureCollection", features, count: features.length, source: token ? "opensky-auth" : "opensky-anon" };
  });
}

// --- quakes (GeoJSON), USGS all-day -----------------------------------------
export type Quakes = GeoJSON & { count: number; max: { mag: number; place: string } | null };
export async function getQuakes(): Promise<Quakes> {
  return cached("quakes", 5 * 60_000, async () => {
    const res = await fetch(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
      { headers: { "User-Agent": UA }, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const j = await res.json();
    const raw: unknown[] = Array.isArray(j?.features) ? j.features : [];
    let max: { mag: number; place: string } | null = null;
    const features = raw.map((f) => {
      const ff = f as { geometry: unknown; properties: { mag?: number; place?: string; time?: number } };
      const mag = Number(ff.properties?.mag) || 0;
      const place = String(ff.properties?.place || "");
      if (!max || mag > max.mag) max = { mag, place };
      return {
        type: "Feature",
        geometry: ff.geometry,
        properties: { mag, place, time: Number(ff.properties?.time) || 0 },
      };
    });
    return { type: "FeatureCollection", features, count: features.length, max };
  });
}

// --- summary for the Brief + AUGUST's chat prompt ---------------------------
function shortPlace(p: string): string {
  return (p || "").replace(/^\d+\s*km\s+[NSEW]+\s+of\s+/i, "near ").slice(0, 48);
}

export async function getCommandSummary(): Promise<{
  aircraft: number | null;
  quakes: number;
  maxQuake: { mag: number; place: string } | null;
  bigQuake: { mag: number; place: string; time: number } | null;
  briefLine: string;
  snapshot: string;
}> {
  const q = await getQuakes().catch(() => ({ count: 0, max: null }) as Quakes);
  const aircraft = lastFlightCount; // live count from the globe's last fetch (null until opened)
  const max = q.max;
  // Newest big quake (M ≥ 6) WITH its time — `max` alone carries none, and the
  // client-side "World has something new" pull needs newer-than-last-visit.
  // Same payload, no new endpoint.
  let bigQuake: { mag: number; place: string; time: number } | null = null;
  const feats: unknown[] = Array.isArray(q.features) ? q.features : [];
  for (const f of feats) {
    const p = (f as { properties?: { mag?: number; place?: string; time?: number } }).properties;
    const mag = Number(p?.mag) || 0;
    if (mag < 6) continue;
    const time = Number(p?.time) || 0;
    if (!bigQuake || time > bigQuake.time) bigQuake = { mag, place: String(p?.place || ""), time };
  }
  const planes = aircraft != null ? `${aircraft.toLocaleString()} aircraft tracked` : "live flights on the globe";
  const big = max ? `, biggest M${max.mag.toFixed(1)} ${shortPlace(max.place)}` : "";
  const briefLine = `${q.count} quakes in 24h${big}; ${planes}.`;
  const snapshot =
    `\n\n---\nCOMMAND GLOBE (live intelligence surface):\n` +
    `It shows live aircraft (OpenSky)${aircraft != null ? ` — ${aircraft.toLocaleString()} currently tracked` : ""}, ` +
    `recent earthquakes (USGS) — ${q.count} in the last 24h${max ? `, largest M${max.mag.toFixed(1)} near ${max.place}` : ""}, ` +
    `and the day/night terminator. When he asks what's on the globe or about flights/quakes, answer from these. ` +
    `He can say "show me flights over Europe" and you should call look_closer to fly the globe there.`;
  return { aircraft, quakes: q.count, maxQuake: max, bigQuake, briefLine, snapshot };
}

export async function getCommandSnapshot(): Promise<string> {
  try {
    return (await getCommandSummary()).snapshot || "";
  } catch {
    return "";
  }
}
