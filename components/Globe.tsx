"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// A dark "earth in space" style: black background + a darkened, desaturated
// satellite raster (Esri World Imagery — free, keyless, CORS-enabled). No symbol
// layers, so no glyphs/fonts needed. Draped on the globe it reads as a real,
// moody earth floating in the dark.
const SPACE_STYLE = {
  version: 8 as const,
  sources: {
    "esri-imagery": {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [
    { id: "space", type: "background" as const, paint: { "background-color": "#05060a" } },
    {
      id: "earth",
      type: "raster" as const,
      source: "esri-imagery",
      paint: {
        "raster-saturation": -0.45, // toward grayscale
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.6, // darken the daylight imagery
        "raster-contrast": 0.05,
      },
    },
  ],
};

export type GlobeTarget = {
  lat: number;
  lon: number;
  label: string;
  zoom?: number;
  key: number; // nonce so repeated requests to the same place still fly
};

type GlobeProps = {
  visible: boolean;
  target: GlobeTarget | null;
  onClose: () => void;
};

export default function Globe({ visible, target, onClose }: GlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const readyRef = useRef(false);
  const latestTargetRef = useRef<GlobeTarget | null>(target);

  useEffect(() => {
    latestTargetRef.current = target;
  }, [target]);

  function flyTo(t: GlobeTarget) {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) return;
    const zoom =
      typeof t.zoom === "number" && Number.isFinite(t.zoom)
        ? Math.max(0, Math.min(16, t.zoom))
        : 8;

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

  // Lazily create the map the first time the globe is shown.
  useEffect(() => {
    if (!visible || mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SPACE_STYLE,
      center: [10, 25],
      zoom: 1.1,
      minZoom: 0,
      maxZoom: 16,
      dragRotate: true,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    // Surface any tile/style failures.
    map.on("error", (e) => {
      const msg =
        (e && (e as { error?: { message?: string } }).error?.message) || "unknown map error";
      console.error("[globe] map error:", msg);
    });

    map.on("load", () => {
      // Switch to the 3D globe sphere (MapLibre v5). Defensive call keeps it
      // tolerant across versions.
      try {
        (map as unknown as { setProjection: (p: { type: string }) => void }).setProjection({
          type: "globe",
        });
      } catch (err) {
        console.error("[globe] setProjection failed:", err);
      }
      readyRef.current = true;
      map.resize(); // the container may have been hidden when created
      if (latestTargetRef.current) flyTo(latestTargetRef.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Fly whenever a new target arrives (after the map is ready).
  useEffect(() => {
    if (target) flyTo(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key]);

  // Resize once the overlay is shown (it mounts hidden / zero-painted).
  useEffect(() => {
    if (!visible || !mapRef.current) return;
    const a = window.setTimeout(() => mapRef.current?.resize(), 80);
    const b = window.setTimeout(() => mapRef.current?.resize(), 760); // after the fade-in
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [visible]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      markerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className={`globe-overlay${visible ? " globe-visible" : ""}`} aria-hidden={!visible}>
      <div ref={containerRef} className="globe-map" style={{ width: "100%", height: "100%" }} />
      <div className="globe-vignette" aria-hidden />
      <button type="button" className="globe-close" onClick={onClose} aria-label="Close map">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  );
}
