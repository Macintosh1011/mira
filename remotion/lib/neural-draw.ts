/**
 * The neural-net scene renderer (acts 3 + 4). One continuous scene: it builds
 * up around a handwritten "7", locks 98.2% confidence, then morphs live as the
 * user asks why it confuses a 7 with a 1 — activations shift, the latent
 * clusters collapse together, and the confidence destabilizes to 54 / 43.
 *
 * Pure function of params (themselves a pure function of the frame), drawn on a
 * single canvas with a slow drifting camera for parallax.
 */
import { C, FONT, rgb, mix, type RGB } from "../theme";
import {
  forward, digitAt, flatten, probsAt, latentCloud, type LatentPoint,
} from "./nn";
import type { DrawCtx } from "../components/Canvas";
import {
  clamp, lerp, glowDot, glowLine, travelingPulse, noise1, mulberry32, easeOutCubic,
} from "./draw";

export interface NeuralParams {
  t: number; // local seconds
  a7: number; pix: number; edges: number;
  h1: number; h2: number; outl: number;
  latent: number; morph: number; interrupt: number; ghost: number; lock: number;
}

// ── screen-space layout (1920×1080) ────────────────────────────────────────
const GRID = { cx: 372, cy: 556, cell: 30, n: 8 };
const COL = {
  h1: { x: 726, n: 12, y0: 196, y1: 904, r: 11 },
  h2: { x: 980, n: 8, y0: 250, y1: 850, r: 12 },
  out: { x: 1244, n: 10, y0: 168, y1: 912, r: 11 },
};
const BAR = { x: 1286, w: 232, h: 13 };
const DIGITS_STR = "0123456789";

const colY = (c: { n: number; y0: number; y1: number }, i: number) =>
  c.y0 + (i / (c.n - 1)) * (c.y1 - c.y0);

const cloud: LatentPoint[] = latentCloud();

const setFont = (
  ctx: CanvasRenderingContext2D, size: number, fam: string, weight = "400",
) => (ctx.font = `${weight} ${size}px ${fam}`);

export function drawNeural(ctx: CanvasRenderingContext2D, info: DrawCtx, p: NeuralParams) {
  const { width, height, t } = info;
  const probs = probsAt(p.morph);
  const pass = forward(flatten(digitAt(p.morph)));

  // camera: slow push-in + drift for parallax
  const push = clamp(t / 34);
  const zoom = 1 + easeOutCubic(clamp(t / 22)) * 0.05;
  const camX = noise1(t * 0.14) * 14 - push * 18;
  const camY = noise1(80 + t * 0.12) * 11;

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-width / 2 - camX, -height / 2 - camY);

  // dim everything slightly behind the interrupt bar
  const dim = 1 - p.interrupt * 0.4;

  drawGhostDigits(ctx, p, t);
  drawLatentCloud(ctx, p, t, dim);
  drawEdges(ctx, p, t, pass, dim);
  drawDigit(ctx, p, t);
  drawNeurons(ctx, p, t, pass, probs, dim);
  drawHUD(ctx, p, t, probs, dim);

  ctx.restore();
}

// ── deep-background ghost competitors (1, 9, 2) ─────────────────────────────
function drawGhostDigits(ctx: CanvasRenderingContext2D, p: NeuralParams, t: number) {
  if (p.ghost <= 0.001) return;
  const ghosts: [string, number, number, number, RGB][] = [
    ["1", 1320, 360, 460, C.rival],
    ["9", 760, 760, 360, C.teal],
    ["2", 1080, 240, 300, C.terracotta],
  ];
  for (const [d, x, y, size, col] of ghosts) {
    const isOne = d === "1";
    // the "1" brightens with the morph; others stay faint
    const a = p.ghost * (isOne ? 0.05 + p.morph * 0.16 : 0.045) * (0.85 + 0.15 * noise1(t * 0.3 + x));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    setFont(ctx, size, FONT.display, "300");
    ctx.fillStyle = rgb(col, a);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(d, x, y + noise1(t * 0.2 + x) * 8);
    ctx.restore();
  }
}

