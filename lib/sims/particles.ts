/**
 * PARTICLES — a literal, interactive simulation of diffusion and the 2nd law.
 *
 * A box of many hard-disk particles bounces with elastic collisions (off the
 * walls AND off each other). They start CONFINED to the left half behind a
 * partition; opening the partition releases them and you watch DIFFUSION carry
 * the gas toward a uniform spatial distribution — entropy increasing in real
 * time. A small tracer subset is colored teal and leaves Brownian random-walk
 * trails. Two live histograms evolve from peaked to spread: the x-position
 * distribution (left-peaked → flat = mixed) and the speed distribution, which
 * relaxes toward the analytic 2-D Maxwell-Boltzmann curve.
 *
 * Physics (all real, deterministic from a seeded RNG):
 *   - Symplectic position integration with elastic wall reflection.
 *   - Equal-mass elastic particle-particle collisions resolved on a uniform
 *     spatial hash: exchange the velocity component along the contact normal,
 *     so kinetic energy and momentum are conserved and speeds thermalize.
 *   - Speed scale s = BASE·√T, so KE ~ v² ~ T  (½m⟨v²⟩ = k_BT in 2D).
 *   - Maxwell-Boltzmann speed PDF in 2D:  f(v) ∝ v·exp(−v²/2σ²),  σ = s/√2.
 *   - Diffusion signature:  ⟨r²⟩ ~ Dt  ⇒  spreading front ~ √t.
 *
 * setPhase beats (1:1 with narration cues):
 *   0 confined · 1 release (partition eases open) · 2 spreading · 3 equilibrium.
 * Live controls: count · temperature · particleSize · partitionOpen — all are
 * applied immediately by setParam (temperature rescales velocities in place;
 * count reseeds; size + partitionOpen are read live in draw).
 *
 * Contract: a registered `Sim` (see lib/sims/index.ts). The SimHost calls
 * `create(container, libs, content)` and drives the returned `SceneController`
 * via setPhase (narration beat) and setParam (slider). p5 2.2.3 instance mode,
 * no removed APIs — the Maxwell-Boltzmann curve is composed via kit.plot and
 * trails via manual vertex strips (never curveVertex/quadraticVertex). dispose()
 * removes the p5 instance, kills the gsap tween, and removes the KaTeX overlay.
 * All shapes come from @/lib/types — nothing is redefined here.
 */

import type {
  ControlSpec,
  SceneContent,
  SceneController,
  Sim,
  SimLibs,
} from "@/lib/types";
import type { Kit, RGB } from "@/lib/kit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P5 = any;

type ControlKey = "count" | "temperature" | "particleSize" | "partitionOpen";

// ── controls ──────────────────────────────────────────────────────────────
const CONTROLS: ControlSpec[] = [
  { key: "count", label: "Particles", min: 80, max: 1200, step: 20, default: 520 },
  { key: "temperature", label: "Temperature", min: 0.2, max: 3, step: 0.1, default: 1, unit: "T" },
  { key: "particleSize", label: "Particle Size", min: 1.5, max: 6, step: 0.5, default: 3, unit: "px" },
  { key: "partitionOpen", label: "Partition Open", min: 0, max: 1, step: 0.01, default: 0 },
];

const DEFAULTS: Record<ControlKey, number> = {
  count: 520,
  temperature: 1,
  particleSize: 3,
  partitionOpen: 0,
};

// ── phases (1:1 with narration beats) ───────────────────────────────────────
const PHASE_COUNT = 4;
const DEFAULT_PHASE_LABELS = ["confined", "release", "spreading", "equilibrium"];
const DEFAULT_EQUATION = "\\tfrac{1}{2}m\\langle v^2\\rangle = k_BT \\qquad \\langle r^2\\rangle \\sim Dt";

const TWO_PI = Math.PI * 2;
const PART_X = 0.5; // partition position in data space
const PART_HALF_THICK = 0.006;
const BASE_SPEED = 0.16; // data-space speed at T=1

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
function clampSpec(spec: ControlSpec, v: number): number {
  return Math.max(spec.min, Math.min(spec.max, v));
}

