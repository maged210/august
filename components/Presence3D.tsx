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
   * design's 190px orb circle and needs the crystal to fill it; the default
   * keeps the original full-surface presence sizing (0.18, 0.13 compact).
   */
  orbFraction?: number;
};

// ── THE TINT KNOB ────────────────────────────────────────────────────────────
// The crystal is a METAL: its albedo tints every reflection, so this one colour
// IS the gem's colour. Deep sapphire, per the reference (polished chrome-glass
// in a saturated blue). Every theme reads its crystalTint from here, so this
// single line swaps the whole presence to AUGUST's gold: 0xc9a96a.
// (Per-theme divergence stays available — each LOOK entry has its own
// crystalTint field — but by default all three share this one token.)
const CRYSTAL_TINT = 0x2f62b4;

// Per-theme look, tuned to the home design (docs/design/AUGUST Home.dc.html).
// The body is a faceted CRYSTAL (see buildCrystal): a reflection-dominated
// metal that takes its colour from the room, which is why envRoom below is
// per-theme and load-bearing — on the day stage the room IS the paper page, so
// the crystal reads as a jewel lying on it instead of a hole punched in it.
// The energy around it stays warm gold (#C9A96A / #E8C27A family) — luminous on
// the night stage (additive), gold ink on the day's off-white stage (normal
// blending). Batman keeps its own searchlight-gold signature untouched.
const LOOK = {
  // NIGHT (design applyTheme() night values): warm gold light on near-black.
  // These intensities are the gold palette's own tuning — the earlier "+15-20%
  // brightness pass" numbers were tuned against the retired steel palette and
  // would over-drive gold, which already reads hotter. Tune HERE, not inline.
  dark: {
    crystalTint: CRYSTAL_TINT,
    crystalMetalness: 0.95, // near-metal: the env IS the material
    crystalRoughness: 0.14, // crisp specular streaks along the facet edges
    crystalIridescence: 0.3, // a cheap gem shimmer on the grazing facets
    crystalSpike: 1.0, // shard reach into the body→rim headroom: 1 = CRYSTAL_TIP_FILL
    rim: new THREE.Color(0xe8c27a),
    corona: new THREE.Color(0xc9a96a),
    glow: new THREE.Color(0x8a744a),
    additive: true,
    rimIntensity: 0.72,
    glowOpacity: 0.45,
    coronaOpacity: 0.52,
    envIntensity: 2.6,
    exposure: 1.12,
    // The night room: the mood's own ambient top (MOOD_LIGHT.envTop, hence
    // `top: null`) over the existing searchlight-on-black falloff, PLUS a softbox.
    // The old room had no source in the band the front facets actually reflect,
    // which was fine for a near-black sphere but leaves a mirror-finish stone
    // reflecting pure black — a murky, unreadable lump. The box is the searchlight
    // itself: it lets the facets show while the gold rim/corona/halo keep the
    // signature. A faint cool bounce stops the underside going to a dead pit.
    envRoom: {
      top: null,
      mid: "#131922",
      floor: "#04060a",
      bounce: "36,44,58",
      bounceA: 0.5,
      box: { a: 0.85, r: 96, squash: 0.46, dx: -66, dy: -50 },
      shade: null,
    },
  },
  // DAY: the PAPER ROOM. A mirror-finish body shows whatever surrounds it, so on
  // the off-white stage the surround must be the page: bright warm-white above,
  // paper mid-tones around, and a real floor bounce off the page itself. That is
  // what stops the crystal being the near-black hole the old lit sphere was.
  light: {
    crystalTint: CRYSTAL_TINT,
    crystalMetalness: 0.94,
    crystalRoughness: 0.08, // crisper than night: the paper room's streaks are the read
    crystalIridescence: 0.3,
    crystalSpike: 0.9, // shorter shards on paper — a jewel, not a caltrop (tips ~95%)
    rim: new THREE.Color(0xa2823f),
    corona: new THREE.Color(0x8b6f3e),
    glow: new THREE.Color(0xc9a96a),
    additive: false,
    rimIntensity: 0.34, // ink rim stays a whisper — the facets carry the edge
    // DAY HAS NO ENERGY LAYER. Both of these are light SOURCES — a bloom billboard
    // and an eruption of filaments off the rim — and a light source is a dark-stage
    // idea: you cannot glow on white. Dimming them didn't make them honest, it made
    // them faint: the bloom billboard laid a pale gold disc behind a stone that
    // (unlike the old sphere) doesn't fill its circle, so it detached into a plate
    // under a floating jewel, and the filaments read as hairs/lint around it. The
    // owner's reference is the stone on plain paper and nothing else. At 0 both
    // meshes are also skipped outright (applyLook sets .visible) — two fewer
    // transparent draws per frame on the theme most people boot into.
    // (NIGHT/GOTHAM keep theirs: there the glow IS a searchlight in a void.)
    glowOpacity: 0,
    coronaOpacity: 0,
    envIntensity: 2.6, // the room is the whole trick — let it in
    exposure: 1.06,
    // The paper room needs CONTRAST, not just brightness: a mirror in an evenly
    // bright room reflects one flat tone everywhere and the gem dies as a matte
    // blob (which is exactly what a paper-white room gave). So the day room is a
    // real room — a hot warm-white ceiling, a warm mid-grey wall, a darker floor,
    // a softbox, and a shadow pool opposite it — which is what puts bright streaks
    // on the facets, deep blue in the recesses, and a blowout or two on the edges.
    // Note the wall is mid, not paper-white: that mid-grey/warm ground is exactly
    // what the reference's crystal sits on and takes its colour from. It cannot
    // read as a hole — a hole is near-black, and every facet here lands between
    // pale sky-blue and deep navy, with the page's own bounce under it.
    envRoom: {
      top: "#fffdf8",
      mid: "#a8a293",
      floor: "#6d675b",
      bounce: "226,218,198", // the page throwing warm light back up under the stone
      bounceA: 0.85,
      box: { a: 1, r: 92, squash: 0.42, dx: -70, dy: -54 },
      shade: { c: "58,54,46", a: 0.9, r: 150 },
    },
  },
  // Gotham: the same dark-stage physics with the energy in signal gold —
  // a searchlight against black, slightly dimmer than the steel look.
  batman: {
    crystalTint: CRYSTAL_TINT,
    crystalMetalness: 0.97,
    crystalRoughness: 0.07, // the sharpest, hardest read of the three
    crystalIridescence: 0.16,
    crystalSpike: 1.06, // Gotham runs its shards a hair longer — the sharpest read (tips ~98%)
    rim: new THREE.Color(0xe8d08a),
    corona: new THREE.Color(0xd6b25a),
    glow: new THREE.Color(0xa8905e),
    additive: true,
    rimIntensity: 0.68,
    glowOpacity: 0.45,
    coronaOpacity: 0.5,
    envIntensity: 2.5,
    exposure: 1.1,
    // Gotham's room rides a hair colder and darker than night's, per its brief.
    envRoom: {
      top: null,
      mid: "#0f141b",
      floor: "#030304",
      bounce: "30,36,48",
      bounceA: 0.42,
      box: { a: 0.82, r: 90, squash: 0.44, dx: -66, dy: -50 },
      shade: null,
    },
  },
} as const;

