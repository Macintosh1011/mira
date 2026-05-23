/**
 * Mira Kit — implementation.
 *
 * Hand-tuned to reproduce the reference aesthetic from the design handoff
 * (canvas.jsx = Fed topic, nn-canvas.jsx = NN classifier). All the magic
 * numbers here — 0.18 hero-ring alpha, rgba(20,20,24,0.7) inner card, the
 * dash period, the drop-shadow glow radius — are lifted from those files so a
 * scene COMPOSED from these primitives lands at reference quality.
 *
 * Discipline carried over from the brief:
 *   - tinted near-black (#0c0c0e), never pure black
 *   - fg ~95% white (#f4f4f5), never pure white
 *   - strokes 1.5px, never harsh
 *   - accent yellow #efc540 reserved for active states / values
 *   - quintic / smoothstep easing
 */
import type {
  EaseSet,
  EquationHandle,
  EquationOpts,
  KatexLike,
  Kit,
  P5,
  Palette,
  Point2,
  RGB,
  Scene3D,
  Scene3DOpts,
} from "./types";

// ── palette ───────────────────────────────────────────────────────────
// Hex from design_handoff_mira/styles.css :root + topic colors from the brief.
const PALETTE: Palette = {
  bg: [12, 12, 14], // #0c0c0e
  surface: [20, 20, 24], // rgba(20,20,24,*) inner card base
  fg: [244, 244, 245], // #f4f4f5
  fgMuted: [161, 161, 170], // #a1a1aa
  fgSubtle: [82, 82, 91], // #52525b
  accent: [239, 197, 64], // #efc540
  terracotta: [239, 127, 57], // #ef7f39
  teal: [49, 192, 177], // #31c0b1
  blue: [37, 107, 185], // #256bb9
  pink: [218, 123, 163], // #da7ba3
  deepRed: [164, 18, 71], // #a41247
  hairline: [255, 255, 255, 0.08],
  hairlineStrong: [255, 255, 255, 0.16],
};

