"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import IntelPanel from "@/components/command/IntelPanel";

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const EMPTY = { type: "FeatureCollection" as const, features: [] };

export type GlobeTarget = {
  lat: number;
  lon: number;
  label: string;
  zoom?: number;
  key: number;
};

type Props = {
  active: boolean; // is the World surface the current screen? (only poll flights when so)
  flyTo: GlobeTarget | null;
};

// --- day/night terminator (computed from the sun, no data source) -----------
function subsolar(date: Date): { decl: number; lon: number } {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear =
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - yearStart) / 86400000;
  let decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  if (Math.abs(decl) < 1) decl = decl >= 0 ? 1 : -1; // avoid degenerate terminator at equinox
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lon = (((12 - utcHours) * 15 + 540) % 360) - 180;
  return { decl, lon };
}
function nightFeature(date: Date) {
  const { decl, lon: subLon } = subsolar(date);
  const tanDecl = Math.tan((decl * Math.PI) / 180);
  const coords: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 1) {
    const h = ((lon - subLon) * Math.PI) / 180;
    const lat = (Math.atan(-Math.cos(h) / tanDecl) * 180) / Math.PI;
    coords.push([lon, lat]);
  }
  const darkPole = decl > 0 ? -90 : 90;
  coords.push([180, darkPole], [-180, darkPole], coords[0]);
  return {
    type: "FeatureCollection" as const,
    features: [
      { type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [coords] }, properties: {} },
    ],
  };
}

// A small glowing aircraft glyph (canvas → map image), rotated by heading.
function planeImage(): ImageData {
  const s = 48;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  if (!ctx) return new ImageData(s, s);
  ctx.translate(s / 2, s / 2);
  ctx.shadowColor = "rgba(150,200,240,0.95)";
  ctx.shadowBlur = 7;
  ctx.fillStyle = "#d4e6f6";
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(13, 13);
  ctx.lineTo(0, 6);
  ctx.lineTo(-13, 13);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, s, s);
}