// --- Mood lighting matrix ------------------------------------------------------
// The mood never touches the crystal's own tint (that is CRYSTAL_TINT's job, and
// it is one stone across every mood) — it re-temperatures the LIGHT playing over
// it: the key/fill lights, the rim tint, the corona filaments, the halo, and the
// studio-environment blobs the stone reflects. Since the crystal is a mirror,
// those env blobs are now most of what a mood change actually re-colours.
// One entry per mood; rim/corona/
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
const ENV_KEY_RADIUS = 190; // env key-blob radius (px on the 512×256 env) — bigger = broader surface gradient
const ENV_WASH_RADIUS = 320; // radius of the wide soft wash around the key (hemisphere shading)
const ENV_KEY_WASH = 0.16; // strength of that wash — lifts the lit half, leaves a terminator
const ENV_DRIFT_SPEED = 0.035; // env reflection slew (rad/s ≈ 2°/s) — the specular catch never parks
// WHERE THE STONE LOOKS. With EquirectangularReflectionMapping a facet whose
// normal faces the camera reflects direction +z, which lands at u≈0.75, v≈0.5 on
// the equirect — the band BEHIND the camera, at the horizon. The pre-existing key
// blob sits at (150,64), i.e. off to the side: fine as a light source for a matte
// sphere, but a mirror-finish crystal shows the room, and the room the FRONT
// facets actually see is here. Anything meant to be seen ON the stone (the
// softbox, the shadow pool) is painted relative to this point.
const ENV_BEHIND_X = 384;
const ENV_HORIZON_Y = 128;