// ── easing ──────────────────────────────────────────────────────────────
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const EASE: EaseSet = {
  linear: (t) => clamp01(t),
  quintic: (t) => {
    t = clamp01(t);
    return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
  },
  smoothstep: (t) => {
    t = clamp01(t);
    return t * t * (3 - 2 * t);
  },
  smootherstep: (t) => {
    t = clamp01(t);
    return t * t * t * (t * (t * 6 - 15) + 10);
  },
  outCubic: (t) => {
    t = clamp01(t);
    return 1 - Math.pow(1 - t, 3);
  },
  outQuint: (t) => {
    t = clamp01(t);
    return 1 - Math.pow(1 - t, 5);
  },
  inOutCubic: (t) => {
    t = clamp01(t);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },
  overshoot: (t) => {
    t = clamp01(t);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

// ── font feel ─────────────────────────────────────────────────────────
// We can't guarantee Geist is loaded inside the p5 canvas, so we map to the
// closest reliably-present families. Helvetica Neue reads close to Geist Sans;
// Menlo / monospace matches the Geist Mono metrics well enough for values.
const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";
const MONO = "Menlo, Monaco, Consolas, monospace";

// ── low-level paint helpers ─────────────────────────────────────────────
function fill(p: P5, c: RGB, alpha = 1): void {
  p.fill(c[0], c[1], c[2], clamp01(alpha) * 255);
}
function stroke(p: P5, c: RGB, alpha = 1, weight = 1.5): void {
  p.stroke(c[0], c[1], c[2], clamp01(alpha) * 255);
  p.strokeWeight(weight);
}
function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((d) => d + d)
          .join("")
      : h,
    16,
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function useFonts(p: P5): void {
  // p5 textFont accepts a CSS font-family string in the DOM renderer.
  p.textFont(SANS);
}

// A reusable glow: p5 has no CSS drop-shadow, so we fake it with a few
// translucent, growing circles behind the shape. Cheap and deterministic.
function glow(
  p: P5,
  x: number,
  y: number,
  r: number,
  c: RGB,
  strength: number,
): void {
  if (strength <= 0) return;
  p.noStroke();
  const rings = 4;
  for (let i = rings; i >= 1; i--) {
    const f = i / rings;
    fill(p, c, strength * 0.16 * (1 - f) + 0.02);
    p.circle(x, y, r * 2 + f * r * 2.4);
  }
}

// ── backgrounds ─────────────────────────────────────────────────────────
function grid(
  p: P5,
  opts: { reveal?: number; cell?: number; wash?: RGB } = {},
): void {
  const reveal = opts.reveal ?? 1;
  const cell = opts.cell ?? 100;
  const wash = opts.wash ?? PALETTE.accent;
  const W = p.width;
  const H = p.height;

  // Tinted-black paper.
  p.background(PALETTE.bg[0], PALETTE.bg[1], PALETTE.bg[2]);

  // Central radial accent wash: rgba(accent,0.04) -> transparent at ~70% r.
  p.noStroke();
  const cx = W / 2;
  const cy = H / 2;
  const maxR = Math.hypot(W, H) * 0.7;
  const steps = 18;
  for (let i = steps; i >= 1; i--) {
    const f = i / steps;
    fill(p, wash, 0.045 * (1 - f) * reveal);
    p.circle(cx, cy, maxR * 2 * f);
  }

  // Faint 1px sub-grid at white 0.02.
  p.strokeWeight(1);
  p.stroke(255, 255, 255, 0.02 * reveal * 255);
  for (let x = 0; x <= W; x += cell) p.line(x, 0, x, H);
  for (let y = 0; y <= H; y += cell) p.line(0, y, W, y);
}

function phaseDots(
  p: P5,
  opts: {
    x: number;
    y: number;
    total: number;
    current: number;
    label?: string;
    color?: RGB;
  },
): void {
  const color = opts.color ?? PALETTE.accent;
  const segW = 16;
  const gap = 4;
  const h = 2;
  p.noStroke();
  for (let i = 0; i < opts.total; i++) {
    const on = i <= opts.current;
    fill(p, on ? color : PALETTE.fgSubtle, on ? 1 : 0.5);
    p.rect(opts.x + i * (segW + gap), opts.y, segW, h, 1);
  }
  if (opts.label) {
    p.textFont(MONO);
    p.textSize(11);
    p.textAlign(p.LEFT, p.CENTER);
    fill(p, PALETTE.fgSubtle, 1);
    p.text(
      opts.label.toUpperCase(),
      opts.x + opts.total * (segW + gap) + 8,
      opts.y + h / 2,
    );
    p.textFont(SANS);
  }
}

// ── typography ────────────────────────────────────────────────────────
function label(
  p: P5,
  opts: {
    x: number;
    y: number;
    text: string;
    size?: number;
    upper?: boolean;
    color?: RGB;
    mono?: boolean;
    align?: "left" | "center" | "right";
    alpha?: number;
    weight?: "normal" | "bold";
  },
): void {
  const size = opts.size ?? 13;
  const color = opts.color ?? PALETTE.fg;
  const alpha = opts.alpha ?? 1;
  const align = opts.align ?? "center";
  p.push();
  p.textFont(opts.mono ? MONO : SANS);
  p.textSize(size);
  p.textStyle(opts.weight === "bold" ? p.BOLD : p.NORMAL);
  const ha = align === "left" ? p.LEFT : align === "right" ? p.RIGHT : p.CENTER;
  p.textAlign(ha, p.CENTER);
  p.noStroke();
  fill(p, color, alpha);
  if (opts.upper) {
    // p5 has no letter-spacing; draw chars spaced for the uppercase sub-label.
    drawTracked(p, opts.text.toUpperCase(), opts.x, opts.y, size * 0.08, ha);
  } else {
    p.text(opts.text, opts.x, opts.y);
  }
  p.pop();
}

// Manual letter-spacing for uppercase sub-labels (matches 0.08em tracking).
function drawTracked(
  p: P5,
  text: string,
  x: number,
  y: number,
  spacing: number,
  ha: number,
): void {
  const widths = [...text].map((ch) => p.textWidth(ch) + spacing);
  const total = widths.reduce((s, w) => s + w, 0) - spacing;
  let cx = ha === p.CENTER ? x - total / 2 : ha === p.RIGHT ? x - total : x;
  const prevAlign = p.LEFT;
  p.textAlign(prevAlign, p.CENTER);
  [...text].forEach((ch, i) => {
    p.text(ch, cx, y);
    cx += widths[i];
  });
}

function valueFlip(
  p: P5,
  opts: {
    x: number;
    y: number;
    from: string;
    to: string;
    t: number;
    size?: number;
    color?: RGB;
    align?: "left" | "center" | "right";
  },
): void {
  const size = opts.size ?? 28;
  const color = opts.color ?? PALETTE.accent;
  const t = clamp01(opts.t);
  // Crossfade with a tiny vertical slide, like the SVG fill transition.
  const showFrom = 1 - EASE.smoothstep(clamp01(t / 0.5));
  const showTo = EASE.smoothstep(clamp01((t - 0.5) / 0.5));
  if (showFrom > 0.01) {
    label(p, {
      x: opts.x,
      y: opts.y - (1 - showFrom) * 4,
      text: opts.from,
      size,
      mono: true,
      color,
      align: opts.align ?? "center",
      alpha: showFrom,
    });
  }
  if (showTo > 0.01) {
    label(p, {
      x: opts.x,
      y: opts.y + (1 - showTo) * 4,
      text: opts.to,
      size,
      mono: true,
      color,
      align: opts.align ?? "center",
      alpha: showTo,
    });
  }
}

function deltaTri(
  p: P5,
  opts: {
    x: number;
    y: number;
    dir: "up" | "down";
    size?: number;
    color?: RGB;
    reveal?: number;
  },
): void {
  const s = opts.size ?? 11;
  const color = opts.color ?? PALETTE.accent;
  const rev = EASE.outCubic(opts.reveal ?? 1);
  if (rev <= 0.01) return;
  const rise = (1 - rev) * 6; // fadeInUp
  p.push();
  p.noStroke();
  fill(p, color, 0.9 * rev);
  const y = opts.y + rise;
  const half = s / 2;
  if (opts.dir === "up") {
    p.triangle(opts.x - half, y + s * 0.45, opts.x, y - s * 0.55, opts.x + half, y + s * 0.45);
  } else {
    p.triangle(opts.x - half, y - s * 0.55, opts.x, y + s * 0.55, opts.x + half, y - s * 0.55);
  }
  p.pop();
}

// ── node-graph (Fed topic) ──────────────────────────────────────────────
function node(
  p: P5,
  opts: {
    x: number;
    y: number;
    r: number;
    label?: string;
    sublabel?: string;
    value?: string;
    color?: RGB;
    reveal?: number;
    settle?: number;
    delta?: "up" | "down" | null;
  },
): void {
  const color = opts.color ?? PALETTE.accent;
  const reveal = EASE.outCubic(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  const settle = clamp01(opts.settle ?? 1);
  const ring = opts.r;

  p.push();
  // scale(0.92 -> 1) + opacity, transform-origin at center (matches the SVG).
  const scale = lerp(0.92, 1, reveal);
  p.translate(opts.x, opts.y);
  p.scale(scale);

  // Hero ring: accent at 18% alpha, brightening from 0.3 -> 0.9 on settle.
  const ringAlpha = lerp(0.3, 0.9, settle) * reveal;
  p.noFill();
  p.stroke(color[0], color[1], color[2], 0.18 * 255 * ringAlpha);
  p.strokeWeight(1.5);
  p.circle(0, 0, ring * 2);

  // Inner card: rgba(20,20,24,0.7) fill, white 0.08 hairline.
  fill(p, PALETTE.surface, 0.7 * reveal);
  p.stroke(255, 255, 255, 0.08 * 255 * reveal);
  p.strokeWeight(1);
  p.circle(0, 0, (ring - 8) * 2);

  const valueSize = ring >= 90 ? 32 : ring >= 76 ? 26 : ring >= 60 ? 20 : 18;

  // Sublabel above the value (uppercase mono).
  if (opts.sublabel) {
    label(p, {
      x: 0,
      y: -valueSize / 2 - 6,
      text: opts.sublabel,
      size: 11,
      upper: true,
      mono: true,
      color: PALETTE.fgMuted,
      alpha: reveal,
    });
  }
  // Value (big mono, accent/color).
  if (opts.value) {
    label(p, {
      x: 0,
      y: valueSize / 6,
      text: opts.value,
      size: valueSize,
      mono: true,
      color,
      weight: "bold",
      alpha: reveal,
    });
  }
  // Delta indicator next to the value.
  if (opts.delta) {
    deltaTri(p, {
      x: ring * 0.42,
      y: valueSize / 6,
      dir: opts.delta,
      size: 12,
      color,
      reveal: settle,
    });
  }
  p.pop();

  // Node label below the card (unscaled, in screen space).
  if (opts.label) {
    label(p, {
      x: opts.x,
      y: opts.y + ring + 22,
      text: opts.label,
      size: ring >= 90 ? 14 : 13,
      color: PALETTE.fg,
      weight: "bold",
      alpha: reveal,
    });
  }
}

// Animated edge: faint base line + a flowing accent dash overlay.
function flowEdge(
  p: P5,
  opts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    t: number;
    color?: RGB;
    reveal?: number;
    active?: boolean;
  },
): void {
  const color = opts.color ?? PALETTE.accent;
  const reveal = EASE.outCubic(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  const active = opts.active ?? true;

  // Base subtle line — white 0.10.
  p.stroke(255, 255, 255, 0.1 * 255 * reveal);
  p.strokeWeight(1);
  p.line(opts.x1, opts.y1, opts.x2, opts.y2);

  if (!active) return;
  // Flowing dash: accent 1.5px @ 50% opacity, period ~2.4s, dash 4px on.
  drawFlowingDash(p, opts.x1, opts.y1, opts.x2, opts.y2, opts.t, color, 0.5 * reveal, 2.4, 4);
}

function signal(
  p: P5,
  opts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    t: number;
    color?: RGB;
    reveal?: number;
  },
): void {
  const color = opts.color ?? PALETTE.accent;
  const reveal = EASE.outCubic(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  // Brighter, faster than flowEdge — the NN signal feel (0.7 alpha, 2.0s).
  drawFlowingDash(p, opts.x1, opts.y1, opts.x2, opts.y2, opts.t, color, 0.7 * reveal, 2.0, 4);
}

// Shared dash-flow renderer: marching ants along a segment, with the
// "comet" segment slightly brighter so motion direction reads clearly.
function drawFlowingDash(
  p: P5,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
  color: RGB,
  alpha: number,
  period: number,
  dash: number,
): void {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  // Gap scales with length so a handful of dashes flow regardless of distance.
  const gap = Math.max(18, len / 4);
  const stride = dash + gap;
  const offset = ((t / period) % 1) * stride;
  p.strokeWeight(1.5);
  p.strokeCap(p.ROUND);
  for (let d = -stride + offset; d < len; d += stride) {
    const a = Math.max(0, d);
    const b = Math.min(len, d + dash);
    if (b <= a) continue;
    // Leading dash glows a touch brighter.
    const lead = clamp01(1 - (len - b) / Math.max(1, len));
    p.stroke(color[0], color[1], color[2], (alpha + lead * 0.25) * 255);
    p.line(x1 + ux * a, y1 + uy * a, x1 + ux * b, y1 + uy * b);
  }
  p.strokeCap(p.PROJECT);
}

// Numeric gauge / readout with a crossfading value.
function gauge(
  p: P5,
  opts: {
    x: number;
    y: number;
    from: number;
    to: number;
    t: number;
    label?: string;
    unit?: string;
    color?: RGB;
    decimals?: number;
  },
): void {
  const color = opts.color ?? PALETTE.accent;
  const decimals =
    opts.decimals ??
    (Number.isInteger(opts.from) && Number.isInteger(opts.to) ? 0 : 2);
  const unit = opts.unit ?? "";
  const fromTxt = opts.from.toFixed(decimals) + unit;
  const toTxt = opts.to.toFixed(decimals) + unit;
  if (opts.label) {
    label(p, {
      x: opts.x,
      y: opts.y - 22,
      text: opts.label,
      size: 11,
      upper: true,
      mono: true,
      color: PALETTE.fgMuted,
    });
  }
  valueFlip(p, {
    x: opts.x,
    y: opts.y,
    from: fromTxt,
    to: toTxt,
    t: opts.t,
    size: 26,
    color,
  });
}

// ── archetype primitives (cycle / timeline / comparison) ────────────────
// Directed edge: optional quadratic bow, flowing dash, and an arrowhead at the
// end. Built on the same dash-flow renderer so it matches flowEdge's feel.
function arrowEdge(
  p: P5,
  opts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    t: number;
    color?: RGB;
    reveal?: number;
    head?: boolean;
    curve?: number;
  },
): void {
  const color = opts.color ?? PALETTE.accent;
  const reveal = EASE.outCubic(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  const head = opts.head ?? true;
  const curve = opts.curve ?? 0;

  const dx = opts.x2 - opts.x1;
  const dy = opts.y2 - opts.y1;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal for the bow control point.
  const nx = -dy / len;
  const ny = dx / len;
  const mx = (opts.x1 + opts.x2) / 2 + nx * curve;
  const my = (opts.y1 + opts.y2) / 2 + ny * curve;

  // Tangent at the end (for arrowhead orientation): derivative of the
  // quadratic Bézier at t=1 points from the control point to the end.
  const tangentX = curve === 0 ? dx / len : opts.x2 - mx;
  const tangentY = curve === 0 ? dy / len : opts.y2 - my;
  const tlen = Math.hypot(tangentX, tangentY) || 1;
  const ux = tangentX / tlen;
  const uy = tangentY / tlen;

  // Pull the visible end back so the line tucks under the arrowhead.
  const headSize = 9;
  const ex = head ? opts.x2 - ux * headSize : opts.x2;
  const ey = head ? opts.y2 - uy * headSize : opts.y2;

  p.push();
  // Base line — white 0.10, curved if requested.
  p.noFill();
  p.stroke(255, 255, 255, 0.1 * 255 * reveal);
  p.strokeWeight(1);
  if (curve === 0) {
    p.line(opts.x1, opts.y1, ex, ey);
  } else {
    // Sample the quadratic Bézier into vertices — quadraticVertex was removed
    // in p5 2.x, so build the curve manually to stay version-agnostic.
    p.beginShape();
    p.vertex(opts.x1, opts.y1);
    const baseSegs = 24;
    for (let i = 1; i <= baseSegs; i++) {
      const s = i / baseSegs;
      const bx = lerp(lerp(opts.x1, mx, s), lerp(mx, ex, s), s);
      const by = lerp(lerp(opts.y1, my, s), lerp(my, ey, s), s);
      p.vertex(bx, by);
    }
    p.endShape();
  }

  // Flowing accent dash along the (approximated) path.
  if (curve === 0) {
    drawFlowingDash(p, opts.x1, opts.y1, ex, ey, opts.t, color, 0.55 * reveal, 2.4, 4);
  } else {
    // Sample the curve into short segments and flow the dash per segment.
    const segs = 24;
    let px = opts.x1;
    let py = opts.y1;
    let acc = 0;
    for (let i = 1; i <= segs; i++) {
      const s = i / segs;
      const bx = lerp(lerp(opts.x1, mx, s), lerp(mx, ex, s), s);
      const by = lerp(lerp(opts.y1, my, s), lerp(my, ey, s), s);
      acc += Math.hypot(bx - px, by - py);
      drawFlowingDash(p, px, py, bx, by, opts.t + acc * 0.0015, color, 0.5 * reveal, 2.4, 4);
      px = bx;
      py = by;
    }
  }

  // Arrowhead.
  if (head) {
    const a = Math.atan2(uy, ux);
    const spread = 0.42;
    p.noStroke();
    fill(p, color, 0.85 * reveal);
    p.triangle(
      opts.x2,
      opts.y2,
      opts.x2 - Math.cos(a - spread) * headSize * 1.6,
      opts.y2 - Math.sin(a - spread) * headSize * 1.6,
      opts.x2 - Math.cos(a + spread) * headSize * 1.6,
      opts.y2 - Math.sin(a + spread) * headSize * 1.6,
    );
  }
  p.pop();
}

// Compact stage pill — the cycle/timeline beat. Lighter than the Fed `node`:
// a rounded card with sublabel/label/value stacked, an active accent glow, and
// an optional ordinal badge. Reveal scales + fades it in.
function stageNode(
  p: P5,
  opts: {
    x: number;
    y: number;
    r?: number;
    label: string;
    sublabel?: string;
    value?: string;
    color?: RGB;
    reveal?: number;
    active?: number;
    index?: number;
  },
): void {
  const r = opts.r ?? 46;
  const color = opts.color ?? PALETTE.accent;
  const reveal = EASE.outCubic(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  const active = clamp01(opts.active ?? 0);

  p.push();
  p.translate(opts.x, opts.y);
  p.scale(lerp(0.9, 1, reveal));

  // Active hero ring (accent at 18%, brightening with active).
  if (active > 0.01) {
    glow(p, 0, 0, r, color, 0.4 * active * reveal);
    p.noFill();
    p.stroke(color[0], color[1], color[2], 0.18 * 255 * lerp(0.4, 1, active) * reveal);
    p.strokeWeight(1.5);
    p.circle(0, 0, r * 2);
  } else {
    p.noFill();
    p.stroke(255, 255, 255, 0.1 * 255 * reveal);
    p.strokeWeight(1.5);
    p.circle(0, 0, r * 2);
  }

  // Inner card.
  fill(p, PALETTE.surface, 0.72 * reveal);
  p.stroke(255, 255, 255, 0.08 * 255 * reveal);
  p.strokeWeight(1);
  p.circle(0, 0, (r - 7) * 2);
  p.pop();

  const lit = active > 0.4;
  // Sublabel.
  if (opts.sublabel) {
    label(p, {
      x: opts.x,
      y: opts.y - (opts.value ? 17 : 11),
      text: opts.sublabel,
      size: 10,
      upper: true,
      mono: true,
      color: lit ? color : PALETTE.fgMuted,
      alpha: reveal,
    });
  }
  // Label (wrapped to two lines if long).
  drawWrapped(p, opts.label, opts.x, opts.y + (opts.value ? 1 : opts.sublabel ? 4 : 0), {
    size: r >= 52 ? 14 : 12.5,
    weight: "bold",
    color: PALETTE.fg,
    alpha: reveal,
    maxWidth: (r - 10) * 2,
    lineH: 15,
  });
  // Value.
  if (opts.value) {
    label(p, {
      x: opts.x,
      y: opts.y + 19,
      text: opts.value,
      size: 14,
      mono: true,
      weight: "bold",
      color,
      alpha: reveal,
    });
  }

  // Ordinal badge at the top edge.
  if (opts.index != null) {
    p.push();
    p.noStroke();
    fill(p, lit ? color : PALETTE.surface, reveal);
    p.circle(opts.x, opts.y - r, 18);
    if (!lit) {
      p.noFill();
      p.stroke(255, 255, 255, 0.16 * 255 * reveal);
      p.strokeWeight(1);
      p.circle(opts.x, opts.y - r, 18);
    }
    label(p, {
      x: opts.x,
      y: opts.y - r,
      text: String(opts.index),
      size: 11,
      mono: true,
      weight: "bold",
      color: lit ? PALETTE.bg : PALETTE.fgMuted,
      alpha: reveal,
    });
    p.pop();
  }
}

// A single vertical bar for the comparison archetype. Track + accent fill that
// grows from the baseline, with a label below and a value readout above.
function bar(
  p: P5,
  opts: {
    x: number;
    y: number;
    w: number;
    maxH: number;
    value: number;
    label?: string;
    readout?: string;
    color?: RGB;
    reveal?: number;
    active?: number;
  },
): void {
  const color = opts.color ?? PALETTE.accent;
  const reveal = EASE.outCubic(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  const active = clamp01(opts.active ?? 0);
  const v = clamp01(opts.value);
  const grown = EASE.outQuint(reveal) * v;
  const h = opts.maxH * grown;
  const left = opts.x - opts.w / 2;

  p.push();
  // Track outline up the full height.
  p.noFill();
  p.stroke(255, 255, 255, 0.06 * 255 * reveal);
  p.strokeWeight(1);
  p.rect(left, opts.y - opts.maxH, opts.w, opts.maxH, 4);

  // Fill — accent, brighter when active.
  if (active > 0.2) glow(p, opts.x, opts.y - h, opts.w / 2, color, 0.3 * active);
  p.noStroke();
  fill(p, color, (active > 0.2 ? 0.95 : 0.7) * reveal);
  if (h > 1) p.rect(left, opts.y - h, opts.w, h, 4);
  p.pop();

  // Readout above the fill.
  if (opts.readout) {
    label(p, {
      x: opts.x,
      y: opts.y - h - 14,
      text: opts.readout,
      size: 13,
      mono: true,
      weight: "bold",
      color: active > 0.4 ? color : PALETTE.fg,
      alpha: reveal,
    });
  }
  // Label below the baseline.
  if (opts.label) {
    drawWrapped(p, opts.label, opts.x, opts.y + 20, {
      size: 12,
      weight: "bold",
      color: active > 0.4 ? PALETTE.fg : PALETTE.fgMuted,
      alpha: reveal,
      maxWidth: opts.w + 40,
      lineH: 14,
    });
  }
}

// Word-wrap helper for labels that may not fit one line under a pill/bar.
function drawWrapped(
  p: P5,
  text: string,
  x: number,
  y: number,
  opts: {
    size: number;
    weight?: "normal" | "bold";
    color: RGB;
    alpha: number;
    maxWidth: number;
    lineH: number;
  },
): void {
  p.push();
  p.textFont(SANS);
  p.textSize(opts.size);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (p.textWidth(trial) > opts.maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  const capped = lines.slice(0, 2);
  if (lines.length > 2) capped[1] = capped[1].replace(/\s*\S*$/, "…");
  p.pop();
  const startY = y - ((capped.length - 1) * opts.lineH) / 2;
  capped.forEach((ln, i) => {
    label(p, {
      x,
      y: startY + i * opts.lineH,
      text: ln,
      size: opts.size,
      weight: opts.weight,
      color: opts.color,
      alpha: opts.alpha,
    });
  });
}

// ── network (NN topic) ──────────────────────────────────────────────────
function neuron(
  p: P5,
  opts: {
    x: number;
    y: number;
    r?: number;
    active?: boolean;
    settled?: boolean;
    winner?: boolean;
    label?: string;
    color?: RGB;
    reveal?: number;
  },
): void {
  const r = opts.r ?? 11;
  const color = opts.color ?? PALETTE.accent;
  const reveal = EASE.outCubic(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  const lit = opts.winner || opts.active;

  // Glow behind firing / winning neurons (fakes the SVG drop-shadow).
  if (lit) glow(p, opts.x, opts.y, r, color, (opts.winner ? 0.7 : 0.55) * reveal);

  p.push();
  if (opts.winner) {
    fill(p, color, reveal);
    stroke(p, color, reveal, 2);
  } else if (opts.active) {
    fill(p, color, reveal);
    stroke(p, color, reveal, 1);
  } else if (opts.settled) {
    fill(p, PALETTE.fgMuted, 0.55 * reveal);
    p.stroke(255, 255, 255, 0.18 * 255 * reveal);
    p.strokeWeight(1);
  } else {
    p.fill(255, 255, 255, 0.05 * 255 * reveal);
    p.stroke(255, 255, 255, 0.18 * 255 * reveal);
    p.strokeWeight(1);
  }
  p.circle(opts.x, opts.y, r * 2);
  p.pop();

  if (opts.label != null) {
    const lc = opts.winner
      ? color
      : opts.active || opts.settled
        ? PALETTE.fg
        : PALETTE.fgMuted;
    label(p, {
      x: opts.x + r + 12,
      y: opts.y,
      text: opts.label,
      size: 13,
      color: lc,
      align: "left",
      weight: "bold",
      alpha: reveal,
    });
  }
}

function neuronLayer(
  p: P5,
  opts: {
    x: number;
    ys: number[];
    active?: boolean[];
    settled?: boolean[];
    labels?: string[];
    title?: string;
    sublabel?: string;
    r?: number;
    color?: RGB;
    reveal?: number;
  },
): void {
  const reveal = opts.reveal ?? 1;
  opts.ys.forEach((y, i) => {
    neuron(p, {
      x: opts.x,
      y,
      r: opts.r ?? 11,
      active: opts.active?.[i] ?? false,
      settled: opts.settled?.[i] ?? false,
      label: opts.labels?.[i],
      color: opts.color,
      reveal,
    });
  });
  if (opts.title) {
    label(p, {
      x: opts.x,
      y: 110,
      text: opts.title,
      size: 13,
      color: PALETTE.fg,
      weight: "bold",
      alpha: EASE.outCubic(reveal),
    });
  }
  if (opts.sublabel) {
    label(p, {
      x: opts.x,
      y: 128,
      text: opts.sublabel,
      size: 11,
      upper: true,
      mono: true,
      color: PALETTE.fgMuted,
      alpha: EASE.outCubic(reveal),
    });
  }
}

// Faint full bundle of base edges between two neuron columns.
function connectBundle(
  p: P5,
  opts: {
    from: { x: number; y: number }[];
    to: { x: number; y: number }[];
    inset?: number;
    reveal?: number;
  },
): void {
  const inset = opts.inset ?? 12;
  const reveal = EASE.outCubic(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  p.stroke(255, 255, 255, 0.05 * 255 * reveal);
  p.strokeWeight(1);
  for (const a of opts.from) {
    for (const b of opts.to) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      p.line(a.x + ux * inset, a.y + uy * inset, b.x - ux * inset, b.y - uy * inset);
    }
  }
}

function pixelGrid(
  p: P5,
  opts: {
    x: number;
    y: number;
    cell: number;
    data: number[][];
    reveal?: number;
    color?: RGB;
    frame?: boolean;
  },
): void {
  const color = opts.color ?? PALETTE.accent;
  const reveal = clamp01(opts.reveal ?? 1);
  const rows = opts.data.length;
  const cols = opts.data[0]?.length ?? 0;
  const w = cols * opts.cell;
  const h = rows * opts.cell;

  if (opts.frame) {
    p.push();
    fill(p, PALETTE.surface, 0.5);
    p.stroke(255, 255, 255, 0.08 * 255);
    p.strokeWeight(1);
    p.rect(opts.x - 8, opts.y - 8, w + 16, h + 16, 12);
    p.pop();
  }

  // Count "on" cells for scan-order reveal.
  const onCount = opts.data.reduce(
    (s, row) => s + row.reduce((rs, v) => rs + (v > 0 ? 1 : 0), 0),
    0,
  );
  const revealedOn = Math.floor(reveal * onCount);
  let onIdx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = opts.data[r][c];
      const on = v > 0;
      const cx = opts.x + c * opts.cell + 1;
      const cy = opts.y + r * opts.cell + 1;
      const sz = opts.cell - 2;
      const revealed = on ? onIdx++ < revealedOn : false;
      p.push();
      if (on && revealed) {
        glow(p, cx + sz / 2, cy + sz / 2, sz / 2, color, 0.5 * v);
        fill(p, color, v);
        p.stroke(color[0], color[1], color[2], 0.5 * 255);
      } else if (on) {
        p.noFill();
        p.stroke(color[0], color[1], color[2], 0.0);
      } else {
        p.fill(255, 255, 255, 0.025 * 255);
        p.stroke(255, 255, 255, 0.06 * 255);
      }
      p.strokeWeight(1);
      p.rect(cx, cy, sz, sz, 3);
      p.pop();
    }
  }
}

function confidenceBar(
  p: P5,
  opts: {
    x: number;
    y: number;
    w?: number;
    value: number;
    color?: RGB;
    showPct?: boolean;
  },
): void {
  const w = opts.w ?? 80;
  const color = opts.color ?? PALETTE.accent;
  const v = clamp01(opts.value);
  const h = 4;
  p.push();
  p.noStroke();
  // Track.
  p.fill(255, 255, 255, 0.08 * 255);
  p.rect(opts.x, opts.y - h / 2, w, h, 2);
  // Fill.
  fill(p, color, 1);
  p.rect(opts.x, opts.y - h / 2, w * v, h, 2);
  p.pop();
  if (opts.showPct ?? true) {
    label(p, {
      x: opts.x + w + 8,
      y: opts.y,
      text: (v * 100).toFixed(1) + "%",
      size: 11,
      mono: true,
      color,
      align: "left",
    });
  }
}

// ── charts ──────────────────────────────────────────────────────────────
function axes(
  p: P5,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    reveal?: number;
    xLabel?: string;
    yLabel?: string;
  },
): void {
  const reveal = EASE.outCubic(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  p.push();
  p.stroke(255, 255, 255, 0.16 * 255 * reveal);
  p.strokeWeight(1.5);
  p.strokeCap(p.ROUND);
  // L-shaped axes.
  p.line(opts.x, opts.y, opts.x, opts.y + opts.h);
  p.line(opts.x, opts.y + opts.h, opts.x + opts.w, opts.y + opts.h);
  // Faint gridlines.
  p.stroke(255, 255, 255, 0.05 * 255 * reveal);
  p.strokeWeight(1);
  for (let i = 1; i <= 4; i++) {
    const gy = opts.y + (opts.h * i) / 4;
    p.line(opts.x, gy, opts.x + opts.w, gy);
  }
  p.pop();
  if (opts.xLabel) {
    label(p, {
      x: opts.x + opts.w / 2,
      y: opts.y + opts.h + 22,
      text: opts.xLabel,
      size: 11,
      upper: true,
      mono: true,
      color: PALETTE.fgMuted,
      alpha: reveal,
    });
  }
  if (opts.yLabel) {
    p.push();
    p.translate(opts.x - 28, opts.y + opts.h / 2);
    p.rotate(-Math.PI / 2);
    label(p, {
      x: 0,
      y: 0,
      text: opts.yLabel,
      size: 11,
      upper: true,
      mono: true,
      color: PALETTE.fgMuted,
      alpha: reveal,
    });
    p.pop();
  }
}

function plotLine(
  p: P5,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    points: { x: number; y: number }[];
    t: number;
    color?: RGB;
    head?: boolean;
  },
): void {
  const color = opts.color ?? PALETTE.accent;
  const t = EASE.outCubic(clamp01(opts.t));
  const pts = opts.points;
  if (pts.length < 2) return;
  const sx = (nx: number) => opts.x + clamp01(nx) * opts.w;
  const sy = (ny: number) => opts.y + opts.h - clamp01(ny) * opts.h;
  const last = (pts.length - 1) * t;
  const whole = Math.floor(last);
  const frac = last - whole;

  p.push();
  p.noFill();
  stroke(p, color, 1, 1.5);
  p.strokeCap(p.ROUND);
  p.strokeJoin(p.ROUND);
  p.beginShape();
  for (let i = 0; i <= whole; i++) p.vertex(sx(pts[i].x), sy(pts[i].y));
  let hx = sx(pts[whole].x);
  let hy = sy(pts[whole].y);
  if (whole < pts.length - 1) {
    hx = lerp(sx(pts[whole].x), sx(pts[whole + 1].x), frac);
    hy = lerp(sy(pts[whole].y), sy(pts[whole + 1].y), frac);
    p.vertex(hx, hy);
  }
  p.endShape();
  p.pop();

  if (opts.head ?? true) {
    glow(p, hx, hy, 4, color, 0.6);
    p.noStroke();
    fill(p, color, 1);
    p.circle(hx, hy, 7);
  }
}

// ── technical vocabulary (charts / physics / readouts) ──────────────────
// Everything below maps a DATA domain (the units the sim thinks in) onto the
// plot box in canvas px. Keep the same xMin/xMax/yMin/yMax across axesPro +
// plot + gridlines and the curve registers against the ticks.

// Format a tick/readout number tersely: drop the trailing ".0" when integral.
function fmtNum(v: number, decimals: number): string {
  const s = v.toFixed(decimals);
  return decimals > 0 && /\.0+$/.test(s) ? s.slice(0, s.indexOf(".")) : s;
}

// Infer a sane decimal count from a domain span (so 0..1 ticks read "0.25",
// 0..100 read "25", etc.). Deterministic — no locale, no rounding surprises.
function inferDecimals(span: number, ticks: number): number {
  const step = Math.abs(span) / Math.max(1, ticks);
  if (step === 0) return 0;
  if (step >= 10) return 0;
  if (step >= 1) return Number.isInteger(step) ? 0 : 1;
  if (step >= 0.1) return 1;
  return 2;
}

// Labeled axes over a data domain: L-frame, outward tick marks with numbers +
// units, optional interior gridlines, and axis titles. The richer sibling of
// the legacy `axes` (kept intact for existing sims).
function axesPro(
  p: P5,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    xMin?: number;
    xMax?: number;
    yMin?: number;
    yMax?: number;
    ticks?: number;
    xLabel?: string;
    yLabel?: string;
    xUnit?: string;
    yUnit?: string;
    decimals?: number;
    gridlines?: boolean;
    reveal?: number;
    color?: RGB;
  },
): void {
  const reveal = clamp01(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  const lineRev = EASE.outCubic(clamp01(reveal / 0.6)); // frame draws first
  const tickRev = EASE.outCubic(clamp01((reveal - 0.4) / 0.6)); // ticks after
  const xMin = opts.xMin ?? 0;
  const xMax = opts.xMax ?? 1;
  const yMin = opts.yMin ?? 0;
  const yMax = opts.yMax ?? 1;
  const ticks = Math.max(1, opts.ticks ?? 5);
  const axisColor = opts.color ?? PALETTE.fgMuted;
  const x0 = opts.x;
  const y0 = opts.y;
  const x1 = opts.x + opts.w;
  const y1 = opts.y + opts.h;
  const xUnit = opts.xUnit ?? "";
  const yUnit = opts.yUnit ?? "";
  const xDec = opts.decimals ?? inferDecimals(xMax - xMin, ticks);
  const yDec = opts.decimals ?? inferDecimals(yMax - yMin, ticks);

  p.push();
  // Interior gridlines (faint), drawn under everything.
  if (opts.gridlines ?? true) {
    p.stroke(255, 255, 255, 0.05 * 255 * lineRev);
    p.strokeWeight(1);
    for (let i = 1; i <= ticks; i++) {
      const gx = lerp(x0, x1, i / ticks);
      const gy = lerp(y1, y0, i / ticks);
      if (i < ticks) p.line(gx, y0, gx, y1);
      if (i < ticks) p.line(x0, gy, x1, gy);
    }
  }

  // L-frame: y-axis up, x-axis along the bottom. Draws on from the origin.
  p.stroke(axisColor[0], axisColor[1], axisColor[2], 0.55 * 255 * lineRev);
  p.strokeWeight(1.5);
  p.strokeCap(p.ROUND);
  const yEnd = lerp(y1, y0, lineRev);
  const xEnd = lerp(x0, x1, lineRev);
  p.line(x0, y1, x0, yEnd);
  p.line(x0, y1, xEnd, y1);
  p.pop();

  if (tickRev <= 0.01) return;

  // Tick marks + numbers.
  p.push();
  for (let i = 0; i <= ticks; i++) {
    const f = i / ticks;
    // X ticks along the bottom.
    const tx = lerp(x0, x1, f);
    p.stroke(axisColor[0], axisColor[1], axisColor[2], 0.5 * 255 * tickRev);
    p.strokeWeight(1.5);
    p.line(tx, y1, tx, y1 + 5);
    if (i > 0 || xMin !== 0) {
      label(p, {
        x: tx,
        y: y1 + 15,
        text: fmtNum(lerp(xMin, xMax, f), xDec) + xUnit,
        size: 10,
        mono: true,
        color: PALETTE.fgSubtle,
        alpha: tickRev,
      });
    }
    // Y ticks up the left.
    const ty = lerp(y1, y0, f);
    p.stroke(axisColor[0], axisColor[1], axisColor[2], 0.5 * 255 * tickRev);
    p.line(x0 - 5, ty, x0, ty);
    label(p, {
      x: x0 - 9,
      y: ty,
      text: fmtNum(lerp(yMin, yMax, f), yDec) + yUnit,
      size: 10,
      mono: true,
      color: PALETTE.fgSubtle,
      align: "right",
      alpha: tickRev,
    });
  }
  p.pop();

  // Axis titles.
  if (opts.xLabel) {
    label(p, {
      x: x0 + opts.w / 2,
      y: y1 + 32,
      text: opts.xLabel,
      size: 11,
      upper: true,
      mono: true,
      color: PALETTE.fgMuted,
      alpha: tickRev,
    });
  }
  if (opts.yLabel) {
    p.push();
    p.translate(x0 - 44, y0 + opts.h / 2);
    p.rotate(-Math.PI / 2);
    label(p, {
      x: 0,
      y: 0,
      text: opts.yLabel,
      size: 11,
      upper: true,
      mono: true,
      color: PALETTE.fgMuted,
      alpha: tickRev,
    });
    p.pop();
  }
}

// A line/curve plot in DATA space. Curve sampled into a vertex polyline (NO
// quadraticVertex — removed in p5 2.x), drawing on left-to-right along the
// path with a glowing leading head. Mirrors plotLine's feel but takes a real
// domain so it lines up with axesPro ticks.
function plot(
  p: P5,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    points: Point2[];
    xMin?: number;
    xMax?: number;
    yMin?: number;
    yMax?: number;
    drawProgress?: number;
    color?: RGB;
    head?: boolean;
    weight?: number;
    fillArea?: boolean;
    clip?: boolean;
  },
): void {
  const pts = opts.points;
  if (pts.length < 2) return;
  const color = opts.color ?? PALETTE.accent;
  const prog = EASE.outCubic(clamp01(opts.drawProgress ?? 1));
  if (prog <= 0.001) return;
  const xMin = opts.xMin ?? 0;
  const xMax = opts.xMax ?? 1;
  const yMin = opts.yMin ?? 0;
  const yMax = opts.yMax ?? 1;
  const weight = opts.weight ?? 1.5;
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const sx = (dx: number) => {
    const f = (dx - xMin) / xSpan;
    return opts.x + (opts.clip ? clamp01(f) : f) * opts.w;
  };
  const sy = (dy: number) => {
    const f = (dy - yMin) / ySpan;
    return opts.y + opts.h - (opts.clip ? clamp01(f) : f) * opts.h;
  };

  // Map every point to screen space once.
  const screen = pts.map((q) => ({ x: sx(q.x), y: sy(q.y) }));

  // Walk the path by how far `prog` has unspooled the *index*, like plotLine.
  const last = (screen.length - 1) * prog;
  const whole = Math.floor(last);
  const frac = last - whole;
  const drawn: { x: number; y: number }[] = [];
  for (let i = 0; i <= whole; i++) drawn.push(screen[i]);
  let hx = screen[whole].x;
  let hy = screen[whole].y;
  if (whole < screen.length - 1) {
    hx = lerp(screen[whole].x, screen[whole + 1].x, frac);
    hy = lerp(screen[whole].y, screen[whole + 1].y, frac);
    drawn.push({ x: hx, y: hy });
  }

  p.push();
  // Area fill from the curve down to the x-axis baseline (y for yMin).
  if (opts.fillArea && drawn.length >= 2) {
    const baseY = sy(Math.max(yMin, Math.min(yMax, 0 >= yMin && 0 <= yMax ? 0 : yMin)));
    p.noStroke();
    fill(p, color, 0.1 * prog);
    p.beginShape();
    p.vertex(drawn[0].x, baseY);
    for (const s of drawn) p.vertex(s.x, s.y);
    p.vertex(drawn[drawn.length - 1].x, baseY);
    p.endShape(p.CLOSE);
  }

  // The curve itself.
  p.noFill();
  stroke(p, color, 1, weight);
  p.strokeCap(p.ROUND);
  p.strokeJoin(p.ROUND);
  p.beginShape();
  for (const s of drawn) p.vertex(s.x, s.y);
  p.endShape();
  p.pop();

  if (opts.head ?? true) {
    glow(p, hx, hy, 4, color, 0.6);
    p.noStroke();
    fill(p, color, 1);
    p.circle(hx, hy, 7);
  }
}

// An arrow/vector in SCREEN space (dx right, dy down). Shaft draws on with
// reveal; arrowhead + optional magnitude label fade in at the end.
function vector(
  p: P5,
  opts: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    color?: RGB;
    label?: string;
    showMagnitude?: boolean;
    reveal?: number;
    headSize?: number;
    weight?: number;
    decimals?: number;
  },
): void {
  const reveal = clamp01(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  const color = opts.color ?? PALETTE.accent;
  const shaftRev = EASE.outCubic(clamp01(reveal / 0.7));
  const headRev = EASE.outCubic(clamp01((reveal - 0.6) / 0.4));
  const mag = Math.hypot(opts.dx, opts.dy);
  if (mag < 0.5) return;
  const ux = opts.dx / mag;
  const uy = opts.dy / mag;
  const headSize = opts.headSize ?? 10;
  const weight = opts.weight ?? 1.5;

  // Tip = full vector; base of the head sits headSize back along the shaft.
  const tipX = opts.x + opts.dx;
  const tipY = opts.y + opts.dy;
  // Shaft grows from tail toward the (head-adjusted) tip.
  const shaftLen = (mag - (headRev > 0.01 ? headSize * 0.8 : 0)) * shaftRev;
  const ex = opts.x + ux * shaftLen;
  const ey = opts.y + uy * shaftLen;

  p.push();
  stroke(p, color, 0.9, weight);
  p.strokeCap(p.ROUND);
  p.line(opts.x, opts.y, ex, ey);

  // Arrowhead.
  if (headRev > 0.01) {
    const a = Math.atan2(uy, ux);
    const spread = 0.42;
    p.noStroke();
    fill(p, color, 0.9 * headRev);
    p.triangle(
      tipX,
      tipY,
      tipX - Math.cos(a - spread) * headSize * 1.6,
      tipY - Math.sin(a - spread) * headSize * 1.6,
      tipX - Math.cos(a + spread) * headSize * 1.6,
      tipY - Math.sin(a + spread) * headSize * 1.6,
    );
  }
  p.pop();

  // Label at the head, nudged along the vector's perpendicular so it clears
  // the shaft. Optionally suffix the magnitude.
  if ((opts.label != null && opts.label !== "") || opts.showMagnitude) {
    const decimals = opts.decimals ?? 1;
    const parts: string[] = [];
    if (opts.label) parts.push(opts.label);
    if (opts.showMagnitude) parts.push("|" + fmtNum(mag, decimals) + "|");
    const txt = parts.join(" ");
    // Perpendicular offset (left of travel direction).
    const nx = -uy;
    const ny = ux;
    label(p, {
      x: tipX + ux * 10 + nx * 8,
      y: tipY + uy * 10 + ny * 8,
      text: txt,
      size: 12,
      mono: true,
      weight: "bold",
      color,
      align: "center",
      alpha: headRev,
    });
  }
}

// A technical numeric readout: uppercase mono caption stacked over a big value
// with an optional unit. The instrument-panel beat.
function readout(
  p: P5,
  opts: {
    x: number;
    y: number;
    label: string;
    value: number | string;
    unit?: string;
    color?: RGB;
    decimals?: number;
    size?: number;
    align?: "left" | "center" | "right";
    reveal?: number;
    boxed?: boolean;
  },
): void {
  const reveal = EASE.outCubic(clamp01(opts.reveal ?? 1));
  if (reveal <= 0.01) return;
  const color = opts.color ?? PALETTE.accent;
  const size = opts.size ?? 24;
  const align = opts.align ?? "center";
  const rise = (1 - reveal) * 6;
  const valTxt =
    typeof opts.value === "number"
      ? fmtNum(opts.value, opts.decimals ?? 2)
      : opts.value;
  const unit = opts.unit ?? "";

  // Optional card behind the readout.
  if (opts.boxed) {
    p.push();
    p.textFont(MONO);
    p.textSize(size);
    const vw = p.textWidth(valTxt + (unit ? " " + unit : ""));
    p.textSize(10);
    const lw = p.textWidth(opts.label.toUpperCase());
    const w = Math.max(vw, lw) + 28;
    const h = size + 30;
    const bx =
      align === "left" ? opts.x - 14 : align === "right" ? opts.x - w + 14 : opts.x - w / 2;
    fill(p, PALETTE.surface, 0.7 * reveal);
    p.stroke(255, 255, 255, 0.08 * 255 * reveal);
    p.strokeWeight(1);
    p.rect(bx, opts.y - h / 2 + rise, w, h, 8);
    p.pop();
  }

  label(p, {
    x: opts.x,
    y: opts.y - size / 2 - 2 + rise,
    text: opts.label,
    size: 10,
    upper: true,
    mono: true,
    color: PALETTE.fgMuted,
    align,
    alpha: reveal,
  });
  // Value (+ unit drawn smaller/muted, trailing).
  label(p, {
    x: opts.x,
    y: opts.y + size / 4 + rise,
    text: unit ? valTxt + " " + unit : valTxt,
    size,
    mono: true,
    weight: "bold",
    color,
    align,
    alpha: reveal,
  });
}

// A color-keyed legend. Rows stagger in with reveal.
function legend(
  p: P5,
  opts: {
    x: number;
    y: number;
    items: { color: RGB; label: string }[];
    rowH?: number;
    swatch?: "line" | "dot";
    reveal?: number;
    boxed?: boolean;
  },
): void {
  const reveal = clamp01(opts.reveal ?? 1);
  if (reveal <= 0.01 || opts.items.length === 0) return;
  const rowH = opts.rowH ?? 22;
  const swatch = opts.swatch ?? "line";
  const n = opts.items.length;

  if (opts.boxed) {
    p.push();
    p.textFont(SANS);
    p.textSize(12);
    let maxW = 0;
    for (const it of opts.items) maxW = Math.max(maxW, p.textWidth(it.label));
    fill(p, PALETTE.surface, 0.7 * EASE.outCubic(reveal));
    p.stroke(255, 255, 255, 0.08 * 255 * EASE.outCubic(reveal));
    p.strokeWeight(1);
    p.rect(opts.x - 12, opts.y - 14, maxW + 24 + 28, n * rowH + 8, 8);
    p.pop();
  }

  opts.items.forEach((it, i) => {
    // Stagger: each row reveals over its slice of the progress window.
    const rowRev = EASE.outCubic(clamp01((reveal - (i / n) * 0.5) / 0.5));
    if (rowRev <= 0.01) return;
    const cy = opts.y + i * rowH;
    p.push();
    if (swatch === "dot") {
      p.noStroke();
      fill(p, it.color, rowRev);
      p.circle(opts.x + 6, cy, 9);
    } else {
      stroke(p, it.color, rowRev, 2.5);
      p.strokeCap(p.ROUND);
      p.line(opts.x, cy, opts.x + 16, cy);
    }
    p.pop();
    label(p, {
      x: opts.x + 26,
      y: cy,
      text: it.label,
      size: 12,
      color: PALETTE.fg,
      align: "left",
      alpha: rowRev,
    });
  });
}

// Standalone interior gridlines (no axes) — for backdrops behind a plot.
function gridlines(
  p: P5,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    cols?: number;
    rows?: number;
    color?: RGB;
    alpha?: number;
    reveal?: number;
  },
): void {
  const reveal = EASE.outCubic(clamp01(opts.reveal ?? 1));
  if (reveal <= 0.01) return;
  const cols = Math.max(1, opts.cols ?? 8);
  const rows = Math.max(1, opts.rows ?? 5);
  const color = opts.color ?? PALETTE.fg;
  const alpha = (opts.alpha ?? 0.05) * reveal;
  p.push();
  p.stroke(color[0], color[1], color[2], alpha * 255);
  p.strokeWeight(1);
  for (let i = 0; i <= cols; i++) {
    const gx = lerp(opts.x, opts.x + opts.w, i / cols);
    p.line(gx, opts.y, gx, opts.y + opts.h);
  }
  for (let j = 0; j <= rows; j++) {
    const gy = lerp(opts.y, opts.y + opts.h, j / rows);
    p.line(opts.x, gy, opts.x + opts.w, gy);
  }
  p.pop();
}

// A span bracket: a line parallel to the span with perpendicular lips at each
// end, plus an optional label at mid-span. Annotates "this range here".
function bracket(
  p: P5,
  opts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    depth?: number;
    label?: string;
    color?: RGB;
    reveal?: number;
    flip?: boolean;
  },
): void {
  const reveal = EASE.outCubic(clamp01(opts.reveal ?? 1));
  if (reveal <= 0.01) return;
  const color = opts.color ?? PALETTE.fgMuted;
  const depth = opts.depth ?? 8;
  const dx = opts.x2 - opts.x1;
  const dy = opts.y2 - opts.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular, side chosen by `flip`.
  const s = opts.flip ? -1 : 1;
  const nx = -uy * s;
  const ny = ux * s;

  // The bracket sits offset by `depth` from the span line.
  const ax = opts.x1 + nx * depth;
  const ay = opts.y1 + ny * depth;
  const bx = opts.x2 + nx * depth;
  const by = opts.y2 + ny * depth;
  const grown = reveal;

  p.push();
  stroke(p, color, 0.6, 1.5);
  p.strokeCap(p.ROUND);
  // Spine, draws on from the first end.
  p.line(ax, ay, lerp(ax, bx, grown), lerp(ay, by, grown));
  // Lips back toward the span at each end.
  p.line(opts.x1, opts.y1, ax, ay);
  if (grown > 0.95) p.line(opts.x2, opts.y2, bx, by);
  p.pop();

  if (opts.label && grown > 0.6) {
    const mx = (ax + bx) / 2 + nx * 12;
    const my = (ay + by) / 2 + ny * 12;
    label(p, {
      x: mx,
      y: my,
      text: opts.label,
      size: 11,
      mono: true,
      color: PALETTE.fg,
      align: "center",
      alpha: EASE.outCubic(clamp01((grown - 0.6) / 0.4)),
    });
  }
}

// An engineering dimension line: extension lines off the measured span, a
// dimension line offset between them with tick caps, and the value at mid-span.
function dimension(
  p: P5,
  opts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    value: number | string;
    unit?: string;
    offset?: number;
    color?: RGB;
    decimals?: number;
    reveal?: number;
  },
): void {
  const reveal = clamp01(opts.reveal ?? 1);
  if (reveal <= 0.01) return;
  const lineRev = EASE.outCubic(clamp01(reveal / 0.7));
  const valRev = EASE.outCubic(clamp01((reveal - 0.6) / 0.4));
  const color = opts.color ?? PALETTE.fgMuted;
  const offset = opts.offset ?? 24;
  const dx = opts.x2 - opts.x1;
  const dy = opts.y2 - opts.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  // Dimension line endpoints (the span pushed out by `offset`).
  const ax = opts.x1 + nx * offset;
  const ay = opts.y1 + ny * offset;
  const bx = opts.x2 + nx * offset;
  const by = opts.y2 + ny * offset;

  p.push();
  // Extension lines (span -> dim line), with a small gap at the span.
  stroke(p, color, 0.4, 1);
  p.line(opts.x1 + nx * 3, opts.y1 + ny * 3, ax + nx * 4, ay + ny * 4);
  p.line(opts.x2 + nx * 3, opts.y2 + ny * 3, bx + nx * 4, by + ny * 4);
  // Dimension line, draws on from the center outward.
  stroke(p, color, 0.6, 1.5);
  p.strokeCap(p.ROUND);
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  p.line(cx, cy, lerp(cx, ax, lineRev), lerp(cy, ay, lineRev));
  p.line(cx, cy, lerp(cx, bx, lineRev), lerp(cy, by, lineRev));
  // Tick caps (45°) at each end.
  if (lineRev > 0.9) {
    const cap = 5;
    const tx = (ux - nx) * cap;
    const ty = (uy - ny) * cap;
    p.line(ax - tx, ay - ty, ax + tx, ay + ty);
    p.line(bx - tx, by - ty, bx + tx, by + ty);
  }
  p.pop();

  if (valRev > 0.01) {
    const valTxt =
      typeof opts.value === "number"
        ? fmtNum(opts.value, opts.decimals ?? 1) + (opts.unit ?? "")
        : opts.value + (opts.unit ?? "");
    label(p, {
      x: cx + nx * 11,
      y: cy + ny * 11,
      text: valTxt,
      size: 11,
      mono: true,
      weight: "bold",
      color: PALETTE.fg,
      align: "center",
      alpha: valRev,
    });
  }
}

