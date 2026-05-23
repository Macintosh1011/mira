/**
 * WAVES — a literal, interactive simulation of wave superposition.
 *
 * Two traveling sine waves share a 1D medium and SUPERPOSE. The individual
 * waves draw faint (teal + blue); their pointwise sum draws bright (amber).
 * Tune the two frequencies together to collapse a beat pattern; tune them to
 * the SAME frequency travelling in OPPOSITE directions and the medium locks
 * into a standing wave with marked nodes and antinodes. A final beat swaps to a
 * 2D ripple tank: two point sources whose circular waves interfere into fringes.
 *
 * Physics (all real, all derived from the live slider state):
 *   y_i(x,t) = A · sin(k_i·x − ω_i·t + φ)            traveling wave
 *   y(x,t)   = Σ y_i(x,t)                             superposition
 *   k = 2π·f ,  ω = 2π·f·speed ,  λ = 1/f ,  T = 1/(f·speed) ,  v = f·λ·speed
 *   Standing wave (counter-propagating, equal f):
 *     y = 2A·sin(kx)·cos(ωt)  → nodes at kx = nπ, antinodes at kx = (n+½)π
 *   Beats (co-propagating, f1≠f2): spatial envelope at Δk/2, beat freq |f1−f2|.
 *
 * Contract: this is a registered `Sim` (see lib/sims/index.ts). The SimHost
 * calls `create(container, libs, content)` and drives the returned
 * `SceneController` via `setPhase` (narration beat) and `setParam` (slider).
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

type ControlKey = "frequency1" | "frequency2" | "amplitude" | "phase" | "speed";

// ── controls ──────────────────────────────────────────────────────────────
// Frequencies are spatial harmonics: f = number of full wavelengths spanning
// the medium. Integer f land the fixed ends on nodes, which is what locks a
// clean standing wave. f∈[0.5,6] keeps the sampling smooth at 420 points.
const CONTROLS: ControlSpec[] = [
  { key: "frequency1", label: "Frequency 1", min: 0.5, max: 6, step: 0.1, default: 2, unit: "Hz" },
  { key: "frequency2", label: "Frequency 2", min: 0.5, max: 6, step: 0.1, default: 3, unit: "Hz" },
  { key: "amplitude", label: "Amplitude", min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: "phase", label: "Phase φ", min: 0, max: 2 * Math.PI, step: 0.01, default: 0, unit: "rad" },
  { key: "speed", label: "Speed", min: 0, max: 2, step: 0.01, default: 1, unit: "×" },
];

const DEFAULTS: Record<ControlKey, number> = {
  frequency1: 2,
  frequency2: 3,
  amplitude: 0.7,
  phase: 0,
  speed: 1,
};

// ── phases (1:1 with narration beats) ───────────────────────────────────────
//  0 single wave · 1 second wave added · 2 superposition ·
//  3 interference/beats · 4 standing wave (nodes+antinodes) · 5 2D ripple tank
const PHASE_COUNT = 6;
const DEFAULT_PHASE_LABELS = [
  "single wave",
  "second wave",
  "superposition",
  "interference & beats",
  "standing wave",
  "ripple tank",
];
const DEFAULT_EQUATION = "y(x,t)=A\\,\\sin(kx-\\omega t)";

const TWO_PI = Math.PI * 2;

const sim: Sim = {
  id: "waves",
  title: "Wave Superposition",
  controls: CONTROLS,
  create(
    container: HTMLElement,
    libs: SimLibs,
    content: SceneContent,
  ): SceneController {
    const kit = libs.kit;
    const { palette, ease } = kit;

    const phaseLabels =
      content?.phases?.length
        ? content.phases.map((ph, i) => ph.label || DEFAULT_PHASE_LABELS[i] || "")
        : DEFAULT_PHASE_LABELS;
    const equationTex = content?.equation || DEFAULT_EQUATION;

    // Live, mutable parameter state, seeded from spec defaults + content params.
    const params: Record<ControlKey, number> = { ...DEFAULTS };
    if (content?.params) {
      for (const c of CONTROLS) {
        const v = content.params[c.key];
        if (typeof v === "number" && Number.isFinite(v)) {
          params[c.key as ControlKey] = clampSpec(c, v);
        }
      }
    }

    // Component colors: amber resultant, teal + blue components on #0c0c0e.
    const C_RESULT: RGB = palette.accent; // amber #efc540
    const C_WAVE1: RGB = palette.teal; // #31c0b1
    const C_WAVE2: RGB = palette.blue; // #256bb9
    const C_NODE: RGB = palette.terracotta;

    let phase = 0;
    let phaseStartMs = 0;
    let lastMs = 0;
    let elapsedMs = 0; // deterministic clock: advanced by capped dt each frame

    // KaTeX equation overlaid as a positioned DOM node (the proper way to show
    // TeX). Falls back to nothing here; the canvas always draws a mono version
    // too, so the formula is visible regardless of katex availability.
    const eqEl = mountEquation(container, libs, equationTex, palette);

    const sketch = (p: P5) => {
      let W = container.clientWidth || 1280;
      let H = container.clientHeight || 720;

      const layout = () => {
        const padL = Math.max(72, W * 0.07);
        const padR = Math.max(180, W * 0.16); // room for the right-hand readouts
        const plotW = Math.max(120, W - padL - padR);
        const cy = H * 0.48;
        const plotH = Math.min(H * 0.3, 210);
        return { padL, padR, plotW, cy, plotH, x0: padL, x1: padL + plotW };
      };

      p.setup = () => {
        const c = p.createCanvas(W, H);
        if (c && c.style) c.style("display", "block");
        kit.useFonts(p);
        lastMs = p.millis();
      };

      p.draw = () => {
        const now = p.millis();
        const dt = Math.min(64, now - lastMs);
        lastMs = now;
        elapsedMs += dt;
        const tSec = elapsedMs / 1000;
        const local = ease.quintic(clamp01((elapsedMs - phaseStartMs) / 900));

        kit.grid(p);

        const ripple = phase >= 5;
        if (eqEl) eqEl.style.opacity = ripple ? "0.35" : "1";

        if (ripple) {
          drawRippleTank(p, kit, W, H, params, tSec, local, C_RESULT);
        } else {
          draw1D(p, kit, layout(), {
            phase, params, tSec, local, ease,
            C_RESULT, C_WAVE1, C_WAVE2, C_NODE,
          });
        }
        drawHud(p, kit, {
          W, H, phase, phaseLabels, params, equationTex,
          hasDomEquation: eqEl !== null,
          C_RESULT, C_WAVE1, C_WAVE2,
        });
      };

      p.windowResized = () => {
        W = container.clientWidth || W;
        H = container.clientHeight || H;
        p.resizeCanvas(W, H);
      };
    };

    const inst = new libs.p5(sketch, container);

    return {
      setPhase(n: number) {
        const next = Math.max(0, Math.min(PHASE_COUNT - 1, Math.floor(n)));
        if (next === phase) return;
        phase = next;
        phaseStartMs = elapsedMs;
      },
      setParam(key: string, value: number) {
        const spec = CONTROLS.find((c) => c.key === key);
        if (!spec || !Number.isFinite(value)) return;
        params[key as ControlKey] = clampSpec(spec, value);
      },
      dispose() {
        if (eqEl && eqEl.parentNode) eqEl.parentNode.removeChild(eqEl);
        inst.remove();
      },
    };
  },
};

export default sim;

// ── physics ─────────────────────────────────────────────────────────────────

interface Derived {
  f1: number; f2: number; A: number; phi: number; speed: number;
  k1: number; k2: number; w1: number; w2: number;
  df: number; beatFreq: number; nearestHarmonic: number; harmonicLock: boolean;
  lambda1: number; T1: number; v: number;
}

/** Resolve live params into every physical quantity used downstream. */
function derive(params: Record<ControlKey, number>): Derived {
  const { frequency1: f1, frequency2: f2, amplitude: A, phase: phi, speed } = params;
  const k1 = TWO_PI * f1;
  const k2 = TWO_PI * f2;
  const w1 = TWO_PI * f1 * speed;
  const w2 = TWO_PI * f2 * speed;
  const df = Math.abs(f1 - f2);
  const nearestHarmonic = Math.round((f1 + f2) / 2);
  // Standing-wave territory: equal frequencies, sitting on an integer harmonic
  // (so both fixed ends are nodes). A small tolerance makes the slider "snap".
  const harmonicLock =
    df < 0.12 &&
    Math.abs((f1 + f2) / 2 - nearestHarmonic) < 0.12 &&
    nearestHarmonic >= 1;
  const lambda1 = 1 / f1;
  const T1 = speed > 1e-4 ? 1 / (f1 * speed) : Infinity;
  const v = f1 * lambda1 * speed; // v = fλ
  return {
    f1, f2, A, phi, speed, k1, k2, w1, w2,
    df, beatFreq: df, nearestHarmonic, harmonicLock, lambda1, T1, v,
  };
}