// --- The crystal ---------------------------------------------------------------
// A faceted crystalline solid: roughly spherical in mass, built from hard angular
// planes, with a handful of genuine shards. Procedural and DETERMINISTIC — a
// seeded PRNG, never Math.random — so the same stone renders every load, across
// SSR/HMR and between themes. Tune HERE, not inline.
const CRYSTAL_SEED = 0x41554755; // "AUGU" — the stone's identity; change it, get a different stone
const CRYSTAL_DETAIL = 2; // icosphere subdivisions → 20·(detail+1)² = 180 facets, 92 unique
// vertices (plenty at ~190px, and ~99% fewer triangles than the 128×128 sphere it replaces)
const CRYSTAL_LUMPS = 6; // low-frequency swells → an irregular mass, not a ball
const CRYSTAL_LUMP_MIN = 0.05; // per-lump radial amplitude range (× radius). Kept tight
const CRYSTAL_LUMP_MAX = 0.13; // and high-exponent (below) — broad soft swells read as a
const CRYSTAL_LUMP_POW_MIN = 2.6; // melted blob; narrow ones cut the mass into planes
const CRYSTAL_LUMP_POW_MAX = 6;
const CRYSTAL_SHARDS = 6; // protruding spikes, per the reference's silhouette
const CRYSTAL_SHARD_MIN = 0.4; // shard length range (× BODY radius), before LOOK.crystalSpike
const CRYSTAL_SHARD_MAX = 0.72;
const CRYSTAL_SHARD_FOCUS = 30; // falloff exponent — higher = narrower, sharper shard. Below
// ~20 the falloff is still ~0.6 at the neighbouring vertex (the icosphere's vertex spacing is
// ~21° at detail 2) and the "shard" smears into a soft bump instead of a spike.
const CRYSTAL_SHARD_SPREAD = 0.85; // min angle (rad ≈ 49°) between shards, so they never clump
// THE TWO FILL TARGETS, both as a fraction of R_ORB — which orbFrac pins to the
// landing's 95px circle radius (HomeLanding: "the sphere's on-screen radius must
// equal the circle's 95px"). Both are measured on the TRUE extent of the finished
// hull, squash included, so what they promise is what lands on screen:
//   BODY = the mass's own farthest point (no shard). The old smooth sphere sat at
//          0.98 in every direction; a stone cannot, and chasing that number is how
//          you get a ball. 0.8 is measured, not guessed: it puts the mean radius at
//          ~72% of R_ORB (64% before) while the shards still visibly protrude. 0.84
//          was tried and rejected — bigger, but the silhouette rounds off and the
//          shards stop reading, which is the "regular ball" failure.
//   TIP  = the longest shard tip, i.e. the whole silhouette's reach. Left a hair
//          under 1 so the rim shell (×1.012) and the breathing still land inside.
const CRYSTAL_BODY_FILL = 0.8;
const CRYSTAL_TIP_FILL = 0.97;
const CRYSTAL_SQUASH = [1.06, 0.93, 1.01]; // anisotropic scale — kills any regular-polyhedron read
const CRYSTAL_REST = [0.38, 0.72, 0.16]; // resting euler (rad) — the face it shows at reduced motion

// --- State motion --------------------------------------------------------------
// The states are read off the TUMBLE: the facets doing the work is the whole
// point of a faceted body. Rates in rad/s.
const TUMBLE_IDLE = 0.085; // slow, deliberate — a stone turning over
const TUMBLE_LISTEN = 0.14; // base while listening…
const TUMBLE_LISTEN_GAIN = 1.5; // …plus this × mic amplitude: it visibly reacts to a voice
const TUMBLE_THINK = 0.5; // searching — fast, and it hunts (see THINK_SWEEP)
const TUMBLE_THINK_SWEEP = 0.85; // rad/s of the sweep sine: speed swells and eases = purposeful
const TUMBLE_SPEAK = 0.16; // speaking rides the pulse more than the spin
const TUMBLE_SPEAK_GAIN = 0.7;
const TUMBLE_WOBBLE = 0.42; // cross-axis rate (× the yaw rate) → a real tumble, not a turntable
const SHIMMER_GAIN = 0.55; // amplitude → envMapIntensity lift: the gem catches light as it speaks

