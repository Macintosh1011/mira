"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";

/**
 * NoiseField — the LANDING (empty) state backdrop only.
 *
 * An exact port of prophet's PerlinHero: a clean amber wireframe terrain
 * (#f59e0b @ 0.55) over a dark ghost surface (#161b22 @ 0.7), undulating with a
 * two-octave 3D simplex noise, set in fog (#0a0d12, 14→42). No dither, no Bayer
 * pass, no color ramp — just the wireframe + ghost + fog.
 *
 * Seated as a bottom-anchored horizon band (the CSS `.noise-field` block sizes
 * it to ~36vh and fades its top edge into the dark), so prophet's terrain glows
 * along the bottom of the viewport and melts upward into the page, leaving the
 * wordmark / tagline / ⌘K pill on clean dark background.
 *
 * three touches `window`, so it's dynamic-imported in the effect, exactly like
 * lib/render/libs.ts — never at module top level. The whole pipeline (renderer,
 * scene, geometry, materials, wireframe, rAF, listeners) is torn down on unmount
 * so switching out of the empty state leaks no WebGL context.
 *
 * Honors prefers-reduced-motion (single static frame) and pauses rAF when the
 * tab is hidden.
 */

// ── Inlined 3D simplex noise ─────────────────────────────────────────────────
//
// Public-domain simplex noise (Stefan Gustavson / Ashima "webgl-noise" lineage),
// the same algorithm the `simplex-noise` npm package implements as
// `createNoise3D`. Inlined here so we don't add a dependency mid-build. Returns
// smooth values in roughly [-1, 1]; we use it exactly as `noise3D(x, y, z)`.
//
// A fixed permutation table is used (rather than a per-instance random seed);
// for a continuously-drifting terrain the seed is immaterial to the look.

function buildNoise3D(): (x: number, y: number, z: number) => number {
  const grad3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  ]);

  const p = [
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140,
    36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120,
    234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33,
    88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71,
    134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133,
    230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161,
    1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130,
    116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250,
    124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227,
    47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44,
    154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98,
    108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34,
    242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14,
    239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121,
    50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243,
    141, 128, 195, 78, 66, 215, 61, 156, 180,
  ];

  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }

  const F3 = 1 / 3;
  const G3 = 1 / 6;

  return function noise3D(xin: number, yin: number, zin: number): number {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);

    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    let i1: number, j1: number, k1: number;
    let i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
      } else if (x0 < z0) {
        i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
      } else {
        i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) {
      const gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0 + grad3[gi0 + 2] * z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) {
      const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1 + grad3[gi1 + 2] * z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) {
      const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2 + grad3[gi2 + 2] * z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) {
      const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n3 = t3 * t3 * (grad3[gi3] * x3 + grad3[gi3 + 1] * y3 + grad3[gi3 + 2] * z3);
    }

    return 32 * (n0 + n1 + n2 + n3);
  };
}

// ── Tunables ─────────────────────────────────────────────────────────────────
// The 800ms mount fade lives in CSS (.noise-field transition in globals.css).
// prophet's SIZE / segment / noise constants are reproduced verbatim below.
const SIZE = 48;

export default function NoiseField() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fadedIn, setFadedIn] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let raf = 0;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const THREE = (await import("three")) as typeof THREE_NS;
      if (disposed || !container) return;

      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const isMobile = window.matchMedia("(max-width: 640px)").matches;

      // ── Scene: prophet's amber wireframe terrain in fog ────────────────────
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x0a0d12, 14, 42);

      const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
      camera.position.set(0, 9, 18);
      camera.lookAt(0, -1, 0);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
      renderer.setPixelRatio(dpr);
      // Transparent clear so the band composites over the dark page; the CSS
      // top-fade mask + fog melt the terrain upward into the background.
      renderer.setClearColor(0x000000, 0);
      const canvas = renderer.domElement;
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      container.appendChild(canvas);

      const segments = isMobile ? 64 : 96;
      const geometry = new THREE.PlaneGeometry(SIZE, SIZE, segments, segments);
      geometry.rotateX(-Math.PI / 2);

      const material = new THREE.LineBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.55,
      });
      let wire = new THREE.WireframeGeometry(geometry);
      const wireMesh = new THREE.LineSegments(wire, material);
      scene.add(wireMesh);

      const ghostMaterial = new THREE.MeshBasicMaterial({
        color: 0x161b22,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      });
      const ghostMesh = new THREE.Mesh(geometry, ghostMaterial);
      ghostMesh.position.y = -0.05;
      scene.add(ghostMesh);

      const noise3D = buildNoise3D();

      const positionAttr = geometry.attributes.position as THREE_NS.BufferAttribute;
      const initialPositions = positionAttr.array.slice() as Float32Array;

      const displace = (t: number) => {
        const arr = positionAttr.array as Float32Array;
        for (let i = 0; i < arr.length; i += 3) {
          const x = initialPositions[i];
          const z = initialPositions[i + 2];
          arr[i + 1] =
            noise3D(x * 0.08, z * 0.08, t * 0.18) * 1.6 +
            noise3D(x * 0.22, z * 0.22, t * 0.32) * 0.45;
        }
        positionAttr.needsUpdate = true;

        wire.dispose();
        wire = new THREE.WireframeGeometry(geometry);
        wireMesh.geometry.dispose();
        wireMesh.geometry = wire;

        const yaw = Math.sin(t * 0.04) * 0.04;
        ghostMesh.rotation.y = yaw;
        wireMesh.rotation.y = yaw;
      };

      const resize = () => {
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();

      const ro = new ResizeObserver(resize);
      ro.observe(container);

      // Trigger the CSS fade-in once the first frame is on screen.
      requestAnimationFrame(() => {
        if (!disposed) setFadedIn(true);
      });

      const start = performance.now();

      if (reducedMotion) {
        // Single static frame — no animation loop.
        displace(12);
        renderer.render(scene, camera);
        cleanup = () => {
          ro.disconnect();
          wire.dispose();
          geometry.dispose();
          material.dispose();
          ghostMaterial.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        };
        return;
      }

      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        displace((now - start) / 1000);
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(loop);

      const onVisibility = () => {
        if (document.hidden) {
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
        } else if (!raf && !disposed) {
          raf = requestAnimationFrame(loop);
        }
      };
      document.addEventListener("visibilitychange", onVisibility);

      cleanup = () => {
        document.removeEventListener("visibilitychange", onVisibility);
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        wire.dispose();
        geometry.dispose();
        material.dispose();
        ghostMaterial.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      };
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="noise-field"
      data-faded={fadedIn ? "in" : "out"}
      aria-hidden="true"
    />
  );
}
