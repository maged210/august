"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Mood } from "@/lib/tools";

export type AugustState = "boot" | "idle" | "listening" | "thinking" | "speaking";
export type Theme = "dark" | "light" | "batman";
export type { Mood };

type Props = {
  state: AugustState;
  /** 0..1 live audio level — mic RMS while listening, TTS envelope while speaking. */
  amplitudeRef: React.MutableRefObject<number>;
  theme?: Theme;
  /** Accent mood — re-temperatures the orb's light rig (see MOOD_LIGHT). */
  mood?: Mood;
  /**
   * Override the orb's on-screen radius as a fraction of min(container w, h).
   * The home landing mounts the canvas in a small fixed square around the
   * design's 190px orb circle and needs the sphere to fill it; the default
   * keeps the original full-surface presence sizing (0.18, 0.13 compact).
   */
  orbFraction?: number;
};

// Per-theme look, tuned to the home design (docs/design/AUGUST Home.dc.html):
// the sphere stays a glossy near-black everywhere; the energy is warm gold
// (#C9A96A / #E8C27A family) — luminous on the night stage (additive), gold
// ink on the day's off-white stage (normal blending). Batman keeps its own
// searchlight-gold signature untouched.
const LOOK = {
  // NIGHT (design applyTheme() night values): warm gold light on near-black.
  // These intensities are the gold palette's own tuning — the earlier "+15-20%
  // brightness pass" numbers were tuned against the retired steel palette and
  // would over-drive gold, which already reads hotter. ringOpacity is carried
  // over from that pass (the rings are new here). Tune HERE, not inline.
  dark: {
    sphere: 0x12100c,
    rim: new THREE.Color(0xe8c27a),
    corona: new THREE.Color(0xc9a96a),
    glow: new THREE.Color(0x8a744a),
    additive: true,
    rimIntensity: 1.0,
    glowOpacity: 0.45,
    coronaOpacity: 0.52,
    ringOpacity: 0.55,
    envIntensity: 1.0,
    exposure: 1.12,
  },
  // DAY: dark warm sphere on the off-white stage, corona/rim as dark-gold ink
  // (normal blending — additive gold would wash out against #F5F4F1).
  light: {
    sphere: 0x16130e,
    rim: new THREE.Color(0xa2823f),
    corona: new THREE.Color(0x8b6f3e),
    glow: new THREE.Color(0xc9a96a),
    additive: false,
    rimIntensity: 0.95,
    glowOpacity: 0.2,
    coronaOpacity: 0.45,
    ringOpacity: 0.5,
    envIntensity: 1.2,
    exposure: 1.0,
  },
  // Gotham: the same dark-stage physics with the energy in signal gold —
  // a searchlight against black, slightly dimmer than the steel look.
  batman: {
    sphere: 0x0a0a0c,
    rim: new THREE.Color(0xe8d08a),
    corona: new THREE.Color(0xd6b25a),
    glow: new THREE.Color(0xa8905e),
    additive: true,
    rimIntensity: 0.95,
    glowOpacity: 0.45,
    coronaOpacity: 0.5,
    ringOpacity: 0.5, // Gotham rides a hair under the night rings, per its dimmer brief
    envIntensity: 1.0,
    exposure: 1.1,
  },
} as const;

// --- Mood lighting matrix ------------------------------------------------------
// The mood never touches the orb's body (the sphere stays the same glossy
// near-black everywhere) — it re-temperatures the LIGHT playing over it: the
// key/fill lights, the rim + ring tint, the corona filaments, the halo, and the
// studio-environment blobs the gloss reflects. One entry per mood; rim/corona/
// glow come per theme (luminous on the dark stage, ink on the light one), and
// STEEL is the reference rig. Rather than repeating LOOK's rim/corona/glow here
// and hoping the two stay in lock-step, applyLook reads steel's straight FROM
// LOOK — so LOOK is the single source of truth for the default mood and steel's
// dark/light triplets below are inert reference values (the pre-gold steel
// palette, kept for provenance). Only ember/phosphor/graphite drive colour from
// this table. env* are the equirect studio colours: the ambient top of the
// gradient, then "r,g,b" strings for the key blob core, its mid falloff, the
// wide wash, and the low counter-fill blob. "energy" scales corona/halo
// presence — graphite runs a touch dimmer, per its near-mono brief.
const MOOD_LIGHT: Record<
  Mood,
  {
    key: number; // key light — the specular shaping
    fill: number; // counter-fill light — the shadow-side trace
    dark: { rim: number; corona: number; glow: number };
    light: { rim: number; corona: number; glow: number };
    envTop: string;
    envKey: string;
    envMid: string;
    envWash: string;
    envFill: string;
    energy: number;
  }
