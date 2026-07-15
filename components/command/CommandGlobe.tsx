"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import IntelPanel from "@/components/command/IntelPanel";

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
// CARTO's light sibling of dark-matter — the same keyless basemap family.
const LIGHT_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const EMPTY = { type: "FeatureCollection" as const, features: [] };

// The World follows the app theme: "day" mirrors the [data-theme="light"]
// .command-surface chrome in globals.css; "dark" serves data-theme dark AND
// batman (the globe's dark skin — exactly the pre-theming look).
type WorldTheme = "dark" | "day";
function readWorldTheme(): WorldTheme {
  return typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light"
    ? "day"
    : "dark";
}

// Per-theme scene palette for everything painted ON the basemap. Day values are
// derived from the app's warm-paper family (landing paper/ink + the intel desk's
// DAY DESK ink ramps) — semantic meanings hold: quakes stay a cool→warning ramp,
// aircraft stay steel, the night shade stays "darker than the map". Dark values
// are the exact pre-theming literals.
const SCENE = {
  dark: {
    style: DARK_STYLE,
    sky: {
      "sky-color": "#070d18",
      "sky-horizon-blend": 0.5,
      "horizon-color": "#24405c",
      "horizon-fog-blend": 0.7,
      "fog-color": "#05080f",
      "fog-ground-blend": 0.4,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 5, 0.5, 9, 0],
    } as Record<string, unknown>,
    night: { color: "#03050b", opacity: 0.5 },
    quakeRamp: ["#5fd0c0", "#e0c24a", "#e8836a", "#ff5a44"],
    quakeStroke: { color: "#eaf2f8", opacity: 0.6 },
    plane: { fill: "#d4e6f6", glow: "rgba(150,200,240,0.95)" },
  },
  day: {
    style: LIGHT_STYLE,
    sky: {
      "sky-color": "#b9cedd",
      "sky-horizon-blend": 0.5,
      "horizon-color": "#e9edee",
      "horizon-fog-blend": 0.7,
      "fog-color": "#f0efe9",
      "fog-ground-blend": 0.4,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 5, 0.5, 9, 0],
    } as Record<string, unknown>,
    // the night hemisphere reads as a soft ink dusk over paper
    night: { color: "#232019", opacity: 0.24 },
    // deepened ink hues keep the low→high warning ramp legible on positron
    quakeRamp: ["#2e6b68", "#8a6420", "#b0503e", "#c0361c"],
    quakeStroke: { color: "#f7f6f2", opacity: 0.75 },
    // steel ink glyph, glow softened to an ink halo
    plane: { fill: "#33506b", glow: "rgba(63,86,112,0.45)" },
  },
} as const;

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
function planeImage(theme: WorldTheme): ImageData {
  const s = 48;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  if (!ctx) return new ImageData(s, s);
  ctx.translate(s / 2, s / 2);
  ctx.shadowColor = SCENE[theme].plane.glow;
  ctx.shadowBlur = 7;
  ctx.fillStyle = SCENE[theme].plane.fill;
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(13, 13);
  ctx.lineTo(0, 6);
  ctx.lineTo(-13, 13);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, s, s);
}

// --- LIVE rail — curated 24/7 broadcaster streams -----------------------------
// Channel IDs verified against each channel page's canonical og:url /
// RSS channel_id link (youtube.com/@handle, 2026-07). The durable
// /embed/live_stream?channel=<ID> form always points at whatever stream the
// channel is currently running; when a broadcaster is off-air YouTube renders
// its own notice inside the iframe — honest, and the tile keeps working.
const LIVE_CHANNELS = [
  { id: "UCNye-wNBqNL5ZzHSJj3l8Bg", name: "Al Jazeera English" },
  { id: "UCoMdktPbSTixAyNGwb-UYkQ", name: "Sky News" },
  { id: "UCBi2mrWuNuyYy4gbM6fU18Q", name: "ABC News Live" },
  { id: "UCIALMKvObZNtJ6AmdCLP7Lg", name: "Bloomberg Television" },
  { id: "UCknLrEdhRCp1aegoMqRaCZg", name: "DW News" },
] as const;

