/**
 * flow-field — a literal, interactive vector-field / fluid simulation.
 *
 * A real 2D vector field is sampled on a faint grid (arrows) and used to advect
 * thousands of light particles as streamlines. Particles leave fading trails so
 * the flow becomes visible — like a wind map or streaklines in a flow tank.
 *
 * The field is analytic + divergence-free, so the continuity equation ∇·v = 0
 * shown in the overlay actually holds:
 *   - VORTEX        a single rotational vortex (v ⟂ r, |v| ∝ 1/r softened)
 *   - SOURCE-SINK   a source (left) and a sink (right) — a flow dipole
 *   - OBSTACLE      uniform wind past a cylinder (potential-flow doublet),
 *                   showing flow that wraps and separates around the body
 * On top of any field we add CURL noise (the perpendicular of a Perlin-noise
 * gradient), which is divergence-free by construction, for organic turbulence.
 *
 * Particles are coloured by speed: amber #efc540 (fast) → teal → blue (slow).
 *
 * Contract: default-exported `Sim`. `create(container, libs, content)` mounts a
 * p5 instance and returns a `SceneController` ({ setPhase, setParam, dispose }).
 * No runtime p5/three import — everything arrives through `libs`. Deterministic:
 * fixed seeds for particle layout and the noise field, so identical inputs draw
 * an identical sequence.
 *
 * p5 2.2.3: uses only stable instance-mode APIs (createCanvas, background, line,
 * circle, noise/noiseSeed/randomSeed, push/pop, resizeCanvas). No removed APIs.
 */
import type {
  ControlSpec,
  SceneContent,
  SceneController,
  Sim,
  SimLibs,
} from "@/lib/types";
import type { Kit, P5, RGB } from "@/lib/kit";

// ── design space ──────────────────────────────────────────────────────────
// We think in a fixed 1600×900 design space and scale it into the container,
// exactly like the gold-standard examples, so geometry is resolution-stable.
const VW = 1600;
const VH = 900;
const SEED = 0x10f1e1d; // deterministic seed for particles + noise

const CONTROLS: ControlSpec[] = [
  { key: "flowSpeed", label: "Flow speed", min: 0.1, max: 3, step: 0.05, default: 1, unit: "×" },
  { key: "viscosity", label: "Trail persistence", min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: "turbulence", label: "Turbulence", min: 0, max: 1, step: 0.01, default: 0.35 },
  { key: "particleCount", label: "Particles", min: 200, max: 4000, step: 50, default: 1800 },
  // 0 = vortex, 1 = source-sink dipole, 2 = uniform wind + obstacle.
  { key: "fieldType", label: "Field (vortex / dipole / obstacle)", min: 0, max: 2, step: 1, default: 0 },
];

// Phase intents — 1:1 with narration beats, rendered cumulatively.
const PHASE_LABELS = ["field", "particles seeded", "streamlines", "feature"] as const;

// Field-specific tuning, all in design-space units.
const FIELD = {
  // vortex
  vortexX: VW * 0.5,
  vortexY: VH * 0.5,
  vortexCore: 110, // softening radius — caps speed at the core
  vortexStrength: 26000,
  // source-sink dipole
  srcX: VW * 0.3,
  srcY: VH * 0.5,
  sinkX: VW * 0.7,
  sinkY: VH * 0.5,
  poleCore: 70,
  poleStrength: 18000,
  // uniform wind past a cylinder (potential-flow doublet)
  windU: 150, // free-stream speed (design px/s before flowSpeed)
  obsX: VW * 0.42,
  obsY: VH * 0.5,
  obsR: 130, // cylinder radius
};

type FieldType = 0 | 1 | 2;

interface Particle {
  x: number;
  y: number;
  px: number; // previous position (for the trail segment)
  py: number;
  life: number; // remaining lifetime in seconds
  maxLife: number;
}

interface Params {
  flowSpeed: number;
  viscosity: number;
  turbulence: number;
  particleCount: number;
  fieldType: FieldType;
}

interface Vel {
  vx: number;
  vy: number;
}

