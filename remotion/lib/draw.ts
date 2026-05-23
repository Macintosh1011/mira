/** Canvas drawing toolkit — easing, glow, deterministic noise. Pure, frame-driven. */
import type { RGB } from "../theme";

export const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Smooth 0→1 ramp over [a,b], clamped. */
export const ramp = (x: number, a: number, b: number) => clamp((x - a) / (b - a));
/** Eased ramp. */
export const eramp = (x: number, a: number, b: number, ease = easeOutCubic) =>
  ease(ramp(x, a, b));
/** 0→1→0 pulse peaking at center of [a,b]. */
export const pulse = (x: number, a: number, b: number) => {
  const t = ramp(x, a, b);
  return Math.sin(t * Math.PI);
};

const css = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** A glowing filled circle with a soft halo. */
export function glowDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: RGB,
  intensity = 1,
) {
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4.5);
  g.addColorStop(0, css(color, 0.9 * intensity));
  g.addColorStop(0.35, css(color, 0.28 * intensity));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css(color, Math.min(1, 0.95 * intensity));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A line with additive glow. */
export function glowLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: RGB,
  width: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = css(color, alpha);
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.shadowColor = css(color, alpha);
  ctx.shadowBlur = width * 4;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** A traveling pulse of light along a segment; phase 0..1. */
export function travelingPulse(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  phase: number,
  color: RGB,
  size: number,
  alpha: number,
) {
  const t = phase % 1;
  const x = lerp(x1, x2, t);
  const y = lerp(y1, y2, t);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, 0, x, y, size);
  g.addColorStop(0, css(color, alpha));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── deterministic PRNG / value noise ──────────────────────────────────────
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash11 = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};
/** Smooth 1-D value noise in [-1,1]. */
export function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (lerp(hash11(i), hash11(i + 1), u) * 2 - 1);
}

export const css2 = css;
