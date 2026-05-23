import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Canvas, type DrawCtx } from "../components/Canvas";
import { C, FONT, FPS, rgb, mix } from "../theme";
import {
  clamp, lerp, easeOutCubic, easeInOutCubic, easeOutExpo,
  ramp, eramp, glowDot, glowLine, travelingPulse,
  mulberry32, noise1,
} from "../lib/draw";

// ── vignette timing (6 slots, accelerating) ─────────────────────────────────
// Each slot: [start, end] in local seconds
const SLOTS: [number, number][] = [
  [0.0, 0.72],
  [0.72, 1.38],
  [1.38, 1.96],
  [1.96, 2.46],
  [2.46, 2.90],
  [2.90, 3.28],
];
const PART_B_START = 3.60; // crossfade from flashes ends, finale begins
const FINALE_IN_START = 4.00; // wordmark fades in

// enter/exit envelope for a vignette (quick scale+opacity bloom in, hard cut out)
function vigEnvelope(t: number, slot: number): { alpha: number; scale: number } {
  const [s, e] = SLOTS[slot];
  const duration = e - s;
  const local = t - s;
  if (local < 0 || local > duration + 0.08) return { alpha: 0, scale: 1 };
  const enterDur = Math.min(0.12, duration * 0.2);
  const alpha = eramp(local, 0, enterDur, easeOutCubic);
  const scale = 1 + (1 - eramp(local, 0, enterDur, easeOutCubic)) * 0.06;
  return { alpha, scale };
}

// which vignette is active at time t (during PART A)
function activeVignette(t: number): number {
  for (let i = 0; i < SLOTS.length; i++) {
    if (t >= SLOTS[i][0] && t < SLOTS[i][1] + 0.06) return i;
  }
  return -1;
}

// vignette progress 0..1 within its own slot
function vignetteProg(t: number, slot: number): number {
  const [s, e] = SLOTS[slot];
  return clamp((t - s) / (e - s));
}

// ── VIGNETTE 0: BLACK HOLE COLLAPSE ──────────────────────────────────────────
function drawBlackHole(ctx: CanvasRenderingContext2D, prog: number, t: number) {
  const cx = 960;
  const cy = 540;

  // deep space background gradient
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 700);
  bg.addColorStop(0, `rgba(4,2,6,1)`);
  bg.addColorStop(0.18, `rgba(7,4,10,1)`);
  bg.addColorStop(1, `rgba(7,7,9,1)`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1920, 1080);

  const rotation = t * 1.4 + prog * Math.PI * 2;

  // gravitational lens halo (outermost)
  const halo = ctx.createRadialGradient(cx, cy, 180, cx, cy, 520);
  halo.addColorStop(0, `rgba(239,197,64,0.0)`);
  halo.addColorStop(0.55, `rgba(239,127,57,${0.06 * prog})`);
  halo.addColorStop(0.8, `rgba(239,197,64,${0.04 * prog})`);
  halo.addColorStop(1, `rgba(0,0,0,0)`);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 520, 220, 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // accretion disk — amber→terracotta ellipse ring with glow
  const rnd1 = mulberry32(0xbabe1);
  const diskParticles = 260;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < diskParticles; i++) {
    const baseAngle = (i / diskParticles) * Math.PI * 2;
    const r = rnd1();
    const radialSpread = 55 + r * 95;
    const angle = baseAngle + rotation * (1 + r * 0.6) + noise1(i * 0.3 + t * 0.7) * 0.18;
    const ex = 1.0;
    const ey = 0.38;
    const px = cx + Math.cos(angle) * radialSpread * ex;
    const py = cy + Math.sin(angle) * radialSpread * ey;
    const distFrac = (radialSpread - 55) / 95;
    const col = mix(C.accent, C.terracotta, distFrac);
    const brightness = 0.6 + 0.4 * r;
    glowDot(ctx, px, py, 2.4 + r * 3.5, col, brightness * prog * 0.7);
  }
  ctx.restore();

  // solid bright ring core
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let pass = 0; pass < 3; pass++) {
    const w = [12, 5, 2][pass];
    const a = [0.12, 0.3, 0.7][pass] * prog;
    ctx.strokeStyle = `rgba(239,197,64,${a})`;
    ctx.lineWidth = w;
    ctx.shadowColor = `rgba(239,197,64,${a})`;
    ctx.shadowBlur = 40;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 150, 58, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // infalling matter — thin streams spiraling in
  const rnd2 = mulberry32(0xf00d2);
  const streams = 18;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < streams; i++) {
    const r2 = rnd2();
    const startAngle = (i / streams) * Math.PI * 2 + rotation * 0.4;
    const startR = 200 + r2 * 260;
    const sx = cx + Math.cos(startAngle) * startR;
    const sy = cy + Math.sin(startAngle) * startR * 0.4;
    const speed = 0.3 + r2 * 0.5;
    travelingPulse(ctx, sx, sy, cx, cy, (t * speed + i * 0.17) % 1, C.accent, 7, 0.28 * prog);
  }
  ctx.restore();

  // event horizon — pure black circle
  const ehR = 78;
  const ehG = ctx.createRadialGradient(cx, cy, 0, cx, cy, ehR * 1.6);
  ehG.addColorStop(0, `rgba(0,0,0,1)`);
  ehG.addColorStop(0.6, `rgba(0,0,0,1)`);
  ehG.addColorStop(1, `rgba(0,0,0,0)`);
  ctx.fillStyle = ehG;
  ctx.beginPath();
  ctx.arc(cx, cy, ehR * 1.6, 0, Math.PI * 2);
  ctx.fill();
}