/** Wave 1: travels +x. */
function y1(u: number, t: number, d: Derived): number {
  return d.A * Math.sin(d.k1 * u - d.w1 * t);
}

/**
 * Wave 2: counter-propagates (−x) at wave 1's frequency in standing-wave
 * territory (so y1+y2 = 2A·sin(kx)·cos(ωt), a true standing wave); otherwise
 * co-propagates (+x) at its own frequency to give beats / general interference.
 */
function y2(u: number, t: number, d: Derived): number {
  if (d.harmonicLock) return d.A * Math.sin(d.k1 * u + d.w1 * t + d.phi);
  return d.A * Math.sin(d.k2 * u - d.w2 * t + d.phi);
}

// ── 1D renderer ──────────────────────────────────────────────────────────────

interface Draw1DCtx {
  phase: number;
  params: Record<ControlKey, number>;
  tSec: number;
  local: number;
  ease: Kit["ease"];
  C_RESULT: RGB;
  C_WAVE1: RGB;
  C_WAVE2: RGB;
  C_NODE: RGB;
}

interface Box {
  padL: number; padR: number; plotW: number;
  cy: number; plotH: number; x0: number; x1: number;
}

function draw1D(p: P5, kit: Kit, L: Box, ctx: Draw1DCtx) {
  const { palette } = kit;
  const d = derive(ctx.params);
  const { phase, tSec, local, ease } = ctx;
  const amp = L.plotH;

  kit.axes(p, {
    x: L.x0, y: L.cy - amp, w: L.plotW, h: amp * 2, reveal: 1,
    xLabel: "position  x", yLabel: "displacement  y",
  });
  p.push();
  p.stroke(255, 255, 255, 0.1 * 255);
  p.strokeWeight(1);
  p.line(L.x0, L.cy, L.x1, L.cy);
  p.pop();

  // Manual vertex sampling only (p5 2.x removed curveVertex/quadraticVertex).
  const N = 420;
  const ux = (i: number) => i / (N - 1);
  const sx = (u: number) => L.x0 + u * L.plotW;
  const sy = (val: number) => L.cy - val * amp;

  const standing = phase >= 4 && d.harmonicLock;
  const w1Rev = phase === 0 ? local : 1;
  const w2Rev = phase === 1 ? local : phase > 1 ? 1 : 0;
  const sumRev = phase === 2 ? local : phase > 2 ? 1 : 0;

  // Faint component waves.
  if (w1Rev > 0.01) {
    drawSampledWave(p, kit, N, ux, sx, sy, (u) => y1(u, tSec, d), ctx.C_WAVE1, 0.5 * w1Rev, 1.5);
  }
  if (phase >= 1 && w2Rev > 0.01) {
    drawSampledWave(p, kit, N, ux, sx, sy, (u) => y2(u, tSec, d), ctx.C_WAVE2, 0.5 * w2Rev, 1.5);
  }

  // Bright resultant + envelope.
  if (phase >= 2 && sumRev > 0.01) {
    if (standing) {
      const env = (u: number) => 2 * d.A * Math.abs(Math.sin(d.k1 * u));
      drawSampledWave(p, kit, N, ux, sx, sy, env, palette.fgSubtle, 0.32 * sumRev, 1);
      drawSampledWave(p, kit, N, ux, sx, sy, (u) => -env(u), palette.fgSubtle, 0.32 * sumRev, 1);
    } else if (phase >= 3) {
      const dkHalf = Math.abs(d.k1 - d.k2) / 2;
      const dwHalf = (d.w1 - d.w2) / 2;
      if (dkHalf > 1e-3) {
        const env = (u: number) => 2 * d.A * Math.abs(Math.cos(dkHalf * u - dwHalf * tSec));
        drawSampledWave(p, kit, N, ux, sx, sy, env, palette.fgSubtle, 0.28 * sumRev, 1);
        drawSampledWave(p, kit, N, ux, sx, sy, (u) => -env(u), palette.fgSubtle, 0.28 * sumRev, 1);
      }
    }
    drawSampledWave(
      p, kit, N, ux, sx, sy,
      (u) => y1(u, tSec, d) + y2(u, tSec, d),
      ctx.C_RESULT, 0.95 * sumRev, 2,
    );
  }

  if (standing) {
    drawNodes(p, kit, d, L, sx, ctx.C_NODE, ctx.C_RESULT, ease.outCubic(local));
  }
}

