/**
 * The neural-net brain behind acts 3 & 4. The forward pass is the app's real
 * seeded model (so neuron firing is genuine), but the headline probabilities are
 * authored to the script (98.2% clean, 54/43 ambiguous) and the input bitmap is
 * morphed from a "7" toward a "1" so the activations actually shift on screen.
 */
import { lerp, mulberry32 } from "./draw";

const IN = 64;
const H1 = 12;
const H2 = 8;
const OUT = 10;

const relu = (x: number) => (x > 0 ? x : 0);
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface Weights {
  w1: number[][]; b1: number[];
  w2: number[][]; b2: number[];
  w3: number[][]; b3: number[];
}

function buildClassifier(seed: number): Weights {
  const rng = mulberry32(seed >>> 0);
  const he = (fanIn: number) => Math.sqrt(2 / fanIn);
  const mat = (rows: number, cols: number, s: number) =>
    Array.from({ length: rows }, () => Array.from({ length: cols }, () => gaussian(rng) * s));
  const vec = (m: number) => Array.from({ length: m }, () => gaussian(rng) * 0.05);
  return {
    w1: mat(H1, IN, he(IN)), b1: vec(H1),
    w2: mat(H2, H1, he(H1)), b2: vec(H2),
    w3: mat(OUT, H2, he(H2)), b3: vec(OUT),
  };
}

export interface Pass {
  input: number[]; // 64
  a1: number[]; // 12
  a2: number[]; // 8
}

const W = buildClassifier(0x9e3779b9);

export function forward(input: number[]): Pass {
  const matvec = (m: number[][], x: number[], b: number[]) =>
    m.map((row, i) => row.reduce((s, wij, j) => s + wij * x[j], b[i]));
  const a1 = matvec(W.w1, input, W.b1).map(relu);
  const a2 = matvec(W.w2, a1, W.b2).map(relu);
  return { input, a1, a2 };
}

// ── digit "7" and its morph toward an ambiguous "1" ────────────────────────
export const DIGIT_7: number[][] = [
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 1, 1, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
];
// Top bar collapses to a small flag → reads ambiguous between 7 and 1.
const DIGIT_AMBIG: number[][] = [
  [0, 0, 0, 0, 0, 1, 1, 0],
  [0, 0, 0, 0, 0, 1, 1, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
];

/** 8×8 float grid morphed from "7" (t=0) toward ambiguous (t=1). */
export function digitAt(t: number): number[][] {
  return DIGIT_7.map((row, r) => row.map((v, c) => lerp(v, DIGIT_AMBIG[r][c], t)));
}
export const flatten = (m: number[][]) => m.flat();

// ── authored softmax over 10 classes ───────────────────────────────────────
const CLEAN = [0.001, 0.006, 0.0025, 0.001, 0.0005, 0.0005, 0.0005, 0.982, 0.001, 0.0045];
const AMBIG = [0.004, 0.43, 0.008, 0.004, 0.003, 0.003, 0.003, 0.54, 0.001, 0.004];

/** Probability vector at morph t, renormalized. Index 7 = "7", index 1 = "1". */
export function probsAt(t: number): number[] {
  const raw = CLEAN.map((c, i) => lerp(c, AMBIG[i], t));
  const sum = raw.reduce((s, v) => s + v, 0);
  return raw.map((v) => v / sum);
}

// ── latent space: clusters that overlap as the digit goes ambiguous ─────────
export interface LatentPoint {
  bx: number; by: number; // base position in [-1,1]
  cls: number; // which digit cluster
  jitterSeed: number;
}

/** Deterministic point cloud: a dense "7" cluster, a "1" cluster, faint others. */
export function latentCloud(): LatentPoint[] {
  const rng = mulberry32(0x51ed270b);
  const pts: LatentPoint[] = [];
  // center, count, spread, class
  const clusters: [number, number, number, number, number][] = [
    [-0.42, -0.18, 70, 0.16, 7], // the "7" cluster (amber)
    [0.46, 0.22, 58, 0.16, 1], // the "1" cluster (cool)
    [0.1, -0.55, 22, 0.13, 9],
    [-0.2, 0.6, 20, 0.13, 2],
    [0.62, -0.5, 16, 0.12, 4],
  ];
  for (const [cx, cy, n, sp, cls] of clusters) {
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * sp * (1 + gaussian(rng) * 0.25);
      pts.push({ bx: cx + Math.cos(a) * r, by: cy + Math.sin(a) * r, cls, jitterSeed: rng() * 1000 });
    }
  }
  return pts;
}