// ── VIGNETTE 1: IMMUNE SYSTEM vs VIRUSES ────────────────────────────────────
function drawImmune(ctx: CanvasRenderingContext2D, prog: number, t: number) {
  // dark crimson bg
  ctx.fillStyle = `rgb(8,4,9)`;
  ctx.fillRect(0, 0, 1920, 1080);

  const rnd = mulberry32(0xce11);

  // pathogen positions (spiky blobs) — fixed, center-ish
  const pathogens: { x: number; y: number; size: number }[] = [
    { x: 920, y: 510, size: 52 },
    { x: 1060, y: 580, size: 38 },
    { x: 820, y: 610, size: 44 },
  ];

  // immune cell count grows with prog (the swarm arrives)
  const cellCount = Math.floor(lerp(8, 120, easeOutCubic(prog)));
  const rnd2 = mulberry32(0xab12);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < cellCount; i++) {
    const r2 = rnd2();
    const r3 = rnd2();
    const r4 = rnd2();
    // each cell converges on a pathogen
    const target = pathogens[Math.floor(r2 * pathogens.length)];
    // starting position (outer orbit)
    const angle0 = r3 * Math.PI * 2;
    const radius0 = 280 + r4 * 320;
    const sx = target.x + Math.cos(angle0) * radius0;
    const sy = target.y + Math.sin(angle0) * radius0;
    // approach factor: each cell arrives staggered
    const cellProg = clamp((prog - (i / cellCount) * 0.4) / 0.6);
    const arrive = easeOutCubic(cellProg);
    const cellX = lerp(sx, target.x + noise1(i * 0.7 + t * 0.4) * 28, arrive);
    const cellY = lerp(sy, target.y + noise1(i + 30 + t * 0.4) * 28, arrive);
    // teal immune cell glow
    const cellA = 0.55 + 0.45 * arrive;
    glowDot(ctx, cellX, cellY, 7 + r4 * 4, C.teal, cellA * 0.85);
  }
  ctx.restore();

  // pathogen spiky blobs
  for (const pg of pathogens) {
    const spikeCount = 12;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // inner blob
    glowDot(ctx, pg.x, pg.y, pg.size * 0.6, C.deepRed, 0.9 * prog);
    // spikes
    for (let k = 0; k < spikeCount; k++) {
      const ang = (k / spikeCount) * Math.PI * 2 + t * 0.3;
      const spikeLen = pg.size * (0.7 + rnd() * 0.5);
      const tx2 = pg.x + Math.cos(ang) * spikeLen;
      const ty2 = pg.y + Math.sin(ang) * spikeLen;
      glowLine(ctx, pg.x, pg.y, tx2, ty2, C.pink, 2.5, 0.6 * prog);
      glowDot(ctx, tx2, ty2, 5, C.pink, 0.8 * prog);
    }
    ctx.restore();
  }

  // faint label
  ctx.save();
  ctx.font = `500 13px ${FONT.mono}`;
  ctx.fillStyle = `rgba(161,161,170,${0.7 * prog})`;
  ctx.textAlign = "center";
  ctx.fillText("IMMUNE RESPONSE", 960, 900);
  ctx.restore();
}

