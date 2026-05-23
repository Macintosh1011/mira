/**
 * Mira interactive Sim — Neural Net & Attention.
 *
 * A LITERAL, deterministic forward-pass / attention simulation. Two modes,
 * switched live by the `mode` control:
 *
 *   Mode A — CLASSIFIER. An 8×8 input grid (a preset "drawn" digit) feeds two
 *   hidden layers of neurons over weighted edges. The forward pass is REAL:
 *     a^(l) = ReLU(W^(l) a^(l-1) + b^(l)),   logits z = W^(out) a^(2) + b
 *     p = softmax(z / T),  σ(z)_i = e^{z_i/T} / Σ_j e^{z_j/T}
 *   Edges light by sign·|weight·activation|; the output is a softmax bar chart
 *   over 10 classes with the argmax winner highlighted + confidence %.
 *
 *   Mode B — ATTENTION. Tokens of a sentence get seeded Q/K/V vectors; we
 *   compute the full self-attention matrix:
 *     A = softmax(Q Kᵀ / √d_k),   out_i = Σ_j A_ij V_j
 *   Rendered as a token-pair heatmap. The `input` slider selects a query token
 *   and traces its attention distribution over the keys + the weighted value
 *   sum it produces.
 *
 * Everything is computed from a fixed PRNG seed → identical frames for
 * identical (mode, input, temperature, layer, weightNoise). No Math.random in
 * the draw loop. Curves are sampled manually (no p5 2.x-removed vertex APIs).
 *
 * Contract: `export default Sim`. `create(container, libs, content)` mounts a
 * p5 instance and returns SceneController { setPhase, setParam, dispose }.
 * libs = { p5, THREE, gsap, kit, katex }; only kit + p5 + katex are used here.
 */
import type {
  ControlSpec,
  SceneContent,
  SceneController,
  Sim,
  SimLibs,
} from "@/lib/types";
import type { Kit, P5, RGB } from "@/lib/kit";

// ── deterministic PRNG ──────────────────────────────────────────────────
// Mulberry32: tiny, fully deterministic from a 32-bit seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Standard normal via Box–Muller, drawn from a uniform PRNG.
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const relu = (x: number): number => (x > 0 ? x : 0);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function softmax(z: number[], temperature: number): number[] {
  const T = Math.max(1e-3, temperature);
  const scaled = z.map((v) => v / T);
  const m = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - m));
  const sum = exps.reduce((s, e) => s + e, 0) || 1;
  return exps.map((e) => e / sum);
}

// ── classifier model (deterministic, seeded) ─────────────────────────────
// Architecture: 64 → 12 (ReLU) → 8 (ReLU) → 10 (softmax). Small enough to draw
// every neuron, large enough to look like a real net. Weights are seeded so the
// same input always classifies the same way; weightNoise re-seeds per bucket so
// a given slider value is stable frame-to-frame yet sweeping it re-rolls.
const IN = 64;
const H1 = 12;
const H2 = 8;
const OUT = 10;

interface ClassifierWeights {
  w1: number[][]; // H1 × IN
  b1: number[];
  w2: number[][]; // H2 × H1
  b2: number[];
  w3: number[][]; // OUT × H2
  b3: number[];
}

function buildClassifier(noise: number): ClassifierWeights {
  const bucket = Math.round(noise * 20);
  const rng = mulberry32((0x9e3779b9 ^ (bucket * 0x85ebca6b)) >>> 0);
  const he = (fanIn: number) => Math.sqrt(2 / fanIn);
  const mat = (rows: number, cols: number, s: number) =>
    Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => gaussian(rng) * s),
    );
  const vec = (m: number) =>
    Array.from({ length: m }, () => gaussian(rng) * 0.05);
  return {
    w1: mat(H1, IN, he(IN)),
    b1: vec(H1),
    w2: mat(H2, H1, he(H1)),
    b2: vec(H2),
    w3: mat(OUT, H2, he(H2)),
    b3: vec(OUT),
  };
}