// Deterministic PRNG (mulberry32). Seeded per call, so buildCrystal is pure:
// identical geometry on server, client, and every HMR pass.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The stone. An icosphere displaced by a few low-frequency lumps (the irregular
 * mass) plus a handful of narrow shards, then squashed anisotropically so it can
 * never read as a regular polyhedron. Displacement is a pure function of each
 * vertex's ORIGINAL direction, so the duplicated corners of the non-indexed
 * icosphere all move identically and the hull stays watertight; flatShading then
 * makes every triangle a crisp plane.
 *
 * Shard axes are snapped to real vertex directions — a narrow falloff aimed
 * between vertices would only be sampled at the corners and smear into a bump
 * instead of a spike.
 *
 * FILL. Two independent targets, hit exactly rather than approached: the body's
 * true extent lands on CRYSTAL_BODY_FILL·radius (a plain uniform fit), and the
 * shards are then scaled by one solved multiplier `k` so the longest tip lands on
 * `tipFill`·radius. Both extents are the real max of |vertex| over the finished,
 * squashed hull — NOT the old `bodyMax * squashMax` bound, which multiplied the
 * farthest body direction by the largest squash axis as though they coincided.
 * They don't, so that bound overshot and the fit divided it back out of the whole
 * stone: the body landed at ~64% mean radius and the longest tip at 83.7% of a
 * circle the old sphere filled to 98.2%. Solving on the true extents is also what
 * lets `spikeScale` mean something honest — the shards' REACH into the headroom
 * between body and rim — instead of an absolute length that silently resized the
 * whole silhouette per theme.
 */