> = {
  steel: {
    key: 0xdfe8f2,
    fill: 0x6e8ca8,
    dark: { rim: 0x9fc3e8, corona: 0x8fb6dc, glow: 0x6e8ca8 },
    light: { rim: 0x2b3a4c, corona: 0x39414b, glow: 0x2a3340 },
    envTop: "#222d3b",
    envKey: "232,242,252",
    envMid: "186,210,234",
    envWash: "150,178,206",
    envFill: "120,150,182",
    energy: 1,
  },
  ember: {
    // Warm workshop gold — copper-leaning, never the semantic catalyst amber.
    key: 0xf2e6d0,
    fill: 0xc08d5f,
    dark: { rim: 0xe8c69a, corona: 0xd9b07f, glow: 0xc08d5f },
    light: { rim: 0x4a3a26, corona: 0x474033, glow: 0x3b3226 },
    envTop: "#31281c",
    envKey: "252,240,222",
    envMid: "232,206,166",
    envWash: "204,176,136",
    envFill: "178,144,102",
    energy: 1,
  },
  phosphor: {
    // Muted CRT phosphor — leaf green, kept well off the market --pos teal.
    key: 0xe1f0dd,
    fill: 0x82a878,
    dark: { rim: 0xb5d5ab, corona: 0xa0c496, glow: 0x82a878 },
    light: { rim: 0x2c402d, corona: 0x3a443a, glow: 0x2c362c },
    envTop: "#20291f",
    envKey: "230,248,228",
    envMid: "188,222,182",
    envWash: "154,196,150",
    envFill: "122,164,120",
    energy: 1,
  },
  graphite: {
    // Near-mono gray-blue — the coldest room, with the glow turned down.
    key: 0xe4e8ee,
    fill: 0x8b95a3,
    dark: { rim: 0xb9c1cc, corona: 0xa6aeba, glow: 0x8b95a3 },
    light: { rim: 0x30363f, corona: 0x3b3f46, glow: 0x2e3339 },
    envTop: "#242830",
    envKey: "236,240,246",
    envMid: "196,204,214",
    envWash: "162,170,182",
    envFill: "130,138,150",
    energy: 0.85,
  },
};

// --- Dimensionality tuning ---------------------------------------------------
// Knobs for the 3D read of the orb (the anti-"flat disc" pass). Angles are in
// radians, speeds in rad/s (0.0175 rad/s ≈ 1°/s). Everything here is meant to
// stay barely perceptible — tune in this block, not inline.
const FRESNEL_POWER = 3.0; // rim falloff sharpness — lower = wider, softer light-wrap
const RIM_SHADE_FLOOR = 0.42; // rim brightness on the shadow side (1.0 would be a flat uniform stroke)
const KEY_SHEEN = 0.085; // faint lambert wash over the lit hemisphere — the curvature cue
const FILL_SHEEN = 0.05; // fainter counter-wash so the dark limb never reads dead black
const KEY_SHEEN_FOCUS = 1.6; // sheen lambert exponent — higher pulls the wash toward the light
const FILL_SHEEN_FOCUS = 1.4; // same, for the fill wash
const SHEEN_CENTER_KEEP = 0.35; // fraction of sheen kept at disc centre (the rest hugs the limb)
const LIGHT_AZIMUTH = -0.54; // key light bearing off the camera axis (rad; negative = screen-left)
const LIGHT_ELEVATION = 0.6; // key light height above the equator (rad)
const KEY_DIST = 7; // key/fill light distance (world units; only direction matters)
const KEY_INTENSITY = 1.1; // key light strength — drives the specular shaping
const FILL_INTENSITY = 0.35; // dim steel counter-light: a trace of form on the shadow side
const FILL_DIR = new THREE.Vector3(2.6, -1.8, 3.0).normalize(); // fill from lower screen-right
const SPHERE_METALNESS = 0.22; // dielectric-leaning so grazing reflections brighten the limb (metal tinted them black)
const SPHERE_ROUGHNESS = 0.3; // smears the env key into a lit hemisphere; the clearcoat keeps the gloss
const ENV_KEY_RADIUS = 190; // env key-blob radius (px on the 512×256 env) — bigger = broader surface gradient
const ENV_WASH_RADIUS = 320; // radius of the wide soft wash around the key (hemisphere shading)
const ENV_KEY_WASH = 0.16; // strength of that wash — lifts the lit half, leaves a terminator
const ENV_DRIFT_SPEED = 0.035; // env reflection slew (rad/s ≈ 2°/s) — the specular catch never parks
const ROTATION_SPEED = 0.011; // base ring drift (rad/s ≈ 0.63°/s — barely perceptible)
const RING_SPEED_STEP = 0.004; // per-ring speed differential (≈0.23°/s) → slow parallax slip
const RING_RADII = [1.1, 1.16, 1.23]; // ring radii as multiples of the orb radius
const RING_TILT_BASE = 0.34; // first ring inclination off the equator (rad ≈ 19°)
const RING_INCLINATION_STEP = 0.11; // added inclination per ring, alternating sign (≈ 6.3°)
const RING_TILT_SKEW = 0.12; // small z-lean step per ring so no two rings share an axis
const RING_ARCS = 2; // arcs per ring — the gaps are what make the slow rotation visible
const RING_ARC_SPAN = 2.35; // arc length (rad ≈ 135°); the remainder is gap
const RING_SEGMENTS = 96; // line segments per arc
const RING_PHASE_STEP = 2.1; // per-ring start offset (rad) so the gaps never align
const RING_FAR_DIM = 0.25; // far-side segment brightness (near side = 1) — front/back depth cue
// --- Starfield — the space backdrop behind the orb (presence slide only) ------
// One THREE.Points cloud on a REAR spherical cap centred on the view axis: the
// drift is a roll around that axis, so no star can ever migrate in front of the
// orb, at any aspect/zoom. Per-star brightness variance rides vertex colors;
// the twinkle is one slow whole-cloud opacity sine (no per-frame buffer
// writes). Reduced motion keeps the field static (no drift, no twinkle).
const STARS = {
  count: 360, // points in the cloud
  radius: 48, // shell radius (world units) — far behind the orb, inside the far plane
  capDeg: 57, // rear-cap half-angle off the view axis — overfills every viewport
  size: 1.7, // point size (CSS px; scaled by devicePixelRatio, capped at 2)
  opacity: 0.32, // dark-stage base opacity (variance dims individual stars below this)
  opacityLight: 0.14, // light stage — faint ink specks (normal blending, see applyLook)
  brightMin: 0.45, // per-star brightness floor, 0..1 of the cloud colour
  driftDegPerSec: 0.1, // roll drift — barely perceptible (<0.2°/s per the brief)
  twinkle: 0.12, // ± fraction of the slow whole-cloud opacity sine
  twinkleHz: 0.045, // sine frequency — one breath ≈ 22s
  colorDark: 0xdbe4f0, // pale steel-white on the dark stage
  colorLight: 0x2b3a4c, // ink on the off-white stage (matches the light rim)
};