/** Sample y=f(u) across the field and stroke it as a polyline (manual verts). */
function drawSampledWave(
  p: P5,
  kit: Kit,
  N: number,
  ux: (i: number) => number,
  sx: (u: number) => number,
  sy: (v: number) => number,
  f: (u: number) => number,
  color: RGB,
  alpha: number,
  weight: number,
) {
  p.push();
  p.noFill();
  kit.stroke(p, color, alpha, weight);
  p.strokeCap(p.ROUND);
  p.strokeJoin(p.ROUND);
  p.beginShape();
  for (let i = 0; i < N; i++) {
    const u = ux(i);
    p.vertex(sx(u), sy(f(u)));
  }
  p.endShape();
  p.pop();
}

/** Mark standing-wave nodes (no motion) and antinodes (max swing). */
function drawNodes(
  p: P5,
  kit: Kit,
  d: Derived,
  L: Box,
  sx: (u: number) => number,
  nodeColor: RGB,
  antiColor: RGB,
  reveal: number,
) {
  const n = d.nearestHarmonic; // n half-wavelengths fit the field
  const ctx2d = p.drawingContext as CanvasRenderingContext2D | undefined;
  for (let m = 0; m <= n; m++) {
    const x = sx(m / n);
    p.push();
    kit.stroke(p, nodeColor, 0.35 * reveal, 1);
    if (ctx2d) ctx2d.setLineDash([4, 6]);
    p.line(x, L.cy - L.plotH, x, L.cy + L.plotH);
    if (ctx2d) ctx2d.setLineDash([]);
    p.noStroke();
    kit.fill(p, nodeColor, 0.9 * reveal);
    p.circle(x, L.cy, 7);
    p.pop();
  }
  for (let m = 0; m < n; m++) {
    const x = sx((m + 0.5) / n);
    const y = L.cy - 2 * d.A * L.plotH;
    p.push();
    p.noStroke();
    kit.fill(p, antiColor, 0.85 * reveal);
    p.quad(x, y - 6, x + 6, y, x, y + 6, x - 6, y);
    p.pop();
  }
  kit.label(p, {
    x: sx(0.5 / n), y: L.cy + L.plotH + 16, text: "antinode",
    size: 10, upper: true, mono: true, color: antiColor, alpha: reveal,
  });
  kit.label(p, {
    x: sx(1 / n), y: L.cy + L.plotH + 16, text: "node",
    size: 10, upper: true, mono: true, color: nodeColor, alpha: reveal,
  });
}