// ── VIGNETTE 2: MARKET PANIC NETWORK ────────────────────────────────────────
function drawMarketPanic(ctx: CanvasRenderingContext2D, prog: number, t: number) {
  ctx.fillStyle = `rgb(7,7,9)`;
  ctx.fillRect(0, 0, 1920, 1080);

  // deterministic node layout
  const rnd = mulberry32(0xd34d);
  const nodeCount = 38;
  const nodes: { x: number; y: number; panicked: boolean; panicTime: number }[] = [];

  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      x: 200 + rnd() * 1520,
      y: 120 + rnd() * 840,
      panicked: false,
      panicTime: 0,
    });
  }

  // epicenter is node 0 (positioned center-left)
  nodes[0].x = 620;
  nodes[0].y = 540;

  // build edges (nearest neighbors)
  const edges: [number, number][] = [];
  for (let i = 0; i < nodeCount; i++) {
    for (let j = i + 1; j < nodeCount; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const d = Math.hypot(dx, dy);
      if (d < 340) edges.push([i, j]);
    }
  }

  // panic propagates as a BFS wave; distance from node 0 determines timing
  const dist: number[] = new Array(nodeCount).fill(Infinity);
  dist[0] = 0;
  // BFS
  const queue = [0];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [a, b] of edges) {
      const nb = a === cur ? b : b === cur ? a : -1;
      if (nb >= 0 && dist[nb] === Infinity) {
        dist[nb] = dist[cur] + 1;
        queue.push(nb);
      }
    }
  }
  const maxDist = Math.max(...dist.filter(isFinite));
  // panic wave: node panics when prog > dist[i]/maxDist * 0.85
  const panicFrac = (i: number) => clamp(dist[i] === Infinity ? 0 : dist[i] / maxDist);

  // draw edges
  ctx.save();
  for (const [a, b] of edges) {
    const pa = Math.min(1, prog / (panicFrac(a) * 0.8 + 0.2));
    const pb = Math.min(1, prog / (panicFrac(b) * 0.8 + 0.2));
    const bothPanicked = pa > 0.5 && pb > 0.5;
    const col = bothPanicked ? C.deepRed : C.fgSubtle;
    const alpha = bothPanicked ? 0.35 : 0.1;
    ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
    ctx.lineWidth = bothPanicked ? 1.8 : 1;
    ctx.beginPath();
    ctx.moveTo(nodes[a].x, nodes[a].y);
    ctx.lineTo(nodes[b].x, nodes[b].y);
    ctx.stroke();
  }
  ctx.restore();

  // traveling panic signals
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const [a, b] of edges) {
    const pa2 = panicFrac(a);
    if (prog > pa2 * 0.8 + 0.08) {
      travelingPulse(ctx, nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y,
        (t * 0.8 + a * 0.13) % 1, C.deepRed, 10, 0.32);
    }
  }
  ctx.restore();

  // draw nodes
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < nodeCount; i++) {
    const pf = panicFrac(i);
    const isPanicked = prog > pf * 0.85 + 0.08;
    const panicLevel = clamp((prog - pf * 0.85) / 0.15);
    const col = isPanicked ? mix(C.teal, C.deepRed, easeOutCubic(panicLevel)) : C.teal;
    const r = 10 + (isPanicked ? panicLevel * 6 : 0);
    glowDot(ctx, nodes[i].x, nodes[i].y, r, col, isPanicked ? 0.9 : 0.5);
  }
  ctx.restore();

  ctx.save();
  ctx.font = `500 13px ${FONT.mono}`;
  ctx.fillStyle = `rgba(161,161,170,${0.7 * prog})`;
  ctx.textAlign = "center";
  ctx.fillText("MARKET CONTAGION", 960, 980);
  ctx.restore();
}

