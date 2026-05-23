/**
 * Act 5 — THE AGENT REVEAL
 *
 * A pull-back shot of the four Gemini agents working in parallel:
 * ORCHESTRATOR, CODEGEN, NARRATION, VERIFIER — each in a frosted-glass
 * panel with its own running mini-visualization. Panels light up in
 * sequence to match the voiceover, then pulse together.
 *
 * Z-order: glass frames (div) < canvas vizzes < labels/dots (div).
 * All timing is driven by info.t (local seconds, frame 0 = act start).
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, type DrawCtx } from "../components/Canvas";
import { C, FONT, FPS, rgb } from "../theme";
import {
  clamp,
  lerp,
  eramp,
  ramp,
  easeOutCubic,
  easeOutExpo,
  easeOutBack,
  easeInOutSine,
  glowDot,
  glowLine,
  travelingPulse,
  noise1,
  mulberry32,
} from "../lib/draw";

// ── layout constants ─────────────────────────────────────────────────────────
const PW = 816;
const PH = 392;
const RADIUS = 16;
const COL_X = [126, 978] as const;
const ROW_Y = [130, 558] as const;

// Panel definitions
const PANELS = [
  { id: "orchestrator", label: "ORCHESTRATOR", col: 0, row: 0 },
  { id: "codegen",      label: "CODEGEN",       col: 1, row: 0 },
  { id: "narration",    label: "NARRATION",      col: 0, row: 1 },
  { id: "verifier",     label: "VERIFIER",       col: 1, row: 1 },
] as const;

// The four named beats (seconds local)
const BEAT_PLAN     = 1.2;
const BEAT_GENERATE = 2.1;
const BEAT_NARRATE  = 3.0;
const BEAT_VERIFY   = 3.9;
const ALL_GLOW_START = 5.0;
const GRAPH_START    = 6.2;
const ACT_END        = 9.1;

// Sequence: which panel activates at which beat (index-parallel with PANELS)
const PANEL_BEATS: readonly [number, number, number, number] = [
  BEAT_PLAN, BEAT_GENERATE, BEAT_NARRATE, BEAT_VERIFY,
];

function panelX(col: number) { return COL_X[col]; }
function panelY(row: number) { return ROW_Y[row]; }

// ── helpers ───────────────────────────────────────────────────────────────────
function setFont(
  ctx: CanvasRenderingContext2D,
  size: number,
  fam: string,
  weight = "400",
) {
  ctx.font = `${weight} ${size}px ${fam}`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// clip into a panel's inner rect and run drawFn, then restore
function withPanelClip(
  ctx: CanvasRenderingContext2D,
  col: number, row: number,
  drawFn: (ox: number, oy: number) => void,
) {
  const px = panelX(col);
  const py = panelY(row);
  ctx.save();
  roundRectPath(ctx, px + 1, py + 1, PW - 2, PH - 2, RADIUS - 1);
  ctx.clip();
  drawFn(px, py);
  ctx.restore();
}

// ── ORCHESTRATOR: phase timeline / node tree ──────────────────────────────────
function drawOrchestrator(
  ctx: CanvasRenderingContext2D, t: number,
  ox: number, oy: number, active: number,
) {
  if (active <= 0.01) return;

  const cx = ox + PW / 2;
  const a = active;

  // phase nodes — a horizontal timeline of 5 steps
  const phases = ["PROMPT", "PLAN", "ASSIGN", "EXECUTE", "VERIFY"];
  const nodeCount = phases.length;
  const spanW = 580;
  const startX = cx - spanW / 2;
  const stepW = spanW / (nodeCount - 1);
  const nodeY = oy + PH / 2 - 30;

  // stagger node reveal based on t (relative to panel beat)
  const tLocal = Math.max(0, t - BEAT_PLAN);

  for (let i = 0; i < nodeCount; i++) {
    const nodeReveal = eramp(tLocal, i * 0.22, i * 0.22 + 0.35);
    if (nodeReveal <= 0) continue;
    const nx = startX + i * stepW;
    const isActive = i <= Math.floor(tLocal / 0.4);
    const col = isActive ? C.accent : C.teal;
    const intensity = isActive ? nodeReveal : nodeReveal * 0.45;

    // connector line to previous node
    if (i > 0) {
      const prevX = startX + (i - 1) * stepW;
      const lineReveal = eramp(tLocal, (i - 1) * 0.22 + 0.2, i * 0.22 + 0.1);
      if (lineReveal > 0) {
        const lx2 = lerp(prevX + 14, nx - 14, lineReveal);
        glowLine(ctx, prevX + 14, nodeY, lx2, nodeY, col, 1.5, 0.35 * a * lineReveal);
        // traveling pulse along active connectors
        if (isActive && lineReveal > 0.8) {
          const phase = ((t * 0.8 + i * 0.3) % 1);
          travelingPulse(ctx, prevX + 14, nodeY, nx - 14, nodeY, phase, C.accent, 8, 0.6 * a);
        }
      }
    }

    // node circle
    glowDot(ctx, nx, nodeY, 10, col, intensity * a * 1.1);

    // outer ring
    ctx.save();
    ctx.strokeStyle = rgb(col, 0.4 * a * nodeReveal);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(nx, nodeY, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // label
    ctx.save();
    setFont(ctx, 11, FONT.mono, "500");
    ctx.fillStyle = rgb(isActive ? C.fg : C.fgMuted, a * nodeReveal * (isActive ? 0.9 : 0.55));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(phases[i], nx, nodeY + 22);
    ctx.restore();
  }

  // sub-tree: branching tasks under ASSIGN node (index 2)
  const assignReveal = eramp(tLocal, 0.9, 1.4);
  if (assignReveal > 0) {
    const rootX = startX + 2 * stepW;
    const treeY = nodeY + 78;
    const branches = ["codegen", "narration", "verifier"] as const;
    const branchColors = [C.teal, C.pink, C.terracotta] as const;
    const branchXs = [-140, 0, 140] as const;

    for (let b = 0; b < branches.length; b++) {
      const br = eramp(tLocal, 1.1 + b * 0.18, 1.6 + b * 0.18);
      if (br <= 0) continue;
      const bx = rootX + branchXs[b];
      const col = branchColors[b];

      glowLine(ctx, rootX, nodeY + 14, bx, treeY - 8, col, 1.2, 0.4 * a * br);
      glowDot(ctx, bx, treeY, 7, col, 0.7 * a * br);

      ctx.save();
      setFont(ctx, 10, FONT.mono, "400");
      ctx.fillStyle = rgb(col, a * br * 0.75);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(branches[b].toUpperCase(), bx, treeY + 14);
      ctx.restore();
    }
  }

  // status line at bottom
  const statusReveal = eramp(tLocal, 1.6, 2.2);
  if (statusReveal > 0) {
    const blink = Math.sin(t * 4) > 0 ? 1 : 0.3;
    ctx.save();
    setFont(ctx, 12, FONT.mono, "400");
    ctx.fillStyle = rgb(C.teal, a * statusReveal * 0.8 * blink);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("● AGENTS SPAWNED · RUNNING IN PARALLEL", cx, oy + PH - 36);
    ctx.restore();
  }
}

// ── CODEGEN: streaming code editor ───────────────────────────────────────────
const CODE_LINES: ReadonlyArray<{ text: string; kind: string }> = [
  { text: "// THREE.js physics sim — Mira codegen", kind: "comment" },
  { text: "import * as THREE from 'three';", kind: "keyword" },
  { text: "", kind: "blank" },
  { text: "const scene = new THREE.Scene();", kind: "mixed" },
  { text: "const geo = new THREE.SphereGeometry(1, 32, 32);", kind: "mixed" },
  { text: "const mat = new THREE.MeshStandardMaterial({", kind: "mixed" },
  { text: "  color: 0xefc540, roughness: 0.2,", kind: "value" },
  { text: "  metalness: 0.6, emissive: 0x1a1200,", kind: "value" },
  { text: "});", kind: "fg" },
  { text: "const mesh = new THREE.Mesh(geo, mat);", kind: "mixed" },
  { text: "scene.add(mesh);", kind: "fg" },
  { text: "", kind: "blank" },
  { text: "function animate(t) {", kind: "keyword" },
  { text: "  mesh.rotation.y = t * 0.8;", kind: "fg" },
  { text: "  mesh.position.y = Math.sin(t) * 0.4;", kind: "fg" },
  { text: "  for (let i = 0; i < particles.length; i++) {", kind: "keyword" },
  { text: "    p.stroke(239, 197, 64, 180);", kind: "value" },
  { text: "    p.ellipse(px, py, r * 2);", kind: "fg" },
  { text: "  }", kind: "fg" },
  { text: "  renderer.render(scene, camera);", kind: "fg" },
  { text: "}", kind: "fg" },
];

function codeColor(kind: string): typeof C.fg {
  if (kind === "comment") return C.fgSubtle;
  if (kind === "keyword") return C.teal;
  if (kind === "value")   return C.accent;
  return C.fg;
}

function drawCodegen(
  ctx: CanvasRenderingContext2D, t: number,
  ox: number, oy: number, active: number,
) {
  if (active <= 0.01) return;

  const tLocal = Math.max(0, t - BEAT_GENERATE);
  const a = active;

  const lineH = 22;
  const padX = 28;
  const padY = 28;
  const visibleLines = Math.floor((PH - padY * 2) / lineH);
  const lineRevealRate = 0.28;
  const totalRevealTime = CODE_LINES.length * lineRevealRate;
  const scroll = Math.max(0, tLocal - (visibleLines * lineRevealRate)) * 0.9;

  // background tint
  ctx.save();
  ctx.fillStyle = rgb(C.bgDeep, 0.45 * a);
  ctx.fillRect(ox, oy, PW, PH);
  ctx.restore();

  // line numbers gutter
  const gutterW = 34;
  ctx.save();
  ctx.fillStyle = rgb(C.surface, 0.6 * a);
  ctx.fillRect(ox + padX, oy, gutterW, PH);
  ctx.restore();

  for (let i = 0; i < CODE_LINES.length; i++) {
    const lineReveal = eramp(tLocal, i * lineRevealRate, i * lineRevealRate + 0.25);
    if (lineReveal <= 0) continue;

    const screenY = oy + padY + i * lineH - scroll * lineH;
    if (screenY < oy + padY - lineH || screenY > oy + PH - padY) continue;

    const line = CODE_LINES[i];
    const col = codeColor(line.kind);

    const charsReveal = clamp((tLocal - i * lineRevealRate) / 0.22);
    const visChars = Math.floor(line.text.length * charsReveal);
    const displayText = line.text.slice(0, visChars);

    // line number
    ctx.save();
    setFont(ctx, 11, FONT.mono, "400");
    ctx.fillStyle = rgb(C.fgSubtle, 0.4 * a * lineReveal);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), ox + padX + gutterW - 6, screenY);
    ctx.restore();

    // code text
    ctx.save();
    setFont(ctx, 13, FONT.mono, "400");
    ctx.fillStyle = rgb(col, a * lineReveal * (line.kind === "comment" ? 0.65 : 0.92));
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(displayText, ox + padX + gutterW + 10, screenY);
    ctx.restore();

    // blinking caret at the currently typing line
    const isCurrentLine = Math.floor(tLocal / lineRevealRate) === i && tLocal < totalRevealTime;
    if (isCurrentLine) {
      ctx.save();
      setFont(ctx, 13, FONT.mono, "400");
      const caretX = ox + padX + gutterW + 10 + ctx.measureText(displayText).width + 1;
      const blink = Math.sin(t * 7) > 0 ? 1 : 0;
      ctx.fillStyle = rgb(C.accent, a * blink * 0.9);
      ctx.fillRect(caretX, screenY - 8, 2, 16);
      ctx.restore();
    }
  }

  // scan line glow on the active line
  const scanLineIdx = Math.min(Math.floor(tLocal / lineRevealRate), CODE_LINES.length - 1);
  const scanY = oy + padY + scanLineIdx * lineH - scroll * lineH;
  if (scanY >= oy && scanY <= oy + PH) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createLinearGradient(ox, scanY, ox + PW, scanY);
    g.addColorStop(0, rgb(C.teal, 0));
    g.addColorStop(0.1, rgb(C.teal, 0.07 * a));
    g.addColorStop(0.9, rgb(C.teal, 0.07 * a));
    g.addColorStop(1, rgb(C.teal, 0));
    ctx.fillStyle = g;
    ctx.fillRect(ox, scanY - 1, PW, lineH);
    ctx.restore();
  }
}

// ── NARRATION: audio waveform + subtitle track ────────────────────────────────
// Deterministic waveform seeds generated once at module scope
const _waveRand = mulberry32(0xdeadbeef);
const WAVEFORM_SEEDS: readonly number[] = Array.from({ length: 60 }, () => _waveRand() * 100);

function drawNarration(
  ctx: CanvasRenderingContext2D, t: number,
  ox: number, oy: number, active: number,
) {
  if (active <= 0.01) return;

  const tLocal = Math.max(0, t - BEAT_NARRATE);
  const a = active;

  const cx = ox + PW / 2;
  const waveY = oy + PH / 2 - 30;
  const waveW = PW - 80;
  const waveX = ox + 40;
  const barCount = 60;
  const barW = (waveW / barCount) - 1.5;
  const maxH = 80;

  // playhead sweeps L->R continuously
  const playheadPhase = (t * 0.18) % 1;
  const playheadX = waveX + playheadPhase * waveW;

  // bars
  for (let i = 0; i < barCount; i++) {
    const barReveal = eramp(tLocal, i * 0.025, i * 0.025 + 0.2);
    if (barReveal <= 0) continue;

    const bx = waveX + (i / barCount) * waveW;
    const h = (0.3 + 0.7 * Math.abs(noise1(WAVEFORM_SEEDS[i] + t * 0.4))) * maxH;
    const isPast = bx < playheadX;
    const col = isPast ? C.accent : C.teal;
    const barA = isPast ? 0.85 : 0.35;

    ctx.save();
    ctx.globalCompositeOperation = isPast ? "lighter" : "source-over";
    ctx.fillStyle = rgb(col, a * barReveal * barA);
    ctx.fillRect(bx, waveY - h / 2, barW, h);
    ctx.restore();
  }

  // playhead line
  glowLine(ctx, playheadX, waveY - maxH / 2 - 8, playheadX, waveY + maxH / 2 + 8, C.accent, 2, 0.9 * a);

  // subtitle track
  const subY = waveY + maxH / 2 + 28;
  const subtitleReveal = eramp(tLocal, 0.6, 1.2);
  if (subtitleReveal > 0) {
    ctx.save();
    ctx.strokeStyle = rgb(C.fgSubtle, 0.3 * a * subtitleReveal);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(waveX, subY);
    ctx.lineTo(waveX + waveW, subY);
    ctx.stroke();
    ctx.restore();

    // tick marks
    const ticks = 8;
    for (let i = 0; i <= ticks; i++) {
      const tx = waveX + (i / ticks) * waveW;
      const tickH = i % 4 === 0 ? 8 : 4;
      ctx.save();
      ctx.strokeStyle = rgb(C.fgSubtle, 0.45 * a * subtitleReveal);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, subY);
      ctx.lineTo(tx, subY + tickH);
      ctx.stroke();
      ctx.restore();

      if (i % 4 === 0) {
        ctx.save();
        setFont(ctx, 10, FONT.mono, "400");
        ctx.fillStyle = rgb(C.fgSubtle, 0.55 * a * subtitleReveal);
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`${(i / ticks * 9.1).toFixed(1)}s`, tx, subY + 10);
        ctx.restore();
      }
    }

    // caption text
    const captions = [
      { phase: 0.0,  txt: "initializing simulation parameters..." },
      { phase: 0.25, txt: "four agents spawned in parallel" },
      { phase: 0.55, txt: "real-time plan → code → narrate → verify" },
    ] as const;
    const currentCaption = captions.filter((c) => playheadPhase >= c.phase).pop();
    if (currentCaption) {
      ctx.save();
      setFont(ctx, 12, FONT.mono, "400");
      ctx.fillStyle = rgb(C.fgMuted, a * subtitleReveal * 0.8);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`"${currentCaption.txt}"`, cx, subY + 26);
      ctx.restore();
    }
  }

  // recording indicator top-right
  const recA = eramp(tLocal, 0, 0.4) * (0.6 + 0.4 * Math.abs(Math.sin(t * 2.5)));
  if (recA > 0) {
    glowDot(ctx, ox + PW - 44, oy + 30, 5, C.deepRed, recA * a * 1.4);
    ctx.save();
    setFont(ctx, 11, FONT.mono, "500");
    ctx.fillStyle = rgb(C.deepRed, a * recA);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("REC", ox + PW - 36, oy + 30);
    ctx.restore();
  }
}

// ── VERIFIER: frame vs narration diff check ───────────────────────────────────
function drawVerifier(
  ctx: CanvasRenderingContext2D, t: number,
  ox: number, oy: number, active: number,
) {
  if (active <= 0.01) return;

  const tLocal = Math.max(0, t - BEAT_VERIFY);
  const a = active;
  const cy = oy + PH / 2;

  // left: "rendered frame" thumbnail
  const thumbW = 260;
  const thumbH = 180;
  const thumbX = ox + 60;
  const thumbY = cy - thumbH / 2;
  const thumbReveal = eramp(tLocal, 0, 0.5);

  if (thumbReveal > 0) {
    ctx.save();
    ctx.strokeStyle = rgb(C.fgSubtle, 0.4 * a * thumbReveal);
    ctx.lineWidth = 1;
    roundRectPath(ctx, thumbX, thumbY, thumbW, thumbH, 8);
    ctx.stroke();
    ctx.fillStyle = rgb(C.bgDeep, 0.7 * a * thumbReveal);
    ctx.fill();
    ctx.restore();

    // mini neuron viz inside thumbnail
    ctx.save();
    roundRectPath(ctx, thumbX + 1, thumbY + 1, thumbW - 2, thumbH - 2, 7);
    ctx.clip();

    const mcx = thumbX + thumbW / 2;
    const mcy = thumbY + thumbH / 2;
    const ringR = 42 + Math.sin(t * 1.8) * 4;

    // outer orbit glow
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const gOuter = ctx.createRadialGradient(mcx, mcy, ringR - 12, mcx, mcy, ringR + 12);
    gOuter.addColorStop(0, rgb(C.teal, 0.25 * a * thumbReveal));
    gOuter.addColorStop(0.5, rgb(C.teal, 0.1 * a * thumbReveal));
    gOuter.addColorStop(1, rgb(C.teal, 0));
    ctx.fillStyle = gOuter;
    ctx.beginPath();
    ctx.arc(mcx, mcy, ringR + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // orbiting dots
    for (let i = 0; i < 5; i++) {
      const ang = (t * 0.9 + (i / 5) * Math.PI * 2);
      glowDot(ctx, mcx + Math.cos(ang) * ringR, mcy + Math.sin(ang) * (ringR * 0.4), 4, C.teal, 0.8 * a * thumbReveal);
    }

    // center core + spokes
    glowDot(ctx, mcx, mcy, 14, C.accent, 0.9 * a * thumbReveal);
    for (let i = 0; i < 6; i++) {
      const ang = (t * 0.3 + (i / 6) * Math.PI * 2);
      glowLine(ctx, mcx, mcy, mcx + Math.cos(ang) * (ringR - 6), mcy + Math.sin(ang) * (ringR - 6) * 0.4, C.accent, 1, 0.25 * a * thumbReveal);
    }

    ctx.restore();

    // "FRAME 247" label
    ctx.save();
    setFont(ctx, 10, FONT.mono, "500");
    ctx.fillStyle = rgb(C.fgSubtle, 0.65 * a * thumbReveal);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("FRAME 247", thumbX + thumbW / 2, thumbY + thumbH + 6);
    ctx.restore();
  }

  // right: narration text lines
  const textX = ox + 60 + thumbW + 40;
  const textReveal = eramp(tLocal, 0.3, 0.9);
  if (textReveal > 0) {
    const lines: Array<{ text: string; color: typeof C.fg; size: number; weight: string }> = [
      { text: "NARRATION TRANSCRIPT", color: C.fgSubtle, size: 10, weight: "500" },
      { text: "", color: C.fgSubtle, size: 8, weight: "400" },
      { text: '"...the orbital bodies trace', color: C.fgMuted, size: 12, weight: "400" },
      { text: "elliptical paths under", color: C.fgMuted, size: 12, weight: "400" },
      { text: 'gravitational influence"', color: C.fgMuted, size: 12, weight: "400" },
      { text: "", color: C.fgSubtle, size: 8, weight: "400" },
      { text: "MATCH CONFIDENCE", color: C.fgSubtle, size: 10, weight: "500" },
    ];

    let lyOffset = thumbY;
    for (const line of lines) {
      ctx.save();
      setFont(ctx, line.size, FONT.mono, line.weight);
      ctx.fillStyle = rgb(line.color, a * textReveal * 0.85);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(line.text, textX, lyOffset);
      ctx.restore();
      lyOffset += line.size + 6;
    }

    // confidence bar
    const availW = ox + PW - 60 - textX;
    const barY = lyOffset + 4;
    const confReveal = eramp(tLocal, 0.8, 1.4);
    const confW = availW * 0.94 * confReveal;

    ctx.save();
    ctx.fillStyle = rgb(C.fgSubtle, 0.15 * a * textReveal);
    roundRectPath(ctx, textX, barY, availW, 8, 4);
    ctx.fill();
    ctx.restore();

    if (confW > 2) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgb(C.teal, 0.8 * a * confReveal);
      ctx.shadowColor = rgb(C.teal, 0.5);
      ctx.shadowBlur = 10;
      roundRectPath(ctx, textX, barY, confW, 8, 4);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    setFont(ctx, 11, FONT.mono, "600");
    ctx.fillStyle = rgb(C.teal, a * confReveal);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("94.2%", textX, barY + 14);
    ctx.restore();
  }

  // check mark snaps in at ~1.2s
  const checkReveal = eramp(tLocal, 1.1, 1.6, easeOutBack);
  if (checkReveal > 0) {
    const checkX = ox + PW / 2 + 30;
    const checkY = oy + PH - 54;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const gCheck = ctx.createRadialGradient(checkX, checkY, 0, checkX, checkY, 36);
    gCheck.addColorStop(0, rgb(C.teal, 0.35 * a * checkReveal));
    gCheck.addColorStop(1, rgb(C.teal, 0));
    ctx.fillStyle = gCheck;
    ctx.beginPath();
    ctx.arc(checkX, checkY, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    setFont(ctx, 28, FONT.sans, "600");
    ctx.fillStyle = rgb(C.teal, a * checkReveal);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("✓", checkX - 16, checkY);
    ctx.restore();

    ctx.save();
    setFont(ctx, 13, FONT.mono, "500");
    ctx.fillStyle = rgb(C.teal, a * checkReveal * 0.9);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("frame matches narration", checkX + 20, checkY);
    ctx.restore();
  }
}

// ── SCENE MUTATION GRAPH (bottom-center) ──────────────────────────────────────
function drawMutationGraph(ctx: CanvasRenderingContext2D, t: number, active: number) {
  if (active <= 0.01) return;

  const a = active;
  const tLocal = Math.max(0, t - GRAPH_START);

  const cx = 960;
  const cy = 1036;
  const nodeR = 16;
  const spanW = 360;

  const nodes = [
    { label: "v1",     x: cx - spanW / 2, col: C.teal },
    { label: "mutate", x: cx,              col: C.accent },
    { label: "v2",     x: cx + spanW / 2, col: C.teal },
  ] as const;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const nr = eramp(tLocal, i * 0.25, i * 0.25 + 0.35);

    if (i > 0) {
      const prev = nodes[i - 1];
      const connReveal = eramp(tLocal, (i - 1) * 0.25 + 0.2, i * 0.25 + 0.1);
      if (connReveal > 0) {
        glowLine(ctx, prev.x + nodeR, cy, lerp(prev.x + nodeR, n.x - nodeR, connReveal), cy, C.fgSubtle, 1, 0.4 * a);
        if (connReveal > 0.5) {
          const phase = (t * 0.7 + i * 0.4) % 1;
          travelingPulse(ctx, prev.x + nodeR, cy, n.x - nodeR, cy, phase, C.accent, 7, 0.7 * a);
        }
      }
    }

    if (nr <= 0) continue;
    glowDot(ctx, n.x, cy, nodeR * 0.6, n.col, 0.8 * a * nr);
    ctx.save();
    ctx.strokeStyle = rgb(n.col, 0.5 * a * nr);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(n.x, cy, nodeR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    setFont(ctx, 11, FONT.mono, n.label === "mutate" ? "600" : "500");
    ctx.fillStyle = rgb(n.col, a * nr * 0.9);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(n.label, n.x, cy);
    ctx.restore();
  }

  const graphReveal = eramp(tLocal, 0, 0.7);
  if (graphReveal > 0.5) {
    ctx.save();
    setFont(ctx, 10, FONT.mono, "400");
    ctx.fillStyle = rgb(C.fgSubtle, a * graphReveal * 0.5);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("SCENE MUTATION", cx, cy + nodeR + 6);
    ctx.restore();
  }
}

// ── MAIN CANVAS DRAW ──────────────────────────────────────────────────────────
function makeDrawFn(activations: readonly [number, number, number, number]) {
  return function draw(ctx: CanvasRenderingContext2D, info: DrawCtx) {
    const { t } = info;

    // parallax: gentle scale drift + noise pan
    const scaleD = 1 + easeInOutSine(ramp(t, 0, ACT_END)) * 0.03;
    const panX = noise1(t * 0.18) * 4;
    const panY = noise1(42 + t * 0.15) * 3;

    ctx.save();
    ctx.translate(960 + panX, 540 + panY);
    ctx.scale(scaleD, scaleD);
    ctx.translate(-960 - panX, -540 - panY);

    for (let pi = 0; pi < PANELS.length; pi++) {
      const panel = PANELS[pi];
      const active = activations[pi];

      withPanelClip(ctx, panel.col, panel.row, (ox, oy) => {
        // inner background tint for non-active panels
        if (active < 0.9) {
          ctx.save();
          ctx.fillStyle = rgb(C.bgDeep, 0.2 * (1 - active));
          ctx.fillRect(ox, oy, PW, PH);
          ctx.restore();
        }

        if (pi === 0) drawOrchestrator(ctx, t, ox, oy, active);
        else if (pi === 1) drawCodegen(ctx, t, ox, oy, active);
        else if (pi === 2) drawNarration(ctx, t, ox, oy, active);
        else              drawVerifier(ctx, t, ox, oy, active);
      });
    }

    // all-glow parallel pulse
    const allGlow = eramp(t, ALL_GLOW_START, ALL_GLOW_START + 0.6);
    if (allGlow > 0.01) {
      const breathe = 0.5 + 0.5 * Math.sin(t * 3.5);
      for (let pi = 0; pi < PANELS.length; pi++) {
        const panel = PANELS[pi];
        const px = panelX(panel.col);
        const py = panelY(panel.row);
        const pcx = px + PW / 2;
        const pcy = py + PH / 2;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(pcx, pcy, PH * 0.1, pcx, pcy, PH * 0.9);
        g.addColorStop(0, rgb(C.accent, 0.08 * allGlow * breathe));
        g.addColorStop(1, rgb(C.accent, 0));
        ctx.fillStyle = g;
        ctx.fillRect(px, py, PW, PH);
        ctx.restore();
      }
    }

    // mutation graph (bottom-center)
    const graphActive = eramp(t, GRAPH_START, GRAPH_START + 0.5);
    drawMutationGraph(ctx, t, graphActive);

    ctx.restore();
  };
}

// ── COMPONENT ─────────────────────────────────────────────────────────────────
export const Act5Agents: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;

  // Fade/scale-in of all panels in the first second
  const introReveal = eramp(t, 0, 1.0, easeOutCubic);
  const introScale  = lerp(0.93, 1, eramp(t, 0, 1.0, easeOutExpo));

  // Per-panel activation: ramps 0→1 over ~0.45s at each named beat
  const allBoost = eramp(t, ALL_GLOW_START, ALL_GLOW_START + 0.7) * 0.15;
  const activations = PANEL_BEATS.map((beat) =>
    clamp(eramp(t, beat, beat + 0.45, easeOutCubic) + allBoost),
  ) as [number, number, number, number];

  const drawFn = makeDrawFn(activations);

  return (
    <AbsoluteFill style={{ background: rgb(C.bg) }}>
      {/* Glass panel frames — behind canvas */}
      <AbsoluteFill
        style={{
          opacity: introReveal,
          transform: `scale(${introScale})`,
          transformOrigin: "center center",
        }}
      >
        {PANELS.map((panel, pi) => {
          const active = activations[pi];
          const px = panelX(panel.col);
          const py = panelY(panel.row);
          const borderAlpha = lerp(0.08, 0.5, active);
          const borderColor = active > 0.05
            ? `rgba(${C.accent[0]},${C.accent[1]},${C.accent[2]},${borderAlpha})`
            : "rgba(255,255,255,0.08)";
          const glowBlur = active > 0.05
            ? `0 0 ${32 * active}px rgba(${C.accent[0]},${C.accent[1]},${C.accent[2]},${0.18 * active}), 0 4px 32px rgba(0,0,0,0.55)`
            : "0 4px 32px rgba(0,0,0,0.55)";

          return (
            <div
              key={panel.id}
              style={{
                position: "absolute",
                left: px,
                top: py,
                width: PW,
                height: PH,
                borderRadius: RADIUS,
                background: "rgba(18,18,22,0.55)",
                border: `1px solid ${borderColor}`,
                backdropFilter: "blur(20px) saturate(160%)",
                WebkitBackdropFilter: "blur(20px) saturate(160%)",
                boxShadow: glowBlur,
              }}
            />
          );
        })}
      </AbsoluteFill>

      {/* Canvas — all four mini-vizzes */}
      <AbsoluteFill
        style={{
          opacity: introReveal,
          transform: `scale(${introScale})`,
          transformOrigin: "center center",
        }}
      >
        <Canvas draw={drawFn} />
      </AbsoluteFill>

      {/* Labels + status dots — on top of canvas */}
      <AbsoluteFill
        style={{
          opacity: introReveal,
          transform: `scale(${introScale})`,
          transformOrigin: "center center",
        }}
      >
        {PANELS.map((panel, pi) => {
          const active = activations[pi];
          const px = panelX(panel.col);
          const py = panelY(panel.row);
          const isActive = active > 0.05;
          const dotGlow = isActive
            ? `0 0 ${12 * active}px rgba(${C.accent[0]},${C.accent[1]},${C.accent[2]},${0.9 * active}), 0 0 ${28 * active}px rgba(${C.accent[0]},${C.accent[1]},${C.accent[2]},${0.35 * active})`
            : "none";

          return (
            <div
              key={`label-${panel.id}`}
              style={{
                position: "absolute",
                left: px + 22,
                top: py + 18,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: isActive
                    ? `rgb(${C.accent[0]},${C.accent[1]},${C.accent[2]})`
                    : "transparent",
                  border: isActive
                    ? "none"
                    : `1.5px solid rgba(${C.fgSubtle[0]},${C.fgSubtle[1]},${C.fgSubtle[2]},0.7)`,
                  boxShadow: dotGlow,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 14,
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  color: isActive
                    ? `rgb(${C.fg[0]},${C.fg[1]},${C.fg[2]})`
                    : `rgba(${C.fgMuted[0]},${C.fgMuted[1]},${C.fgMuted[2]},0.7)`,
                }}
              >
                {panel.label}
              </span>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