// ── 2D ripple tank ───────────────────────────────────────────────────────────

/**
 * Two in-phase point sources radiating decaying circular waves; each cell shows
 * the superposed displacement. Amber = crest, teal = trough; the bright/dark
 * bands radiating between the sources are the interference fringes.
 */
function drawRippleTank(
  p: P5,
  kit: Kit,
  W: number,
  H: number,
  params: Record<ControlKey, number>,
  tSec: number,
  reveal: number,
  accent: RGB,
) {
  const d = derive(params);
  const cx = W / 2;
  const tankH = H * 0.58;
  const tankW = Math.min(W * 0.8, tankH * 1.5);
  const y0 = H * 0.18;
  const x0 = cx - tankW / 2;

  const lambdaPx = tankW / Math.max(1.2, d.f1 * 1.6);
  const kPx = TWO_PI / lambdaPx;
  const omega = d.w1;
  const sep = tankW * 0.34;
  const sy0 = y0 + tankH * 0.5;
  const s1 = { x: cx - sep / 2, y: sy0 };
  const s2 = { x: cx + sep / 2, y: sy0 };

  const cell = 9;
  const cols = Math.floor(tankW / cell);
  const rows = Math.floor(tankH / cell);
  const ev = kit.ease.quintic(reveal);

  p.push();
  p.noStroke();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = x0 + c * cell + cell / 2;
      const py = y0 + r * cell + cell / 2;
      const r1 = Math.hypot(px - s1.x, py - s1.y);
      const r2 = Math.hypot(px - s2.x, py - s2.y);
      const a1 = Math.sin(kPx * r1 - omega * tSec) / (1 + r1 * 0.012);
      const a2 = Math.sin(kPx * r2 - omega * tSec + d.phi) / (1 + r2 * 0.012);
      const val = (a1 + a2) * 0.5 * d.A;
      const inten = clamp01(Math.abs(val)) * ev;
      const col = val >= 0 ? accent : kit.palette.teal;
      kit.fill(p, col, 0.08 + inten * 0.85);
      p.rect(px - cell / 2, py - cell / 2, cell - 1, cell - 1, 1.5);
    }
  }
  p.pop();

  p.push();
  p.noFill();
  p.stroke(255, 255, 255, 0.12 * 255);
  p.strokeWeight(1);
  p.rect(x0, y0, cols * cell, rows * cell, 6);
  p.pop();
  for (const s of [s1, s2]) {
    p.push();
    p.noStroke();
    kit.fill(p, accent, ev);
    p.circle(s.x, s.y, 9);
    p.noFill();
    kit.stroke(p, accent, 0.5 * ev, 1.5);
    p.circle(s.x, s.y, 18);
    p.pop();
  }
  kit.label(p, {
    x: cx, y: y0 + rows * cell + 22, text: "two sources · interference fringes",
    size: 11, upper: true, mono: true, color: kit.palette.fgMuted, alpha: ev,
  });
}