// Key light rest position, derived from azimuth/elevation (matches the env key blob).
const KEY_POS = new THREE.Vector3(
  Math.sin(LIGHT_AZIMUTH) * Math.cos(LIGHT_ELEVATION),
  Math.sin(LIGHT_ELEVATION),
  Math.cos(LIGHT_AZIMUTH) * Math.cos(LIGHT_ELEVATION),
).multiplyScalar(KEY_DIST);

export default function Presence3D({
  state,
  amplitudeRef,
  theme = "dark",
  mood = "steel",
  orbFraction,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const themeRef = useRef<Theme>(theme);
  const moodRef = useRef<Mood>(mood);
  const applyLookRef = useRef<((cause: "theme" | "mood") => void) | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Re-look without rebuilding the scene (cheap, no flicker). A theme flip keeps
  // its dip-and-recover cross-fade; a mood change instead lets the render loop
  // ease the light colours over (~600ms) — no fade, no flash.
  useEffect(() => {
    themeRef.current = theme;
    applyLookRef.current?.("theme");
  }, [theme]);
  useEffect(() => {
    moodRef.current = mood;
    applyLookRef.current?.("mood");
  }, [mood]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = LOOK[themeRef.current].exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.transition = "opacity 0.4s ease"; // gentle cross-fade on theme flip
    mount.appendChild(renderer.domElement);

    const FOV = 34;
    const R_ORB = 1.55; // sphere radius in world units
    // The orb's on-screen radius is kept at orbFrac · min(viewport w, h) — the SAME
    // fraction PresenceTelemetry keys its lattice to (keep these in lock-step) — by
    // deriving the camera distance per resize. min() (not h) so it shrinks on
    // portrait; a smaller fraction on compact screens leaves room for the readouts.
    const orbFrac = (w: number, h: number) =>
      orbFraction ?? (Math.min(w, h) < 540 ? 0.13 : 0.18);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(0, 0, 13);

    // Guarded so it's cheap to call every frame: only touches the renderer when the
    // container actually changed. Called from the render loop too, so the canvas can
    // never get stuck at a stale (e.g. mount-time 0×0) size.
    const fovRad = (FOV * Math.PI) / 180;
    let lastW = 0;
    let lastH = 0;
    const sizeTo = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.position.z = (R_ORB * h) / (2 * Math.tan(fovRad / 2) * orbFrac(w, h) * Math.min(w, h));
      camera.updateProjectionMatrix();
    };

    const disposables: Array<{ dispose: () => void }> = [];

    // --- Studio environment (gives the glossy sphere its specular catch + depth).
    // A dark equirect with a bright soft key blob upper-left → the white highlight
    // that reads as polished glass. One env serves both themes (it's the sphere's
    // own reflection; the page background is separate) — but it IS mood-tinted:
    // rebuilt from MOOD_LIGHT's env colours whenever the mood changes (rare, ~ms).
    let envRT: THREE.WebGLRenderTarget | null = null;
    let envMoodApplied: Mood | null = null;
    const applyEnv = (m: Mood) => {
      if (envMoodApplied === m) return;
      envMoodApplied = m;
      const ML = MOOD_LIGHT[m];
      const envCanvas = document.createElement("canvas");
      envCanvas.width = 512;
      envCanvas.height = 256;
      const ex = envCanvas.getContext("2d")!;
      const amb = ex.createLinearGradient(0, 0, 0, 256);
      amb.addColorStop(0, ML.envTop);
      amb.addColorStop(0.5, "#0a0e14");
      amb.addColorStop(1, "#04060a");
      ex.fillStyle = amb;
      ex.fillRect(0, 0, 512, 256);
      // Wide soft wash around the key first: it smears into a lit hemisphere with
      // a real terminator on the sphere, instead of a lone hot dot on black.
      const wash = ex.createRadialGradient(150, 64, 0, 150, 64, ENV_WASH_RADIUS);
      wash.addColorStop(0, `rgba(${ML.envWash},${ENV_KEY_WASH})`);
      wash.addColorStop(1, `rgba(${ML.envWash},0)`);
      ex.fillStyle = wash;
      ex.fillRect(0, 0, 512, 256);
      const key = ex.createRadialGradient(150, 64, 0, 150, 64, ENV_KEY_RADIUS);
      key.addColorStop(0, `rgba(${ML.envKey},0.98)`);
      key.addColorStop(0.32, `rgba(${ML.envMid},0.42)`);
      key.addColorStop(1, `rgba(${ML.envMid},0)`);
      ex.fillStyle = key;
      ex.fillRect(0, 0, 512, 256);
      const fill = ex.createRadialGradient(400, 200, 0, 400, 200, 150);
      fill.addColorStop(0, `rgba(${ML.envFill},0.3)`);
      fill.addColorStop(1, `rgba(${ML.envFill},0)`);
      ex.fillStyle = fill;
      ex.fillRect(0, 0, 512, 256);
      const envTex = new THREE.CanvasTexture(envCanvas);
      envTex.mapping = THREE.EquirectangularReflectionMapping;
      envTex.colorSpace = THREE.SRGBColorSpace;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const next = pmrem.fromEquirectangular(envTex);
      scene.environment = next.texture;
      envTex.dispose();
      pmrem.dispose();
      envRT?.dispose();
      envRT = next;
    };
    applyEnv(moodRef.current);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const keyLight = new THREE.DirectionalLight(0xdfe8f2, KEY_INTENSITY);
    keyLight.position.copy(KEY_POS);
    scene.add(keyLight);
    // Faint steel fill from the opposite low quarter — a counter-glint so the
    // shadow side keeps a trace of form (never dead black, never a second sun).
    const fillLight = new THREE.DirectionalLight(0x6e8ca8, FILL_INTENSITY);
    fillLight.position.copy(FILL_DIR).multiplyScalar(KEY_DIST);
    scene.add(fillLight);

    const root = new THREE.Group();
    scene.add(root);

    // --- The orb: a polished, deep, glossy near-black sphere. The physical
    // material + env map do the depth; clearcoat gives the wet glass sheen.
    const sphereGeo = new THREE.SphereGeometry(R_ORB, 128, 128);
    // Two-lobe shading: a rougher dielectric base smears the env into a soft lit
    // hemisphere (curvature), while the low-roughness clearcoat keeps the crisp
    // drifting catch-light. High metalness tinted every reflection near-black —
    // that is what flattened the ball into a disc.
    const sphereMat = new THREE.MeshPhysicalMaterial({
      color: LOOK[themeRef.current].sphere,
      metalness: SPHERE_METALNESS,
      roughness: SPHERE_ROUGHNESS,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: LOOK[themeRef.current].envIntensity,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    root.add(sphere);
    disposables.push(sphereGeo, sphereMat);

    // --- Shading shell (was: flat fresnel rim): still bright at the silhouette,
    // nothing at centre — but the rim now follows the key light (bright over the
    // lit hemisphere, falling to a floor on the shadow side), and two whisper-level
    // lambert sheens (key + fill) put a curvature gradient across the ball itself.
    // The camera never rotates here, so view space == world space and the light
    // directions can be passed as plain normalized positions.
    const L0 = LOOK[themeRef.current];
    const rimGeo = new THREE.SphereGeometry(R_ORB * 1.012, 96, 96);
    const rimMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: L0.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uColor: { value: L0.rim.clone() },
        uIntensity: { value: L0.rimIntensity },
        uPow: { value: FRESNEL_POWER },
        uKeyDir: { value: KEY_POS.clone().normalize() },
        uFillDir: { value: FILL_DIR.clone() },
        uShadeFloor: { value: RIM_SHADE_FLOOR },
        uKeySheen: { value: KEY_SHEEN },
        uFillSheen: { value: FILL_SHEEN },
      },
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vN; varying vec3 vV;
        uniform vec3 uColor; uniform float uIntensity; uniform float uPow;
        uniform vec3 uKeyDir; uniform vec3 uFillDir;
        uniform float uShadeFloor; uniform float uKeySheen; uniform float uFillSheen;
        void main() {
          vec3 N = normalize(vN);
          float ndv = max(dot(N, normalize(vV)), 0.0);
          float fres = pow(1.0 - ndv, uPow);
          // rim shaded by the key: a lit limb and a shadowed one, not a uniform stroke
          float keyFace = clamp(dot(N, uKeyDir) * 0.5 + 0.5, 0.0, 1.0);
          float rim = fres * uIntensity * mix(uShadeFloor, 1.0, keyFace);
          // lambert sheens hug the limb so the disc centre stays deep black
          float limb = mix(${SHEEN_CENTER_KEEP.toFixed(2)}, 1.0, 1.0 - ndv);
          float sheen = uKeySheen * pow(max(dot(N, uKeyDir), 0.0), ${KEY_SHEEN_FOCUS.toFixed(2)}) * limb;
          float fill = uFillSheen * pow(max(dot(N, uFillDir), 0.0), ${FILL_SHEEN_FOCUS.toFixed(2)}) * limb;
          gl_FragColor = vec4(uColor, rim + sheen + fill);
        }`,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    root.add(rim);
    disposables.push(rimGeo, rimMat);

    // --- Outer glow billboard: the soft bloom halo behind the orb.
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 256;
    const gx = glowCanvas.getContext("2d")!;
    const grad = gx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.28)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    gx.fillStyle = grad;
    gx.fillRect(0, 0, 256, 256);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      blending: L0.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      color: L0.glow.clone(),
      opacity: L0.glowOpacity,
    });
    const glowGeo = new THREE.PlaneGeometry(R_ORB * 4.4, R_ORB * 4.4);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.z = -0.6;
    scene.add(glow);
    disposables.push(glowTex, glowMat, glowGeo);

    // --- Starfield (see STARS above): sparse points on a rear cap. Added to the
    // SCENE, not the root group, so the orb's breathing/wobble never moves the
    // sky. depthTest stays on — the sphere occludes the stars behind it.
    const starPos = new Float32Array(STARS.count * 3);
    const starCol = new Float32Array(STARS.count * 3);
    const capCos = Math.cos((STARS.capDeg * Math.PI) / 180);
    for (let i = 0; i < STARS.count; i++) {
      // Uniform over the cap: cos(φ) uniform in [cos(capDeg), 1], aimed down -z.
      const cphi = capCos + Math.random() * (1 - capCos);
      const sphi = Math.sqrt(Math.max(0, 1 - cphi * cphi));
      const th = Math.random() * Math.PI * 2;
      starPos[i * 3] = Math.cos(th) * sphi * STARS.radius;
      starPos[i * 3 + 1] = Math.sin(th) * sphi * STARS.radius;
      starPos[i * 3 + 2] = -cphi * STARS.radius;
      const b = STARS.brightMin + Math.random() * (1 - STARS.brightMin);
      starCol[i * 3] = b;
      starCol[i * 3 + 1] = b;
      starCol[i * 3 + 2] = b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: STARS.size * Math.min(2, window.devicePixelRatio || 1),
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      color: new THREE.Color(STARS.colorDark),
      opacity: STARS.opacity,
      blending: L0.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);
    disposables.push(starGeo, starMat);
    let starBase = STARS.opacity; // theme-resolved base; applyLook retargets it

    // --- Energy corona: a turbulent eruption of radial filaments off the rim. A
    // dense short fringe with a few long whipping spikes (power-law length), drifting
    // angular clumps, slow undulation + fast flicker = violent contained energy. All
    // motion is in the vertex shader (uTime/uAmp), so it's GPU-cheap; it flows on its
    // own at idle and surges with AUGUST's voice.
    // ----- tuning knobs (isolated, as asked) -----------------------------------
    const minDim = Math.min(window.innerWidth || 1280, window.innerHeight || 800);
    const weakGPU = (navigator.hardwareConcurrency || 8) <= 4;
    const CORONA_COUNT = minDim < 540 || weakGPU ? 240 : 620; // filament density
    const CORONA_LEN = 1.0; // spike-length scale
    const CORONA_TURB = 1.0; // turbulence / whip
    const CORONA_GAIN = 1.4; // voice reactivity
    const CORONA_RIN = R_ORB * 1.015; // where filaments start (just off the rim)
    const CORONA_MAXLEN = 2.4; // soft-cap asymptote — the longest spikes reach well out (~2.5×)
    // ---------------------------------------------------------------------------
    const vCount = CORONA_COUNT * 2; // 2 verts per filament (inner rim + outer tip)
    const fAngle = new Float32Array(vCount);
    const fSeed = new Float32Array(vCount);
    const fEnd = new Float32Array(vCount);
    for (let i = 0; i < CORONA_COUNT; i++) {
      const ang = Math.random() * Math.PI * 2;
      const seed = Math.random();
      fAngle[i * 2] = ang;
      fAngle[i * 2 + 1] = ang;
      fSeed[i * 2] = seed;
      fSeed[i * 2 + 1] = seed;
      fEnd[i * 2] = 0;
      fEnd[i * 2 + 1] = 1;
    }
    const coronaGeo = new THREE.BufferGeometry();
    coronaGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vCount * 3), 3));
    coronaGeo.setAttribute("aAngle", new THREE.BufferAttribute(fAngle, 1));
    coronaGeo.setAttribute("aSeed", new THREE.BufferAttribute(fSeed, 1));
    coronaGeo.setAttribute("aEnd", new THREE.BufferAttribute(fEnd, 1));
    // Positions are computed in the shader → fixed bounding sphere, no culling.
    coronaGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), R_ORB * 5);
    const coronaMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: L0.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uAmp: { value: 0 },
        uColor: { value: L0.corona.clone() },
        uOpacity: { value: L0.coronaOpacity },
        uLen: { value: CORONA_LEN },
        uTurb: { value: CORONA_TURB },
        uGain: { value: CORONA_GAIN },
        uRin: { value: CORONA_RIN },
        uMaxLen: { value: CORONA_MAXLEN },
      },
      vertexShader: `
        uniform float uTime, uAmp, uLen, uTurb, uGain, uRin, uMaxLen;
        attribute float aAngle, aSeed, aEnd;
        varying float vA;
        float hash(float n){ return fract(sin(n) * 43758.5453123); }
        void main() {
          float seed = aSeed;
          float energy = 1.0 + uAmp * uGain;
          // strong power-law → mostly short filaments, a rare few very long & dramatic
          float reach = pow(hash(seed * 1.7), 3.0);
          // drifting uneven lobes (multi-frequency angular noise): some regions erupt
          // hard, others stay quiet — turbulent + organic, never an even ring
          float lobe = 0.45
            + 0.32 * sin(aAngle * 2.0 + uTime * 0.17 + seed * 0.4)
            + 0.24 * sin(aAngle * 5.0 - uTime * 0.27 + 1.3)
            + 0.16 * sin(aAngle * 9.0 + uTime * 0.13 + 2.6);
          lobe = clamp(lobe, 0.06, 1.3);
          float slow = 0.6 + 0.4 * sin(uTime * 1.3 + seed * 6.2831);     // undulation
          float fast = 0.84 + 0.16 * sin(uTime * 5.5 + seed * 30.0);     // flicker
          // a continuous short fringe everywhere + long spikes concentrated in the lobes
          float raw = (0.05 + reach * uLen * 2.4 * lobe) * slow * fast * energy;
          float len = uMaxLen * (1.0 - exp(-raw / uMaxLen));            // soft cap, no hard wall
          // long spikes whip more (curl scales with reach) → dramatic organic arcs
          float curl = sin(uTime * 1.9 + seed * 50.0) * uTurb * (0.04 + reach * 0.22) * (1.0 + uAmp);
          vec3 dir = vec3(cos(aAngle), sin(aAngle), 0.0);
          vec3 tang = vec3(-sin(aAngle), cos(aAngle), 0.0);
          // spread the inner ends off the exact rim circle so the base doesn't mush
          float r = uRin + hash(seed * 5.3) * 0.05 + len * aEnd;
          vec3 p = dir * r + tang * (curl * aEnd);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          // hot at the rim, tapering to the tip; long filaments read brighter so they
          // stand out clearly against the dense short fringe (no mush)
          vA = (1.0 - aEnd * 0.8) * (0.4 + 0.8 * uAmp + 0.5 * reach);
        }`,
      fragmentShader: `
        precision mediump float;
        varying float vA;
        uniform vec3 uColor; uniform float uOpacity;
        void main() {
          gl_FragColor = vec4(uColor, clamp(vA, 0.0, 1.0) * uOpacity);
        }`,
    });
    const corona = new THREE.LineSegments(coronaGeo, coronaMat);
    corona.position.z = -0.05;
    root.add(corona);
    disposables.push(coronaGeo, coronaMat);

    // --- Mechanical rings: three thin arc pairs orbiting the sphere on slightly
    // different inclinations, spinning at slow opposing speeds. The sphere writes
    // depth, so their far halves duck BEHIND the orb, and near segments render
    // brighter than far ones (vDepth) — parallax + occlusion is what turns the
    // disc into a volume. ~1.2k line verts total; no fog pass, no post.
    const ringMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false, // keep them out of the depth buffer…
      // …but depthTest stays ON so the sphere occludes the far half.
      blending: L0.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uColor: { value: L0.rim.clone() },
        uOpacity: { value: L0.ringOpacity },
        uFarDim: { value: RING_FAR_DIM },
      },
      vertexShader: `
        varying float vDepth;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          // view-space z relative to the orb centre, normalized by ring radius → 0 far, 1 near
          vDepth = clamp((mv.z - c.z) / max(length(position), 1e-3) * 0.5 + 0.5, 0.0, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        precision mediump float;
        varying float vDepth;
        uniform vec3 uColor; uniform float uOpacity; uniform float uFarDim;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity * mix(uFarDim, 1.0, vDepth));
        }`,
    });
    const rings: Array<{ mesh: THREE.LineSegments; speed: number }> = [];
    RING_RADII.forEach((mult, i) => {
      const r = R_ORB * mult;
      const gap = (Math.PI * 2 - RING_ARCS * RING_ARC_SPAN) / RING_ARCS;
      const pts: number[] = [];
      for (let a = 0; a < RING_ARCS; a++) {
        const start = i * RING_PHASE_STEP + a * (RING_ARC_SPAN + gap);
        for (let s = 0; s < RING_SEGMENTS; s++) {
          const a0 = start + (s / RING_SEGMENTS) * RING_ARC_SPAN;
          const a1 = start + ((s + 1) / RING_SEGMENTS) * RING_ARC_SPAN;
          pts.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
        }
      }
      const ringGeo = new THREE.BufferGeometry();
      ringGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
      const ring = new THREE.LineSegments(ringGeo, ringMat);
      // Static inclination lives on a parent group; the ring spins in-plane inside
      // it, so the composition holds while the arcs travel front-to-back.
      const tilt = new THREE.Group();
      tilt.rotation.x = (i % 2 ? -1 : 1) * (RING_TILT_BASE + i * RING_INCLINATION_STEP);
      tilt.rotation.z = (i - 1) * RING_TILT_SKEW;
      tilt.add(ring);
      root.add(tilt);
      rings.push({ mesh: ring, speed: (i % 2 ? -1 : 1) * (ROTATION_SPEED + (i - 1) * RING_SPEED_STEP) });
      disposables.push(ringGeo);
    });
    disposables.push(ringMat);

    // --- Look application (no rebuild): the theme swaps blend modes, opacities
    // and exposure; the mood retargets every light colour. Colours move through
    // the `tint` targets below, which the render loop eases toward (~600ms), so a
    // mood change re-lights the orb as a slow temperature drift, not a cut.
    const tint = {
      rim: L0.rim.clone(),
      corona: L0.corona.clone(),
      glow: L0.glow.clone(),
      key: new THREE.Color(MOOD_LIGHT.steel.key),
      fill: new THREE.Color(MOOD_LIGHT.steel.fill),
    };
    let moodEnergy = 1;
    let themedOnce = false; // fade only on real theme flips, never the boot apply
    let moodedOnce = false; // snap the boot mood apply; later changes get the lerp
    let fadeTimer = 0;
    const applyLook = (cause: "mount" | "theme" | "mood") => {
      const t = themeRef.current;
      const L = LOOK[t];
      const ML = MOOD_LIGHT[moodRef.current];
      // STEEL is the reference rig, and the matrix below documents its colours as
      // "LOOK verbatim, keep them in lock-step". So read them straight FROM LOOK
      // instead of duplicating them: that keeps LOOK authoritative for the default
      // mood (the gold palette, and batman's searchlight signature — which has no
      // MOOD_LIGHT triplet of its own) rather than letting a stale copy overwrite
      // it at mount. The other moods re-temperature the light as designed; batman
      // is a dark stage, so it rides their DARK triplet, never the light ink one.
      const steelRef = moodRef.current === "steel";
      const C = t === "light" ? ML.light : ML.dark;
      renderer.toneMappingExposure = L.exposure;
      sphereMat.color.set(L.sphere);
      sphereMat.envMapIntensity = L.envIntensity;
      sphereMat.needsUpdate = true;
      const blend = L.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      rimMat.uniforms.uIntensity.value = L.rimIntensity;
      rimMat.blending = blend;
      rimMat.needsUpdate = true;
      glowMat.blending = blend;
      glowMat.needsUpdate = true;
      coronaMat.uniforms.uOpacity.value = L.coronaOpacity * ML.energy;
      coronaMat.blending = blend;
      coronaMat.needsUpdate = true;
      ringMat.uniforms.uOpacity.value = L.ringOpacity;
      ringMat.blending = blend;
      ringMat.needsUpdate = true;
      // Stars: luminous dust on the dark stages (dark AND batman), faint ink
      // specks on the light one.
      starBase = t === "light" ? STARS.opacityLight : STARS.opacity;
      starMat.color.set(t === "light" ? STARS.colorLight : STARS.colorDark);
      starMat.opacity = starBase;
      starMat.blending = blend;
      starMat.needsUpdate = true;
      moodEnergy = ML.energy;
      // Retarget the light colours (rings share the rim tint) + re-tint the env.
      if (steelRef) {
        tint.rim.copy(L.rim);
        tint.corona.copy(L.corona);
        tint.glow.copy(L.glow);
      } else {
        tint.rim.setHex(C.rim);
        tint.corona.setHex(C.corona);
        tint.glow.setHex(C.glow);
      }
      tint.key.setHex(ML.key);
      tint.fill.setHex(ML.fill);
      applyEnv(moodRef.current);
      // Mood changes drift through the render loop's lerp; everything else
      // (mount, boot-time persisted mood, theme flips) lands instantly.
      if (cause !== "mood" || !moodedOnce) {
        rimMat.uniforms.uColor.value.copy(tint.rim);
        coronaMat.uniforms.uColor.value.copy(tint.corona);
        glowMat.color.copy(tint.glow);
        ringMat.uniforms.uColor.value.copy(tint.rim);
        keyLight.color.copy(tint.key);
        fillLight.color.copy(tint.fill);
      }
      if (cause === "mood") moodedOnce = true;
      // Gentle dip-and-recover so the orb re-materializes rather than hard-cutting
      // its corona/blend on a theme flip (skipped on the first, boot-time apply).
      if (cause === "theme") {
        if (themedOnce) {
          const el = renderer.domElement;
          el.style.opacity = "0";
          window.clearTimeout(fadeTimer);
          fadeTimer = window.setTimeout(() => {
            el.style.opacity = "1";
          }, 200);
        }
        themedOnce = true;
      }
    };
    applyLookRef.current = applyLook;
    applyLook("mount");

    sizeTo();
    const ro = new ResizeObserver(sizeTo);
    ro.observe(mount);

    let raf = 0;
    let rafOn = false; // the loop runs only while the orb is near-view in a visible tab
    // THREE.Clock is deprecated (r184 warns in console); Timer is the drop-in
    // replacement — update() once per frame, then read delta/elapsed.
    const timer = new THREE.Timer();
    let easedGlow = 1;
    let easedAmp = 0;
    let easedScale = 1;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const render = () => {
      if (!rafOn) {
        raf = 0;
        return; // paused — the loop parks; startLoop() re-arms it
      }
      raf = requestAnimationFrame(render);
      sizeTo(); // keep the canvas matched to the container, even while backgrounded
      if (typeof document !== "undefined" && document.hidden) return;
      timer.update();
      const dt = Math.min(0.05, timer.getDelta());
      const t = timer.getElapsed();
      const st = stateRef.current;
      const L = LOOK[themeRef.current];

      const rawAmp = Math.max(0, Math.min(1, amplitudeRef.current || 0));
      const ampRate = rawAmp > easedAmp ? 11 : 4;
      easedAmp += (rawAmp - easedAmp) * (1 - Math.exp(-dt * ampRate));
      const amp = easedAmp;

      // State → energy level (multiplier on the corona/glow/rim).
      let energyTarget = 1;
      let scaleTarget = 1;
      switch (st) {
        case "listening":
          energyTarget = 1.15 + amp * 0.7;
          scaleTarget = 1.012;
          break;
        case "thinking":
          energyTarget = 1.3 + 0.1 * Math.sin(t * 1.6);
          scaleTarget = 1.008;
          break;
        case "speaking":
          energyTarget = 1.15 + amp * 1.0;
          scaleTarget = 1.02;
          break;
        default:
          energyTarget = 1;
          scaleTarget = 1;
          break;
      }
      easedGlow += (energyTarget - easedGlow) * Math.min(1, dt * 3);
      easedScale += (scaleTarget - easedScale) * Math.min(1, dt * 3);

      // Corona: a flowing particle field driven by the voice envelope + state
      // energy. All motion is in the shader — we just feed it time + amplitude, so
      // orb and corona breathe and surge as one living thing.
      const coronaAmp = reduced
        ? Math.min(0.5, (easedGlow - 1) * 0.4 + amp * 0.6)
        : Math.min(1.4, (easedGlow - 1) * 0.7 + amp * 1.15);
      coronaMat.uniforms.uTime.value = reduced ? t * 0.15 : t;
      coronaMat.uniforms.uAmp.value = coronaAmp;

      // Mood drift — every light colour eases toward its `tint` target (~600ms
      // settle; instant under reduced motion). A no-op once settled.
      const ck = reduced ? 1 : 1 - Math.exp(-dt * 5);
      rimMat.uniforms.uColor.value.lerp(tint.rim, ck);
      coronaMat.uniforms.uColor.value.lerp(tint.corona, ck);
      glowMat.color.lerp(tint.glow, ck);
      ringMat.uniforms.uColor.value.lerp(tint.rim, ck);
      keyLight.color.lerp(tint.key, ck);
      fillLight.color.lerp(tint.fill, ck);

      // Living rim — a slow shimmer rides on the state/voice response.
      const rimShimmer = reduced ? 1 : 1 + Math.sin(t * 1.1) * 0.06;
      rimMat.uniforms.uIntensity.value =
        L.rimIntensity * (0.85 + (easedGlow - 1) * 0.6 + amp * 0.5) * rimShimmer;
      glowMat.opacity = L.glowOpacity * moodEnergy * (0.85 + (easedGlow - 1) * 0.9 + amp * 0.8);
      const glowPulse = reduced ? 1 : 1 + Math.sin(t * 0.7) * 0.05 + amp * 0.18;
      glow.scale.setScalar(glowPulse);

      // Starfield: an extremely slow roll around the view axis + one whole-cloud
      // opacity sine — the cheapest possible twinkle. Static under reduced motion.
      if (!reduced) {
        stars.rotation.z = t * ((STARS.driftDegPerSec * Math.PI) / 180);
        starMat.opacity =
          starBase * (1 + Math.sin(t * STARS.twinkleHz * Math.PI * 2) * STARS.twinkle);
      }

      // Slow breathing + a gentle drift at idle.
      const breathe = reduced ? 0 : Math.sin(t * 0.62) * 0.011 + Math.sin(t * 0.29) * 0.006;
      root.scale.setScalar(easedScale + breathe + amp * (reduced ? 0.01 : 0.04));
      if (!reduced) {
        root.rotation.z = Math.sin(t * 0.07) * 0.03;
        root.position.y = Math.sin(t * 0.45) * 0.03;
        sphere.rotation.y = t * 0.04;
        // Keep the orb awake: drift the specular catch by easing the key light in a
        // slow orbit and turning the reflection environment.
        keyLight.position.set(
          KEY_POS.x + Math.sin(t * 0.21) * 0.9,
          KEY_POS.y + Math.cos(t * 0.17) * 0.5,
          KEY_POS.z,
        );
        // The shell's shading tracks the orbiting key, so rim + sheen drift with it.
        rimMat.uniforms.uKeyDir.value.copy(keyLight.position).normalize();
        scene.environmentRotation.y = t * ENV_DRIFT_SPEED;
        // Ring parallax: in-plane spins at slow opposing differential speeds; the
        // arcs travel front-to-back, dimming as they pass behind the sphere.
        for (const rg of rings) rg.mesh.rotation.y = t * rg.speed;
      }

      renderer.render(scene, camera);
    };

    // Visibility gating — pause the RAF entirely while the Presence slide is far
    // off-view (deck on another surface) or the tab is hidden; resume restarts
    // the loop cleanly. State/mood/theme changes arriving during a pause still
    // apply on resume: applyLook mutates materials/refs immediately (CPU-side),
    // and the first resumed frame reads stateRef/tint targets and paints them.
    const startLoop = () => {
      if (rafOn) return;
      rafOn = true;
      timer.update(); // swallow the paused gap so eases don't jump
      raf = requestAnimationFrame(render);
    };
    const stopLoop = () => {
      rafOn = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    let orbInView = true; // presence is the boot slide — assume visible until told otherwise
    const applyGate = () => {
      if (orbInView && !document.hidden) startLoop();
      else stopLoop();
    };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      // rootMargin extends the viewport, so the orb is already animating again
      // while the slide is still approaching (mid-swipe), not only on arrival.
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            orbInView = e.isIntersecting;
          });
          applyGate();
        },
        { rootMargin: "25%" },
      );
      io.observe(mount);
    }
    const onVisibility = () => applyGate();
    document.addEventListener("visibilitychange", onVisibility);
    applyGate();

    return () => {
      stopLoop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(fadeTimer);
      ro.disconnect();
      applyLookRef.current = null;
      envRT?.dispose();
      disposables.forEach((d) => {
        try {
          d.dispose();
        } catch {
          /* noop */
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [amplitudeRef, orbFraction]);

  return <div ref={mountRef} className="presence-3d" />;
}