// A tiny deterministic PRNG (mulberry32) so particle layout never depends on
// Math.random / p5 global state — identical seed ⇒ identical scene.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Speed → colour ramp: amber (fast) → teal (mid) → blue (slow).
function speedColor(kit: Kit, speed: number, fastRef: number): RGB {
  const t = kit.clamp01(speed / fastRef);
  const { accent, teal, blue } = kit.palette;
  // two-stop lerp: blue→teal for the slow half, teal→amber for the fast half.
  if (t < 0.5) {
    const k = t / 0.5;
    return [
      Math.round(kit.lerp(blue[0], teal[0], k)),
      Math.round(kit.lerp(blue[1], teal[1], k)),
      Math.round(kit.lerp(blue[2], teal[2], k)),
    ];
  }
  const k = (t - 0.5) / 0.5;
  return [
    Math.round(kit.lerp(teal[0], accent[0], k)),
    Math.round(kit.lerp(teal[1], accent[1], k)),
    Math.round(kit.lerp(teal[2], accent[2], k)),
  ];
}

const sim: Sim = {
  id: "flow-field",
  title: "Flow field — advected streamlines",
  controls: CONTROLS,

  create(
    container: HTMLElement,
    libs: SimLibs,
    content: SceneContent,
  ): SceneController {
    const { p5, kit, katex } = libs;
    const { palette, ease } = kit;

    // ── live, mutable state (shared by setup/draw/setParam) ────────────────
    const params: Params = {
      flowSpeed: numParam(content, "flowSpeed", 1),
      viscosity: numParam(content, "viscosity", 0.55),
      turbulence: numParam(content, "turbulence", 0.35),
      particleCount: numParam(content, "particleCount", 1800),
      fieldType: clampFieldType(numParam(content, "fieldType", 0)),
    };
    let phase = 0;
    let particles: Particle[] = [];
    let maxSpeedSeen = 1; // smoothed readout of the peak speed on screen
    let started = 0; // ms timestamp the current phase began, for local easing

    const rng = mulberry32(SEED);

    // ── the vector field ───────────────────────────────────────────────────
    // Writes velocity in design px/s at design-space (x, y) into `out`.
    // Divergence-free base field + curl-noise turbulence (also div-free).
    let pInst: P5 | null = null; // set in setup; needed for p.noise
    function fieldAt(x: number, y: number, tSec: number, out: Vel): void {
      let vx = 0;
      let vy = 0;

      if (params.fieldType === 0) {
        // VORTEX — velocity perpendicular to the radius, magnitude ∝ 1/r
        // softened by a core radius so the centre doesn't blow up.
        const dx = x - FIELD.vortexX;
        const dy = y - FIELD.vortexY;
        const r2 = dx * dx + dy * dy + FIELD.vortexCore * FIELD.vortexCore;
        const k = FIELD.vortexStrength / r2;
        vx += -dy * k;
        vy += dx * k;
      } else if (params.fieldType === 1) {
        // SOURCE-SINK — radial out of the source, into the sink. Their sum is
        // divergence-free everywhere except at the two singular points.
        addRadial(x, y, FIELD.srcX, FIELD.srcY, +FIELD.poleStrength, out);
        vx += out.vx;
        vy += out.vy;
        addRadial(x, y, FIELD.sinkX, FIELD.sinkY, -FIELD.poleStrength, out);
        vx += out.vx;
        vy += out.vy;
      } else {
        // OBSTACLE — uniform free stream U past a cylinder, a doublet flow:
        // v = U·(1 − R²(x²−y²)/r⁴, −2R²xy/r⁴) in body-local coords.
        const lx = x - FIELD.obsX;
        const ly = y - FIELD.obsY;
        const r2 = lx * lx + ly * ly;
        const U = FIELD.windU;
        if (r2 > FIELD.obsR * FIELD.obsR) {
          const R2 = FIELD.obsR * FIELD.obsR;
          const inv = 1 / (r2 * r2);
          vx += U * (1 - R2 * (lx * lx - ly * ly) * inv);
          vy += U * (-2 * R2 * lx * ly * inv);
        }
        // Inside the body: zero (solid). Particles are pushed out by the
        // obstacle reseed in the integrator.
      }

      // CURL-NOISE turbulence: ψ = Perlin(x,y,t); v_turb = (∂ψ/∂y, −∂ψ/∂x).
      // The curl of a scalar potential is divergence-free, so this perturbs the
      // streamlines without creating sources/sinks. Scaled by `turbulence`.
      if (params.turbulence > 0 && pInst) {
        const ns = 0.0016; // noise spatial scale
        const eps = 1.5;
        const tz = tSec * 0.08;
        const n1 = pInst.noise((x + eps) * ns, y * ns, tz);
        const n2 = pInst.noise((x - eps) * ns, y * ns, tz);
        const n3 = pInst.noise(x * ns, (y + eps) * ns, tz);
        const n4 = pInst.noise(x * ns, (y - eps) * ns, tz);
        const dpsiDx = (n1 - n2) / (2 * eps);
        const dpsiDy = (n3 - n4) / (2 * eps);
        const amp = params.turbulence * 26000;
        vx += dpsiDy * amp;
        vy += -dpsiDx * amp;
      }

      out.vx = vx * params.flowSpeed;
      out.vy = vy * params.flowSpeed;
    }

    function addRadial(
      x: number,
      y: number,
      cx: number,
      cy: number,
      strength: number,
      out: Vel,
    ): void {
      const dx = x - cx;
      const dy = y - cy;
      const r2 = dx * dx + dy * dy + FIELD.poleCore * FIELD.poleCore;
      const k = strength / r2;
      out.vx = dx * k;
      out.vy = dy * k;
    }

    // ── particle lifecycle ──────────────────────────────────────────────────
    function seedParticle(into: Particle): void {
      // Seed across the field. For the obstacle case, bias seeding to the left
      // so particles stream rightward into the body and reveal the wake.
      let x: number;
      let y: number;
      if (params.fieldType === 2) {
        x = rng() * VW * 0.25;
        y = rng() * VH;
        if (inObstacle(x, y)) x = rng() * VW * 0.2;
      } else {
        x = rng() * VW;
        y = rng() * VH;
      }
      into.x = x;
      into.y = y;
      into.px = x;
      into.py = y;
      into.maxLife = 2.5 + rng() * 3.5;
      into.life = into.maxLife;
    }

    function inObstacle(x: number, y: number): boolean {
      if (params.fieldType !== 2) return false;
      const dx = x - FIELD.obsX;
      const dy = y - FIELD.obsY;
      return dx * dx + dy * dy <= FIELD.obsR * FIELD.obsR;
    }

    function ensureCount(n: number): void {
      n = Math.round(n);
      if (particles.length < n) {
        for (let i = particles.length; i < n; i++) {
          const pt: Particle = { x: 0, y: 0, px: 0, py: 0, life: 0, maxLife: 1 };
          seedParticle(pt);
          // Stagger initial lifetimes so trails don't all reseed in lockstep.
          pt.life = rng() * pt.maxLife;
          particles.push(pt);
        }
      } else if (particles.length > n) {
        particles.length = n;
      }
    }

    // ── the equation overlay (KaTeX into a positioned div) ───────────────────
    // The kit has no equation primitive at runtime, so we render KaTeX into an
    // absolutely-positioned overlay inside the container — the standard pattern.
    const equationOverlay = makeEquationOverlay(container, katex);
    const continuityTex =
      content.equation ??
      "\\nabla\\cdot\\mathbf{v}=0 \\qquad \\dot{\\mathbf{x}}=\\mathbf{v}(\\mathbf{x},t)";

    // ── p5 sketch ────────────────────────────────────────────────────────────
    const vel: Vel = { vx: 0, vy: 0 }; // scratch reused per sample (no per-frame GC)
    let lastT = 0;

    const sketch = (p: P5) => {
      let W = container.clientWidth || 1280;
      let H = container.clientHeight || 720;

      p.setup = () => {
        pInst = p;
        const c = p.createCanvas(W, H);
        c.style("display", "block");
        kit.useFonts(p);
        p.noiseSeed(SEED);
        p.randomSeed(SEED);
        ensureCount(params.particleCount);
        started = p.millis();
        lastT = p.millis() / 1000;
        // Paint the tinted-black paper once so the first trail frames blend.
        p.background(palette.bg[0], palette.bg[1], palette.bg[2]);
      };

      p.draw = () => {
        // Handle live container resize without losing state.
        const cw = container.clientWidth || W;
        const chh = container.clientHeight || H;
        if (cw !== W || chh !== H) {
          W = cw;
          H = chh;
          p.resizeCanvas(W, H);
          p.background(palette.bg[0], palette.bg[1], palette.bg[2]);
        }

        const tSec = p.millis() / 1000;
        let dt = tSec - lastT;
        lastT = tSec;
        // Clamp dt so a stalled tab (huge dt) can't fling particles off-field.
        if (dt > 0.05) dt = 0.05;
        if (dt < 0) dt = 0;

        const elapsed = p.millis() - started;

        const sc = Math.min(W / VW, H / VH);
        const offX = W / 2 - (VW * sc) / 2;
        const offY = H / 2 - (VH * sc) / 2;

        // ── TRAIL FADE ──────────────────────────────────────────────────────
        // Instead of clearing, paint a translucent paper rect over everything.
        // Lower alpha (high viscosity) ⇒ longer-lived trails ⇒ "thicker" fluid.
        // Phase 0 is a clean arrow field on a freshly painted background.
        if (phase >= 1) {
          const fade = kit.lerp(0.32, 0.04, kit.clamp01(params.viscosity));
          p.noStroke();
          p.fill(palette.bg[0], palette.bg[1], palette.bg[2], fade * 255);
          p.rect(0, 0, W, H);
        } else {
          p.background(palette.bg[0], palette.bg[1], palette.bg[2]);
        }

        p.push();
        p.translate(offX, offY);
        p.scale(sc);

        // ── FIELD ARROWS — staged diagonal sweep at P0 so the field reads as
        // BUILDING, then held faint underneath once particles take over. ─────
        const arrowSweep =
          phase === 0 ? ease.smoothstep(Math.min(1, elapsed / 1700)) : 1;
        // Brighter while it's the focus (P0), dim once it's just scaffolding.
        const arrowAlpha = phase === 0 ? 0.55 : 0.12;
        drawFieldArrows(p, kit, fieldAt, tSec, arrowAlpha, arrowSweep);

        // Feature markers, gated by phase. P0 stays a pure arrow field. The
        // obstacle BODY appears once particles flow (P1+) so trails visibly
        // part around it; its accent emphasis (and the vortex core / poles)
        // only light up on the feature beat (P3).
        if (params.fieldType === 2 && phase >= 1) {
          drawObstacle(p, kit, phase);
        } else if (params.fieldType === 0 && phase >= 3) {
          drawVortexCore(p, kit, tSec);
        } else if (params.fieldType === 1 && phase >= 3) {
          drawPoles(p, kit);
        }

        // ── PARTICLES (phase ≥ 1) ───────────────────────────────────────────
        if (phase >= 1) {
          ensureCount(params.particleCount);
          // During the seeding beat, ramp how many are "alive" so they appear
          // to be released rather than popping in all at once.
          const seedRamp =
            phase === 1 ? ease.smoothstep(Math.min(1, elapsed / 1400)) : 1;
          const aliveCount = Math.round(particles.length * seedRamp);

          // Speed reference for the colour ramp: adapts to flowSpeed so colours
          // stay meaningful as the slider moves.
          const fastRef = 220 * params.flowSpeed + 40;
          let frameMax = 0;

          p.strokeCap(p.ROUND);
          for (let i = 0; i < aliveCount; i++) {
            const pt = particles[i];

            // RK2 (midpoint) integration of ẋ = v(x,t) for smooth streamlines.
            fieldAt(pt.x, pt.y, tSec, vel);
            const k1x = vel.vx;
            const k1y = vel.vy;
            const mx = pt.x + k1x * dt * 0.5;
            const my = pt.y + k1y * dt * 0.5;
            fieldAt(mx, my, tSec, vel);
            const vxF = vel.vx;
            const vyF = vel.vy;

            pt.px = pt.x;
            pt.py = pt.y;
            pt.x += vxF * dt;
            pt.y += vyF * dt;
            pt.life -= dt;

            const speed = Math.hypot(vxF, vyF);
            if (speed > frameMax) frameMax = speed;

            // Reseed if dead, out of bounds (with margin), or it entered the
            // obstacle (flow can't penetrate the body).
            const margin = 40;
            const offField =
              pt.x < -margin ||
              pt.x > VW + margin ||
              pt.y < -margin ||
              pt.y > VH + margin;
            if (pt.life <= 0 || offField || inObstacle(pt.x, pt.y)) {
              seedParticle(pt);
              continue; // skip drawing so no segment jumps across the canvas
            }

            // Trail segment, coloured by speed, faded at birth/death so
            // particles don't pop. Thin (~1px) lines per the flat aesthetic.
            const col = speedColor(kit, speed, fastRef);
            const lifeFade = kit.clamp01(
              Math.min(pt.life, pt.maxLife - pt.life) * 3,
            );
            const baseAlpha = phase >= 2 ? 0.85 : 0.55;
            kit.stroke(p, col, baseAlpha * lifeFade * seedRamp, 1.1);
            p.line(pt.px, pt.py, pt.x, pt.y);
          }

          // Smooth the peak-speed readout (design px/s ⇒ screen-independent).
          maxSpeedSeen = kit.lerp(maxSpeedSeen, frameMax, 0.08);
        }

        p.pop();

        // ── HUD (screen space, on top, in its OWN clean panel) ──────────────
        // Gated by phase: P0 shows only a minimal field-name label so the
        // building arrow grid stays uncluttered; the full readout panel (with
        // an opaque backing so arrows never bleed through the text) reveals on
        // the feature beat. Reveal is local-eased off the phase-3 clock.
        const hudReveal =
          phase >= 3 ? ease.outCubic(Math.min(1, elapsed / 600)) : 0;
        drawHud(p, kit, {
          fieldType: params.fieldType,
          maxSpeed: maxSpeedSeen,
          particleCount: Math.round(params.particleCount),
          turbulence: params.turbulence,
          reveal: hudReveal,
        });

        // Continuity / streamline equation appears on the feature beat, fading
        // in with the panel so the math, the feature and the readouts land
        // together as one beat.
        positionEquation(equationOverlay, {
          x: W / 2,
          y: H - 60,
          latex: continuityTex,
          size: Math.max(15, Math.min(22, W * 0.014)),
          color: palette.fgMuted,
          alpha: hudReveal,
        });

        kit.phaseDots(p, {
          x: 28,
          y: H - 28,
          total: 4,
          current: phase,
          label: phaseLabelFor(phase, params.fieldType),
        });
      };
    };

    const inst: P5 = new p5(sketch, container);

    return {
      setPhase(n: number) {
        const next = Math.max(0, Math.min(3, Math.floor(n)));
        if (next !== phase) {
          phase = next;
          started = typeof inst.millis === "function" ? inst.millis() : 0;
        }
      },
      setParam(key: string, value: number) {
        if (!Number.isFinite(value)) return;
        switch (key) {
          case "flowSpeed":
            params.flowSpeed = value;
            break;
          case "viscosity":
            params.viscosity = kit.clamp01(value);
            break;
          case "turbulence":
            params.turbulence = kit.clamp01(value);
            break;
          case "particleCount":
            params.particleCount = value;
            ensureCount(value);
            break;
          case "fieldType": {
            const ft = clampFieldType(value);
            if (ft !== params.fieldType) {
              params.fieldType = ft;
              // Reseed everyone so the new field fills cleanly (e.g. obstacle
              // seeds from the left edge).
              for (const pt of particles) seedParticle(pt);
            }
            break;
          }
        }
      },
      dispose() {
        try {
          inst.remove();
        } catch {
          /* p5 already torn down */
        }
        pInst = null;
        equationOverlay.remove();
        particles = [];
      },
    };
  },
};

