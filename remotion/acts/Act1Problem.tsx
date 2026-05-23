import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { Canvas, type DrawCtx } from "../components/Canvas";
import { C, FONT, FPS, rgb } from "../theme";
import { clamp, ramp, easeOutCubic, noise1 } from "../lib/draw";

// flat, glow-less gray — the "dead static" look that the living NN later refutes
const GRAY = (a: number) => rgb(C.fgSubtle, a);
const GRAY2 = (a: number) => rgb(C.fgMuted, a);

function appear(t: number, start: number) {
  return clamp((t - start) / 0.8);
}

function draw(ctx: CanvasRenderingContext2D, info: DrawCtx) {
  const { t } = info;
  // pre-blur drift that arrests around t=4.6 ("everything freezes completely")
  const motion = 1 - ramp(t, 4.0, 4.8);
  const drift = (seed: number) => noise1(seed + t * 0.25) * 8 * motion;

  // ── static neural-net diagram (top-left) ──────────────────────────────
  const a1 = appear(t, 0.2);
  if (a1 > 0) {
    ctx.save();
    ctx.translate(250 + drift(1), 250 + drift(2));
    const cols = [
      [0, 1, 2, 3],
      [0, 1, 2],
      [0, 1],
    ];
    const xs = [0, 150, 300];
    const pos = cols.map((rows, ci) => rows.map((ri) => ({ x: xs[ci], y: ri * 70 - (rows.length - 1) * 35 })));
    ctx.strokeStyle = GRAY(0.3 * a1);
    ctx.lineWidth = 1;
    for (let c = 0; c < pos.length - 1; c++)
      for (const a of pos[c]) for (const b of pos[c + 1]) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    for (const col of pos) for (const nde of col) {
      ctx.beginPath(); ctx.arc(nde.x, nde.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = rgb(C.surface, 0.9 * a1); ctx.fill();
      ctx.strokeStyle = GRAY(0.55 * a1); ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
  }

  // ── equation fragments (scattered) ────────────────────────────────────
  const eqs: [string, number, number, number, number][] = [
    ["∂L/∂wᵢⱼ = δⱼ · aᵢ", 120, 470, 0.5, 22],
    ["σ(z) = 1 / (1 + e⁻ᶻ)", 700, 180, 0.9, 22],
    ["H(p) = −Σ p(x) log p(x)", 1180, 520, 1.3, 22],
    ["f(x) = max(0, x)", 560, 760, 1.6, 20],
    ["KL(P‖Q) = Σ P log(P/Q)", 1000, 860, 1.0, 20],
    ["argmaxₖ p(y=k | x)", 240, 880, 1.4, 20],
  ];
  for (const [s, x, y, st, size] of eqs) {
    const a = appear(t, st);
    if (a <= 0) continue;
    ctx.save();
    setMono(ctx, size);
    ctx.fillStyle = GRAY2(0.6 * a);
    ctx.textBaseline = "middle";
    ctx.fillText(s, x + drift(x), y + drift(y));
    ctx.restore();
  }

  // ── a "PDF page" (right) ──────────────────────────────────────────────
  const ap = appear(t, 0.6);
  if (ap > 0) {
    ctx.save();
    ctx.translate(1360 + drift(5), 180 + drift(6));
    ctx.strokeStyle = GRAY(0.4 * ap);
    ctx.fillStyle = rgb(C.surface, 0.45 * ap);
    ctx.lineWidth = 1.5;
    rect(ctx, 0, 0, 360, 480, true);
    ctx.fillStyle = GRAY(0.3 * ap);
    for (let i = 0; i < 9; i++) {
      const w = i === 0 ? 200 : 300 - (i % 3) * 40;
      ctx.fillRect(30, 40 + i * 26, w, 6);
    }
    ctx.strokeStyle = GRAY(0.35 * ap);
    rect(ctx, 30, 300, 300, 140, false);
    ctx.restore();
  }

  // ── flat plot (bottom-left) ───────────────────────────────────────────
  const apl = appear(t, 1.1);
  if (apl > 0) {
    ctx.save();
    ctx.translate(110 + drift(7), 620 + drift(8));
    ctx.strokeStyle = GRAY(0.4 * apl);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 160); ctx.lineTo(260, 160); ctx.stroke();
    ctx.strokeStyle = GRAY2(0.5 * apl);
    ctx.beginPath();
    for (let i = 0; i <= 50; i++) {
      const x = (i / 50) * 240;
      const y = 120 - 90 * (1 / (1 + Math.exp(-(i - 25) / 5)));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── floating domain words that blur together ──────────────────────────
  const words: [string, number, number, number][] = [
    ["backpropagation", 540, 320, 0.4],
    ["eigenvector", 1180, 760, 0.8],
    ["gradient", 820, 560, 1.1],
    ["manifold", 360, 200, 1.5],
    ["entropy", 1280, 280, 0.7],
  ];
  for (const [s, x, y, st] of words) {
    const a = appear(t, st);
    if (a <= 0) continue;
    ctx.save();
    setDisplay(ctx, 34);
    ctx.fillStyle = GRAY2(0.34 * a);
    ctx.textBaseline = "middle";
    ctx.fillText(s, x + drift(x * 0.5), y + drift(y * 0.5));
    ctx.restore();
  }
}

const setMono = (ctx: CanvasRenderingContext2D, s: number) => (ctx.font = `400 ${s}px ${FONT.mono}`);
const setDisplay = (ctx: CanvasRenderingContext2D, s: number) => (ctx.font = `300 ${s}px ${FONT.display}`);
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: boolean) {
  ctx.beginPath(); ctx.rect(x, y, w, h);
  if (fill) ctx.fill();
  ctx.stroke();
}

export const Act1Problem: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  // blur + desaturate ramp as the words "blur together" and freeze
  const blur = interpolate(t, [3.9, 5.8], [0, 20], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sat = interpolate(t, [3.9, 5.8], [1, 0.25], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = 1 + easeOutCubic(clamp(t / 6)) * 0.04;
  return (
    <AbsoluteFill style={{ background: rgb(C.bgDeep) }}>
      <AbsoluteFill style={{ filter: `blur(${blur}px) saturate(${sat})`, transform: `scale(${scale})` }}>
        <Canvas draw={draw} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
