/**
 * build-us-map.mjs — BUILD-TIME generator for the /intel US map panel
 * (SPEC-wiring §2.8, SPEC-desktop §2.5d). Run MANUALLY:
 *
 *   node scripts/build-us-map.mjs
 *
 * It is NOT part of `next build` — the outputs are committed so the app has
 * zero runtime dependency on d3-geo / us-atlas and zero runtime network.
 *
 * Writes:
 *   lib/intel/us-states-paths.json — { viewBox: "0 0 300 185", paths: string[] }
 *     geoAlbersUsa state outlines fitted to the design's 300×185 viewBox
 *     (fitExtent [[6,6],[294,179]] — exactly the design's fit).
 *   lib/intel/hq.json — Record<ticker, { x, y, city } | { city, nonUS: true }>
 *     PROJECTED x/y for each hand-curated ticker HQ, using the SAME fitted
 *     projection, so the app never has to re-derive projection constants.
 *
 * Curation rules (the law for this file):
 *   - Hand-curated only. NEVER geocode or guess a ticker's HQ. A ticker
 *     missing from HQ simply gets no dot on the map — that is the designed
 *     behavior, not an error.
 *   - Index/ETF tickers (SPY, QQQ, IWM, …) have no HQ concept — leave them
 *     out entirely.
 *   - HQs outside the geoAlbersUsa composite (lower 48 + AK + HI — Puerto
 *     Rico is NOT included) are marked { nonUS: true } and get no x/y; the
 *     panel lists them in the one-line footer instead.
 *   - To add a ticker: add one line to HQ below with [lat, lon] (from the
 *     company's investor-relations page), re-run this script, commit both
 *     JSONs.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── hand-curated ticker → HQ table (lat, lon) ────────────────────────────────
// nonUS entries carry NO coordinates on purpose — they must never be projected.
/** @type {Record<string, { city: string, lat?: number, lon?: number, nonUS?: true }>} */
const HQ = {
  AAPL: { city: "Cupertino CA", lat: 37.323, lon: -122.032 },
  UBER: { city: "San Francisco CA", lat: 37.775, lon: -122.418 },
  TEM: { city: "Chicago IL", lat: 41.881, lon: -87.623 },
  WEN: { city: "Dublin OH", lat: 40.099, lon: -83.114 },
  SHOP: { city: "Ottawa CA", nonUS: true },
  BABA: { city: "Hangzhou CN", nonUS: true },
  FCEL: { city: "Danbury CT", lat: 41.394, lon: -73.454 },
  // San Juan PR is a US territory but sits OUTSIDE the geoAlbersUsa composite
  // (lower 48 + AK + HI only) — off-map, so it rides the nonUS footer path.
  RCAT: { city: "San Juan PR", nonUS: true },
  UMAC: { city: "Orlando FL", lat: 28.538, lon: -81.379 },
  CRM: { city: "San Francisco CA", lat: 37.789, lon: -122.397 },
  GXO: { city: "Greenwich CT", lat: 41.026, lon: -73.628 },
  CELH: { city: "Boca Raton FL", lat: 26.359, lon: -80.083 },
  AVAV: { city: "Arlington VA", lat: 38.881, lon: -77.104 },
  INTC: { city: "Santa Clara CA", lat: 37.354, lon: -121.953 },
  CAR: { city: "Parsippany NJ", lat: 40.858, lon: -74.426 },
  TSLA: { city: "Austin TX", lat: 30.223, lon: -97.617 },
  NVDA: { city: "Santa Clara CA", lat: 37.371, lon: -121.968 },
  MSFT: { city: "Redmond WA", lat: 47.644, lon: -122.13 },
  AMZN: { city: "Seattle WA", lat: 47.615, lon: -122.338 },
  META: { city: "Menlo Park CA", lat: 37.485, lon: -122.148 },
  GOOGL: { city: "Mountain View CA", lat: 37.422, lon: -122.084 },
  AMD: { city: "Santa Clara CA", lat: 37.388, lon: -121.964 },
};

// ── load us-atlas topology from node_modules (never a CDN) ───────────────────
const topo = JSON.parse(readFileSync(require.resolve("us-atlas/states-10m.json"), "utf8"));
const fc = feature(topo, topo.objects.states);

// ── fit the design projection: geoAlbersUsa into the 300×185 viewBox ─────────
const projection = geoAlbersUsa().fitExtent([[6, 6], [294, 179]], fc);
// 0.1px precision is plenty at 300×185 and keeps the committed JSON small
const path = geoPath(projection).digits(1);

// One path string per state. geoAlbersUsa returns null geometry for entities
// outside its composite (PR, VI, GU, MP, AS in states-10m) — drop those.
const paths = fc.features
  .map((f) => path(f))
  .filter((d) => typeof d === "string" && d.length > 0);

if (paths.length !== 51) {
  // 50 states + DC. Anything else means the atlas or projection changed.
  console.error(`Expected 51 projected outlines (50 states + DC), got ${paths.length}`);
  process.exit(1);
}

// ── project the HQ table with the SAME fitted projection ─────────────────────
/** @type {Record<string, { x: number, y: number, city: string } | { city: string, nonUS: true }>} */
const hqOut = {};
for (const [ticker, e] of Object.entries(HQ)) {
  if (e.nonUS) {
    hqOut[ticker] = { city: e.city, nonUS: true };
    continue;
  }
  const p = projection([e.lon, e.lat]);
  if (!p) {
    // A curated "US" coordinate that geoAlbersUsa cannot place is a curation
    // bug — fail loudly instead of silently dropping the dot.
    console.error(`${ticker} (${e.city}): [${e.lat}, ${e.lon}] falls outside geoAlbersUsa — fix the entry`);
    process.exit(1);
  }
  hqOut[ticker] = { x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10, city: e.city };
}

// ── write committed outputs ──────────────────────────────────────────────────
const outDir = join(root, "lib", "intel");
mkdirSync(outDir, { recursive: true });

const statesFile = join(outDir, "us-states-paths.json");
writeFileSync(statesFile, JSON.stringify({ viewBox: "0 0 300 185", paths }));

const hqFile = join(outDir, "hq.json");
writeFileSync(hqFile, JSON.stringify(hqOut, null, 2) + "\n");

const kb = (f) => (readFileSync(f).length / 1024).toFixed(1) + " KB";
console.log(`us-states-paths.json — ${paths.length} outlines, ${kb(statesFile)}`);
console.log(`hq.json — ${Object.keys(hqOut).length} tickers (${Object.values(hqOut).filter((e) => "nonUS" in e).length} non-US), ${kb(hqFile)}`);