// ── HUD: readouts + equation fallback + phase dots ───────────────────────────

interface HudCtx {
  W: number;
  H: number;
  phase: number;
  phaseLabels: string[];
  params: Record<ControlKey, number>;
  equationTex: string;
  hasDomEquation: boolean;
  C_RESULT: RGB;
  C_WAVE1: RGB;
  C_WAVE2: RGB;
}

function drawHud(p: P5, kit: Kit, ctx: HudCtx) {
  const { palette } = kit;
  const d = derive(ctx.params);
  const { W, H, phase } = ctx;

  kit.label(p, {
    x: 28, y: 30, text: "WAVE SUPERPOSITION", size: 12, upper: true, mono: true,
    color: palette.fgMuted, align: "left",
  });

  // Canvas equation: a clean mono fallback when no DOM/KaTeX overlay is present.
  if (!ctx.hasDomEquation) {
    kit.label(p, {
      x: 28, y: 54, text: texToPlain(ctx.equationTex), size: 18, mono: true,
      weight: "bold", color: palette.fg, align: "left",
    });
  }

  // Color legend.
  const legendY = ctx.hasDomEquation ? 56 : 82;
  legendSwatch(p, kit, 28, legendY, ctx.C_WAVE1, "wave 1");
  legendSwatch(p, kit, 120, legendY, ctx.C_WAVE2, "wave 2");
  legendSwatch(p, kit, 212, legendY, ctx.C_RESULT, "resultant");

  // Right-hand readouts: λ, T, v, beat / standing-lock.
  const rx = W - 28;
  let ry = 30;
  const row = (label: string, value: string, color: RGB) => {
    kit.label(p, { x: rx - 104, y: ry, text: label, size: 11, upper: true, mono: true, color: palette.fgMuted, align: "right" });
    kit.label(p, { x: rx, y: ry, text: value, size: 13, mono: true, weight: "bold", color, align: "right" });
    ry += 22;
  };
  row("f1", d.f1.toFixed(2) + " Hz", ctx.C_WAVE1);
  row("f2", d.f2.toFixed(2) + " Hz", ctx.C_WAVE2);
  row("λ1", d.lambda1.toFixed(3), palette.fg);
  row("T1", Number.isFinite(d.T1) ? d.T1.toFixed(3) + " s" : "∞", palette.fg);
  row("v = fλ", d.v.toFixed(3), palette.fg);
  if (d.harmonicLock) {
    row("standing", "n = " + d.nearestHarmonic, ctx.C_RESULT);
  } else if (d.df > 1e-3) {
    row("beat", d.beatFreq.toFixed(2) + " Hz", ctx.C_RESULT);
  } else {
    row("Δf", "0.00 Hz", palette.fgMuted);
  }

  kit.phaseDots(p, {
    x: 28, y: H - 32, total: PHASE_COUNT, current: phase,
    label: ctx.phaseLabels[phase] ?? "",
  });

  const note = phaseNote(phase, d);
  if (note) {
    kit.label(p, { x: W / 2, y: H - 28, text: note, size: 12, color: palette.fg, alpha: 0.85 });
  }
}