// Deterministic RNG (mulberry32) — a given (count, temperature) renders alike.
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sim: Sim = {
  id: "particles",
  title: "Diffusion & the Second Law",
  controls: CONTROLS,
  create(
    container: HTMLElement,
    libs: SimLibs,
    content: SceneContent,
  ): SceneController {
    const kit = libs.kit;
    const { palette, ease } = kit;

    // Colors: amber bulk on tinted-black; teal tracers.
    const AMBER: RGB = palette.accent;
    const TEAL: RGB = palette.teal;

    const phaseLabels = content?.phases?.length
      ? content.phases.map((ph, i) => ph.label || DEFAULT_PHASE_LABELS[i] || "")
      : DEFAULT_PHASE_LABELS;
    const equationTex = content?.equation || DEFAULT_EQUATION;

    // ── live params ───────────────────────────────────────────────────────
    const params: Record<ControlKey, number> = { ...DEFAULTS };
    for (const spec of CONTROLS) {
      const override = content?.params?.[spec.key];
      if (typeof override === "number" && Number.isFinite(override)) {
        params[spec.key as ControlKey] = clampSpec(spec, override);
      }
    }

    // Phase + gsap-eased "release" envelope (0 confined → 1 released).
    let phase = 0;
    const releaseEnv = { v: 0 };
    let releaseTween: { kill: () => void } | null = null;

    // ── particle state (typed arrays for the hot loop) ────────────────────
    const MAX = CONTROLS[0].max;
    const px = new Float32Array(MAX);
    const py = new Float32Array(MAX);
    const vx = new Float32Array(MAX);
    const vy = new Float32Array(MAX);
    const isTracer = new Uint8Array(MAX);
    let n = Math.min(MAX, Math.round(params.count));

    // Tracer trails: a ring buffer of recent positions per tracer.
    const TRACER_COUNT = 5;
    const TRAIL_LEN = 80;
    const tracerIdx: number[] = [];
    const trail: Float32Array[] = [];
    let trailHead = 0;

    const speedScale = () => BASE_SPEED * Math.sqrt(Math.max(1e-4, params.temperature));

    let rng = makeRng(0x5eed);
    function gauss(): number {
      const u1 = Math.max(1e-7, rng());
      const u2 = rng();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
    }

    // Seed: all particles confined LEFT (x∈[0.03,0.46]); velocities drawn from a
    // 2D Maxwell-Boltzmann (each component Gaussian, RMS speed ≈ scale). Spatial
    // order is what decays into entropy; speeds start thermal.
    function seed(): void {
      rng = makeRng(0x5eed + n);
      const sig = speedScale() / Math.SQRT2;
      isTracer.fill(0);
      for (let i = 0; i < n; i++) {
        px[i] = 0.03 + rng() * 0.43;
        py[i] = 0.04 + rng() * 0.92;
        vx[i] = gauss() * sig;
        vy[i] = gauss() * sig;
      }
      tracerIdx.length = 0;
      const stride = n / Math.min(TRACER_COUNT, n);
      for (let k = 0; k < TRACER_COUNT && k < n; k++) {
        const j = Math.min(n - 1, Math.floor((k + 0.5) * stride));
        tracerIdx.push(j);
        isTracer[j] = 1;
      }
      trail.length = 0;
      for (let k = 0; k < tracerIdx.length; k++) {
        const buf = new Float32Array(TRAIL_LEN * 2);
        const j = tracerIdx[k];
        for (let t = 0; t < TRAIL_LEN; t++) {
          buf[t * 2] = px[j];
          buf[t * 2 + 1] = py[j];
        }
        trail.push(buf);
      }
      trailHead = 0;
    }
    seed();

    // Rescale velocities to a new T without reseeding (preserves mixing done).
    function rescaleToTemperature(): void {
      const target = speedScale();
      let sum = 0;
      for (let i = 0; i < n; i++) sum += vx[i] * vx[i] + vy[i] * vy[i];
      const rms = Math.sqrt(sum / Math.max(1, n));
      if (rms < 1e-6) {
        const sig = target / Math.SQRT2;
        for (let i = 0; i < n; i++) {
          vx[i] = gauss() * sig;
          vy[i] = gauss() * sig;
        }
        return;
      }
      const f = target / rms;
      for (let i = 0; i < n; i++) {
        vx[i] *= f;
        vy[i] *= f;
      }
    }

    const gapFraction = () => Math.max(releaseEnv.v, clamp01(params.partitionOpen));

    // Collision radius (data space): scales with size, capped by density so
    // dense packs stay stable.
    function radius(): number {
      const base = 0.004 + (params.particleSize - 1.5) * 0.0014;
      const densityCap = 0.013 / Math.sqrt(n / 200);
      return Math.min(base, densityCap);
    }

    // ── physics step (fixed dt) ───────────────────────────────────────────
    const buckets = new Map<number, number[]>();

    function step(dt: number): void {
      const gap = gapFraction();
      const r = radius();
      const r2 = 2 * r * (2 * r);
      const gapHalf = (0.04 + gap * 0.46) / 2;
      const wallActive = gap < 0.999;

      for (let i = 0; i < n; i++) {
        let x = px[i] + vx[i] * dt;
        let y = py[i] + vy[i] * dt;

        if (x < r) {
          x = r + (r - x);
          vx[i] = Math.abs(vx[i]);
        } else if (x > 1 - r) {
          x = 1 - r - (x - (1 - r));
          vx[i] = -Math.abs(vx[i]);
        }
        if (y < r) {
          y = r + (r - y);
          vy[i] = Math.abs(vy[i]);
        } else if (y > 1 - r) {
          y = 1 - r - (y - (1 - r));
          vy[i] = -Math.abs(vy[i]);
        }

        if (wallActive && Math.abs(y - 0.5) >= gapHalf) {
          const prevX = px[i];
          const wallL = PART_X - PART_HALF_THICK - r;
          const wallR = PART_X + PART_HALF_THICK + r;
          if (prevX <= PART_X && x > wallL) {
            x = wallL;
            vx[i] = -Math.abs(vx[i]);
          } else if (prevX >= PART_X && x < wallR) {
            x = wallR;
            vx[i] = Math.abs(vx[i]);
          }
        }

        px[i] = x;
        py[i] = y;
      }

      resolveCollisions(r, r2);
    }

    function resolveCollisions(r: number, r2: number): void {
      const cellSize = Math.max(2 * r, 0.012);
      const cells = Math.max(1, Math.floor(1 / cellSize));
      buckets.clear();
      for (let i = 0; i < n; i++) {
        const cx = Math.min(cells - 1, Math.max(0, Math.floor(px[i] / cellSize)));
        const cy = Math.min(cells - 1, Math.max(0, Math.floor(py[i] / cellSize)));
        const key = cx * 4096 + cy;
        const b = buckets.get(key);
        if (b) b.push(i);
        else buckets.set(key, [i]);
      }
      for (let i = 0; i < n; i++) {
        const cx = Math.min(cells - 1, Math.max(0, Math.floor(px[i] / cellSize)));
        const cy = Math.min(cells - 1, Math.max(0, Math.floor(py[i] / cellSize)));
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const ncx = cx + ox;
            const ncy = cy + oy;
            if (ncx < 0 || ncy < 0 || ncx >= cells || ncy >= cells) continue;
            const b = buckets.get(ncx * 4096 + ncy);
            if (!b) continue;
            for (let kk = 0; kk < b.length; kk++) {
              const j = b[kk];
              if (j <= i) continue;
              const dx = px[j] - px[i];
              const dy = py[j] - py[i];
              const d2 = dx * dx + dy * dy;
              if (d2 >= r2 || d2 < 1e-12) continue;
              const d = Math.sqrt(d2);
              const nx = dx / d;
              const ny = dy / d;
              const sep = (2 * r - d) / 2;
              px[i] -= nx * sep;
              py[i] -= ny * sep;
              px[j] += nx * sep;
              py[j] += ny * sep;
              const vn = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny;
              if (vn > 0) continue; // already separating
              // Equal-mass elastic: exchange the normal velocity component.
              vx[i] += vn * nx;
              vy[i] += vn * ny;
              vx[j] -= vn * nx;
              vy[j] -= vn * ny;
            }
          }
        }
      }
    }

    // ── statistics ────────────────────────────────────────────────────────
    const X_BINS = 22;
    const SPEED_BINS = 22;
    const xHist = new Float32Array(X_BINS);
    const speedHist = new Float32Array(SPEED_BINS);
    const xHistSmooth = new Float32Array(X_BINS); // low-passed so bars don't strobe
    const speedHistSmooth = new Float32Array(SPEED_BINS);
    let meanSpeed = 0;
    let rightFrac = 0;
    let speedAxisMax = 1e-4;

    function computeStats(): void {
      xHist.fill(0);
      speedHist.fill(0);
      let sSum = 0;
      let right = 0;
      const sMax = speedScale() * 3.2 + 1e-4;
      speedAxisMax = sMax;
      for (let i = 0; i < n; i++) {
        const xb = Math.min(X_BINS - 1, Math.max(0, Math.floor(px[i] * X_BINS)));
        xHist[xb] += 1;
        const sp = Math.hypot(vx[i], vy[i]);
        sSum += sp;
        const sb = Math.min(SPEED_BINS - 1, Math.max(0, Math.floor((sp / sMax) * SPEED_BINS)));
        speedHist[sb] += 1;
        if (px[i] > PART_X) right += 1;
      }
      meanSpeed = sSum / Math.max(1, n);
      rightFrac = right / Math.max(1, n);
      normalizeAndSmooth(xHist, xHistSmooth);
      normalizeAndSmooth(speedHist, speedHistSmooth);
    }

    function normalizeAndSmooth(src: Float32Array, dst: Float32Array): void {
      let mx = 0;
      for (let i = 0; i < src.length; i++) if (src[i] > mx) mx = src[i];
      const inv = mx > 0 ? 1 / mx : 0;
      for (let i = 0; i < src.length; i++) dst[i] += (src[i] * inv - dst[i]) * 0.18;
    }

    // "Mixedness" 0..1: 1 when x-distribution is flat (max spatial entropy),
    // 0 when fully peaked. 1 − normalized L1 distance from the uniform dist.
    function uniformity(): number {
      let sum = 0;
      for (let i = 0; i < xHistSmooth.length; i++) sum += xHistSmooth[i];
      if (sum <= 0) return 0;
      const u = 1 / xHistSmooth.length;
      let dist = 0;
      for (let i = 0; i < xHistSmooth.length; i++) dist += Math.abs(xHistSmooth[i] / sum - u);
      return clamp01(1 - dist / (2 * (1 - u)));
    }

    // 2D Maxwell-Boltzmann speed PDF, sampled to a polyline normalized to peak 1
    // over the speed axis [0,1] (for kit.plot, no curveVertex needed).
    function maxwellCurve(samples: number): { x: number; y: number }[] {
      const sigma = speedScale() / Math.SQRT2;
      const sMax = speedAxisMax;
      const raw: number[] = [];
      let peak = 0;
      for (let i = 0; i <= samples; i++) {
        const v = (i / samples) * sMax;
        const f = (v / (sigma * sigma)) * Math.exp(-(v * v) / (2 * sigma * sigma));
        raw.push(f);
        if (f > peak) peak = f;
      }
      return raw.map((f, i) => ({ x: i / samples, y: peak > 0 ? f / peak : 0 }));
    }

    // ── KaTeX equation overlay (DOM), with graceful absence ───────────────
    const eqEl = mountEquation(container, libs, equationTex, palette);

    // ── layout (recomputed per frame from live canvas size) ───────────────
    let W = container.clientWidth || 1280;
    let H = container.clientHeight || 720;

    interface Layout {
      boxX: number;
      boxY: number;
      boxW: number;
      boxH: number;
      panelX: number;
      panelW: number;
    }
    function layout(): Layout {
      const padT = 92;
      const padB = 66;
      const padL = 32;
      const padR = 34;
      const gapMid = 60;
      const usableW = W - padL - padR - gapMid;
      const boxW = Math.max(120, Math.min(usableW * 0.56, H - padT - padB));
      const boxX = padL;
      const boxY = padT + (H - padT - padB - boxW) / 2;
      const panelX = boxX + boxW + gapMid;
      return {
        boxX,
        boxY,
        boxW,
        boxH: boxW,
        panelX,
        panelW: Math.max(120, W - padR - panelX),
      };
    }

    let accTime = 0;

    const sketch = (p: P5) => {
      p.setup = () => {
        W = container.clientWidth || W;
        H = container.clientHeight || H;
        const c = p.createCanvas(W, H);
        if (c && c.style) c.style("display", "block");
        kit.useFonts(p);
      };

      p.windowResized = () => {
        W = container.clientWidth || W;
        H = container.clientHeight || H;
        p.resizeCanvas(W, H);
      };

      p.draw = () => {
        // Fixed-step physics for determinism + stability; clamp dt so a stalled
        // tab doesn't explode the integrator, and cap sub-steps per frame.
        const dtReal = Math.min(0.05, (p.deltaTime || 16.7) / 1000);
        accTime += dtReal;
        const SUB = 0.008;
        let budget = 3;
        while (accTime >= SUB && budget-- > 0) {
          step(SUB);
          accTime -= SUB;
        }
        if (accTime > SUB) accTime = 0;

        for (let k = 0; k < tracerIdx.length; k++) {
          const j = tracerIdx[k];
          const buf = trail[k];
          buf[trailHead * 2] = px[j];
          buf[trailHead * 2 + 1] = py[j];
        }
        trailHead = (trailHead + 1) % TRAIL_LEN;

        computeStats();

        const L = layout();
        kit.grid(p, { reveal: 1, cell: 120, wash: AMBER });
        drawHeader(p, L);
        drawBox(p, L);
        drawParticles(p, L);
        drawTracerTrails(p, L);
        drawPartition(p, L);
        drawHistograms(p, L);
        drawReadouts(p);
        if (eqEl) eqEl.style.opacity = gapFraction() > 0.5 ? "1" : "0.7";
        else drawEqnFallback(p, L);

        kit.phaseDots(p, {
          x: L.boxX,
          y: H - 30,
          total: PHASE_COUNT,
          current: phase,
          label: phaseLabels[Math.min(phase, PHASE_COUNT - 1)],
          color: AMBER,
        });
      };
    };

    function drawHeader(p: P5, L: Layout): void {
      kit.label(p, { x: L.boxX, y: 36, text: content?.title || sim.title, size: 20, weight: "bold", color: palette.fg, align: "left" });
      kit.label(p, { x: L.boxX, y: 60, text: "Elastic gas · entropy increase", size: 11, upper: true, mono: true, color: palette.fgMuted, align: "left" });
    }

    function drawBox(p: P5, L: Layout): void {
      p.push();
      p.noFill();
      p.stroke(255, 255, 255, 0.16 * 255);
      p.strokeWeight(1.5);
      p.rect(L.boxX, L.boxY, L.boxW, L.boxH, 6);
      p.pop();
    }

    function drawParticles(p: P5, L: Layout): void {
      const sz = params.particleSize;
      p.push();
      p.noStroke();
      kit.fill(p, AMBER, 0.82);
      for (let i = 0; i < n; i++) {
        if (isTracer[i]) continue;
        p.circle(L.boxX + px[i] * L.boxW, L.boxY + py[i] * L.boxH, sz);
      }
      p.pop();
    }

    function drawTracerTrails(p: P5, L: Layout): void {
      const sz = params.particleSize;
      const cut = L.boxW * 0.5; // skip wrap-around teleport segments
      p.push();
      p.noFill();
      p.strokeCap(p.ROUND);
      p.strokeJoin(p.ROUND);
      for (let k = 0; k < tracerIdx.length; k++) {
        const buf = trail[k];
        let prevX = 0;
        let prevY = 0;
        let has = false;
        for (let s = 1; s <= TRAIL_LEN; s++) {
          const idx = (trailHead + s) % TRAIL_LEN;
          const a = s / TRAIL_LEN; // alpha ramps toward the head
          const cx = L.boxX + buf[idx * 2] * L.boxW;
          const cy = L.boxY + buf[idx * 2 + 1] * L.boxH;
          if (has && Math.hypot(cx - prevX, cy - prevY) < cut) {
            p.stroke(TEAL[0], TEAL[1], TEAL[2], a * 0.55 * 255);
            p.strokeWeight(1.5);
            p.line(prevX, prevY, cx, cy);
          }
          prevX = cx;
          prevY = cy;
          has = true;
        }
      }
      p.noStroke();
      for (let k = 0; k < tracerIdx.length; k++) {
        const j = tracerIdx[k];
        const cx = L.boxX + px[j] * L.boxW;
        const cy = L.boxY + py[j] * L.boxH;
        for (let g = 3; g >= 1; g--) {
          kit.fill(p, TEAL, 0.1 * (4 - g));
          p.circle(cx, cy, sz + g * 3.2);
        }
        kit.fill(p, TEAL, 1);
        p.circle(cx, cy, sz + 1.5);
      }
      p.pop();
    }

    function drawPartition(p: P5, L: Layout): void {
      const gap = gapFraction();
      if (gap >= 0.999) return;
      const gapHalf = (0.04 + gap * 0.46) / 2;
      const wx = L.boxX + PART_X * L.boxW;
      const gapTop = L.boxY + (0.5 - gapHalf) * L.boxH;
      const gapBot = L.boxY + (0.5 + gapHalf) * L.boxH;
      p.push();
      p.stroke(255, 255, 255, (0.28 - gap * 0.18) * 255);
      p.strokeWeight(2);
      p.strokeCap(p.ROUND);
      p.line(wx, L.boxY, wx, gapTop);
      p.line(wx, gapBot, wx, L.boxY + L.boxH);
      if (gap > 0.01) {
        kit.stroke(p, AMBER, 0.5 * gap, 2); // the "door" edges glow as it opens
        p.line(wx - 5, gapTop, wx + 5, gapTop);
        p.line(wx - 5, gapBot, wx + 5, gapBot);
      }
      p.pop();
    }

    function drawHistograms(p: P5, L: Layout): void {
      const colTop = L.boxY;
      const hGap = 58;
      const hH = (L.boxH - hGap) / 2;
      const ax = L.panelX + 8;
      const aw = L.panelW - 14;

      // ── x-position histogram (the entropy headline) ──
      kit.label(p, { x: ax, y: colTop - 18, text: "POSITION DISTRIBUTION", size: 10, upper: true, mono: true, color: palette.fgMuted, align: "left" });
      kit.label(p, { x: ax + aw, y: colTop - 18, text: (uniformity() * 100).toFixed(0) + "% MIXED", size: 11, mono: true, weight: "bold", color: AMBER, align: "right" });
      kit.axesPro(p, { x: ax, y: colTop, w: aw, h: hH, xMin: 0, xMax: 1, yMin: 0, yMax: 1, ticks: 4, xLabel: "Position x", decimals: 1, color: palette.fgMuted });
      drawHistBars(p, ax, colTop, aw, hH, xHistSmooth, X_BINS, AMBER);
      drawDashedMarker(p, ax + PART_X * aw, colTop, hH); // partition line

      // ── speed histogram + Maxwell-Boltzmann overlay ──
      const sy = colTop + hH + hGap;
      kit.label(p, { x: ax, y: sy - 18, text: "SPEED DISTRIBUTION", size: 10, upper: true, mono: true, color: palette.fgMuted, align: "left" });
      kit.axesPro(p, { x: ax, y: sy, w: aw, h: hH, xMin: 0, xMax: 1, yMin: 0, yMax: 1, ticks: 4, xLabel: "Speed |v|", decimals: 1, color: palette.fgMuted });
      drawHistBars(p, ax, sy, aw, hH, speedHistSmooth, SPEED_BINS, TEAL);
      kit.plot(p, {
        x: ax,
        y: sy,
        w: aw,
        h: hH,
        points: maxwellCurve(48),
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
        drawProgress: 0.4 + 0.6 * ease.smoothstep(clamp01(gapFraction())),
        color: AMBER,
        head: false,
        weight: 1.5,
        clip: true,
      });

      kit.legend(p, {
        x: ax,
        y: sy + hH + 34,
        items: [
          { color: AMBER, label: "Maxwell-Boltzmann f(v)" },
          { color: TEAL, label: "Measured speeds" },
        ],
        rowH: 18,
        swatch: "line",
      });
    }

    function drawHistBars(p: P5, x: number, y: number, w: number, h: number, hist: Float32Array, bins: number, color: RGB): void {
      const bw = w / bins;
      p.push();
      p.noStroke();
      for (let i = 0; i < bins; i++) {
        const v = clamp01(hist[i]);
        const bh = v * (h - 4);
        if (bh < 0.5) continue;
        kit.fill(p, color, 0.28 + 0.5 * v);
        p.rect(x + i * bw + 1, y + h - bh, bw - 2, bh, 2);
      }
      p.pop();
    }

    function drawDashedMarker(p: P5, mx: number, y: number, h: number): void {
      p.push();
      p.stroke(255, 255, 255, 0.22 * 255);
      p.strokeWeight(1);
      const seg = 5;
      for (let yy = y; yy < y + h; yy += seg * 2) {
        p.line(mx, yy, mx, Math.min(y + h, yy + seg));
      }
      p.pop();
    }

    function drawReadouts(p: P5): void {
      const ry = 32;
      const rx = W - 30;
      kit.readout(p, { x: rx, y: ry, label: "Temperature", value: params.temperature, unit: "T", decimals: 1, size: 18, align: "right", color: AMBER });
      kit.readout(p, { x: rx - 156, y: ry, label: "Mean Speed", value: meanSpeed * 100, decimals: 1, size: 18, align: "right", color: TEAL });
      kit.readout(p, { x: rx - 312, y: ry, label: "Particles", value: String(n), size: 18, align: "right", color: palette.fg });
      kit.readout(p, { x: rx - 430, y: ry, label: "Right %", value: (rightFrac * 100).toFixed(0) + "%", size: 18, align: "right", color: palette.fg });
    }

    function drawEqnFallback(p: P5, L: Layout): void {
      kit.label(p, {
        x: L.boxX,
        y: L.boxY + L.boxH + 26,
        text: "½ m⟨v²⟩ = kT      ⟨r²⟩ ~ Dt   ⇒   r ~ √t",
        size: 12,
        mono: true,
        color: palette.fgMuted,
        align: "left",
      });
    }

    const inst = new libs.p5(sketch, container);

    return {
      // 0 confined · 1 release (gap eases open) · 2 spreading · 3 equilibrium.
      setPhase(idx: number) {
        const next = Math.max(0, Math.min(PHASE_COUNT - 1, Math.floor(idx)));
        if (next === phase) return;
        phase = next;
        releaseTween?.kill();
        const target = next >= 1 ? 1 : 0;
        const gsap = libs.gsap;
        if (gsap && typeof gsap.to === "function") {
          releaseTween = gsap.to(releaseEnv, {
            v: target,
            duration: next === 1 ? 1.6 : 0.9,
            ease: "power3.out",
            overwrite: true,
          });
        } else {
          releaseEnv.v = target;
        }
      },
      setParam(key: string, value: number) {
        const spec = CONTROLS.find((c) => c.key === key);
        if (!spec || !Number.isFinite(value)) return;
        const v = clampSpec(spec, value);
        const k = key as ControlKey;
        const prev = params[k];
        params[k] = v;
        if (k === "count") {
          const newN = Math.min(MAX, Math.round(v));
          if (newN !== n) {
            n = newN;
            seed();
          }
        } else if (k === "temperature" && v !== prev) {
          rescaleToTemperature();
        }
        // particleSize + partitionOpen are read live in draw.
      },
      dispose() {
        releaseTween?.kill();
        releaseTween = null;
        if (eqEl && eqEl.parentNode) eqEl.parentNode.removeChild(eqEl);
        buckets.clear();
        inst.remove();
      },
    };
  },
};