// ── latent space: a 3-D constellation that collapses as it goes ambiguous ───
function drawLatentCloud(ctx: CanvasRenderingContext2D, p: NeuralParams, t: number, dim: number) {
  if (p.latent <= 0.001) return;
  const cx = 980;
  const cy = 392;
  const scale = 250;
  const rotY = t * 0.16 + 0.5;
  const tilt = 0.42;
  const a = p.latent * dim;

  // project a normalized (bx,by) cluster point into the floating 3-D field
  const project = (pt: LatentPoint) => {
    // collapse the 7 & 1 clusters toward each other as morph rises
    let bx = pt.bx;
    let by = pt.by;
    if (pt.cls === 7) { bx = lerp(bx, 0.06, p.morph * 0.8); by = lerp(by, 0.02, p.morph * 0.8); }
    if (pt.cls === 1) { bx = lerp(bx, -0.02, p.morph * 0.8); by = lerp(by, -0.02, p.morph * 0.8); }
    // pseudo-depth from a hashed z + gentle warp during morph
    const z = Math.sin(pt.jitterSeed) * 0.7;
    const warp = p.morph * 0.18 * Math.sin(pt.jitterSeed * 1.7 + t * 0.6);
    const x3 = bx + warp;
    const y3 = by;
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const rx = x3 * c - z * s;
    const rz = x3 * s + z * c;
    const persp = 1 / (1.7 + rz);
    const jx = noise1(pt.jitterSeed + t * 0.5) * 0.012;
    const jy = noise1(pt.jitterSeed + 50 + t * 0.5) * 0.012;
    return {
      x: cx + (rx + jx) * scale * persp * 2.0,
      y: cy + (y3 * Math.cos(tilt) + jy) * scale * persp * 2.0,
      persp,
    };
  };

  const colorFor = (cls: number): RGB =>
    cls === 7 ? C.accent : cls === 1 ? C.rival : cls === 9 ? C.teal : cls === 2 ? C.terracotta : C.fgMuted;

  // faint intra-cluster links
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < cloud.length; i += 1) {
    const pi = cloud[i];
    if (pi.cls !== 7 && pi.cls !== 1) continue;
    const a0 = project(pi);
    // link to nearest few in same cluster (cheap: i+stride)
    for (let k = 1; k <= 2; k++) {
      const pj = cloud[(i + k * 7) % cloud.length];
      if (pj.cls !== pi.cls) continue;
      const a1 = project(pj);
      const dx = a0.x - a1.x, dy = a0.y - a1.y;
      const d = Math.hypot(dx, dy);
      if (d > 130) continue;
      ctx.strokeStyle = rgb(colorFor(pi.cls), a * 0.12 * (1 - d / 130));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.stroke();
    }
  }
  // points
  for (const pt of cloud) {
    const pr = project(pt);
    const col = colorFor(pt.cls);
    const r = (1.6 + pr.persp * 2.6) * (pt.cls === 7 || pt.cls === 1 ? 1.1 : 0.8);
    const alpha = a * (0.5 + pr.persp) * (pt.cls === 7 || pt.cls === 1 ? 0.95 : 0.5);
    glowDot(ctx, pr.x, pr.y, r, col, alpha);
  }
  ctx.restore();

  // label
  ctx.save();
  setFont(ctx, 13, FONT.mono, "500");
  ctx.fillStyle = rgb(C.fgSubtle, a * 0.9);
  ctx.textAlign = "center";
  ctx.fillText("LATENT REPRESENTATION", cx, 168);
  ctx.restore();
}

