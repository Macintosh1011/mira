/**
 * GOLD-STANDARD EXAMPLE — Neural network classifier.
 *
 * A faithful rebuild of design_handoff_mira/nn-canvas.jsx using ONLY the kit.
 * Real render-module body (the SceneBundle.code string): mounts a p5 instance,
 * drives a 4-phase timeline, composes from kit primitives, returns cleanup.
 * Embedded VERBATIM in the codegen system prompt as the second few-shot.
 *
 * Inputs: only `container` and `libs` ({ p5, THREE, gsap, kit }). No imports.
 */
export const NN_CLASSIFIER_BODY = String.raw`const W = container.clientWidth || 1280, H = container.clientHeight || 720;
const kit = libs.kit;
const { ease, palette } = kit;
const VW = 1600, VH = 900;

const DIGIT_7 = [
  [0,0,0,0,0,0,0,0],[0,1,1,1,1,1,1,0],[0,0,0,0,0,1,1,0],[0,0,0,0,1,1,0,0],
  [0,0,0,1,1,0,0,0],[0,0,1,1,0,0,0,0],[0,0,1,1,0,0,0,0],[0,0,0,0,0,0,0,0],
];

const sketch = (p) => {
  // Layer geometry in the 1600x900 design space.
  const cell = 28, size = 8, gridW = cell * size;     // 224
  const gridCx = 260, gridCy = 450;
  const gridX = gridCx - gridW / 2, gridY = gridCy - gridW / 2;
  const colY = (n, i) => 150 + (i * 600) / (n - 1);
  const h1 = Array.from({ length: 10 }, (_, i) => ({ x: 700, y: colY(10, i) }));
  const h2 = Array.from({ length: 8 },  (_, i) => ({ x: 980, y: colY(8, i) }));
  const out = Array.from({ length: 10 }, (_, i) => ({ x: 1300, y: colY(10, i), label: String(i) }));

  const ACTIVE = { h1: [1,3,4,7], h2: [0,2,5], winner: 7, secondary: [1,9] };
  const SIG = { h1: [1,3,4,7], h2: [[1,0],[3,0],[4,2],[7,5]], out: [[0,7],[2,7],[5,7]] };
  const gridExit = { x: gridX + gridW, y: gridCy };

  const PHASE_MS = 4800;
  const PHASE_LABELS = ["input pixels", "hidden layer 1", "hidden layer 2", "classify"];

  p.setup = () => { const c = p.createCanvas(W, H); c.style("display", "block"); kit.useFonts(p); };

  p.draw = () => {
    const tSec = p.millis() / 1000;
    const elapsed = p.millis();
    const phase = Math.min(3, Math.floor(elapsed / PHASE_MS));
    const local = ease.outCubic(Math.min(1, (elapsed % PHASE_MS) / 1100));

    kit.grid(p);
    p.push();
    const sc = Math.min(W / VW, H / VH);
    p.translate(W / 2 - (VW * sc) / 2, H / 2 - (VH * sc) / 2);
    p.scale(sc);

    // ── Base edge bundles (drawn under neurons) ──
    if (phase >= 1) {
      kit.connectBundle(p, { from: [gridExit], to: h1, inset: 12, reveal: phase === 1 ? local : 1 });
    }
    if (phase >= 2) kit.connectBundle(p, { from: h1, to: h2, reveal: phase === 2 ? local : 1 });
    if (phase >= 3) kit.connectBundle(p, { from: h2, to: out, reveal: local });

    // ── Signal flows (bright dashed) ──
    if (phase >= 1) {
      for (const ti of SIG.h1) kit.signal(p, { x1: gridExit.x + 6, y1: gridExit.y, x2: h1[ti].x - 12, y2: h1[ti].y, t: tSec });
    }
    if (phase >= 2) {
      for (const [si, ti] of SIG.h2) kit.signal(p, { x1: h1[si].x + 12, y1: h1[si].y, x2: h2[ti].x - 12, y2: h2[ti].y, t: tSec });
    }
    if (phase >= 3) {
      for (const [si, ti] of SIG.out) kit.signal(p, { x1: h2[si].x + 12, y1: h2[si].y, x2: out[ti].x - 12, y2: out[ti].y, t: tSec });
    }

    // ── Input grid (phase 0) ──
    if (phase >= 0) {
      const rev = phase === 0 ? Math.min(1, (elapsed % PHASE_MS) / 1800) : 1;
      kit.pixelGrid(p, { x: gridX, y: gridY, cell, data: DIGIT_7, reveal: rev, frame: true });
      kit.label(p, { x: gridCx, y: gridY - 18, text: "x ∈ ℝ⁶⁴", size: 11, upper: true, mono: true, color: palette.fgMuted });
      kit.label(p, { x: gridCx, y: gridY + gridW + 38, text: "Input · 8×8 pixels", size: 13, weight: "bold" });
    }

    // ── Hidden layer 1 ──
    if (phase >= 1) {
      kit.neuronLayer(p, { x: 700, ys: h1.map((n) => n.y), r: 11,
        active: h1.map((_, i) => phase === 1 && ACTIVE.h1.includes(i)),
        settled: h1.map((_, i) => phase > 1 && ACTIVE.h1.includes(i)),
        title: "Hidden Layer 1", sublabel: "edge detectors", reveal: phase === 1 ? local : 1 });
    }
    // ── Hidden layer 2 ──
    if (phase >= 2) {
      kit.neuronLayer(p, { x: 980, ys: h2.map((n) => n.y), r: 11,
        active: h2.map((_, i) => phase === 2 && ACTIVE.h2.includes(i)),
        settled: h2.map((_, i) => phase > 2 && ACTIVE.h2.includes(i)),
        title: "Hidden Layer 2", sublabel: "shape composition", reveal: phase === 2 ? local : 1 });
    }
    // ── Output layer + winner confidence ──
    if (phase >= 3) {
      out.forEach((n, i) => {
        const winner = i === ACTIVE.winner;
        kit.neuron(p, { x: n.x, y: n.y, r: 10, label: n.label,
          settled: ACTIVE.secondary.includes(i), winner, reveal: local });
      });
      kit.label(p, { x: 1300, y: 110, text: "Output", size: 13, weight: "bold", alpha: local });
      kit.label(p, { x: 1300, y: 128, text: "softmax · 10 classes", size: 11, upper: true, mono: true, color: palette.fgMuted, alpha: local });
      const conf = 0.942 * ease.smoothstep(Math.min(1, Math.max(0, ((elapsed - 3 * PHASE_MS) - 350) / 900)));
      const wy = out[ACTIVE.winner].y;
      kit.confidenceBar(p, { x: 1300 + 10 + 38, y: wy, w: 80, value: conf });
    }
    p.pop();

    kit.phaseDots(p, { x: 28, y: H - 34, total: 4, current: phase, label: PHASE_LABELS[phase] });
  };
};
const inst = new libs.p5(sketch, container);
return () => inst.remove();`;