// ── equations (LaTeX via KaTeX) ──────────────────────────────────────────
// WHY AN HTML OVERLAY, NOT CANVAS:
//   KaTeX renders math to HTML+CSS (stacked spans with absolute positioning &
//   web-fonts), NOT to a bitmap. p5 has no API to rasterize a DOM subtree onto
//   its canvas, and the "render KaTeX offscreen then drawImage" route needs the
//   KaTeX_Main/Math/Size web-fonts fully loaded AND an SVG/foreignObject->image
//   round-trip that taints the canvas and is fragile across browsers. The
//   robust, deterministic approach is a positioned <div> layered OVER the
//   canvas: KaTeX renders into it once, we move/scale/fade it per frame. It
//   stays crisp at any DPR (real DOM text, not a stretched bitmap) and never
//   touches the p5 draw buffer.
//
// CONTRACT: the kit is stateless, so it does NOT hold the canvas. The caller
// passes the KaTeX namespace (host injects `libs.katex`) and the p5 container
// element (the same `container` the render module receives). `equation` creates
// ONE overlay <div> and returns a handle: call `.update(opts)` each frame to
// reposition/restyle (cheap — no re-render of the math) and `.remove()` on
// dispose. Re-rendering the LaTeX only happens when `latex` actually changes.
//
// For hosts that own their own overlay layer, `equationHtml` is a pure helper
// that returns the KaTeX HTML string + the absolute placement (left/top/
// transform) so they can inject it themselves without the kit touching the DOM.