// ── VIGNETTE 3: WILDFIRE PROPAGATION ────────────────────────────────────────
function drawWildfire(ctx: CanvasRenderingContext2D, prog: number, t: number) {
  ctx.fillStyle = `rgb(6,5,4)`;
  ctx.fillRect(0, 0, 1920, 1080);

  const COLS = 56;
  const ROWS = 32;
  const cw = 1920 / COLS;
  const ch = 1080 / ROWS;

  const igX = Math.floor(COLS * 0.45);
  const igY = Math.floor(ROWS * 0.5);

  // fire spread radius as function of prog
  const maxRadius = prog * Math.max(COLS, ROWS) * 0.72;

  const rnd = mulberry32(0xf1a3);
  // per-cell jitter for organic spread
  const cellJitter: number[] = new Array(COLS * ROWS).fill(0).map(() => rnd() * 0.22);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const dx = col - igX;
      const dy = (row - igY) * 1.2; // terrain warps vertically
      const dist = Math.hypot(dx, dy) + cellJitter[row * COLS + col] * 3.5;
      const isBurnt = dist < maxRadius - 4;
      const isFront = !isBurnt && dist < maxRadius + 3;
      const isActive = dist < maxRadius + 9;

      if (!isActive) continue;

      const px = col * cw;
      const py = row * ch;

      if (isBurnt) {
        // ember/ash
        const emberA = 0.05 + 0.08 * noise1(col * 0.4 + row * 0.3 + t * 0.8);
        ctx.fillStyle = `rgba(80,30,8,${emberA})`;
        ctx.fillRect(px, py, cw, ch);
        // occasional live ember
        if (cellJitter[row * COLS + col] > 0.18) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          glowDot(ctx, px + cw * 0.5, py + ch * 0.5, 3, C.terracotta, 0.25 + 0.2 * Math.sin(t * 4 + col));
          ctx.restore();
        }
      } else if (isFront) {
        const frontProg = clamp(1 - (dist - maxRadius + 4) / 7);
        // fire cell
        const fireCol = mix(C.accent, C.terracotta, 0.5 + 0.5 * noise1(col * 0.5 + t * 2));
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        glowDot(ctx, px + cw * 0.5, py + ch * 0.5, cw * 0.7, fireCol, frontProg * 0.85);
        ctx.restore();
      }
    }
  }

  // ignition point bright core
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glowDot(ctx, igX * cw + cw * 0.5, igY * ch + ch * 0.5, 22, C.accent, Math.min(1, prog * 4));
  ctx.restore();

  ctx.save();
  ctx.font = `500 13px ${FONT.mono}`;
  ctx.fillStyle = `rgba(161,161,170,${0.7 * prog})`;
  ctx.textAlign = "center";
  ctx.fillText("WILDFIRE PROPAGATION", 960, 56);
  ctx.restore();
}

