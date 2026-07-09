"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type AugustState = "boot" | "idle" | "listening" | "thinking" | "speaking";
export type Theme = "dark" | "light" | "batman";

type Props = {
  state: AugustState;
  /** 0..1 live audio level — mic RMS while listening, TTS envelope while speaking. */
  amplitudeRef: React.MutableRefObject<number>;
  theme?: Theme;
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
  dark: {
    sphere: 0x12100c,
    rim: new THREE.Color(0xe8c27a),
    corona: new THREE.Color(0xc9a96a),
    glow: new THREE.Color(0x8a744a),
    additive: true,
    rimIntensity: 1.0,
    glowOpacity: 0.45,
    coronaOpacity: 0.52,
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
    envIntensity: 1.0,
    exposure: 1.1,
  },
} as const;

export default function Presence3D({ state, amplitudeRef, theme = "dark", orbFraction }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const themeRef = useRef<Theme>(theme);
  const applyThemeRef = useRef<((t: Theme) => void) | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Re-theme without rebuilding the scene (cheap, no flicker).
  useEffect(() => {
    themeRef.current = theme;
    applyThemeRef.current?.(theme);
  }, [theme]);

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
    // own reflection; the page background is separate).
    const envCanvas = document.createElement("canvas");
    envCanvas.width = 512;
    envCanvas.height = 256;
    const ex = envCanvas.getContext("2d")!;
    const amb = ex.createLinearGradient(0, 0, 0, 256);
    amb.addColorStop(0, "#222d3b");
    amb.addColorStop(0.5, "#0a0e14");
    amb.addColorStop(1, "#04060a");
    ex.fillStyle = amb;
    ex.fillRect(0, 0, 512, 256);
    const key = ex.createRadialGradient(150, 64, 0, 150, 64, 130);
    key.addColorStop(0, "rgba(232,242,252,0.98)");
    key.addColorStop(0.32, "rgba(186,210,234,0.42)");
    key.addColorStop(1, "rgba(186,210,234,0)");
    ex.fillStyle = key;
    ex.fillRect(0, 0, 512, 256);
    const fill = ex.createRadialGradient(400, 200, 0, 400, 200, 150);
    fill.addColorStop(0, "rgba(120,150,182,0.3)");
    fill.addColorStop(1, "rgba(120,150,182,0)");
    ex.fillStyle = fill;
    ex.fillRect(0, 0, 512, 256);
    const envTex = new THREE.CanvasTexture(envCanvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromEquirectangular(envTex);
    scene.environment = envRT.texture;
    envTex.dispose();
    pmrem.dispose();
    disposables.push(envRT);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const keyLight = new THREE.DirectionalLight(0xdfe8f2, 1.1);
    keyLight.position.set(-3, 4, 5);
    scene.add(keyLight);

    const root = new THREE.Group();
    scene.add(root);

    // --- The orb: a polished, deep, glossy near-black sphere. The physical
    // material + env map do the depth; clearcoat gives the wet glass sheen.
    const sphereGeo = new THREE.SphereGeometry(R_ORB, 128, 128);
    const sphereMat = new THREE.MeshPhysicalMaterial({
      color: LOOK[themeRef.current].sphere,
      metalness: 0.55,
      roughness: 0.16,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: LOOK[themeRef.current].envIntensity,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    root.add(sphere);
    disposables.push(sphereGeo, sphereMat);

    // --- Fresnel rim shell: bright at the silhouette, nothing at centre. Additive
    // (luminous) on dark, normal (ink) on light — the colored edge of the corona.
    const L0 = LOOK[themeRef.current];
    const rimGeo = new THREE.SphereGeometry(R_ORB * 1.012, 96, 96);
    const rimMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: L0.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uColor: { value: L0.rim.clone() },
        uIntensity: { value: L0.rimIntensity },
        uPow: { value: 3.2 },
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
        void main() {
          float f = pow(1.0 - max(dot(vN, vV), 0.0), uPow);
          gl_FragColor = vec4(uColor, f * uIntensity);
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

    // --- Theme application (no rebuild): swap colors, blend modes, intensities.
    let themedOnce = false;
    let fadeTimer = 0;
    const applyTheme = (t: Theme) => {
      const L = LOOK[t];
      renderer.toneMappingExposure = L.exposure;
      sphereMat.color.set(L.sphere);
      sphereMat.envMapIntensity = L.envIntensity;
      sphereMat.needsUpdate = true;
      const blend = L.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      rimMat.uniforms.uColor.value.copy(L.rim);
      rimMat.uniforms.uIntensity.value = L.rimIntensity;
      rimMat.blending = blend;
      rimMat.needsUpdate = true;
      glowMat.color.copy(L.glow);
      glowMat.blending = blend;
      glowMat.needsUpdate = true;
      coronaMat.uniforms.uColor.value.copy(L.corona);
      coronaMat.uniforms.uOpacity.value = L.coronaOpacity;
      coronaMat.blending = blend;
      coronaMat.needsUpdate = true;
      // Gentle dip-and-recover so the orb re-materializes rather than hard-cutting
      // its corona/blend on a theme flip (skipped on the first, mount-time apply).
      if (themedOnce) {
        const el = renderer.domElement;
        el.style.opacity = "0";
        window.clearTimeout(fadeTimer);
        fadeTimer = window.setTimeout(() => {
          el.style.opacity = "1";
        }, 200);
      }
      themedOnce = true;
    };
    applyThemeRef.current = applyTheme;

    sizeTo();
    const ro = new ResizeObserver(sizeTo);
    ro.observe(mount);

    let raf = 0;
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

      // Living rim — a slow shimmer rides on the state/voice response.
      const rimShimmer = reduced ? 1 : 1 + Math.sin(t * 1.1) * 0.06;
      rimMat.uniforms.uIntensity.value =
        L.rimIntensity * (0.85 + (easedGlow - 1) * 0.6 + amp * 0.5) * rimShimmer;
      glowMat.opacity = L.glowOpacity * (0.85 + (easedGlow - 1) * 0.9 + amp * 0.8);
      const glowPulse = reduced ? 1 : 1 + Math.sin(t * 0.7) * 0.05 + amp * 0.18;
      glow.scale.setScalar(glowPulse);

      // Slow breathing + a gentle drift at idle.
      const breathe = reduced ? 0 : Math.sin(t * 0.62) * 0.011 + Math.sin(t * 0.29) * 0.006;
      root.scale.setScalar(easedScale + breathe + amp * (reduced ? 0.01 : 0.04));
      if (!reduced) {
        root.rotation.z = Math.sin(t * 0.07) * 0.03;
        root.position.y = Math.sin(t * 0.45) * 0.03;
        sphere.rotation.y = t * 0.04;
        // Keep the orb awake: drift the specular catch by easing the key light in a
        // slow orbit and turning the reflection environment.
        keyLight.position.set(-3 + Math.sin(t * 0.21) * 0.9, 4 + Math.cos(t * 0.17) * 0.5, 5);
        scene.environmentRotation.y = t * 0.035;
      }

      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fadeTimer);
      ro.disconnect();
      applyThemeRef.current = null;
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