interface ForwardPass {
  input: number[]; // length 64, 0..1
  a1: number[]; // H1 post-ReLU
  a2: number[]; // H2 post-ReLU
  logits: number[]; // OUT pre-softmax
  probs: number[]; // OUT softmax
  winner: number;
}

function forward(
  input: number[],
  w: ClassifierWeights,
  temperature: number,
): ForwardPass {
  const matvec = (m: number[][], x: number[], b: number[]) =>
    m.map((row, i) => row.reduce((s, wij, j) => s + wij * x[j], b[i]));
  const a1 = matvec(w.w1, input, w.b1).map(relu);
  const a2 = matvec(w.w2, a1, w.b2).map(relu);
  const logits = matvec(w.w3, a2, w.b3);
  const probs = softmax(logits, temperature);
  let winner = 0;
  for (let i = 1; i < probs.length; i++)
    if (probs[i] > probs[winner]) winner = i;
  return { input, a1, a2, logits, probs, winner };
}

// 8×8 preset digit bitmaps the `input` slider selects between. Row-major 0/1.
const DIGITS: number[][][] = [
  [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
  ],
  [
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 1, 0, 0, 0],
    [0, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
  ],
  [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
    [0, 0, 0, 0, 1, 1, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 0],
    [0, 1, 1, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
  ],
  [
    [0, 1, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
  ],
  [
    [0, 0, 0, 0, 1, 1, 0, 0],
    [0, 0, 0, 1, 1, 1, 0, 0],
    [0, 0, 1, 1, 0, 1, 0, 0],
    [0, 1, 1, 0, 0, 1, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
  ],
  [
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 0, 0, 0, 0, 0],
    [0, 1, 1, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
  ],
  [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 0, 0, 0, 0, 0],
    [0, 1, 1, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
  ],
  [
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
    [0, 0, 0, 0, 1, 1, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 0],
  ],
  [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
  ],
  [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
    [0, 0, 0, 0, 0, 1, 1, 0],
    [0, 0, 0, 0, 1, 1, 0, 0],
    [0, 0, 1, 1, 1, 0, 0, 0],
  ],
];

const flatten = (m: number[][]): number[] => m.flat();

// ── attention model (deterministic, seeded) ──────────────────────────────
// A toy single-head self-attention over a fixed sentence. Q/K/V come from a
// seeded projection of per-token feature vectors; the attention matrix is the
// genuine softmax(QKᵀ/√d). weightNoise reproducibly perturbs the projections.
const TOKENS = ["The", "cat", "sat", "on", "the", "mat", "."];
const D_MODEL = 8;
const D_K = 4;

interface AttentionModel {
  scores: number[][]; // n × n = QKᵀ/√d
  attn: number[][]; // n × n = softmax row-wise (temperature-scaled)
  out: number[][]; // n × d_k = attn · V
}

function buildAttention(noise: number, temperature: number): AttentionModel {
  const bucket = Math.round(noise * 20);
  const rng = mulberry32((0x27d4eb2f ^ (bucket * 0x165667b1)) >>> 0);

  const embed: number[][] = TOKENS.map((_, i) =>
    Array.from(
      { length: D_MODEL },
      (_, d) => Math.sin((i + 1) * (d + 1) * 0.7) * 0.9 + gaussian(rng) * 0.15,
    ),
  );
  const proj = (rowsOut: number) =>
    Array.from({ length: D_MODEL }, () =>
      Array.from(
        { length: rowsOut },
        () => gaussian(rng) * (1 / Math.sqrt(D_MODEL)),
      ),
    );
  const Wq = proj(D_K);
  const Wk = proj(D_K);
  const Wv = proj(D_K);
  const project = (Wm: number[][]) =>
    embed.map((e) =>
      Array.from({ length: D_K }, (_, j) =>
        e.reduce((s, ei, d) => s + ei * Wm[d][j], 0),
      ),
    );
  const q = project(Wq);
  const k = project(Wk);
  const v = project(Wv);

  const scale = 1 / Math.sqrt(D_K);
  const scores = q.map((qi) =>
    k.map((kj) => qi.reduce((s, qv, d) => s + qv * kj[d], 0) * scale),
  );
  const attn = scores.map((row) => softmax(row, temperature));
  const out = attn.map((row) =>
    Array.from({ length: D_K }, (_, d) =>
      row.reduce((s, a, j) => s + a * v[j][d], 0),
    ),
  );
  return { scores, attn, out };
}

// ── controls ──────────────────────────────────────────────────────────────
const CONTROLS: ControlSpec[] = [
  { key: "mode", label: "Mode (0 classify · 1 attention)", min: 0, max: 1, step: 1, default: 0 },
  { key: "input", label: "Input (digit / query token)", min: 0, max: 9, step: 1, default: 7 },
  { key: "temperature", label: "Softmax temperature", min: 0.2, max: 4, step: 0.1, default: 1, unit: "T" },
  { key: "layer", label: "Layer step", min: 0, max: 3, step: 1, default: 3 },
  { key: "weightNoise", label: "Weight noise", min: 0, max: 1, step: 0.05, default: 0 },
];

// Phase beats (1:1 with narration cues): input → hidden → output/scores → decision.
const PHASE_LABELS = ["input", "hidden activations", "output scores", "decision"];

// ── view-space layout (1600×900 design space, scaled to fit container) ────
const VW = 1600;
const VH = 900;

interface Pt {
  x: number;
  y: number;
}

interface SimState {
  phase: number;
  mode: number;
  input: number;
  temperature: number;
  layer: number;
  weightNoise: number;
}

export const NeuralNetSim: Sim = {
  id: "neural-net",
  title: "Neural Network & Attention",
  controls: CONTROLS,

  create(
    container: HTMLElement,
    libs: SimLibs,
    content: SceneContent,
  ): SceneController {
    const kit: Kit = libs.kit;
    const { palette } = kit;
    const ACTIVE: RGB = palette.accent; // amber active neurons
    const EDGE: RGB = palette.teal; // teal/blue inhibitory edges

    // Initial params: control defaults, overridden by content.params.
    const init: Record<string, number> = {};
    for (const c of CONTROLS) init[c.key] = c.default;
    if (content?.params) {
      for (const [k, val] of Object.entries(content.params)) {
        if (k in init && Number.isFinite(val)) init[k] = val;
      }
    }

    const state: SimState = {
      phase: 0,
      mode: init.mode >= 0.5 ? 1 : 0,
      input: clampInt(init.input, 0, 9),
      temperature: clampRange(init.temperature, 0.2, 4),
      layer: clampInt(init.layer, 0, 3),
      weightNoise: clamp01(init.weightNoise),
    };

    // ── KaTeX equation overlay (HTML, positioned over the canvas) ────────
    if (!container.style.position) container.style.position = "relative";
    const eqEl = document.createElement("div");
    eqEl.setAttribute("data-sim", "neural-net-eq");
    Object.assign(eqEl.style, {
      position: "absolute",
      top: "14px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "8px 16px",
      borderRadius: "10px",
      background: "rgba(20,20,24,0.72)",
      border: "1px solid rgba(255,255,255,0.08)",
      color: "#f4f4f5",
      fontSize: "15px",
      pointerEvents: "none",
      zIndex: "2",
      whiteSpace: "nowrap",
      maxWidth: "92%",
      overflow: "hidden",
    } as Partial<CSSStyleDeclaration>);
    container.appendChild(eqEl);

    const CLASSIFIER_EQ =
      content?.equation ??
      String.raw`a^{(l)}=\mathrm{ReLU}\!\left(W^{(l)}a^{(l-1)}+b^{(l)}\right)\qquad \sigma(z)_i=\dfrac{e^{z_i/T}}{\sum_j e^{z_j/T}}`;
    const ATTENTION_EQ = String.raw`\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\!\left(\dfrac{QK^{\top}}{\sqrt{d_k}}\right)V`;

    function renderEquation(): void {
      const src = state.mode === 1 ? ATTENTION_EQ : CLASSIFIER_EQ;
      try {
        eqEl.innerHTML = libs.katex.renderToString(src, {
          throwOnError: false,
          displayMode: false,
        });
      } catch {
        eqEl.textContent = src;
      }
    }
    renderEquation();

    // ── derived model state, recomputed on any param change ──────────────
    let cls: ClassifierWeights = buildClassifier(state.weightNoise);
    let pass: ForwardPass = forward(
      flatten(DIGITS[state.input]),
      cls,
      state.temperature,
    );
    let att: AttentionModel = buildAttention(state.weightNoise, state.temperature);

    function recompute(): void {
      if (state.mode === 1) {
        att = buildAttention(state.weightNoise, state.temperature);
      } else {
        cls = buildClassifier(state.weightNoise);
        pass = forward(flatten(DIGITS[state.input]), cls, state.temperature);
      }
    }

    function phaseLabel(): string {
      const cp = content?.phases?.[state.phase];
      return cp?.label || PHASE_LABELS[state.phase];
    }

    // ── p5 sketch ─────────────────────────────────────────────────────────
    const sketch = (p: P5) => {
      let W = container.clientWidth || 1280;
      let Hpx = container.clientHeight || 720;

      // classifier geometry (design space)
      const cell = 26;
      const gridW = cell * 8; // 208
      const gridCx = 250;
      const gridCy = 460;
      const gridX = gridCx - gridW / 2;
      const gridY = gridCy - gridW / 2;
      const colY = (cnt: number, i: number) =>
        cnt === 1 ? 460 : 150 + (i * 600) / (cnt - 1);
      const h1Pts: Pt[] = Array.from({ length: H1 }, (_, i) => ({ x: 680, y: colY(H1, i) }));
      const h2Pts: Pt[] = Array.from({ length: H2 }, (_, i) => ({ x: 960, y: colY(H2, i) }));
      const outPts: Pt[] = Array.from({ length: OUT }, (_, i) => ({ x: 1240, y: colY(OUT, i) }));
      const gridExit: Pt = { x: gridX + gridW, y: gridCy };

      // attention geometry (design space)
      const n = TOKENS.length;
      const tokColX = 230;
      const heatX = 470;
      const heatCellAtt = 74;
      const heatTop = 220;
      const valColX = heatX + n * heatCellAtt + 120;
      const tokY = (i: number) => heatTop + i * heatCellAtt + heatCellAtt / 2;

      p.setup = () => {
        const c = p.createCanvas(W, Hpx);
        c.style("display", "block");
        kit.useFonts(p);
      };

      p.windowResized = () => {
        W = container.clientWidth || W;
        Hpx = container.clientHeight || Hpx;
        p.resizeCanvas(W, Hpx);
      };

      p.draw = () => {
        const tSec = p.millis() / 1000;
        kit.grid(p);

        const sc = Math.min(W / VW, Hpx / VH);
        p.push();
        p.translate(W / 2 - (VW * sc) / 2, Hpx / 2 - (VH * sc) / 2);
        p.scale(sc);

        if (state.mode === 1) drawAttention(tSec);
        else drawClassifier(tSec);

        p.pop();

        kit.phaseDots(p, {
          x: 28,
          y: Hpx - 34,
          total: 4,
          current: state.phase,
          label: phaseLabel(),
        });
      };

      // ── CLASSIFIER renderer ─────────────────────────────────────────────
      function drawClassifier(tSec: number): void {
        const phase = state.phase;
        const lyr = state.layer;

        const a1max = Math.max(1e-6, ...pass.a1.map((v) => Math.abs(v)));
        const a2max = Math.max(1e-6, ...pass.a2.map((v) => Math.abs(v)));

        // base edge bundles (faint, under neurons)
        if (phase >= 1) kit.connectBundle(p, { from: [gridExit], to: h1Pts, inset: 12, reveal: 1 });
        if (phase >= 2) kit.connectBundle(p, { from: h1Pts, to: h2Pts, reveal: 1 });
        if (phase >= 3) kit.connectBundle(p, { from: h2Pts, to: outPts, reveal: 1 });

        // weighted signal edges: strongest firing connections light up
        if (phase >= 1 && lyr >= 1) {
          topK(pass.a1, 6).forEach((i) => {
            const w = clamp01(pass.a1[i] / a1max);
            weightedSignal(gridExit.x + 6, gridExit.y, h1Pts[i].x - 12, h1Pts[i].y, tSec, w, +1);
          });
        }
        if (phase >= 2 && lyr >= 2) {
          topK(pass.a2, 5).forEach((j) => {
            let best = 0;
            let bestv = -Infinity;
            for (let i = 0; i < H1; i++) {
              const c = cls.w2[j][i] * pass.a1[i];
              if (c > bestv) {
                bestv = c;
                best = i;
              }
            }
            const w = clamp01(pass.a2[j] / a2max);
            weightedSignal(h1Pts[best].x + 12, h1Pts[best].y, h2Pts[j].x - 12, h2Pts[j].y, tSec, w, Math.sign(cls.w2[j][best]) || 1);
          });
        }
        if (phase >= 3 && lyr >= 3) {
          topK(pass.probs, 3).forEach((cl) => {
            let best = 0;
            let bestv = -Infinity;
            for (let j = 0; j < H2; j++) {
              const c = cls.w3[cl][j] * pass.a2[j];
              if (c > bestv) {
                bestv = c;
                best = j;
              }
            }
            const w = clamp01(pass.probs[cl] / Math.max(1e-6, pass.probs[pass.winner]));
            weightedSignal(h2Pts[best].x + 12, h2Pts[best].y, outPts[cl].x - 12, outPts[cl].y, tSec, w, Math.sign(cls.w3[cl][best]) || 1);
          });
        }

        // input grid
        const digit = DIGITS[state.input];
        kit.pixelGrid(p, { x: gridX, y: gridY, cell, data: digit, reveal: 1, frame: true });
        kit.label(p, { x: gridCx, y: gridY - 18, text: "x ∈ ℝ⁶⁴", size: 11, upper: true, mono: true, color: palette.fgMuted });
        kit.label(p, { x: gridCx, y: gridY + gridW + 36, text: "Input · 8×8 pixels", size: 13, weight: "bold" });

        // hidden layer 1
        if (phase >= 1) {
          const lit = pass.a1.map((v) => v > 0.01);
          kit.neuronLayer(p, {
            x: 680,
            ys: h1Pts.map((nn) => nn.y),
            r: 10,
            active: lit.map((on) => on && phase === 1),
            settled: lit.map((on) => on && phase > 1),
            title: "Hidden Layer 1",
            sublabel: "edge detectors · ReLU",
            reveal: 1,
          });
        }
        // hidden layer 2
        if (phase >= 2) {
          const lit = pass.a2.map((v) => v > 0.01);
          kit.neuronLayer(p, {
            x: 960,
            ys: h2Pts.map((nn) => nn.y),
            r: 10,
            active: lit.map((on) => on && phase === 2),
            settled: lit.map((on) => on && phase > 2),
            title: "Hidden Layer 2",
            sublabel: "shape composition · ReLU",
            reveal: 1,
          });
        }
        // output layer + softmax bars
        if (phase >= 3) {
          const order = [...pass.probs.keys()].sort((a, b) => pass.probs[b] - pass.probs[a]);
          outPts.forEach((nn, i) => {
            const winner = i === pass.winner;
            kit.neuron(p, {
              x: nn.x,
              y: nn.y,
              r: 9,
              label: String(i),
              winner,
              settled: !winner && order.indexOf(i) <= 2,
              reveal: 1,
            });
            kit.confidenceBar(p, {
              x: nn.x + 30,
              y: nn.y,
              w: 120,
              value: pass.probs[i],
              color: winner ? ACTIVE : palette.fgMuted,
              showPct: true,
            });
          });
          kit.label(p, { x: 1240, y: 108, text: "Output", size: 13, weight: "bold" });
          kit.label(p, { x: 1240, y: 126, text: "softmax · 10 classes", size: 11, upper: true, mono: true, color: palette.fgMuted });

          kit.label(p, { x: 1330, y: 770, text: "predicted: " + pass.winner, size: 17, weight: "bold", color: ACTIVE });
          kit.label(p, {
            x: 1330,
            y: 796,
            text: "confidence " + (pass.probs[pass.winner] * 100).toFixed(1) + "%  ·  T=" + state.temperature.toFixed(1),
            size: 11,
            upper: true,
            mono: true,
            color: palette.fgMuted,
          });
        }
      }

      // Weighted signal edge: brightness ∝ activation; amber for positive
      // contribution, teal for negative (inhibitory).
      function weightedSignal(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        tSec: number,
        weight: number,
        sign: number,
      ): void {
        const col: RGB = sign >= 0 ? ACTIVE : EDGE;
        p.stroke(col[0], col[1], col[2], (0.12 + 0.25 * weight) * 255);
        p.strokeWeight(1.5);
        p.line(x1, y1, x2, y2);
        if (weight > 0.05) {
          kit.signal(p, { x1, y1, x2, y2, t: tSec, color: col, reveal: clamp01(0.3 + weight) });
        }
      }

      // ── ATTENTION renderer ──────────────────────────────────────────────
      function drawAttention(tSec: number): void {
        const phase = state.phase;
        const qi = clampInt(state.input, 0, n - 1);

        // query token column (left)
        kit.label(p, { x: tokColX, y: heatTop - 50, text: "Tokens", size: 13, weight: "bold" });
        kit.label(p, { x: tokColX, y: heatTop - 32, text: "query selection", size: 11, upper: true, mono: true, color: palette.fgMuted });
        for (let i = 0; i < n; i++) {
          tokenPill(tokColX, tokY(i), TOKENS[i], i === qi);
        }

        // attention heatmap (phase >= 2)
        if (phase >= 2) {
          kit.label(p, { x: heatX + (n * heatCellAtt) / 2, y: heatTop - 50, text: "Attention  A = softmax(QKᵀ/√dₖ)", size: 13, weight: "bold" });
          kit.label(p, { x: heatX + (n * heatCellAtt) / 2, y: heatTop - 32, text: "rows = query · cols = key", size: 11, upper: true, mono: true, color: palette.fgMuted });

          for (let j = 0; j < n; j++) {
            kit.label(p, { x: heatX + j * heatCellAtt + heatCellAtt / 2, y: heatTop - 12, text: TOKENS[j], size: 11, mono: true, color: palette.fgSubtle });
          }
          for (let i = 0; i < n; i++) {
            kit.label(p, { x: heatX - 16, y: tokY(i), text: TOKENS[i], size: 11, mono: true, align: "right", color: i === qi ? ACTIVE : palette.fgSubtle });
            for (let j = 0; j < n; j++) {
              const a = att.attn[i][j];
              const cx = heatX + j * heatCellAtt;
              const cy = heatTop + i * heatCellAtt;
              const sz = heatCellAtt - 6;
              const isRow = i === qi;
              p.push();
              p.noStroke();
              p.fill(ACTIVE[0], ACTIVE[1], ACTIVE[2], clamp01(isRow ? a : a * 0.55) * 255);
              p.rect(cx + 3, cy + 3, sz, sz, 4);
              p.noFill();
              p.stroke(255, 255, 255, (isRow ? 0.16 : 0.06) * 255);
              p.strokeWeight(1);
              p.rect(cx + 3, cy + 3, sz, sz, 4);
              p.pop();
              if (isRow) {
                kit.label(p, { x: cx + 3 + sz / 2, y: cy + 3 + sz / 2, text: a.toFixed(2), size: 12, mono: true, weight: "bold", color: a > 0.45 ? palette.bg : palette.fg });
              }
            }
          }
        }

        // animated attention flows from query → keys (phase >= 1)
        if (phase >= 1) {
          for (let j = 0; j < n; j++) {
            const a = att.attn[qi][j];
            if (a < 0.04) continue;
            const x2 = phase >= 2 ? heatX + j * heatCellAtt + heatCellAtt / 2 : tokColX + 80;
            const y2 = phase >= 2 ? heatTop - 4 : tokY(j);
            kit.signal(p, { x1: tokColX + 60, y1: tokY(qi), x2, y2, t: tSec, color: ACTIVE, reveal: clamp01(0.25 + a * 1.4) });
          }
        }

        // weighted-sum output (phase >= 3)
        if (phase >= 3) {
          kit.label(p, { x: valColX, y: heatTop - 50, text: "Output  oᵢ = Σⱼ Aᵢⱼ Vⱼ", size: 13, weight: "bold" });
          kit.label(p, { x: valColX, y: heatTop - 32, text: "weighted value sum", size: 11, upper: true, mono: true, color: palette.fgMuted });
          const out = att.out[qi];
          const omax = Math.max(1e-6, ...out.map((v) => Math.abs(v)));
          const barW = 150;
          for (let d = 0; d < D_K; d++) {
            const by = heatTop + 30 + d * 70;
            const v = out[d];
            kit.label(p, { x: valColX - 70, y: by, text: "o[" + d + "]", size: 11, mono: true, align: "left", color: palette.fgMuted });
            const frac = clamp01(Math.abs(v) / omax);
            p.push();
            p.noStroke();
            p.fill(255, 255, 255, 0.06 * 255);
            p.rect(valColX, by - 5, barW, 10, 3);
            const col: RGB = v >= 0 ? ACTIVE : EDGE;
            p.fill(col[0], col[1], col[2], 255);
            p.rect(valColX, by - 5, barW * frac, 10, 3);
            p.pop();
            kit.label(p, { x: valColX + barW + 16, y: by, text: v.toFixed(2), size: 11, mono: true, align: "left", color: v >= 0 ? ACTIVE : EDGE });
          }
          kit.label(p, { x: valColX + 40, y: heatTop + 30 + D_K * 70 + 12, text: "context vector for “" + TOKENS[qi] + "”", size: 12, weight: "bold", color: ACTIVE });
        }
      }

      function tokenPill(x: number, y: number, text: string, selected: boolean): void {
        const w = 120;
        const h = 40;
        p.push();
        if (selected) {
          p.fill(ACTIVE[0], ACTIVE[1], ACTIVE[2], 0.16 * 255);
          p.stroke(ACTIVE[0], ACTIVE[1], ACTIVE[2], 0.9 * 255);
          p.strokeWeight(1.5);
        } else {
          p.fill(palette.surface[0], palette.surface[1], palette.surface[2], 0.72 * 255);
          p.stroke(255, 255, 255, 0.08 * 255);
          p.strokeWeight(1);
        }
        p.rect(x - w / 2, y - h / 2, w, h, 10);
        p.pop();
        kit.label(p, { x, y, text, size: 14, mono: true, weight: "bold", color: selected ? ACTIVE : palette.fg });
      }
    };

    const inst = new libs.p5(sketch, container);

    // ── controller ────────────────────────────────────────────────────────
    return {
      setPhase(phaseIndex: number): void {
        state.phase = clampInt(phaseIndex, 0, 3);
      },
      setParam(key: string, value: number): void {
        if (!Number.isFinite(value)) return;
        switch (key) {
          case "mode": {
            const m = value >= 0.5 ? 1 : 0;
            if (m !== state.mode) {
              state.mode = m;
              renderEquation();
              recompute();
            }
            break;
          }
          case "input":
            state.input = clampInt(value, 0, state.mode === 1 ? TOKENS.length - 1 : 9);
            recompute();
            break;
          case "temperature":
            state.temperature = clampRange(value, 0.2, 4);
            recompute();
            break;
          case "layer":
            state.layer = clampInt(value, 0, 3);
            break;
          case "weightNoise":
            state.weightNoise = clamp01(value);
            recompute();
            break;
          default:
            break;
        }
      },
      dispose(): void {
        try {
          inst.remove();
        } catch {
          /* p5 already torn down */
        }
        eqEl.remove();
      },
    };
  },
};

// ── helpers (module scope, pure) ──────────────────────────────────────────
function clampInt(x: number, lo: number, hi: number): number {
  const v = Math.round(x);
  return v < lo ? lo : v > hi ? hi : v;
}
function clampRange(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
// Indices of the top-k largest values (descending). Deterministic.
function topK(arr: number[], k: number): number[] {
  return [...arr.keys()]
    .sort((a, b) => arr[b] - arr[a])
    .slice(0, Math.min(k, arr.length));
}

export default NeuralNetSim;