function legendSwatch(p: P5, kit: Kit, x: number, y: number, color: RGB, text: string) {
  p.push();
  kit.stroke(p, color, 1, 2);
  p.line(x, y, x + 16, y);
  p.pop();
  kit.label(p, { x: x + 22, y, text, size: 10, upper: true, mono: true, color: kit.palette.fgMuted, align: "left" });
}

function phaseNote(phase: number, d: Derived): string {
  switch (phase) {
    case 0: return "one traveling wave  y = A sin(kx − ωt)";
    case 1: return "add a second wave at a different frequency";
    case 2: return "the medium carries the pointwise SUM of both";
    case 3: return d.df < 0.4
      ? "frequencies close → slow beats, envelope at |f1−f2|/2"
      : "constructive & destructive bands travel along the medium";
    case 4: return d.harmonicLock
      ? "equal f, opposite directions → standing wave locked"
      : "tune f1 ≈ f2 near an integer to lock the standing wave";
    case 5: return "two point sources → constructive (bright) & destructive (dark) fringes";
    default: return "";
  }
}

// ── KaTeX equation overlay (DOM), with graceful absence ──────────────────────

/**
 * Render the KaTeX source to an absolutely-positioned DOM node over the canvas.
 * Returns null if katex is unavailable or rendering throws (the canvas then
 * draws a mono-text fallback instead). The container is made position-relative
 * only if it is currently static, and reverted on dispose via node removal.
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
  if (!renderToString) return null;

  try {
    const html = renderToString(tex, { throwOnError: false, output: "html", displayMode: false });
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.innerHTML = html;
    el.style.position = "absolute";
    el.style.left = "28px";
    el.style.top = "42px";
    el.style.pointerEvents = "none";
    el.style.color = `rgb(${palette.fg[0]},${palette.fg[1]},${palette.fg[2]})`;
    el.style.fontSize = "18px";
    el.style.zIndex = "2";
    el.style.transition = "opacity 200ms ease";
    const cs = typeof window !== "undefined" ? window.getComputedStyle(container) : null;
    if (cs && cs.position === "static") container.style.position = "relative";
    container.appendChild(el);
    return el;
  } catch {
    return null;
  }
}

/** Minimal TeX → unicode for the canvas fallback equation. */
function texToPlain(tex: string): string {
  return tex
    .replace(/\\,/g, " ")
    .replace(/\\sin/g, "sin")
    .replace(/\\cos/g, "cos")
    .replace(/\\omega/g, "ω")
    .replace(/\\pi/g, "π")
    .replace(/\\lambda/g, "λ")
    .replace(/\\Delta/g, "Δ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── small utils ──────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampSpec(spec: ControlSpec, v: number): number {
  return Math.max(spec.min, Math.min(spec.max, v));
}