// ── edges between layers with traveling signal pulses ───────────────────────
function drawEdges(
  ctx: CanvasRenderingContext2D, p: NeuralParams, t: number,
  pass: ReturnType<typeof forward>, dim: number,
) {
  const exit = { x: GRID.cx + (GRID.n * GRID.cell) / 2 + 6, y: GRID.cy };
  const h1 = Array.from({ length: COL.h1.n }, (_, i) => ({ x: COL.h1.x, y: colY(COL.h1, i) }));
  const h2 = Array.from({ length: COL.h2.n }, (_, i) => ({ x: COL.h2.x, y: colY(COL.h2, i) }));
  const out = Array.from({ length: COL.out.n }, (_, i) => ({ x: COL.out.x, y: colY(COL.out, i) }));

  const a1max = Math.max(1e-6, ...pass.a1.map(Math.abs));
  const a2max = Math.max(1e-6, ...pass.a2.map(Math.abs));

  const faint = (x1: number, y1: number, x2: number, y2: number, a: number) => {
    ctx.strokeStyle = rgb(C.fgSubtle, a * dim);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  // grid -> H1
  if (p.h1 > 0) {
    h1.forEach((n, i) => {
      faint(exit.x, exit.y, n.x - COL.h1.r, n.y, 0.05 + 0.04 * p.h1);
      const w = clamp(pass.a1[i] / a1max);
      if (w > 0.25) {
        const speed = 0.6;
        travelingPulse(ctx, exit.x, exit.y, n.x, n.y, (t * speed + i * 0.13) % 1, C.accent, 9, 0.4 * w * p.h1 * dim);
        glowLine(ctx, exit.x, exit.y, n.x, n.y, C.accent, 1.4, 0.10 * w * p.h1 * dim);
      }
    });
  }
  // H1 -> H2
  if (p.h2 > 0) {
    for (let j = 0; j < COL.h2.n; j++) {
      let best = 0, bv = -Infinity;
      for (let i = 0; i < COL.h1.n; i++) { const c = pass.a1[i]; if (c > bv) { bv = c; best = i; } }
      h1.forEach((n) => faint(n.x + COL.h1.r, n.y, h2[j].x - COL.h2.r, h2[j].y, 0.025 * p.h2));
      const w = clamp(pass.a2[j] / a2max);
      if (w > 0.25) {
        travelingPulse(ctx, h1[best].x, h1[best].y, h2[j].x, h2[j].y, (t * 0.55 + j * 0.17) % 1, C.accent, 9, 0.4 * w * p.h2 * dim);
        glowLine(ctx, h1[best].x, h1[best].y, h2[j].x, h2[j].y, C.accent, 1.4, 0.10 * w * p.h2 * dim);
      }
    }
  }
  // H2 -> OUT (emphasize the winner & the rival 1)
  if (p.outl > 0) {
    const probs = probsAt(p.morph);
    for (let cl = 0; cl < COL.out.n; cl++) {
      let best = 0, bv = -Infinity;
      for (let j = 0; j < COL.h2.n; j++) { const c = pass.a2[j]; if (c > bv) { bv = c; best = j; } }
      h2.forEach((n) => faint(n.x + COL.h2.r, n.y, out[cl].x - COL.out.r, out[cl].y, 0.02 * p.outl));
      const w = clamp(probs[cl] / Math.max(...probs));
      const col = cl === 1 ? C.rival : C.accent;
      if (w > 0.18) {
        travelingPulse(ctx, h2[best].x, h2[best].y, out[cl].x, out[cl].y, (t * 0.5 + cl * 0.19) % 1, col, 9, 0.45 * w * p.outl * dim);
        glowLine(ctx, h2[best].x, h2[best].y, out[cl].x, out[cl].y, col, 1.4, 0.12 * w * p.outl * dim);
      }
    }
  }
}

// ── input digit: handwritten 7 dissolving into an 8×8 pixel grid ────────────
function drawDigit(ctx: CanvasRenderingContext2D, p: NeuralParams, t: number) {
  const { cx, cy, cell, n } = GRID;
  const span = cell * n;
  const x0 = cx - span / 2;
  const y0 = cy - span / 2;

  // handwritten 7 stroke (screen space, slight wobble), drawn on then dissolves
  if (p.a7 > 0.001 && p.pix < 0.999) {
    const strokeA = p.a7 * (1 - p.pix);
    const pts: [number, number][] = [
      [x0 + 18, y0 + 30], [x0 + span - 18, y0 + 26],
      [x0 + span * 0.62, y0 + span * 0.42], [x0 + span * 0.42, y0 + span - 16],
    ];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgb(C.accent, strokeA);
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = rgb(C.accent, strokeA * 0.8);
    ctx.shadowBlur = 26;
    // dash reveal along the polyline length
    const reveal = clamp(p.a7 * 1.1);
    const total = pts.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);
    let drawn = 0;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const want = reveal * total;
      if (drawn + seg <= want) ctx.lineTo(pts[i][0], pts[i][1]);
      else {
        const f = clamp((want - drawn) / seg);
        ctx.lineTo(lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f));
        break;
      }
      drawn += seg;
    }
    ctx.stroke();
    ctx.restore();
  }

  if (p.pix <= 0.001) return;
  const digit = digitAt(p.morph);
  // frame
  ctx.save();
  ctx.strokeStyle = rgb(C.fgSubtle, 0.4 * p.pix);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0 - 6, y0 - 6, span + 12, span + 12);
  ctx.restore();

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = digit[r][c];
      const idx = r * n + c;
      // stagger pixel illumination during the dissolve
      const appear = clamp((p.pix - (idx / (n * n)) * 0.5) / 0.5);
      const px = x0 + c * cell + cell / 2;
      const py = y0 + r * cell + cell / 2;
      // empty cell substrate
      ctx.save();
      ctx.fillStyle = rgb(C.surface, 0.5 * appear);
      ctx.strokeStyle = rgb(C.fgSubtle, 0.12 * appear);
      ctx.lineWidth = 1;
      roundRect(ctx, px - cell / 2 + 2, py - cell / 2 + 2, cell - 4, cell - 4, 4);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (v > 0.02) {
        glowDot(ctx, px, py, (cell / 2 - 5) * (0.7 + 0.3 * v), C.accent, v * appear);
      }
      // edge detectors on lit cells
      if (p.edges > 0.01 && v > 0.3) {
        const horiz = r < 2;
        const ang = horiz ? 0 : -Math.PI / 4;
        const len = cell * 0.46 * p.edges;
        const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
        glowLine(ctx, px - dx, py - dy, px + dx, py + dy, C.teal, 2, 0.5 * p.edges * v);
      }
    }
  }

  // label
  ctx.save();
  setFont(ctx, 13, FONT.mono, "500");
  ctx.fillStyle = rgb(C.fgMuted, 0.85 * p.pix);
  ctx.textAlign = "center";
  ctx.fillText("INPUT · 8×8", cx, y0 + span + 34);
  ctx.restore();
}