export default sim;

// ── KaTeX equation overlay (DOM), with graceful absence ──────────────────────
/**
 * Render the KaTeX source to an absolutely-positioned node under the canvas's
 * top-left. Returns null when katex is unavailable or rendering throws — the
 * canvas then draws a mono-text fallback instead. The container is made
 * position-relative only if currently static; the node is removed on dispose.
 */
function mountEquation(
  container: HTMLElement,
  libs: SimLibs,
  tex: string,
  palette: Kit["palette"],
): HTMLElement | null {
  const katex = libs.katex;
  const renderToString: ((t: string, o?: object) => string) | undefined =
    katex && typeof katex.renderToString === "function"
      ? katex.renderToString.bind(katex)
      : katex?.default && typeof katex.default.renderToString === "function"
        ? katex.default.renderToString.bind(katex.default)
        : undefined;
  if (!renderToString || typeof document === "undefined") return null;

  try {
    const html = renderToString(tex, { throwOnError: false, displayMode: false });
    const el = document.createElement("div");
    el.innerHTML = html;
    el.style.position = "absolute";
    el.style.left = "32px";
    el.style.bottom = "30px";
    el.style.pointerEvents = "none";
    el.style.color = `rgb(${palette.fgMuted[0]},${palette.fgMuted[1]},${palette.fgMuted[2]})`;
    el.style.fontSize = "16px";
    el.style.zIndex = "2";
    el.style.transition = "opacity 200ms ease";
    el.style.textShadow = "0 1px 2px rgba(0,0,0,0.6)";
    const cs = typeof window !== "undefined" ? window.getComputedStyle(container) : null;
    if (cs && cs.position === "static") container.style.position = "relative";
    container.appendChild(el);
    return el;
  } catch {
    return null;
  }
}
