/**
 * Thumbnail concepts for the Mira demo. Three directions, each a designed still
 * (not a video frame): bolder type, clearer hook, composed for a tiny click.
 *   recognition — the hero: a glowing neural "7" + 98.2%, premium product line.
 *   prompt      — minimal editorial: giant wordmark + the spoken query.
 *   morph       — provocative: 7 vs 1 colliding, "where thought bends".
 */
import React from "react";
import { AbsoluteFill } from "remotion";
import { Canvas, type DrawCtx } from "./components/Canvas";
import { Grain } from "./components/Grain";
import { C, FONT, rgb, mix, type RGB } from "./theme";
import { glowDot, glowLine, mulberry32, noise1, clamp, lerp } from "./lib/draw";
import { DIGIT_7, latentCloud } from "./lib/nn";

export type ThumbVariant = "recognition" | "prompt" | "morph";

const cloud = latentCloud();

function plate(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.75);
  g.addColorStop(0, rgb([18, 16, 18]));
  g.addColorStop(0.5, rgb(C.bg));
  g.addColorStop(1, rgb(C.bgDeep));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function glowPocket(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: RGB, a: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgb(col, a));
  g.addColorStop(1, rgb(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

// big glowing pixel digit (8×8); `lit` color, optional second color split
function bigDigit(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, cell: number,
  digit: number[][], col: RGB, frame = true,
) {
  const n = 8;
  const span = cell * n;
  const x0 = cx - span / 2;
  const y0 = cy - span / 2;
  if (frame) {
    ctx.save();
    ctx.strokeStyle = rgb(C.fgSubtle, 0.35);
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 - 10, y0 - 10, span + 20, span + 20);
    ctx.restore();
  }
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const px = x0 + c * cell + cell / 2;
      const py = y0 + r * cell + cell / 2;
      const v = digit[r][c];
      if (v < 0.02) {
        ctx.save();
        ctx.fillStyle = rgb(C.surface, 0.4);
        ctx.strokeStyle = rgb(C.fgSubtle, 0.1);
        ctx.lineWidth = 1;
        const s = cell - 8;
        ctx.beginPath();
        ctx.roundRect(px - s / 2, py - s / 2, s, s, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        glowDot(ctx, px, py, (cell / 2 - 6) * (0.8 + 0.2 * v), col, v);
      }
    }
}

// soft neural constellation backdrop (out of focus, for depth)
function constellation(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, a: number, collapse = 0,
) {
  const colorFor = (cls: number): RGB =>
    cls === 7 ? C.accent : cls === 1 ? C.rival : cls === 9 ? C.teal : cls === 2 ? C.terracotta : C.fgMuted;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const pt of cloud) {
    let bx = pt.bx, by = pt.by;
    if (pt.cls === 7) { bx = lerp(bx, 0.12, collapse * 0.7); by = lerp(by, 0.05, collapse * 0.7); }
    if (pt.cls === 1) { bx = lerp(bx, -0.06, collapse * 0.7); by = lerp(by, -0.02, collapse * 0.7); }
    const z = Math.sin(pt.jitterSeed) * 0.7;
    const persp = 1 / (1.7 + z * 0.5);
    const x = cx + bx * scale * persp * 2;
    const y = cy + by * scale * persp * 2;
    const col = colorFor(pt.cls);
    const big = pt.cls === 7 || pt.cls === 1;
    glowDot(ctx, x, y, (1.6 + persp * 2.4) * (big ? 1.1 : 0.7), col, a * (big ? 0.85 : 0.4));
  }
  ctx.restore();
}

function streaks(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, n: number, col: RGB, a: number) {
  const rng = mulberry32(0x7e57);
  for (let i = 0; i < n; i++) {
    const y = y0 + (rng() - 0.5) * 360;
    const w = 0.4 + rng() * 1.4;
    glowLine(ctx, x0, y, lerp(x0, x1, 0.5 + rng() * 0.5), y + (rng() - 0.5) * 40, col, w, a * (0.3 + rng() * 0.7));
  }
}

// ── canvas per variant ──────────────────────────────────────────────────────
function drawThumb(variant: ThumbVariant) {
  return (ctx: CanvasRenderingContext2D, info: DrawCtx) => {
    const { width: w, height: h } = info;
    plate(ctx, w, h);

    if (variant === "recognition") {
      const cx = 1290, cy = 540;
      glowPocket(ctx, cx, cy, 620, C.accent, 0.1);
      constellation(ctx, 1560, 380, 240, 0.5);
      streaks(ctx, cx + 120, cy, w, 14, C.accent, 0.18);
      bigDigit(ctx, cx, cy, 60, DIGIT_7, C.accent);
    } else if (variant === "prompt") {
      // tight warm halo behind the wordmark; deep black everywhere else
      glowPocket(ctx, w / 2, h * 0.44, 540, C.accent, 0.13);
      glowPocket(ctx, w / 2, h * 0.44, 250, C.accent, 0.14);
    } else {
      // morph
      glowPocket(ctx, 560, 540, 520, C.accent, 0.1);
      glowPocket(ctx, 1380, 540, 520, C.rival, 0.1);
      constellation(ctx, w / 2, 470, 300, 0.7, 0.85);
      bigDigit(ctx, 560, 540, 50, DIGIT_7, C.accent, false);
      // big "1" on the right (cool)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.font = `400 460px ${FONT.display}`;
      ctx.fillStyle = rgb(C.rival, 0.92);
      ctx.shadowColor = rgb(C.rival, 0.6);
      ctx.shadowBlur = 50;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("1", 1390, 540);
      ctx.restore();
    }
  };
}