// ── neuron columns ──────────────────────────────────────────────────────────
function drawNeurons(
  ctx: CanvasRenderingContext2D, p: NeuralParams, t: number,
  pass: ReturnType<typeof forward>, probs: number[], dim: number,
) {
  const a1max = Math.max(1e-6, ...pass.a1.map(Math.abs));
  const a2max = Math.max(1e-6, ...pass.a2.map(Math.abs));

  const layer = (
    col: { x: number; n: number; y0: number; y1: number; r: number },
    acts: number[], amax: number, reveal: number, title: string, sub: string,
  ) => {
    if (reveal <= 0.001) return;
    for (let i = 0; i < col.n; i++) {
      const y = colY(col, i);
      const appear = clamp((reveal - (i / col.n) * 0.4) / 0.6);
      if (appear <= 0) continue;
      const act = clamp(acts[i] / amax);
      // base ring
      ctx.save();
      ctx.strokeStyle = rgb(C.fgSubtle, 0.5 * appear * dim);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(col.x, y, col.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (act > 0.06) {
        const pulse = 1 + 0.08 * Math.sin(t * 3 + i);
        glowDot(ctx, col.x, y, col.r * (0.55 + 0.5 * act) * pulse, C.accent, act * appear * dim);
      }
    }
    ctx.save();
    setFont(ctx, 13, FONT.mono, "600");
    ctx.fillStyle = rgb(C.fg, 0.92 * reveal * dim);
    ctx.textAlign = "center";
    ctx.fillText(title, col.x, col.y0 - 40);
    setFont(ctx, 11, FONT.mono, "400");
    ctx.fillStyle = rgb(C.fgMuted, 0.8 * reveal * dim);
    ctx.fillText(sub, col.x, col.y0 - 22);
    ctx.restore();
  };

  layer(COL.h1, pass.a1, a1max, p.h1, "LAYER 1", "edges · angles");
  layer(COL.h2, pass.a2, a2max, p.h2, "LAYER 2", "shapes");

  // output neurons
  if (p.outl > 0.001) {
    const winner = probs.indexOf(Math.max(...probs));
    for (let i = 0; i < COL.out.n; i++) {
      const y = colY(COL.out, i);
      const appear = clamp((p.outl - (i / COL.out.n) * 0.4) / 0.6);
      if (appear <= 0) continue;
      const isWin = i === winner;
      const isRival = i === 1 && p.morph > 0.15;
      const col = isRival ? C.rival : C.accent;
      const lit = clamp(probs[i] / Math.max(...probs));
      ctx.save();
      ctx.strokeStyle = rgb(C.fgSubtle, 0.5 * appear * dim);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(COL.out.x, y, COL.out.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (lit > 0.04 || isWin || isRival) {
        glowDot(ctx, COL.out.x, y, COL.out.r * (0.5 + 0.6 * lit), col, (0.25 + lit) * appear * dim);
      }
      // digit label inside neuron
      ctx.save();
      setFont(ctx, 12, FONT.mono, "600");
      ctx.fillStyle = rgb(lit > 0.5 ? C.bg : C.fgMuted, appear * dim);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(DIGITS_STR[i], COL.out.x, y);
      ctx.restore();
    }
    ctx.save();
    setFont(ctx, 13, FONT.mono, "600");
    ctx.fillStyle = rgb(C.fg, 0.92 * p.outl * dim);
    ctx.textAlign = "center";
    ctx.fillText("OUTPUT", COL.out.x, COL.out.y0 - 40);
    setFont(ctx, 11, FONT.mono, "400");
    ctx.fillStyle = rgb(C.fgMuted, 0.8 * p.outl * dim);
    ctx.fillText("softmax · 10", COL.out.x, COL.out.y0 - 22);
    ctx.restore();
  }
}

// ── softmax bars + hero confidence readout ──────────────────────────────────
function drawHUD(
  ctx: CanvasRenderingContext2D, p: NeuralParams, t: number, probs: number[], dim: number,
) {
  if (p.lock <= 0.001) return;
  const winner = probs.indexOf(Math.max(...probs));
  const pmax = Math.max(...probs);

  for (let i = 0; i < COL.out.n; i++) {
    const y = colY(COL.out, i);
    const isWin = i === winner;
    const isRival = i === 1 && p.morph > 0.15;
    const col = isRival ? C.rival : isWin ? C.accent : C.fgMuted;
    const w = clamp(probs[i] / Math.max(pmax, 1e-6));
    // track
    ctx.save();
    ctx.fillStyle = rgb(C.fg, 0.05 * p.lock * dim);
    roundRect(ctx, BAR.x, y - BAR.h / 2, BAR.w, BAR.h, BAR.h / 2);
    ctx.fill();
    ctx.restore();
    // fill
    const filled = BAR.w * w * p.lock;
    if (filled > 2) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgb(col, (isWin || isRival ? 0.95 : 0.4) * dim);
      ctx.shadowColor = rgb(col, 0.7);
      ctx.shadowBlur = isWin || isRival ? 14 : 0;
      roundRect(ctx, BAR.x, y - BAR.h / 2, filled, BAR.h, BAR.h / 2);
      ctx.fill();
      ctx.restore();
    }
    // % label (jitter while ambiguous)
    const jitter = isWin || isRival ? noise1(t * 6 + i) * p.morph * (1 - clamp((p.morph - 0.9) / 0.1)) * 0.6 : 0;
    const pct = (probs[i] * 100 + jitter).toFixed(1);
    ctx.save();
    setFont(ctx, 13, FONT.mono, isWin || isRival ? "600" : "400");
    ctx.fillStyle = rgb(isWin ? C.accent : isRival ? C.rival : C.fgSubtle, (isWin || isRival ? 1 : 0.7) * p.lock * dim);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${pct}%`, BAR.x + BAR.w + 14, y);
    ctx.restore();
  }

  // hero readout, lower-right
  const hx = 1600;
  const hy = 1000;
  const heroA = clamp((p.lock - 0.4) / 0.4) * dim;
  if (heroA > 0.01) {
    ctx.save();
    ctx.textAlign = "center";
    if (p.morph < 0.2) {
      // single winner
      const jit = noise1(t * 7) * (1 - p.lock) * 0.4;
      setFont(ctx, 96, FONT.display, "400");
      ctx.fillStyle = rgb(C.accent, heroA);
      ctx.textBaseline = "alphabetic";
      ctx.fillText("7", hx - 86, hy);
      setFont(ctx, 40, FONT.mono, "500");
      ctx.fillStyle = rgb(C.fg, heroA);
      ctx.textAlign = "left";
      ctx.fillText(`${(probs[7] * 100 + jit).toFixed(1)}%`, hx - 40, hy - 8);
      setFont(ctx, 13, FONT.mono, "400");
      ctx.fillStyle = rgb(C.fgMuted, heroA);
      ctx.fillText("CONFIDENCE", hx - 40, hy - 56);
    } else {
      // two competitors
      const j7 = noise1(t * 6) * p.morph * 0.5;
      const j1 = noise1(40 + t * 6) * p.morph * 0.5;
      setFont(ctx, 64, FONT.display, "400");
      ctx.textAlign = "left";
      ctx.fillStyle = rgb(C.accent, heroA);
      ctx.fillText("7", hx - 240, hy);
      setFont(ctx, 30, FONT.mono, "500");
      ctx.fillStyle = rgb(C.accent, heroA);
      ctx.fillText(`${(probs[7] * 100 + j7).toFixed(0)}%`, hx - 200, hy - 6);
      setFont(ctx, 64, FONT.display, "400");
      ctx.fillStyle = rgb(C.rival, heroA);
      ctx.fillText("1", hx - 70, hy);
      setFont(ctx, 30, FONT.mono, "500");
      ctx.fillStyle = rgb(C.rival, heroA);
      ctx.fillText(`${(probs[1] * 100 + j1).toFixed(0)}%`, hx - 36, hy - 6);
      setFont(ctx, 13, FONT.mono, "400");
      ctx.fillStyle = rgb(C.fgMuted, heroA);
      ctx.fillText("UNCERTAIN", hx - 240, hy - 54);
    }
    ctx.restore();
  }
}

// ── util ───────────────────────────────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