// ── VIGNETTE 4: PROTEIN FOLDING ──────────────────────────────────────────────
function drawProtein(ctx: CanvasRenderingContext2D, prog: number, t: number) {
  ctx.fillStyle = `rgb(5,7,10)`;
  ctx.fillRect(0, 0, 1920, 1080);

  const cx = 960;
  const cy = 540;
  const N = 22; // bead count

  // extended: linear chain from left to right
  const extended = (i: number): [number, number] => {
    const x = cx - 420 + (i / (N - 1)) * 840;
    const y = cy;
    return [x, y];
  };

  // folded: compact helical/globular
  const folded = (i: number): [number, number] => {
    const angle = (i / (N - 1)) * Math.PI * 5.5 + Math.PI * 0.2;
    const baseR = 60 + Math.sin(i * 0.8) * 35;
    const x = cx + Math.cos(angle) * baseR * 1.3;
    const y = cy + Math.sin(angle) * baseR;
    return [x, y];
  };

  const fold = easeInOutCubic(clamp(prog * 1.1));

  const beads: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const [ex, ey] = extended(i);
    const [fx, fy] = folded(i);
    // stagger: each bead starts folding slightly later
    const beadFold = easeInOutCubic(clamp((fold - (i / N) * 0.3) / 0.7));
    beads.push([lerp(ex, fx, beadFold), lerp(ey, fy, beadFold)]);
  }

  // backbone glow lines
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < N - 1; i++) {
    const col = mix(C.teal, C.blue, i / N);
    glowLine(ctx, beads[i][0], beads[i][1], beads[i + 1][0], beads[i + 1][1], col, 3, 0.5 * prog);
  }
  ctx.restore();

  // hydrogen bonds (cross-links between distant beads in folded state)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const bonds: [number, number][] = [[0, 12], [3, 15], [6, 18], [9, 20]];
  for (const [a, b] of bonds) {
    const bondA = fold * 0.6;
    if (bondA < 0.05) continue;
    ctx.strokeStyle = `rgba(161,161,170,${bondA * 0.35})`;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(beads[a][0], beads[a][1]);
    ctx.lineTo(beads[b][0], beads[b][1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // bead dots
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < N; i++) {
    const col = mix(C.teal, C.accent, i / N);
    glowDot(ctx, beads[i][0], beads[i][1], 11, col, 0.85 * prog);
  }
  ctx.restore();

  // energy glow in folded center
  if (fold > 0.3) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const gCx = cx + noise1(t * 0.5) * 10;
    const gCy = cy + noise1(t * 0.4 + 5) * 10;
    const g = ctx.createRadialGradient(gCx, gCy, 0, gCx, gCy, 120);
    g.addColorStop(0, `rgba(49,192,177,${0.12 * fold * prog})`);
    g.addColorStop(1, `rgba(49,192,177,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(gCx, gCy, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.font = `500 13px ${FONT.mono}`;
  ctx.fillStyle = `rgba(161,161,170,${0.7 * prog})`;
  ctx.textAlign = "center";
  ctx.fillText("PROTEIN FOLDING", 960, 900);
  ctx.restore();
}

// ── VIGNETTE 5: TRAFFIC GRIDLOCK ─────────────────────────────────────────────
function drawTraffic(ctx: CanvasRenderingContext2D, prog: number, t: number) {
  ctx.fillStyle = `rgb(8,8,10)`;
  ctx.fillRect(0, 0, 1920, 1080);

  // grid of streets: 8 horizontal, 5 vertical lanes
  const LANES_H = 7;
  const LANES_V = 11;
  const margin = 80;
  const gridW = 1920 - margin * 2;
  const gridH = 1080 - margin * 2;
  const laneSpacingH = gridH / (LANES_H - 1);
  const laneSpacingV = gridW / (LANES_V - 1);

  // draw street grid (faint)
  ctx.save();
  ctx.strokeStyle = `rgba(30,30,36,0.9)`;
  ctx.lineWidth = 18;
  for (let i = 0; i < LANES_H; i++) {
    const y = margin + i * laneSpacingH;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1920, y); ctx.stroke();
  }
  for (let i = 0; i < LANES_V; i++) {
    const x = margin + i * laneSpacingV;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1080); ctx.stroke();
  }
  ctx.restore();

  // jam nucleates on horizontal lane 3 at x=960, propagates backward (leftward)
  const jamLane = 3;
  const jamY = margin + jamLane * laneSpacingH;
  const jamCenterX = 960;
  const jamRadius = prog * 620; // backward propagation wave

  // cars on horizontal lanes
  const rnd = mulberry32(0x7a11);
  const carCount = 90;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < carCount; i++) {
    const r1 = rnd();
    const r2 = rnd();
    const r3 = rnd();
    const lane = Math.floor(r1 * LANES_H);
    const y = margin + lane * laneSpacingH;
    const baseX = r2 * 1920;
    const speed = 60 + r3 * 90; // pixels per second

    const isJamLane = lane === jamLane;
    const inJamZone = isJamLane && baseX < jamCenterX && baseX > jamCenterX - jamRadius - 80;

    let carX: number;
    if (inJamZone) {
      // car is jammed — nearly stopped, tight spacing
      const jamPos = baseX;
      const slowFactor = clamp(1 - (jamCenterX - baseX - (jamRadius - 80)) / 80);
      carX = jamPos + t * speed * (1 - slowFactor * 0.92);
    } else {
      carX = (baseX + t * speed) % 1920;
    }

    const isJammed = isJamLane && carX < jamCenterX && carX > jamCenterX - jamRadius;
    const col = isJammed ? C.deepRed : C.accent;
    const intensity = isJammed ? 0.9 : 0.55;
    glowDot(ctx, carX, y, isJammed ? 8 : 6, col, intensity);
  }
  ctx.restore();

  // jam stop-wave glow pulse
  if (prog > 0.1) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const waveX = jamCenterX - jamRadius;
    const waveG = ctx.createRadialGradient(waveX, jamY, 0, waveX, jamY, 80);
    waveG.addColorStop(0, `rgba(164,18,71,${0.45 * prog})`);
    waveG.addColorStop(1, `rgba(164,18,71,0)`);
    ctx.fillStyle = waveG;
    ctx.beginPath();
    ctx.arc(waveX, jamY, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.font = `500 13px ${FONT.mono}`;
  ctx.fillStyle = `rgba(161,161,170,${0.7 * prog})`;
  ctx.textAlign = "center";
  ctx.fillText("TRAFFIC JAM · BACKWARD WAVE", 960, 56);
  ctx.restore();
}

// ── EMBER FIELD (Part B background) ─────────────────────────────────────────
function drawEmbers(ctx: CanvasRenderingContext2D, alpha: number, t: number) {
  if (alpha < 0.01) return;
  const rnd = mulberry32(0x3b3b3);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 55; i++) {
    const bx = rnd() * 1920;
    const by = rnd() * 1080;
    const r = rnd();
    const drift = noise1(i * 0.7 + t * 0.25) * 18;
    const flicker = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.8 + i * 0.9));
    const col = r > 0.6 ? C.accent : C.terracotta;
    glowDot(ctx, bx + drift, by + noise1(i * 0.5 + t * 0.18) * 22, 2 + r * 3.5, col,
      alpha * flicker * (0.08 + r * 0.1));
  }
  ctx.restore();
}

// ── BLOOM FLASH (on vignette cut-in) ─────────────────────────────────────────
function drawBloom(ctx: CanvasRenderingContext2D, flashAlpha: number) {
  if (flashAlpha < 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgba(239,197,64,${flashAlpha * 0.18})`;
  ctx.fillRect(0, 0, 1920, 1080);
  ctx.restore();
}

// ── MAIN DRAW FUNCTION ───────────────────────────────────────────────────────
function drawScene(ctx: CanvasRenderingContext2D, info: DrawCtx) {
  const { t, width, height } = info;

  // base background
  ctx.fillStyle = rgb(C.bgDeep);
  ctx.fillRect(0, 0, width, height);

  const active = activeVignette(t);

  if (active >= 0 && t < PART_B_START) {
    const prog = vignetteProg(t, active);
    const { alpha, scale } = vigEnvelope(t, active);

    // bloom flash on entry
    const bloomA = eramp(t, SLOTS[active][0], SLOTS[active][0] + 0.08, easeOutExpo);
    const bloomFade = 1 - eramp(t, SLOTS[active][0] + 0.08, SLOTS[active][0] + 0.22, easeOutCubic);
    const flashAlpha = bloomA * bloomFade;

    // apply scale envelope via transform
    if (scale !== 1) {
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-width / 2, -height / 2);
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    switch (active) {
      case 0: drawBlackHole(ctx, prog, t); break;
      case 1: drawImmune(ctx, prog, t); break;
      case 2: drawMarketPanic(ctx, prog, t); break;
      case 3: drawWildfire(ctx, prog, t); break;
      case 4: drawProtein(ctx, prog, t); break;
      case 5: drawTraffic(ctx, prog, t); break;
    }

    ctx.restore();

    if (scale !== 1) ctx.restore();

    drawBloom(ctx, flashAlpha);
  } else if (t >= PART_B_START) {
    // Part B: ember field fades in
    const emberA = eramp(t, PART_B_START, PART_B_START + 0.6, easeOutCubic);
    drawEmbers(ctx, emberA, t);
  }
}

// ── COMPONENT ────────────────────────────────────────────────────────────────
export const Act6Vision: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;

  // Finale wordmark fade+scale (DIV layer, not canvas)
  const wordmarkT = clamp((t - FINALE_IN_START) / 0.7);
  const wordmarkAlpha = easeOutCubic(wordmarkT);
  const wordmarkScale = lerp(1.06, 1.0, easeOutCubic(wordmarkT));

  return (
    <AbsoluteFill style={{ background: rgb(C.bgDeep) }}>
      {/* Part A canvas: vignette flashes + Part B ember field */}
      <Canvas draw={drawScene} />

      {/* Part B: finale wordmark — DIV layer for crisp text rendering */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: wordmarkAlpha,
          transform: `scale(${wordmarkScale})`,
          pointerEvents: "none",
        }}
      >
        {/* Amber underglow behind wordmark */}
        {wordmarkAlpha > 0.01 && (
          <div
            style={{
              position: "absolute",
              width: 640,
              height: 280,
              background:
                "radial-gradient(ellipse 55% 55% at 50% 52%, rgba(239,197,64,0.13) 0%, rgba(239,127,57,0.05) 50%, transparent 100%)",
              pointerEvents: "none",
            }}
          />
        )}

        {/* "Mira" logotype */}
        <div
          style={{
            fontFamily: FONT.display,
            fontSize: 120,
            fontWeight: 300,
            letterSpacing: "-0.03em",
            color: rgb(C.fg),
            lineHeight: 1,
            position: "relative",
          }}
        >
          Mira
        </div>

        {/* Tagline */}
        <div
          style={{
            fontFamily: FONT.sans,
            fontSize: 20,
            fontWeight: 400,
            letterSpacing: "0.04em",
            color: rgb(C.fgMuted),
            marginTop: 22,
            position: "relative",
          }}
        >
          The visualization layer for thinking
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