export default function CommandGlobe({ active, flyTo }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const readyRef = useRef(false);
  const activeRef = useRef(active);
  const targetRef = useRef<GlobeTarget | null>(flyTo);
  const loadFlightsRef = useRef<() => void>(() => {});

  const [aircraft, setAircraft] = useState<number | null>(null);
  const [quakes, setQuakes] = useState<number | null>(null);
  const [zulu, setZulu] = useState("");
  const [layers, setLayers] = useState({ flights: true, quakes: true, night: true });
  // LAYERS rail starts collapsed so the globe is unobstructed by default.
  const [layersOpen, setLayersOpen] = useState(false);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    targetRef.current = flyTo;
  }, [flyTo]);

  // ZULU clock
  useEffect(() => {
    const fmt = () => setZulu(new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
    fmt();
    const id = window.setInterval(fmt, 1000);
    return () => window.clearInterval(id);
  }, []);

  function flyToTarget(t: GlobeTarget) {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) return;
    const zoom = typeof t.zoom === "number" ? Math.max(0, Math.min(14, t.zoom)) : 5;
    map.flyTo({ center: [t.lon, t.lat], zoom, duration: 4200, curve: 1.42, essential: true });
    markerRef.current?.remove();
    const el = document.createElement("div");
    el.className = "aug-marker";
    const label = document.createElement("span");
    label.className = "aug-marker-label";
    label.textContent = t.label || "";
    const dot = document.createElement("span");
    dot.className = "aug-marker-dot";
    el.appendChild(label);
    el.appendChild(dot);
    markerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([t.lon, t.lat])
      .addTo(map);
  }

  // map setup (once)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = new maplibregl.Map({
      container: el,
      style: DARK_STYLE,
      center: [12, 24],
      zoom: 1.55,
      maxZoom: 14,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on("error", (e) => {
      const msg = (e && (e as { error?: { message?: string } }).error?.message) || "map error";
      console.error("[command]", msg);
    });

    const loadQuakes = async () => {
      try {
        const fc = await (await fetch("/api/quakes", { cache: "no-store" })).json();
        (mapRef.current?.getSource("quakes") as maplibregl.GeoJSONSource | undefined)?.setData(fc);
        setQuakes(typeof fc.count === "number" ? fc.count : (fc.features?.length ?? 0));
      } catch {
        /* keep last */
      }
    };
    const loadFlights = async () => {
      const m = mapRef.current;
      if (!m || !readyRef.current || document.hidden) return;
      try {
        let url = "/api/flights";
        try {
          const b = m.getBounds();
          const s = b.getSouth();
          const n = b.getNorth();
          const w = b.getWest();
          const e2 = b.getEast();
          if (
            [s, n, w, e2].every((x) => Number.isFinite(x)) &&
            n > s &&
            e2 > w &&
            n - s < 160 &&
            e2 - w < 340
          ) {
            url +=
              `?lamin=${Math.max(-90, s).toFixed(2)}&lomin=${Math.max(-180, w).toFixed(2)}` +
              `&lamax=${Math.min(90, n).toFixed(2)}&lomax=${Math.min(180, e2).toFixed(2)}`;
          }
        } catch {
          /* fall back to global */
        }
        const fc = await (await fetch(url, { cache: "no-store" })).json();
        (m.getSource("flights") as maplibregl.GeoJSONSource | undefined)?.setData(fc);
        setAircraft(typeof fc.count === "number" ? fc.count : (fc.features?.length ?? 0));
      } catch {
        /* keep last */
      }
    };
    loadFlightsRef.current = loadFlights;
    const updateNight = () => {
      (mapRef.current?.getSource("night") as maplibregl.GeoJSONSource | undefined)?.setData(
        nightFeature(new Date()),
      );
    };

    // Keep the map sized to its container — fixes the blank / stuck-400x300 canvas
    // when the container starts at 0 (off-screen deck surface) and grows later.
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);

    map.on("load", () => {
      // Globe projection + atmosphere — the cinematic limb glow (OSIRIS look). Cast
      // defensively so a types mismatch can never break the build.
      try {
        (map as unknown as { setProjection: (p: { type: string }) => void }).setProjection({
          type: "globe",
        });
      } catch {
        /* mercator fallback */
      }
      try {
        (map as unknown as { setSky: (s: Record<string, unknown>) => void }).setSky({
          "sky-color": "#070d18",
          "sky-horizon-blend": 0.5,
          "horizon-color": "#24405c",
          "horizon-fog-blend": 0.7,
          "fog-color": "#05080f",
          "fog-ground-blend": 0.4,
          "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 5, 0.5, 9, 0],
        });
      } catch {
        /* no atmosphere on this version */
      }

      if (!map.hasImage("plane")) map.addImage("plane", planeImage(), { pixelRatio: 2 });

      map.addSource("night", { type: "geojson", data: EMPTY });
      map.addSource("quakes", { type: "geojson", data: EMPTY });
      map.addSource("flights", { type: "geojson", data: EMPTY });

      map.addLayer({
        id: "night",
        type: "fill",
        source: "night",
        paint: { "fill-color": "#03050b", "fill-opacity": 0.5 },
      });
      map.addLayer({
        id: "quakes",
        type: "circle",
        source: "quakes",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 0, 3, 3, 7, 5, 16, 7, 30],
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "mag"],
            1,
            "#5fd0c0",
            3,
            "#e0c24a",
            5,
            "#e8836a",
            7,
            "#ff5a44",
          ],
          "circle-opacity": 0.7,
          "circle-blur": 0.45,
          "circle-stroke-width": 1.2,
          "circle-stroke-color": "#eaf2f8",
          "circle-stroke-opacity": 0.6,
        },
      });
      map.addLayer({
        id: "flights",
        type: "symbol",
        source: "flights",
        layout: {
          "icon-image": "plane",
          "icon-size": 0.5,
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": 0.95 },
      });

      readyRef.current = true;
      map.resize();
      updateNight();
      loadQuakes();
      if (activeRef.current) loadFlights();
      if (targetRef.current) flyToTarget(targetRef.current);
    });

    const quakeTimer = window.setInterval(loadQuakes, 5 * 60_000);
    const nightTimer = window.setInterval(updateNight, 60_000);
    let moveTimer = 0;
    const onMove = () => {
      if (!activeRef.current) return;
      window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(loadFlights, 500);
    };
    map.on("moveend", onMove);

    return () => {
      window.clearInterval(quakeTimer);
      window.clearInterval(nightTimer);
      window.clearTimeout(moveTimer);
      ro.disconnect();
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // fly when a new target arrives
  useEffect(() => {
    if (flyTo) flyToTarget(flyTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.key]);

  // when the surface becomes active: size the map and start polling flights
  useEffect(() => {
    if (!active) return;
    const kick = window.setTimeout(() => {
      mapRef.current?.resize();
      loadFlightsRef.current();
    }, 150);
    const poll = window.setInterval(() => loadFlightsRef.current(), 15_000);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(poll);
    };
  }, [active]);

  const toggle = (key: "flights" | "quakes" | "night") => {
    const map = mapRef.current;
    if (!map) return;
    const next = !layers[key];
    setLayers((s) => ({ ...s, [key]: next }));
    if (map.getLayer(key)) {
      map.setLayoutProperty(key, "visibility", next ? "visible" : "none");
    }
  };

  // One compact HUD line — only data that actually has a value (never a dangling
  // "—"). The layer count lives on the LAYERS chip and the wire count on the Intel
  // panel, so they aren't duplicated here.
  const hudStats: string[] = [];
  if (zulu) hudStats.push(zulu);
  if (aircraft != null && aircraft > 0) hudStats.push(`${aircraft.toLocaleString()} aircraft`);
  if (quakes != null) hudStats.push(`${quakes} quakes`);

  return (
    <div className="command-surface">
      <div ref={containerRef} className="command-map" />
      <div className="command-vignette" aria-hidden />

      {/* top HUD — one compact line, only live data tokens */}
      {hudStats.length > 0 ? (
        <div className="command-hud">
          {hudStats.flatMap((s, i) =>
            i === 0
              ? [
                  <span key={`h${i}`} className="hud">
                    {s}
                  </span>,
                ]
              : [
                  <span key={`s${i}`} className="command-hud-sep">
                    ·
                  </span>,
                  <span key={`h${i}`} className="hud">
                    {s}
                  </span>,
                ],
          )}
        </div>
      ) : null}

      {/* reset view — back to the home framing (drag-rotate / scroll-zoom are native) */}
      <button
        type="button"
        className="command-reset"
        title="Reset view"
        onClick={() => {
          mapRef.current?.flyTo({
            center: [12, 24],
            zoom: 1.55,
            bearing: 0,
            pitch: 0,
            duration: 1400,
            essential: true,
          });
        }}
      >
        ⌖ RESET
      </button>

      {/* left layer toggles — collapsed to a small chip by default; tap to reveal */}
      <div className={`command-layers${layersOpen ? " open" : ""}`}>
        <button
          type="button"
          className="command-layers-head"
          onClick={() => setLayersOpen((o) => !o)}
          aria-expanded={layersOpen}
          title={layersOpen ? "Hide layers" : "Show layers"}
        >
          <span>Layers</span>
          <span className="command-layers-chev" aria-hidden>
            {layersOpen ? "▾" : "▸"}
          </span>
        </button>
        {layersOpen ? (
          <div className="command-layers-list">
            {(
              [
                ["flights", "Flights"],
                ["quakes", "Quakes"],
                ["night", "Day / Night"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`layer-toggle${layers[key] ? " on" : ""}`}
                onClick={() => toggle(key)}
              >
                <span className="layer-dot" />
                <span className="layer-name">{label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* world news wires + AUGUST's synthesis, docked right (collapsible) */}
      <IntelPanel />
    </div>
  );
}