// ── helpers (module scope, pure, no instance state) ───────────────────────

function numParam(content: SceneContent, key: string, fallback: number): number {
  const v = content.params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clampFieldType(v: number): FieldType {
  const n = Math.max(0, Math.min(2, Math.round(v)));
  return n as FieldType;
}

function phaseLabelFor(phase: number, ft: FieldType): string {
  if (phase >= 3) {
    return ft === 0
      ? "vortex core"
      : ft === 1
        ? "source → sink"
        : "wake & separation";
  }
  return PHASE_LABELS[Math.max(0, Math.min(3, phase))];
}

// Sample the field on a coarse grid and draw faint arrows. Design space.
// `sweep` (0..1) staggers the reveal diagonally across the grid so the field
// visibly BUILDS at the opening instead of snapping in as a dead static grid.
function drawFieldArrows(
  p: P5,
  kit: Kit,
  fieldAt: (x: number, y: number, t: number, out: Vel) => void,
  tSec: number,
  alpha: number,
  sweep: number,
): void {
  if (alpha <= 0.01) return;
  const step = 80;
  const out: Vel = { vx: 0, vy: 0 };
  const accent = kit.palette.accent;
  // Diagonal sweep: an arrow at normalized diagonal d (0 top-left → 1 bottom-
  // right) only starts appearing once the sweep front passes it, then fades up
  // over a short band. At sweep=1 the whole field is lit.
  const band = 0.28;
  const front = sweep * (1 + band);
  p.strokeCap(p.ROUND);
  for (let gx = step / 2; gx < VW; gx += step) {
    for (let gy = step / 2; gy < VH; gy += step) {
      const d = (gx / VW + gy / VH) * 0.5; // 0..1 along the diagonal
      const local = sweep >= 1 ? 1 : kit.clamp01((front - d) / band);
      if (local <= 0.01) continue;
      const aReveal = kit.ease.outCubic(local);
      fieldAt(gx, gy, tSec, out);
      const sp = Math.hypot(out.vx, out.vy);
      if (sp < 1e-3) continue;
      // Fixed visual length so the grid reads as a direction field, with a
      // gentle speed-based length boost (capped). The shaft also grows in.
      const len = Math.min(34, 14 + sp * 0.03) * aReveal;
      const ux = (out.vx / sp) * len;
      const uy = (out.vy / sp) * len;
      const x2 = gx + ux;
      const y2 = gy + uy;
      kit.stroke(p, accent, alpha * aReveal, 1);
      p.line(gx, gy, x2, y2);
      // Arrowhead (fades in with the shaft).
      const ah = 4.5;
      const ang = Math.atan2(uy, ux);
      p.line(x2, y2, x2 + Math.cos(ang + 2.6) * ah, y2 + Math.sin(ang + 2.6) * ah);
      p.line(x2, y2, x2 + Math.cos(ang - 2.6) * ah, y2 + Math.sin(ang - 2.6) * ah);
    }
  }
}

function drawObstacle(p: P5, kit: Kit, phase: number): void {
  const { obsX, obsY, obsR } = FIELD;
  const { fgSubtle, accent, bg } = kit.palette;
  // Solid body so trails visibly part around it.
  p.noStroke();
  p.fill(bg[0], bg[1], bg[2], 235);
  p.circle(obsX, obsY, obsR * 2);
  kit.stroke(p, phase >= 3 ? accent : fgSubtle, phase >= 3 ? 0.9 : 0.4, 1.5);
  p.noFill();
  p.circle(obsX, obsY, obsR * 2);
}

function drawVortexCore(p: P5, kit: Kit, tSec: number): void {
  const { vortexX, vortexY } = FIELD;
  const { accent } = kit.palette;
  const pulse = 0.5 + 0.5 * Math.sin(tSec * 2.2);
  kit.stroke(p, accent, 0.35 + 0.3 * pulse, 1.5);
  p.noFill();
  p.circle(vortexX, vortexY, FIELD.vortexCore * 1.6);
  kit.fill(p, accent, 0.7);
  p.noStroke();
  p.circle(vortexX, vortexY, 7);
}

function drawPoles(p: P5, kit: Kit): void {
  const { srcX, srcY, sinkX, sinkY } = FIELD;
  const { teal, deepRed } = kit.palette;
  p.noStroke();
  kit.fill(p, teal, 0.85);
  p.circle(srcX, srcY, 9);
  kit.fill(p, deepRed, 0.85);
  p.circle(sinkX, sinkY, 9);
}

interface HudOpts {
  fieldType: FieldType;
  maxSpeed: number;
  particleCount: number;
  turbulence: number;
  /** 0..1 reveal of the full readout panel. 0 ⇒ only the minimal name chip. */
  reveal: number;
}

function fieldName(ft: FieldType): string {
  return ft === 0 ? "VORTEX" : ft === 1 ? "SOURCE–SINK" : "WIND + OBSTACLE";
}

// The HUD lives in its OWN reserved zone, top-left, so it never sits on top of
// the field arrows. Two states:
//   • before the feature beat — a single minimal "FLOW FIELD · <type>" chip on
//     an opaque backing so the building arrow grid stays clean underneath it.
//   • on the feature beat (reveal>0) — that chip grows into a readout PANEL: an
//     opaque surface card with a hairline border holding MAX|v| / PARTICLES /
//     TURBULENCE. The opaque fill guarantees arrows never bleed through text.
function drawHud(p: P5, kit: Kit, o: HudOpts): void {
  const { palette } = kit;
  const PAD = 16; // inner padding so nothing kisses the panel edge
  const x = 24; // panel left
  const y = 24; // panel top
  const reveal = kit.clamp01(o.reveal);

  // Title row width drives the collapsed-chip width.
  const titleTxt = "FLOW FIELD · " + fieldName(o.fieldType);
  p.push();
  p.textFont("Menlo, Monaco, Consolas, monospace");
  p.textSize(12);
  const titleW = p.textWidth(titleTxt) * 1.08 + 6; // +tracking slack
  p.pop();

  const rows: { label: string; value: string }[] = [
    { label: "MAX |v|", value: `${(o.maxSpeed / 100).toFixed(2)} rel` },
    { label: "PARTICLES", value: String(o.particleCount) },
    { label: "TURBULENCE", value: `${(o.turbulence * 100).toFixed(0)} %` },
  ];

  // Panel geometry. Width interpolates chip → full panel as it reveals.
  const fullW = 232;
  const w = Math.max(titleW + PAD * 2, kit.lerp(titleW + PAD * 2, fullW, reveal));
  const titleH = 12 + PAD; // chip-only height
  const rowsH = 14 + rows.length * 30; // title gap + rows
  const h = kit.lerp(titleH, titleH + rowsH, reveal);

  // Backing card — OPAQUE so field arrows behind it can't read through the
  // text. Tinted-black base nearly fully opaque, hairline border.
  p.push();
  p.noStroke();
  p.fill(palette.bg[0], palette.bg[1], palette.bg[2], 232);
  p.rect(x, y, w, h, 10);
  p.fill(palette.surface[0], palette.surface[1], palette.surface[2], 0.6 * 255);
  p.rect(x, y, w, h, 10);
  p.stroke(255, 255, 255, 0.1 * 255);
  p.strokeWeight(1);
  p.noFill();
  p.rect(x, y, w, h, 10);
  p.pop();

  const tx = x + PAD;
  let ty = y + PAD + 6;
  kit.label(p, {
    x: tx,
    y: ty,
    text: titleTxt,
    size: 12,
    upper: true,
    mono: true,
    color: palette.fgMuted,
    align: "left",
  });

  if (reveal <= 0.01) return;

  ty += 28;
  rows.forEach((r, i) => {
    readoutRow(p, kit, tx, ty + i * 30, r.label, r.value, reveal);
  });
}

function readoutRow(
  p: P5,
  kit: Kit,
  x: number,
  y: number,
  label: string,
  value: string,
  alpha: number,
): void {
  const { palette } = kit;
  kit.label(p, {
    x,
    y,
    text: label,
    size: 10,
    upper: true,
    mono: true,
    color: palette.fgSubtle,
    align: "left",
    alpha,
  });
  kit.label(p, {
    x: x + 110,
    y,
    text: value,
    size: 14,
    mono: true,
    color: palette.accent,
    align: "left",
    weight: "bold",
    alpha,
  });
}

// ── KaTeX overlay (the kit has no equation primitive at runtime) ───────────
interface EqOpts {
  x: number;
  y: number;
  latex: string;
  size: number;
  color: RGB;
  alpha: number;
}

interface EqOverlay {
  el: HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  katex: any;
  lastTex: string;
  remove: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeEquationOverlay(container: HTMLElement, katex: any): EqOverlay {
  // Ensure the container can host an absolutely-positioned child.
  if (window.getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.pointerEvents = "none";
  el.style.transform = "translate(-50%, -100%)";
  el.style.opacity = "0";
  el.style.transition = "opacity 0.4s ease";
  el.style.zIndex = "2";
  el.style.whiteSpace = "nowrap";
  container.appendChild(el);
  return {
    el,
    katex,
    lastTex: "",
    remove: () => {
      el.parentNode?.removeChild(el);
    },
  };
}

function positionEquation(ov: EqOverlay, opts: EqOpts): void {
  const { el, katex } = ov;
  if (opts.latex !== ov.lastTex) {
    ov.lastTex = opts.latex;
    try {
      el.innerHTML = katex.renderToString(opts.latex, {
        throwOnError: false, output: "html",
        displayMode: false,
      });
    } catch {
      el.textContent = opts.latex;
    }
  }
  el.style.left = `${opts.x}px`;
  el.style.top = `${opts.y}px`;
  el.style.fontSize = `${opts.size}px`;
  const c = opts.color;
  el.style.color = `rgb(${c[0]},${c[1]},${c[2]})`;
  el.style.opacity = String(opts.alpha);
}

export default sim;
