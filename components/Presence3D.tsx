"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type AugustState = "boot" | "idle" | "listening" | "thinking" | "speaking";

type Props = {
  state: AugustState;
  /** 0..1 live audio level — mic RMS while listening, TTS envelope while speaking. */
  amplitudeRef: React.MutableRefObject<number>;
};

const BONE = 0xe8e6e1;
const ASH = 0x8a8a90;
const STEEL = 0x6e8ca8;

// A slowly-rotating system of concentric mechanical rings — precise, monochrome,
// a little alive. In the spirit of a title sequence, not a copy. If /circle.glb
// exists it's loaded in place of the procedural rings.
export default function Presence3D({ state, amplitudeRef }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 7.2);

    const sizeTo = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xcfd6e0, 0.7);
    key.position.set(2, 3, 5);
    scene.add(key);

    const disposables: Array<{ dispose: () => void }> = [];

    // Soft additive glow billboard behind the rings.
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 256;
    const gctx = glowCanvas.getContext("2d");
    if (gctx) {
      const grad = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      grad.addColorStop(0, "rgba(150,172,200,0.55)");
      grad.addColorStop(0.4, "rgba(110,140,168,0.16)");
      grad.addColorStop(1, "rgba(110,140,168,0)");
      gctx.fillStyle = grad;
      gctx.fillRect(0, 0, 256, 256);
    }
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.3,
    });
    const glowGeo = new THREE.PlaneGeometry(9, 9);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.z = -1;
    scene.add(glow);
    disposables.push(glowTex, glowMat, glowGeo);

    const root = new THREE.Group();
    root.rotation.x = -0.34; // slight tilt for dimensionality
    scene.add(root);

    const ringLine = (radius: number, color: number, opacity: number, segments = 220) => {
      const pts: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pts.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      disposables.push(geo, mat);
      return new THREE.Line(geo, mat);
    };
    const arc = (radius: number, a0: number, a1: number, color: number, opacity: number, segments = 90) => {
      const pts: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const a = a0 + (a1 - a0) * (i / segments);
        pts.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      disposables.push(geo, mat);
      return new THREE.Line(geo, mat);
    };
    const ticks = (radius: number, count: number, len: number, color: number, opacity: number) => {
      const pts: number[] = [];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        pts.push(c * radius, s * radius, 0, c * (radius + len), s * (radius + len), 0);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      disposables.push(geo, mat);
      return new THREE.LineSegments(geo, mat);
    };
    const torus = (radius: number, tube: number, color: number, emissive: number, opacity: number) => {
      const geo = new THREE.TorusGeometry(radius, tube, 10, 180);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: emissive,
        metalness: 0.6,
        roughness: 0.45,
        transparent: true,
        opacity,
      });
      disposables.push(geo, mat);
      return new THREE.Mesh(geo, mat);
    };

    const gA = new THREE.Group();
    gA.add(ringLine(2.55, BONE, 0.85), ticks(2.62, 120, 0.09, ASH, 0.6), arc(2.78, 0.4, 1.9, BONE, 0.5));
    const gB = new THREE.Group();
    gB.add(ringLine(1.95, ASH, 0.7), ticks(1.78, 72, -0.12, ASH, 0.5), torus(2.05, 0.012, BONE, 0.3, 0.7));
    const gC = new THREE.Group();
    gC.add(ringLine(1.25, BONE, 0.8), ticks(1.32, 90, 0.06, ASH, 0.55), arc(1.05, 3.6, 5.2, ASH, 0.6));
    const gHub = new THREE.Group();
    gHub.add(ringLine(0.55, BONE, 0.85), torus(0.5, 0.02, BONE, 0.4, 0.8), ticks(0.62, 36, 0.05, ASH, 0.5));

    const accent = torus(2.28, 0.016, STEEL, 0.8, 0);
    const accentMat = accent.material as THREE.MeshStandardMaterial;
    const accentArc = arc(2.28, 5.0, 6.0, STEEL, 0);
    const accentArcMat = accentArc.material as THREE.LineBasicMaterial;
    const gAccent = new THREE.Group();
    gAccent.add(accent, accentArc);

    root.add(gA, gB, gC, gHub, gAccent);

    sizeTo();
    const ro = new ResizeObserver(sizeTo);
    ro.observe(mount);

    // Optional GLB override.
    fetch("/circle.glb", { method: "HEAD" })
      .then((res) => {
        if (!res.ok || disposed) return;
        return import("three/examples/jsm/loaders/GLTFLoader.js").then(({ GLTFLoader }) => {
          if (disposed) return;
          new GLTFLoader().load(
            "/circle.glb",
            (gltf) => {
              if (disposed) return;
              root.clear();
              gltf.scene.scale.setScalar(2);
              root.add(gltf.scene);
            },
            undefined,
            () => {
              /* keep procedural rings on load error */
            },
          );
        });
      })
      .catch(() => {
        /* no glb — procedural rings */
      });

    let raf = 0;
    const clock = new THREE.Clock();
    let easedAccent = 0;
    let easedGlow = 0.28;
    let easedSpeed = 1;

    const render = () => {
      raf = requestAnimationFrame(render);
      if (typeof document !== "undefined" && document.hidden) return;
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;
      const st = stateRef.current;
      const amp = Math.max(0, Math.min(1, amplitudeRef.current || 0));

      let speedTarget = 1;
      let accentTarget = 0;
      let glowTarget = 0.28;
      switch (st) {
        case "listening":
          speedTarget = 1.5 + amp * 2.2;
          accentTarget = 0.5 + amp * 0.4;
          glowTarget = 0.5 + amp * 0.6;
          break;
        case "thinking":
          speedTarget = 2.2;
          accentTarget = 0.18 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.6));
          glowTarget = 0.4;
          break;
        case "speaking":
          speedTarget = 1.4 + amp * 2.6;
          accentTarget = 0.36 + amp * 0.3;
          glowTarget = 0.45 + amp * 0.7;
          break;
        default:
          speedTarget = 1;
          accentTarget = 0;
          glowTarget = 0.28;
          break;
      }

      easedSpeed += (speedTarget - easedSpeed) * Math.min(1, dt * 3);
      easedAccent += (accentTarget - easedAccent) * Math.min(1, dt * 4);
      easedGlow += (glowTarget - easedGlow) * Math.min(1, dt * 3);

      gA.rotation.z += dt * 0.06 * easedSpeed;
      gB.rotation.z -= dt * 0.11 * easedSpeed;
      gC.rotation.z += dt * 0.17 * easedSpeed;
      gHub.rotation.z -= dt * 0.24 * easedSpeed;
      gAccent.rotation.z += dt * 0.09 * easedSpeed;

      accentMat.opacity = easedAccent;
      accentArcMat.opacity = easedAccent * 0.9;
      glowMat.opacity = easedGlow;
      glow.scale.setScalar(1 + Math.sin(t * 0.7) * 0.04 + amp * 0.25);

      root.scale.setScalar(1 + Math.sin(t * 0.8) * 0.012 + amp * 0.05);
      root.rotation.z = Math.sin(t * 0.08) * 0.04;

      renderer.render(scene, camera);
    };
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
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
  }, [amplitudeRef]);

  return <div ref={mountRef} className="presence-3d" />;
}