// Collapsed by default to a small LIVE tab pinned just above the LAYERS chip;
// expanding flies a panel UPWARD into the empty upper-left band (the tab never
// moves under the pointer). Perf discipline: at rest a tile is a styled
// poster — NO YouTube iframe, NO thumbnail fetch, zero network — and the
// iframe (muted autoplay, the privacy-friendly nocookie host) exists in the
// DOM only while its tile is the one playing; `playing` is a single id, so
// loading a second stream unmounts the first, and the player renders as a
// NON-scrolling block below the poster list so the video is never clipped by
// the list's own scroll. State lives HERE and the component is memo'd with no
// props, so neither the per-second HUD clock re-render of CommandGlobe nor
// any rail interaction ever touches the map (the WebGL loop is unaffected).
const LiveRail = memo(function LiveRail() {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const playingChannel = LIVE_CHANNELS.find((ch) => ch.id === playing) ?? null;

  return (
    <div className={`command-live${open ? " open" : ""}`}>
      {open ? (
        <div className="command-live-panel">
          <div className="command-live-list">
            {LIVE_CHANNELS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                className={`live-tile${playing === ch.id ? " on" : ""}`}
                onClick={() => setPlaying((p) => (p === ch.id ? null : ch.id))}
                title={playing === ch.id ? `Unload ${ch.name}` : `Play ${ch.name} (muted)`}
              >
                <span className="live-tile-dot" aria-hidden />
                <span className="live-tile-name">{ch.name}</span>
                <span className="live-tile-play" aria-hidden>
                  {playing === ch.id ? "◼" : "▸"}
                </span>
              </button>
            ))}
          </div>
          {playingChannel ? (
            <div className="live-player">
              <div className="live-player-bar">
                <span className="live-tile-name">{playingChannel.name}</span>
                <button
                  type="button"
                  className="live-player-x"
                  onClick={() => setPlaying(null)}
                  aria-label={`Unload ${playingChannel.name}`}
                  title="Unload stream"
                >
                  ✕
                </button>
              </div>
              <div className="live-player-frame">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/live_stream?channel=${playingChannel.id}&autoplay=1&mute=1`}
                  title={`${playingChannel.name} — live`}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            </div>
          ) : null}
          <div className="command-live-note">streams provided by their broadcasters</div>
        </div>
      ) : null}
      <button
        type="button"
        className="command-live-head"
        onClick={() => {
          setOpen((o) => !o);
          setPlaying(null); // collapsing unloads any playing stream with it
        }}
        aria-expanded={open}
        title={open ? "Hide live streams" : "Show live streams"}
      >
        <span className="command-live-glyph" aria-hidden />
        <span>Live</span>
        <span className="command-live-chev" aria-hidden>
          {open ? "▾" : "▴"}
        </span>
      </button>
    </div>
  );
});

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

  // Theme plumbing: worldTheme drives the basemap; the refs let the style.load
  // scene rebuild read the current theme / toggles / last data without closing
  // over state. (Loaded ssr:false, so readWorldTheme sees the real attribute.)
  const [worldTheme, setWorldTheme] = useState<WorldTheme>(readWorldTheme);
  const themeRef = useRef(worldTheme);
  const appliedThemeRef = useRef(worldTheme);
  const layersRef = useRef(layers);
  const quakesFcRef = useRef<FeatureCollection | null>(null);
  const flightsFcRef = useRef<FeatureCollection | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    targetRef.current = flyTo;
  }, [flyTo]);

  // Follow live theme cycling: watch data-theme on <html>, exactly like
  // TradingViewIntelChart does (layout.tsx stamps it pre-hydration; the home
  // shell's toggle re-stamps it).
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setWorldTheme(readWorldTheme());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  // ZULU clock
  useEffect(() => {
    // time-only ("18:23:45Z") — the full ISO date is chrome noise in a HUD
    const fmt = () => setZulu(new Date().toISOString().slice(11, 19) + "Z");
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
      style: SCENE[themeRef.current].style,
      center: [12, 24],
      zoom: 1.55,
      maxZoom: 14,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    appliedThemeRef.current = themeRef.current;

    map.on("error", (e) => {
      const msg = (e && (e as { error?: { message?: string } }).error?.message) || "map error";
      console.error("[command]", msg);
    });

    const loadQuakes = async () => {
      try {
        const fc = await (await fetch("/api/quakes", { cache: "no-store" })).json();
        quakesFcRef.current = fc; // kept so a theme swap can reseed the fresh style
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
        flightsFcRef.current = fc; // kept so a theme swap can reseed the fresh style
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

    // Everything painted ON the basemap lives here, keyed by the current theme.
    // Runs on the INITIAL style load and again after every setStyle (a theme
    // swap), because setStyle drops all runtime sources/layers/images — the
    // idempotence guards make the repeat calls safe either way.
    const buildScene = () => {
      const m = mapRef.current;
      if (!m) return;
      const scene = SCENE[themeRef.current];
      // Globe projection + atmosphere — the cinematic limb glow (OSIRIS look).
      // Both are style-scoped, so they must be re-applied per style load. Cast
      // defensively so a types mismatch can never break the build.
      try {
        (m as unknown as { setProjection: (p: { type: string }) => void }).setProjection({
          type: "globe",
        });
      } catch {
        /* mercator fallback */
      }
      try {
        (m as unknown as { setSky: (s: Record<string, unknown>) => void }).setSky(scene.sky);
      } catch {
        /* no atmosphere on this version */
      }

      // The glyph color is theme-baked, so replace rather than keep a stale one.
      if (m.hasImage("plane")) m.removeImage("plane");
      m.addImage("plane", planeImage(themeRef.current), { pixelRatio: 2 });

      // Reseed sources from the last-known data so a theme swap repaints
      // instantly instead of waiting out the next poll.
      if (!m.getSource("night"))
        m.addSource("night", { type: "geojson", data: nightFeature(new Date()) });
      if (!m.getSource("quakes"))
        m.addSource("quakes", { type: "geojson", data: quakesFcRef.current ?? EMPTY });
      if (!m.getSource("flights"))
        m.addSource("flights", { type: "geojson", data: flightsFcRef.current ?? EMPTY });

      if (!m.getLayer("night"))
        m.addLayer({
          id: "night",
          type: "fill",
          source: "night",
          paint: { "fill-color": scene.night.color, "fill-opacity": scene.night.opacity },
        });
      if (!m.getLayer("quakes"))
        m.addLayer({
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
              scene.quakeRamp[0],
              3,
              scene.quakeRamp[1],
              5,
              scene.quakeRamp[2],
              7,
              scene.quakeRamp[3],
            ],
            "circle-opacity": 0.7,
            "circle-blur": 0.45,
            "circle-stroke-width": 1.2,
            "circle-stroke-color": scene.quakeStroke.color,
            "circle-stroke-opacity": scene.quakeStroke.opacity,
          },
        });
      if (!m.getLayer("flights"))
        m.addLayer({
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

      // A fresh style resets visibility — restore the user's layer toggles.
      for (const key of ["flights", "quakes", "night"] as const) {
        if (m.getLayer(key)) {
          m.setLayoutProperty(key, "visibility", layersRef.current[key] ? "visible" : "none");
        }
      }
    };
    // "style.load" fires on the initial style AND after every setStyle, which is
    // exactly the rebuild hook we need — maplibre's typed event map omits it
    // (styledata is the typed cousin but fires on every style mutation), so cast
    // like the setSky/setProjection shims above.
    (map as unknown as { on: (t: string, cb: () => void) => void }).on("style.load", buildScene);

    map.on("load", () => {
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

  // Live theme flip → swap the basemap with setStyle rather than remounting the
  // map keyed by theme: setStyle preserves the camera, any in-flight flyTo and
  // the DOM marker, where a remount would snap the globe back to the home
  // framing and refetch everything. setStyle drops all runtime sources/layers/
  // images, so the style.load handler above rebuilds the scene from the
  // last-known data refs the moment the new style is in.
  useEffect(() => {
    themeRef.current = worldTheme;
    const map = mapRef.current;
    if (!map || appliedThemeRef.current === worldTheme) return;
    appliedThemeRef.current = worldTheme;
    map.setStyle(SCENE[worldTheme].style);
  }, [worldTheme]);

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
    const nextLayers = { ...layers, [key]: next };
    layersRef.current = nextLayers; // mirrored so a theme-swap rebuild restores it
    setLayers(nextLayers);
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

      {/* LIVE broadcaster streams — collapsed tab clustered above LAYERS (left) */}
      <LiveRail />

      {/* world news wires + AUGUST's synthesis, docked right (collapsible) */}
      <IntelPanel />
    </div>
  );
}