function buildCrystal(radius: number, spikeScale: number) {
  const geo = new THREE.IcosahedronGeometry(radius, CRYSTAL_DETAIL);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const rnd = mulberry32(CRYSTAL_SEED);

  const randomAxis = () => {
    // Uniform on the sphere (inverse-CDF on cos φ) — no polar clustering.
    const z = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return new THREE.Vector3(Math.cos(th) * r, Math.sin(th) * r, z);
  };

  const lumps = Array.from({ length: CRYSTAL_LUMPS }, () => ({
    axis: randomAxis(),
    amp: CRYSTAL_LUMP_MIN + rnd() * (CRYSTAL_LUMP_MAX - CRYSTAL_LUMP_MIN),
    pow: CRYSTAL_LUMP_POW_MIN + rnd() * (CRYSTAL_LUMP_POW_MAX - CRYSTAL_LUMP_POW_MIN),
  }));

  // Unique vertex directions (the icosphere is non-indexed → heavy duplication).
  const dirs: THREE.Vector3[] = [];
  const seen = new Set<string>();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const k = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dirs.push(v.clone());
  }

  // Shard axes: seeded picks from the real vertex set, spread apart.
  const shards: Array<{ axis: THREE.Vector3; len: number }> = [];
  for (let guard = 0; guard < 400 && shards.length < CRYSTAL_SHARDS; guard++) {
    const cand = dirs[Math.floor(rnd() * dirs.length)];
    if (shards.some((s) => s.axis.angleTo(cand) < CRYSTAL_SHARD_SPREAD)) continue;
    shards.push({
      axis: cand.clone(),
      len: CRYSTAL_SHARD_MIN + rnd() * (CRYSTAL_SHARD_MAX - CRYSTAL_SHARD_MIN),
    });
  }

  // Pass 1: split the radial profile into its body and shard halves, and record
  // the squash gain along each vertex's OWN direction — |d ⊙ SQUASH| — so both
  // extents below are the hull's real reach, not a bound.
  const d = new THREE.Vector3();
  const bodyProf = new Float32Array(pos.count);
  const shardProf = new Float32Array(pos.count);
  const gain = new Float32Array(pos.count);
  let bodyExtent = 0;
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    let bodyR = 1;
    for (const l of lumps) bodyR += l.amp * Math.pow(Math.max(0, d.dot(l.axis)), l.pow);
    let shardR = 0;
    for (const s of shards) {
      shardR += s.len * Math.pow(Math.max(0, d.dot(s.axis)), CRYSTAL_SHARD_FOCUS);
    }
    const q = Math.hypot(d.x * CRYSTAL_SQUASH[0], d.y * CRYSTAL_SQUASH[1], d.z * CRYSTAL_SQUASH[2]);
    bodyProf[i] = bodyR;
    shardProf[i] = shardR;
    gain[i] = q;
    bodyExtent = Math.max(bodyExtent, bodyR * q);
  }

  // The theme's shard character: how far into the body→rim headroom the longest
  // tip reaches. 1 = CRYSTAL_TIP_FILL; paper runs shorter, Gotham longer. Clamped
  // so no LOOK edit can ever push a tip through the rim or invert it into the body.
  const tipFill = Math.min(
    0.985,
    Math.max(
      CRYSTAL_BODY_FILL + 0.01,
      CRYSTAL_BODY_FILL + (CRYSTAL_TIP_FILL - CRYSTAL_BODY_FILL) * spikeScale,
    ),
  );
  // Fit the BODY's true extent to CRYSTAL_BODY_FILL of the orb radius…
  const fit = (radius * CRYSTAL_BODY_FILL) / bodyExtent;
  // …then solve the one shard multiplier that puts the longest tip on tipFill.
  // max_i (body + k·shard)·gain is a max of lines in k, so it rises monotonically
  // from bodyExtent (k=0) — bisection is exact to float precision and, since every
  // input is seeded, deterministic. k is solved per build, not stored.
  const tipTarget = (tipFill / CRYSTAL_BODY_FILL) * bodyExtent;
  const reach = (m: number) => {
    let far = 0;
    for (let i = 0; i < pos.count; i++) far = Math.max(far, (bodyProf[i] + m * shardProf[i]) * gain[i]);
    return far;
  };
  let lo = 0;
  let hi = 8; // reach(8) overshoots any reachable target by ~5×; bracket assured
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) < tipTarget) lo = mid;
    else hi = mid;
  }
  const shardK = (lo + hi) / 2;

  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const r = (bodyProf[i] + shardK * shardProf[i]) * fit;
    pos.setXYZ(i, d.x * r * CRYSTAL_SQUASH[0], d.y * r * CRYSTAL_SQUASH[1], d.z * r * CRYSTAL_SQUASH[2]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The gold fresnel shell that hugs the crystal's silhouette (AUGUST's signature
 * edge on the night stage). Same hull, nudged out — but with RADIAL normals
 * rather than the facet normals: a per-facet fresnel on a flat-shaded hull
 * resolves to flat blocky patches, where normalize(position) on a star-shaped
 * body gives the smooth silhouette-hugging wrap the rim is actually after.
 */