function rgbCss(c: RGB, alpha = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${clamp01(alpha)})`;
}

function placement(opts: EquationOpts): { transform: string } {
  const align = opts.align ?? "center";
  const baseline = opts.baseline ?? "middle";
  const tx = align === "left" ? "0" : align === "right" ? "-100%" : "-50%";
  const ty = baseline === "top" ? "0" : baseline === "bottom" ? "-100%" : "-50%";
  return { transform: `translate(${tx}, ${ty})` };
}

function renderKatex(katex: KatexLike, opts: EquationOpts): string {
  try {
    return katex.renderToString(opts.latex, {
      displayMode: opts.display ?? true,
      throwOnError: false,
      output: "html",
    });
  } catch {
    // KaTeX already swallows most errors with throwOnError:false; this guards
    // a totally-missing renderToString. Fall back to the raw source.
    return opts.latex;
  }
}

function applyEqStyle(el: HTMLElement, opts: EquationOpts): void {
  const color = opts.color ?? PALETTE.fg;
  el.style.position = "absolute";
  el.style.left = `${opts.x}px`;
  el.style.top = `${opts.y}px`;
  el.style.transform = placement(opts).transform;
  el.style.transformOrigin = "center";
  el.style.fontSize = `${opts.size ?? 22}px`;
  el.style.color = rgbCss(color, 1);
  el.style.opacity = String(clamp01(opts.alpha ?? 1));
  el.style.pointerEvents = "none";
  el.style.whiteSpace = "nowrap";
  el.style.lineHeight = "1";
  el.style.zIndex = "5";
}

function equation(
  katex: KatexLike,
  container: HTMLElement,
  opts: EquationOpts,
): EquationHandle {
  // The container holds the canvas; make sure it can position the overlay.
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  const el = document.createElement("div");
  el.className = "mira-kit-equation";
  el.innerHTML = renderKatex(katex, opts);
  applyEqStyle(el, opts);
  container.appendChild(el);

  let lastLatex = opts.latex;
  let lastDisplay = opts.display ?? true;

  return {
    el,
    update: (next) => {
      // Only re-render the math when the source or display mode changes —
      // positioning/opacity per frame is just cheap style writes.
      if (next.latex !== lastLatex || (next.display ?? true) !== lastDisplay) {
        el.innerHTML = renderKatex(katex, next);
        lastLatex = next.latex;
        lastDisplay = next.display ?? true;
      }
      applyEqStyle(el, next);
    },
    remove: () => {
      el.remove();
    },
  };
}

function equationHtml(
  katex: KatexLike,
  opts: EquationOpts,
): { html: string; left: number; top: number; transform: string } {
  return {
    html: renderKatex(katex, opts),
    left: opts.x,
    top: opts.y,
    transform: placement(opts).transform,
  };
}

// ── 3D helpers (flat shaded) ────────────────────────────────────────────
function scene3d(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  THREE: any,
  container: HTMLElement,
  opts: Scene3DOpts = {},
): Scene3D {
  const bg = opts.bg ?? PALETTE.bg;
  const W = container.clientWidth || 960;
  const H = container.clientHeight || 600;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg[0] / 255, bg[1] / 255, bg[2] / 255);
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 50, W / H, 0.1, 100);
  camera.position.set(0, 0, opts.distance ?? 6);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H);
  container.appendChild(renderer.domElement);

  // A single soft hemisphere light so flat-lit MeshLambert reads with depth
  // without specular highlights (keeps the matte, flat look from the brief).
  const hemi = new THREE.HemisphereLight(0xf4f4f5, 0x0c0c0e, 0.9);
  scene.add(hemi);

  return {
    scene,
    camera,
    renderer,
    render: () => renderer.render(scene, camera),
    resize: () => {
      const w = container.clientWidth || W;
      const h = container.clientHeight || H;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    },
    dispose: () => {
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function flatSphere(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  THREE: any,
  r: number,
  color: RGB,
  wire = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const geo = new THREE.IcosahedronGeometry(r, wire ? 1 : 3);
  const col = new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255);
  const mat = wire
    ? new THREE.MeshBasicMaterial({ color: col, wireframe: true })
    : new THREE.MeshLambertMaterial({ color: col, flatShading: true });
  return new THREE.Mesh(geo, mat);
}

function flatLine(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  THREE: any,
  pts: number[][],
  color: RGB,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const geo = new THREE.BufferGeometry().setFromPoints(
    pts.map((q) => new THREE.Vector3(q[0], q[1], q[2] ?? 0)),
  );
  const col = new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255);
  const mat = new THREE.LineBasicMaterial({ color: col });
  return new THREE.Line(geo, mat);
}

// ── factory ─────────────────────────────────────────────────────────────
export function createKit(): Kit {
  return {
    palette: PALETTE,
    ease: EASE,
    fill,
    stroke,
    hexToRgb,
    clamp01,
    lerp,
    useFonts,
    grid,
    phaseDots,
    label,
    valueFlip,
    deltaTri,
    node,
    flowEdge,
    signal,
    gauge,
    arrowEdge,
    stageNode,
    bar,
    neuron,
    neuronLayer,
    connectBundle,
    pixelGrid,
    confidenceBar,
    axes,
    plotLine,
    axesPro,
    plot,
    vector,
    readout,
    legend,
    gridlines,
    bracket,
    dimension,
    equation,
    equationHtml,
    scene3d,
    flatSphere,
    flatLine,
  };
}
