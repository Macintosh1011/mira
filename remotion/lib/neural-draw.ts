/**
 * The neural-net scene renderer (acts 3 + 4). One continuous scene: it builds
 * up around a handwritten "7", locks 98.2% confidence, then morphs live as the
 * user asks why it confuses a 7 with a 1 — activations shift, the latent
 * clusters drift together, and the confidence destabilizes to 54 / 43.
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
  clamp, lerp, glowDot, glowLine, travelingPulse, noise1, easeOutCubic,
} from "./draw";

export interface NeuralParams {
  t: number; // local seconds
  a7: number; pix: number; edges: number;
  h1: number; h2: number; outl: number;
  latent: number; morph: number; interrupt: number; ghost: number; lock: number;
}

// ── screen-space layout (1920×1080), vertically centered, bold ──────────────
const GRID = { cx: 372, cy: 540, cell: 34, n: 8 };
const COL = {
  h1: { x: 726, n: 12, y0: 258, y1: 822, r: 12 },
  h2: { x: 988, n: 8, y0: 300, y1: 780, r: 13 },
  out: { x: 1238, n: 10, y0: 236, y1: 844, r: 12 },
};
const BAR = { x: 1280, w: 196, h: 13 };
const DIGITS_STR = "0123456789";
// hero confidence readout (top-right — fills the otherwise empty corner)
const HERO = { x: 1560, y: 250 };

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
  const zoom = 1 + easeOutCubic(clamp(t / 24)) * 0.04;
  const camX = noise1(t * 0.14) * 12 - clamp(t / 34) * 14;
  const camY = noise1(80 + t * 0.12) * 9;

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-width / 2 - camX, -height / 2 - camY);

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
    ["1", 1180, 470, 520, C.rival],
    ["9", 560, 720, 360, C.teal],
    ["2", 900, 300, 300, C.terracotta],
  ];
  for (const [d, x, y, size, col] of ghosts) {
    const isOne = d === "1";
    const a = p.ghost * (isOne ? 0.04 + p.morph * 0.14 : 0.035) * (0.85 + 0.15 * noise1(t * 0.3 + x));
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

// ── latent space: a quiet background depth field during the build that BLOOMS
//    during the morph, the two clusters drifting together to overlap ─────────
function drawLatentCloud(ctx: CanvasRenderingContext2D, p: NeuralParams, t: number, dim: number) {
  // faint whisper during build, prominent only as the story turns to it (morph)
  const vis = clamp(p.latent) * (0.16 + 0.62 * p.morph);
  if (vis <= 0.002) return;
  const cx = 1000;
  const cy = 360;
  const scale = 200;
  const rotY = t * 0.14 + 0.5;
  const tilt = 0.4;
  const a = vis * dim;

  const project = (pt: LatentPoint) => {
    // drift the 7 & 1 cluster CENTERS toward each other (overlap, not collapse)
    let bx = pt.bx;
    let by = pt.by;
    if (pt.cls === 7) { bx = lerp(bx, 0.12, p.morph * 0.7); by = lerp(by, 0.05, p.morph * 0.7); }
    if (pt.cls === 1) { bx = lerp(bx, -0.06, p.morph * 0.7); by = lerp(by, -0.02, p.morph * 0.7); }
    const z = Math.sin(pt.jitterSeed) * 0.7;
    const warp = p.morph * 0.1 * Math.sin(pt.jitterSeed * 1.7 + t * 0.6);
    const x3 = bx + warp;
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const rx = x3 * c - z * s;
    const rz = x3 * s + z * c;
    const persp = 1 / (1.7 + rz);
    const jx = noise1(pt.jitterSeed + t * 0.5) * 0.01;
    const jy = noise1(pt.jitterSeed + 50 + t * 0.5) * 0.01;
    return {
      x: cx + (rx + jx) * scale * persp * 2.0,
      y: cy + (by * Math.cos(tilt) + jy) * scale * persp * 2.0,
      persp,
    };
  };
  const colorFor = (cls: number): RGB =>
    cls === 7 ? C.accent : cls === 1 ? C.rival : cls === 9 ? C.teal : cls === 2 ? C.terracotta : C.fgMuted;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // links within the 7 & 1 clusters
  for (let i = 0; i < cloud.length; i += 1) {
    const pi = cloud[i];
    if (pi.cls !== 7 && pi.cls !== 1) continue;
    const a0 = project(pi);
    for (let k = 1; k <= 2; k++) {
      const pj = cloud[(i + k * 7) % cloud.length];
      if (pj.cls !== pi.cls) continue;
      const a1 = project(pj);
      const d = Math.hypot(a0.x - a1.x, a0.y - a1.y);
      if (d > 120) continue;
      ctx.strokeStyle = rgb(colorFor(pi.cls), a * 0.1 * (1 - d / 120));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.stroke();
    }
  }
  for (const pt of cloud) {
    const pr = project(pt);
    const col = colorFor(pt.cls);
    const r = (1.4 + pr.persp * 2.0) * (pt.cls === 7 || pt.cls === 1 ? 1.05 : 0.75);
    const alpha = a * (0.45 + pr.persp) * (pt.cls === 7 || pt.cls === 1 ? 0.9 : 0.45);
    glowDot(ctx, pr.x, pr.y, r, col, alpha);
  }
  ctx.restore();

  ctx.save();
  setFont(ctx, 12, FONT.mono, "500");
  ctx.fillStyle = rgb(C.fgSubtle, a * 0.9);
  ctx.textAlign = "center";
  ctx.fillText("LATENT REPRESENTATION", cx, cy - 142);
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

  if (p.h1 > 0) {
    h1.forEach((n, i) => {
      faint(exit.x, exit.y, n.x - COL.h1.r, n.y, 0.06 + 0.05 * p.h1);
      const w = clamp(pass.a1[i] / a1max);
      if (w > 0.22) {
        travelingPulse(ctx, exit.x, exit.y, n.x, n.y, (t * 0.6 + i * 0.13) % 1, C.accent, 10, 0.45 * w * p.h1 * dim);
        glowLine(ctx, exit.x, exit.y, n.x, n.y, C.accent, 1.4, 0.12 * w * p.h1 * dim);
      }
    });
  }
  if (p.h2 > 0) {
    for (let j = 0; j < COL.h2.n; j++) {
      let best = 0, bv = -Infinity;
      for (let i = 0; i < COL.h1.n; i++) { const c = pass.a1[i]; if (c > bv) { bv = c; best = i; } }
      h1.forEach((n) => faint(n.x + COL.h1.r, n.y, h2[j].x - COL.h2.r, h2[j].y, 0.03 * p.h2));
      const w = clamp(pass.a2[j] / a2max);
      if (w > 0.22) {
        travelingPulse(ctx, h1[best].x, h1[best].y, h2[j].x, h2[j].y, (t * 0.55 + j * 0.17) % 1, C.accent, 10, 0.45 * w * p.h2 * dim);
        glowLine(ctx, h1[best].x, h1[best].y, h2[j].x, h2[j].y, C.accent, 1.4, 0.12 * w * p.h2 * dim);
      }
    }
  }
  if (p.outl > 0) {
    const probs = probsAt(p.morph);
    for (let cl = 0; cl < COL.out.n; cl++) {
      let best = 0, bv = -Infinity;
      for (let j = 0; j < COL.h2.n; j++) { const c = pass.a2[j]; if (c > bv) { bv = c; best = j; } }
      h2.forEach((n) => faint(n.x + COL.h2.r, n.y, out[cl].x - COL.out.r, out[cl].y, 0.022 * p.outl));
      const w = clamp(probs[cl] / Math.max(...probs));
      const col = cl === 1 ? C.rival : C.accent;
      if (w > 0.16) {
        travelingPulse(ctx, h2[best].x, h2[best].y, out[cl].x, out[cl].y, (t * 0.5 + cl * 0.19) % 1, col, 10, 0.5 * w * p.outl * dim);
        glowLine(ctx, h2[best].x, h2[best].y, out[cl].x, out[cl].y, col, 1.4, 0.14 * w * p.outl * dim);
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

  if (p.a7 > 0.001 && p.pix < 0.999) {
    const strokeA = p.a7 * (1 - p.pix);
    const pts: [number, number][] = [
      [x0 + 18, y0 + 32], [x0 + span - 18, y0 + 28],
      [x0 + span * 0.62, y0 + span * 0.46], [x0 + span * 0.42, y0 + span - 16],
    ];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgb(C.accent, strokeA);
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = rgb(C.accent, strokeA * 0.8);
    ctx.shadowBlur = 28;
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
  ctx.save();
  ctx.strokeStyle = rgb(C.fgSubtle, 0.4 * p.pix);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0 - 6, y0 - 6, span + 12, span + 12);
  ctx.restore();

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = digit[r][c];
      const idx = r * n + c;
      const ap = clamp((p.pix - (idx / (n * n)) * 0.5) / 0.5);
      const px = x0 + c * cell + cell / 2;
      const py = y0 + r * cell + cell / 2;
      ctx.save();
      ctx.fillStyle = rgb(C.surface, 0.5 * ap);
      ctx.strokeStyle = rgb(C.fgSubtle, 0.12 * ap);
      ctx.lineWidth = 1;
      roundRect(ctx, px - cell / 2 + 2, py - cell / 2 + 2, cell - 4, cell - 4, 4);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (v > 0.02) {
        glowDot(ctx, px, py, (cell / 2 - 5) * (0.7 + 0.3 * v), C.accent, v * ap);
      }
      if (p.edges > 0.01 && v > 0.3) {
        const horiz = r < 2;
        const ang = horiz ? 0 : -Math.PI / 4;
        const len = cell * 0.46 * p.edges;
        const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
        glowLine(ctx, px - dx, py - dy, px + dx, py + dy, C.teal, 2, 0.55 * p.edges * v);
      }
    }
  }

  ctx.save();
  setFont(ctx, 13, FONT.mono, "500");
  ctx.fillStyle = rgb(C.fgMuted, 0.85 * p.pix);
  ctx.textAlign = "center";
  ctx.fillText("INPUT · 8×8", cx, y0 + span + 36);
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
      const ap = clamp((reveal - (i / col.n) * 0.4) / 0.6);
      if (ap <= 0) continue;
      const act = clamp(acts[i] / amax);
      ctx.save();
      ctx.strokeStyle = rgb(C.fgSubtle, 0.5 * ap * dim);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(col.x, y, col.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (act > 0.06) {
        const pulse = 1 + 0.1 * Math.sin(t * 3 + i);
        glowDot(ctx, col.x, y, col.r * (0.55 + 0.5 * act) * pulse, C.accent, act * ap * dim);
      }
    }
    ctx.save();
    setFont(ctx, 13, FONT.mono, "600");
    ctx.fillStyle = rgb(C.fg, 0.92 * reveal * dim);
    ctx.textAlign = "center";
    ctx.fillText(title, col.x, col.y0 - 42);
    setFont(ctx, 11, FONT.mono, "400");
    ctx.fillStyle = rgb(C.fgMuted, 0.8 * reveal * dim);
    ctx.fillText(sub, col.x, col.y0 - 24);
    ctx.restore();
  };

  layer(COL.h1, pass.a1, a1max, p.h1, "LAYER 1", "edges · angles");
  layer(COL.h2, pass.a2, a2max, p.h2, "LAYER 2", "shapes");

  if (p.outl > 0.001) {
    const winner = probs.indexOf(Math.max(...probs));
    for (let i = 0; i < COL.out.n; i++) {
      const y = colY(COL.out, i);
      const ap = clamp((p.outl - (i / COL.out.n) * 0.4) / 0.6);
      if (ap <= 0) continue;
      const isWin = i === winner;
      const isRival = i === 1 && p.morph > 0.15;
      const col = isRival ? C.rival : C.accent;
      const lit = clamp(probs[i] / Math.max(...probs));
      ctx.save();
      ctx.strokeStyle = rgb(C.fgSubtle, 0.5 * ap * dim);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(COL.out.x, y, COL.out.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (lit > 0.04 || isWin || isRival) {
        glowDot(ctx, COL.out.x, y, COL.out.r * (0.5 + 0.6 * lit), col, (0.25 + lit) * ap * dim);
      }
      ctx.save();
      setFont(ctx, 12, FONT.mono, "600");
      ctx.fillStyle = rgb(lit > 0.5 ? C.bg : C.fgMuted, ap * dim);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(DIGITS_STR[i], COL.out.x, y);
      ctx.restore();
    }
    ctx.save();
    setFont(ctx, 13, FONT.mono, "600");
    ctx.fillStyle = rgb(C.fg, 0.92 * p.outl * dim);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("OUTPUT", COL.out.x, COL.out.y0 - 42);
    setFont(ctx, 11, FONT.mono, "400");
    ctx.fillStyle = rgb(C.fgMuted, 0.8 * p.outl * dim);
    ctx.fillText("softmax · 10", COL.out.x, COL.out.y0 - 24);
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
    ctx.save();
    ctx.fillStyle = rgb(C.fg, 0.05 * p.lock * dim);
    roundRect(ctx, BAR.x, y - BAR.h / 2, BAR.w, BAR.h, BAR.h / 2);
    ctx.fill();
    ctx.restore();
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

  // hero readout, top-right — the headline
  const heroA = clamp((p.lock - 0.35) / 0.4) * dim;
  if (heroA <= 0.01) return;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  if (p.morph < 0.2) {
    const jit = noise1(t * 7) * (1 - p.lock) * 0.4;
    setFont(ctx, 11, FONT.mono, "500");
    ctx.fillStyle = rgb(C.fgMuted, heroA);
    ctx.textAlign = "left";
    ctx.fillText("PREDICTION", HERO.x, HERO.y - 96);
    setFont(ctx, 132, FONT.display, "400");
    ctx.fillStyle = rgb(C.accent, heroA);
    ctx.shadowColor = rgb(C.accent, heroA * 0.5);
    ctx.shadowBlur = 30;
    ctx.fillText("7", HERO.x, HERO.y + 30);
    ctx.shadowBlur = 0;
    setFont(ctx, 46, FONT.mono, "500");
    ctx.fillStyle = rgb(C.fg, heroA);
    ctx.fillText(`${(probs[7] * 100 + jit).toFixed(1)}%`, HERO.x + 110, HERO.y);
    setFont(ctx, 12, FONT.mono, "400");
    ctx.fillStyle = rgb(C.fgMuted, heroA);
    ctx.fillText("CONFIDENCE", HERO.x + 112, HERO.y - 36);
  } else {
    const j7 = noise1(t * 6) * p.morph * 0.5;
    const j1 = noise1(40 + t * 6) * p.morph * 0.5;
    setFont(ctx, 11, FONT.mono, "500");
    ctx.fillStyle = rgb(C.rival, heroA);
    ctx.textAlign = "left";
    ctx.fillText("UNCERTAIN", HERO.x, HERO.y - 96);
    // 7
    setFont(ctx, 100, FONT.display, "400");
    ctx.fillStyle = rgb(C.accent, heroA);
    ctx.shadowColor = rgb(C.accent, heroA * 0.4);
    ctx.shadowBlur = 24;
    ctx.fillText("7", HERO.x, HERO.y + 16);
    ctx.shadowBlur = 0;
    setFont(ctx, 34, FONT.mono, "500");
    ctx.fillStyle = rgb(C.accent, heroA);
    ctx.fillText(`${(probs[7] * 100 + j7).toFixed(0)}%`, HERO.x + 78, HERO.y - 14);
    // 1
    setFont(ctx, 100, FONT.display, "400");
    ctx.fillStyle = rgb(C.rival, heroA);
    ctx.shadowColor = rgb(C.rival, heroA * 0.4);
    ctx.shadowBlur = 24;
    ctx.fillText("1", HERO.x + 188, HERO.y + 16);
    ctx.shadowBlur = 0;
    setFont(ctx, 34, FONT.mono, "500");
    ctx.fillStyle = rgb(C.rival, heroA);
    ctx.fillText(`${(probs[1] * 100 + j1).toFixed(0)}%`, HERO.x + 240, HERO.y - 14);
  }
  ctx.restore();
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