function buildRimShell(crystal: THREE.BufferGeometry, scale: number) {
  const shell = crystal.clone();
  shell.scale(scale, scale, scale);
  const p = shell.attributes.position as THREE.BufferAttribute;
  const n = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    n[i * 3] = v.x;
    n[i * 3 + 1] = v.y;
    n[i * 3 + 2] = v.z;
  }
  shell.setAttribute("normal", new THREE.BufferAttribute(n, 3));
  return shell;
}
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
  // The day stage has no sky to put stars in: on #f5f4f1 paper the specks read
  // as grit scattered around the stone, which is the opposite of a jewel lying
  // clean on a page. The cloud stays built (one flip back to night restores it) —
  // it just isn't drawn on paper.
  opacityLight: 0,
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

    // --- The ROOM. This is the whole trick, and it is THEME-AWARE.
    // The crystal is a mirror-finish metal: it has almost no colour of its own on
    // screen — it shows whatever surrounds it. So the environment decides whether
    // it belongs on the page. On the DAY stage the room must BE the paper page
    // (bright warm-white above, paper mid-tones around, the page bouncing warm
    // light back up from below) — that is what makes the crystal a jewel lying on
    // the page rather than a hole punched through it. On the night stages the room
    // stays the existing searchlight-on-black rig, mood-tinted from MOOD_LIGHT.
    // Rebuilt only when the theme or the mood actually changes (rare, ~ms).
    let envRT: THREE.WebGLRenderTarget | null = null;
    let envApplied: string | null = null;
    const applyEnv = (t: Theme, m: Mood) => {
      if (envApplied === `${t}|${m}`) return;
      envApplied = `${t}|${m}`;
      const ML = MOOD_LIGHT[m];
      const room = LOOK[t].envRoom;
      const envCanvas = document.createElement("canvas");
      envCanvas.width = 512;
      envCanvas.height = 256;
      const ex = envCanvas.getContext("2d")!;
      const amb = ex.createLinearGradient(0, 0, 0, 256);
      // `top: null` on the night rooms = defer to the mood's own ambient top.
      amb.addColorStop(0, room.top ?? ML.envTop);
      amb.addColorStop(0.5, room.mid);
      amb.addColorStop(1, room.floor);
      ex.fillStyle = amb;
      ex.fillRect(0, 0, 512, 256);
      // Floor bounce: the surface under the stone throws light back up into its
      // lower facets, so the underside never goes to a dead pit. On the day stage
      // this is literally the page doing it.
      if (room.bounce) {
        const bounce = ex.createRadialGradient(256, 256, 0, 256, 256, 300);
        bounce.addColorStop(0, `rgba(${room.bounce},${room.bounceA})`);
        bounce.addColorStop(1, `rgba(${room.bounce},0)`);
        ex.fillStyle = bounce;
        ex.fillRect(0, 128, 512, 128);
      }
      // The SOFTBOX — the source the front facets actually see (see ENV_BEHIND_X).
      // Elongated, so facets catch a streak rather than a dot. This is what makes
      // the stone read as polished rather than matte, on every stage.
      const bx = ENV_BEHIND_X + room.box.dx;
      const by = ENV_HORIZON_Y + room.box.dy;
      const boxGrad = ex.createRadialGradient(bx, by, 0, bx, by, room.box.r);
      boxGrad.addColorStop(0, `rgba(255,253,247,${room.box.a})`);
      boxGrad.addColorStop(0.55, `rgba(252,248,238,${room.box.a * 0.55})`);
      boxGrad.addColorStop(1, "rgba(250,246,236,0)");
      ex.save();
      ex.translate(bx, by);
      ex.scale(1, room.box.squash);
      ex.translate(-bx, -by);
      ex.fillStyle = boxGrad;
      ex.fillRect(0, 0, 512, 256);
      ex.restore();
      // The SHADOW SIDE (day): a dark pool opposite the softbox, so the recesses
      // have somewhere dark to pool. Contrast is what reads as polish. The night
      // rooms are already dark everywhere and don't need one.
      if (room.shade) {
        const sx = ENV_BEHIND_X + 110;
        const sy = ENV_HORIZON_Y + 70;
        const shadeGrad = ex.createRadialGradient(sx, sy, 0, sx, sy, room.shade.r);
        shadeGrad.addColorStop(0, `rgba(${room.shade.c},${room.shade.a})`);
        shadeGrad.addColorStop(1, `rgba(${room.shade.c},0)`);
        ex.fillStyle = shadeGrad;
        ex.fillRect(0, 0, 512, 256);
      }
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
    applyEnv(themeRef.current, moodRef.current);

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
    // The stone tumbles inside `root`; root itself keeps the breathing/drift, so
    // the corona and halo never inherit the spin.
    const body = new THREE.Group();
    root.add(body);

    // --- The crystal: a faceted, polished, reflection-dominated stone.
    // Chrome-glass, NOT clear glass: high metalness + low roughness + a real
    // envMap, so the tint colours the reflections and the facet edges throw the
    // bright specular streaks the reference lives on. Deliberately NOT
    // MeshPhysicalMaterial.transmission — this canvas is transparent and composited
    // over the page, so there is nothing behind the crystal IN THE SCENE for
    // transmission to refract: it would sample the empty (alpha-0) backdrop and
    // read as a grey smudge, not as glass over paper. Reflecting a room we author
    // (see applyEnv) is both cheaper and the only honest way to get the gem here.
    // flatShading makes every triangle a crisp plane — the hard facets.
    const L0 = LOOK[themeRef.current];
    let crystalGeo = buildCrystal(R_ORB, L0.crystalSpike);
    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: L0.crystalTint,
      metalness: L0.crystalMetalness,
      roughness: L0.crystalRoughness,
      flatShading: true,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      iridescence: L0.crystalIridescence,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [110, 420],
      envMapIntensity: L0.envIntensity,
    });
    const crystal = new THREE.Mesh(crystalGeo, crystalMat);
    body.add(crystal);
    disposables.push(crystalMat);

    // --- Shading shell: AUGUST's gold edge, now hugging the CRYSTAL's silhouette
    // rather than a ghost sphere around it (a sphere shell over a faceted body
    // would have shown as a halo ball wider than the stone). Still bright at the
    // silhouette, nothing at centre, and shaded by the key so there is a lit limb
    // and a shadowed one. It rides inside `body`, so it tumbles WITH the crystal.
    // The camera never rotates here, so view space == world space and the light
    // directions can be passed as plain normalized positions.
    let rimGeo = buildRimShell(crystalGeo, 1.012);
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
    body.add(rim);
    // crystalGeo/rimGeo are rebuilt when a theme's crystalSpike differs, so they
    // are disposed by hand (see rebuildCrystal + cleanup), not via `disposables`.
    disposables.push(rimMat);

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

    // --- Mechanical rings: REMOVED (they were merged in from the desk line).
    // Three orbital arc pairs read fine on a big presence surface, but the ONLY
    // mount is the landing's 190px circle (HomeLanding, orbFraction), where they
    // compressed into gold spikes fringing the orb — the artefact the owner
    // rejected. They are also now redundant AND in conflict: the crystal grows its
    // own shards, and arcs sweeping through them fight that silhouette. Gated off
    // per-LOOK would leave an unreachable rig behind an always-false flag, so they
    // are gone; git has them at 2882d16 if a future big-surface mount wants them.

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
    let spikeApplied: number = L0.crystalSpike; // widened: LOOK is `as const`

    // Themes carry their own shard character (LOOK.crystalSpike), which is baked
    // into the vertices — so a theme flip that actually changes it re-cuts the
    // stone. Deterministic (same seed) → the same crystal, longer or shorter
    // shards; ~1ms for 320 facets, and only on a real change.
    const rebuildCrystal = (spike: number) => {
      if (spike === spikeApplied) return;
      spikeApplied = spike;
      const nextCrystal = buildCrystal(R_ORB, spike);
      const nextRim = buildRimShell(nextCrystal, 1.012);
      crystal.geometry = nextCrystal;
      rim.geometry = nextRim;
      crystalGeo.dispose();
      rimGeo.dispose();
      crystalGeo = nextCrystal;
      rimGeo = nextRim;
    };

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
      rebuildCrystal(L.crystalSpike);
      crystalMat.color.set(L.crystalTint);
      crystalMat.metalness = L.crystalMetalness;
      crystalMat.roughness = L.crystalRoughness;
      crystalMat.iridescence = L.crystalIridescence;
      crystalMat.envMapIntensity = L.envIntensity;
      crystalMat.needsUpdate = true;
      const blend = L.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      rimMat.uniforms.uIntensity.value = L.rimIntensity;
      rimMat.blending = blend;
      rimMat.needsUpdate = true;
      glowMat.blending = blend;
      glowMat.needsUpdate = true;
      coronaMat.uniforms.uOpacity.value = L.coronaOpacity * ML.energy;
      coronaMat.blending = blend;
      coronaMat.needsUpdate = true;
      // A LOOK that zeroes the energy layer (day) means it, so don't draw it at
      // all: the render loop keeps writing their opacity/uniforms either way, and
      // an opacity-0 transparent mesh still costs a draw. Kept off the LOOK table
      // as a derived fact — one source of truth (the opacity), no flag to desync.
      glow.visible = L.glowOpacity > 0;
      corona.visible = L.coronaOpacity > 0;
      // Stars: luminous dust on the dark stages (dark AND batman), faint ink
      // specks on the light one.
      starBase = t === "light" ? STARS.opacityLight : STARS.opacity;
      starMat.color.set(t === "light" ? STARS.colorLight : STARS.colorDark);
      starMat.opacity = starBase;
      starMat.blending = blend;
      starMat.needsUpdate = true;
      stars.visible = starBase > 0; // day zeroes them (STARS.opacityLight) — same deal
      moodEnergy = ML.energy;
      // Retarget the light colours + rebuild the room (theme AND mood decide it).
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
      applyEnv(t, moodRef.current);
      // Mood changes drift through the render loop's lerp; everything else
      // (mount, boot-time persisted mood, theme flips) lands instantly.
      if (cause !== "mood" || !moodedOnce) {
        rimMat.uniforms.uColor.value.copy(tint.rim);
        coronaMat.uniforms.uColor.value.copy(tint.corona);
        glowMat.color.copy(tint.glow);
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
    // Accumulated tumble angle. The states change the RATE, so the angle is
    // integrated rather than derived from t — a state flip changes the speed
    // without ever snapping the stone to a new orientation.
    let spin = 0;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Reduced motion is a still, well-lit crystal: park it on the resting face.
    body.rotation.set(CRYSTAL_REST[0], CRYSTAL_REST[1], CRYSTAL_REST[2]);

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

      // State → energy (drives corona/glow/rim), scale, and the TUMBLE RATE. On a
      // faceted body the tumble is the loudest signal there is: each state turns
      // the stone with its own character, so a glance tells you which one it's in.
      let energyTarget = 1;
      let scaleTarget = 1;
      let spinRate = TUMBLE_IDLE; // idle: slow and deliberate, the facets doing the work
      switch (st) {
        case "listening":
          // The voice literally drives it: louder in the mic = faster, bigger.
          energyTarget = 1.15 + amp * 0.7;
          scaleTarget = 1.012 + amp * 0.03;
          spinRate = TUMBLE_LISTEN + amp * TUMBLE_LISTEN_GAIN;
          break;
        case "thinking":
          // Searching: fast, but it swells and eases rather than running flat —
          // the stone is hunting for something, not idling on a turntable.
          energyTarget = 1.3 + 0.1 * Math.sin(t * 1.6);
          scaleTarget = 1.008;
          spinRate = TUMBLE_THINK * (0.55 + 0.45 * Math.sin(t * TUMBLE_THINK_SWEEP));
          break;
        case "speaking":
          // Speaking pulses: the envelope drives scale first, spin second.
          energyTarget = 1.15 + amp * 1.0;
          scaleTarget = 1.02 + amp * 0.05;
          spinRate = TUMBLE_SPEAK + amp * TUMBLE_SPEAK_GAIN;
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

      // Shimmer: the voice lifts how hard the room burns into the facets, so the
      // stone visibly catches light as it reacts — the reflection-side of the
      // amplitude response that the scale pulse handles geometrically.
      crystalMat.envMapIntensity = L.envIntensity * (1 + amp * SHIMMER_GAIN);

      // Slow breathing + a gentle drift at idle.
      const breathe = reduced ? 0 : Math.sin(t * 0.62) * 0.011 + Math.sin(t * 0.29) * 0.006;
      root.scale.setScalar(easedScale + breathe + amp * (reduced ? 0.01 : 0.04));
      if (!reduced) {
        root.rotation.z = Math.sin(t * 0.07) * 0.03;
        root.position.y = Math.sin(t * 0.45) * 0.03;
        // THE TUMBLE — integrate the state's rate, then turn the stone on two axes
        // at an irrational-ish ratio so it never settles into a repeating turntable
        // loop and always presents fresh facets to the key.
        spin += dt * spinRate;
        body.rotation.set(
          CRYSTAL_REST[0] + spin * TUMBLE_WOBBLE,
          CRYSTAL_REST[1] + spin,
          CRYSTAL_REST[2] + Math.sin(spin * 0.31) * 0.22,
        );
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
      // Hand-managed (rebuildCrystal swaps them), so they aren't in `disposables`.
      crystalGeo.dispose();
      rimGeo.dispose();
      disposables.forEach((d) => {
        try {
          d.dispose();
        } catch {
          /* noop */
        }
      });
      renderer.dispose();
      // dispose() frees the GL resources but NOT the drawing context itself, so
      // every mount/unmount used to strand one: Chrome caps live contexts per
      // process (~16) and starts evicting the oldest ("Too many active WebGL
      // contexts"), which kills the orb on a page that mounts the landing enough
      // times. forceContextLoss() is the documented way to hand the context back.
      // After dispose(), since that has already removed three's own
      // webglcontextlost listener.
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [amplitudeRef, orbFraction]);

  return <div ref={mountRef} className="presence-3d" />;
}