// ── component ────────────────────────────────────────────────────────────────
export const Thumbnail: React.FC<{ variant: ThumbVariant }> = ({ variant }) => {
  return (
    <AbsoluteFill style={{ background: rgb(C.bgDeep) }}>
      <Canvas draw={drawThumb(variant)} />

      {/* vignette */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 120% at 50% 48%, transparent 36%, rgba(0,0,0,0.55) 82%, rgba(0,0,0,0.82) 100%)`,
        }}
      />
      <Grain opacity={0.045} />

      {variant === "recognition" && (
        <AbsoluteFill style={{ padding: 96, flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 22, letterSpacing: "0.22em", color: rgb(C.accent), marginBottom: 22 }}>
            ● LIVE · NEURAL NET
          </div>
          <div style={{ fontFamily: FONT.display, fontWeight: 300, fontSize: 172, lineHeight: 0.92, letterSpacing: "-0.03em", color: rgb(C.fg), maxWidth: 820 }}>
            Watch a machine think.
          </div>
          <div style={{ fontFamily: FONT.sans, fontSize: 34, color: rgb(C.fgMuted), marginTop: 30, maxWidth: 720 }}>
            Speak an idea. Mira animates it — live, in seconds.
          </div>
          {/* confidence tag near the digit */}
          <div style={{ position: "absolute", right: 150, top: 250, textAlign: "right" }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 20, letterSpacing: "0.16em", color: rgb(C.fgMuted) }}>CONFIDENCE</div>
            <div style={{ fontFamily: FONT.display, fontSize: 96, color: rgb(C.accent), lineHeight: 1 }}>98.2%</div>
          </div>
          {/* brand */}
          <div style={{ position: "absolute", left: 96, bottom: 76, fontFamily: FONT.display, fontSize: 56, color: rgb(C.fg, 0.9) }}>Mira</div>
        </AbsoluteFill>
      )}

      {variant === "prompt" && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <div
            style={{
              fontFamily: FONT.display, fontWeight: 300, fontSize: 320, lineHeight: 0.9,
              letterSpacing: "-0.04em", color: rgb(C.fg),
              textShadow: `0 0 55px ${rgb(C.accent, 0.55)}, 0 0 130px ${rgb(C.accent, 0.3)}, 0 6px 40px rgba(0,0,0,0.6)`,
            }}
          >
            Mira
          </div>
          <div style={{ width: 64, height: 2, background: rgb(C.accent, 0.7), boxShadow: `0 0 18px ${rgb(C.accent, 0.7)}`, margin: "44px 0 30px" }} />
          <div
            style={{
              fontFamily: FONT.sans, fontWeight: 400, fontSize: 46, color: rgb(C.fgMuted),
              letterSpacing: "0.01em",
            }}
          >
            The visualization layer for thinking
          </div>
        </AbsoluteFill>
      )}

      {variant === "morph" && (
        <AbsoluteFill style={{ flexDirection: "column", justifyContent: "flex-end", alignItems: "center", paddingBottom: 84 }}>
          <div style={{ position: "absolute", top: 70, left: "50%", transform: "translateX(-50%)", fontFamily: FONT.mono, fontSize: 22, letterSpacing: "0.22em", color: rgb(C.fgMuted) }}>
            SEE THE MODEL HESITATE
          </div>
          <div style={{ fontFamily: FONT.display, fontWeight: 300, fontSize: 150, letterSpacing: "-0.03em", color: rgb(C.fg), textAlign: "center", textShadow: "0 4px 40px rgba(0,0,0,0.8)" }}>
            Where thought bends.
          </div>
          <div style={{ display: "flex", gap: 44, marginTop: 22, fontFamily: FONT.mono, fontSize: 34 }}>
            <span style={{ color: rgb(C.accent) }}>7 — 54%</span>
            <span style={{ color: rgb(C.rival) }}>1 — 43%</span>
          </div>
          <div style={{ position: "absolute", left: 70, bottom: 64, fontFamily: FONT.display, fontSize: 48, color: rgb(C.fg, 0.9) }}>Mira</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
