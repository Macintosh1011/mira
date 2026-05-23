/**
 * Mira Kit — public TypeScript surface.
 *
 * The kit is a hand-built p5 primitives library that reproduces the Mira
 * reference aesthetic (see design_handoff_mira/canvas.jsx + nn-canvas.jsx).
 * Generated render modules receive it as `libs.kit` and COMPOSE scenes from
 * these primitives rather than drawing from scratch.
 *
 * Every drawing primitive takes the live p5 instance `p` as its first argument
 * (the render host runs generated code in p5 instance mode), then an options
 * object. Animation is deterministic: pass a normalized progress `t` (0..1) or
 * a phase clock; the same inputs always produce the same frame.
 *
 * `p` is typed `any` on purpose: the render host injects the p5 default export
 * and we never want generated code to fight p5's loose runtime types.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type P5 = any;

/** An RGB-or-RGBA tuple in 0..255 (alpha 0..255). p5-friendly. */
export type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];

/** Easing fn: progress in -> eased progress out, both 0..1. */
export type Ease = (t: number) => number;

export interface Palette {
  /** Tinted near-black paper. Pure black is BANNED. */
  bg: RGB;
  /** Slightly raised surface for cards. */
  surface: RGB;
  /** Primary text, ~95% white. Pure white is BANNED. */
  fg: RGB;
  fgMuted: RGB;
  fgSubtle: RGB;
  /** The one accent — yellow. Active states / highlights only. */
  accent: RGB;
  /** Topic colors from the brief, for multi-series scenes. */
  terracotta: RGB;
  teal: RGB;
  blue: RGB;
  pink: RGB;
  deepRed: RGB;
  /** Faint hairline (white at low alpha), used as RGBA via stroke/fill. */
  hairline: RGBA;
  hairlineStrong: RGBA;
}

export interface EaseSet {
  /** Identity. */
  linear: Ease;
  /** Quintic in/out — the workhorse for reveals. */
  quintic: Ease;
  /** Smoothstep (3t^2-2t^3) — gentle, symmetric. */
  smoothstep: Ease;
  /** Smootherstep (6t^5-15t^4+10t^3) — even softer ends. */
  smootherstep: Ease;
  /** Ease-out cubic — matches the handoff --ease-smooth feel. */
  outCubic: Ease;
  /** Ease-out quint — strong settle. */
  outQuint: Ease;
  /** Ease-in-out cubic. */
  inOutCubic: Ease;
  /** Spring-ish overshoot (for scale pops only, never translation). */
  overshoot: Ease;
}

export interface NodeOpts {
  x: number;
  y: number;
  /** Outer hero-ring radius in px. */
  r: number;
  /** Sans-serif label, rendered below the card. */
  label?: string;
  /** Uppercase mono sub-label, rendered above the value. */
  sublabel?: string;
  /** Big mono value, rendered in accent at the card center. */
  value?: string;
  /** Card / value color. Defaults to accent. */
  color?: RGB;
  /** Reveal progress 0..1 (scale + opacity in). Defaults to 1. */
  reveal?: number;
  /** Settle progress 0..1: drives hero-ring brightening (the "live" glow). */
  settle?: number;
  /** Delta indicator drawn next to the value: 'up' | 'down' | null. */
  delta?: "up" | "down" | null;
}

export interface FlowEdgeOpts {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Clock in seconds (or any monotonically increasing time) for dash flow. */
  t: number;
  /** Accent color of the flowing dash. Defaults to accent. */
  color?: RGB;
  /** Overall edge opacity 0..1 (for reveal). Defaults to 1. */
  reveal?: number;
  /** When false, only the faint base line draws (no flowing dash). */
  active?: boolean;
}

export interface SignalOpts {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Clock in seconds for dash flow. */
  t: number;
  color?: RGB;
  reveal?: number;
}

export interface GaugeOpts {
  x: number;
  y: number;
  /** Numeric start value. */
  from: number;
  /** Numeric end value. */
  to: number;
  /** Progress 0..1: crossfades from `from` to `to`. */
  t: number;
  label?: string;
  unit?: string;
  color?: RGB;
  /** Decimal places for the readout. Defaults to inferred (0 or 2). */
  decimals?: number;
}

export interface NeuronOpts {
  x: number;
  y: number;
  /** Radius in px. Defaults to 11. */
  r?: number;
  /** Firing — filled accent + glow. */
  active?: boolean;
  /** Past-firing — muted gray fill, no glow. */
  settled?: boolean;
  /** Winner — accent fill, 2px stroke, strongest glow. */
  winner?: boolean;
  /** Optional text label to the right of the neuron. */
  label?: string;
  color?: RGB;
  /** Per-neuron reveal/glow 0..1. */
  reveal?: number;
}

export interface NeuronLayerOpts {
  x: number;
  /** Y center for each neuron in the column. */
  ys: number[];
  /** Active flags per neuron (firing). */
  active?: boolean[];
  /** Settled flags per neuron (past-firing). */
  settled?: boolean[];
  /** Optional labels per neuron (e.g. output digits). */
  labels?: string[];
  /** Layer title + sublabel, drawn above the column. */
  title?: string;
  sublabel?: string;
  r?: number;
  color?: RGB;
  reveal?: number;
}

export interface GridOpts {
  /** Background reveal/dim 0..1. Defaults to 1. */
  reveal?: number;
  /** Cell size in px for the faint sub-grid. Defaults to 100. */
  cell?: number;
  /** Accent color of the central radial wash. Defaults to accent. */
  wash?: RGB;
}

export interface LabelOpts {
  x: number;
  y: number;
  text: string;
  size?: number;
  /** Uppercase + letter-spacing (mono sub-label style). */
  upper?: boolean;
  color?: RGB;
  /** Use the mono font feel. Defaults to sans. */
  mono?: boolean;
  /** p5 horizontal align: 'left' | 'center' | 'right'. Defaults center. */
  align?: "left" | "center" | "right";
  /** Opacity 0..1 multiplier. Defaults 1. */
  alpha?: number;
  /** Font weight hint (p5 textStyle). 'normal' | 'bold'. Defaults normal. */
  weight?: "normal" | "bold";
}

export interface ValueFlipOpts {
  x: number;
  y: number;
  from: string;
  to: string;
  /** Progress 0..1: <0.5 shows `from` fading out, >0.5 shows `to` fading in. */
  t: number;
  size?: number;
  color?: RGB;
  align?: "left" | "center" | "right";
}

export interface DeltaTriOpts {
  x: number;
  y: number;
  dir: "up" | "down";
  /** Triangle side length in px. Defaults 11. */
  size?: number;
  color?: RGB;
  /** Reveal 0..1 (fade + small rise). */
  reveal?: number;
}

export interface ConfidenceBarOpts {
  x: number;
  y: number;
  /** Track width in px. Defaults 80. */
  w?: number;
  /** Fill fraction 0..1. */
  value: number;
  color?: RGB;
  /** Show the "NN.N%" readout after the bar. Defaults true. */
  showPct?: boolean;
}

export interface ConnectBundleOpts {
  /** Source neuron centers. */
  from: { x: number; y: number }[];
  /** Target neuron centers. */
  to: { x: number; y: number }[];
  /** Inset from each end in px (so lines start at the neuron edge). Default 12. */
  inset?: number;
  reveal?: number;
}

export interface PixelGridOpts {
  /** Top-left corner. */
  x: number;
  y: number;
  /** Square cell size in px. */
  cell: number;
  /** Row-major matrix of 0/1 (or 0..1 intensities). */
  data: number[][];
  /** Reveal progress 0..1 — cells light up in scan order. */
  reveal?: number;
  color?: RGB;
  /** Draw a rounded frame + caption around the grid. */
  frame?: boolean;
}

export interface PhaseDotsOpts {
  x: number;
  y: number;
  /** Total phase count. */
  total: number;
  /** Current 0-based phase index. */
  current: number;
  /** Optional label drawn after the dots. */
  label?: string;
  color?: RGB;
}

export interface AxesOpts {
  /** Plot box: top-left + size. */
  x: number;
  y: number;
  w: number;
  h: number;
  reveal?: number;
  xLabel?: string;
  yLabel?: string;
}

export interface PlotLineOpts {
  /** Plot box matching an Axes call. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Points in DATA space, already normalized 0..1 in both axes. */
  points: { x: number; y: number }[];
  /** Draw-on progress 0..1. */
  t: number;
  color?: RGB;
  /** Put a glowing dot at the leading edge. Defaults true. */
  head?: boolean;
}

/** Small flat-shaded 3D helper set (three.js), for genuinely spatial scenes. */
export interface Scene3D {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scene: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  camera: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderer: any;
  /** Render one frame. */
  render: () => void;
  /** Resize to the container. */
  resize: () => void;
  /** Dispose renderer + DOM node. Geometries/materials you add are yours. */
  dispose: () => void;
}

export interface Scene3DOpts {
  /** Field of view. Defaults 50. */
  fov?: number;
  /** Camera z distance. Defaults 6. */
  distance?: number;
  /** Background color. Defaults palette.bg. */
  bg?: RGB;
}

export interface Kit {
  palette: Palette;
  ease: EaseSet;

  // ── shared helpers ────────────────────────────────────────────────
  /** Apply a p5 fill from an RGB(+alpha 0..1). */
  fill: (p: P5, c: RGB, alpha?: number) => void;
  /** Apply a p5 stroke from an RGB(+alpha 0..1) at a weight (default 1.5). */
  stroke: (p: P5, c: RGB, alpha?: number, weight?: number) => void;
  /** Convert RGB hex (#rrggbb) to an RGB tuple. */
  hexToRgb: (hex: string) => RGB;
  /** Clamp + lerp helpers (deterministic). */
  clamp01: (x: number) => number;
  lerp: (a: number, b: number, t: number) => number;
  /** Set the kit's sans / mono font feel on the p5 instance (call in setup). */
  useFonts: (p: P5) => void;

  // ── backgrounds & scaffolding ─────────────────────────────────────
  grid: (p: P5, opts?: GridOpts) => void;
  phaseDots: (p: P5, opts: PhaseDotsOpts) => void;

  // ── typography ────────────────────────────────────────────────────
  label: (p: P5, opts: LabelOpts) => void;
  valueFlip: (p: P5, opts: ValueFlipOpts) => void;
  deltaTri: (p: P5, opts: DeltaTriOpts) => void;

  // ── node-graph vocabulary (Fed topic) ─────────────────────────────
  node: (p: P5, opts: NodeOpts) => void;
  flowEdge: (p: P5, opts: FlowEdgeOpts) => void;
  signal: (p: P5, opts: SignalOpts) => void;
  gauge: (p: P5, opts: GaugeOpts) => void;

  // ── network vocabulary (NN topic) ─────────────────────────────────
  neuron: (p: P5, opts: NeuronOpts) => void;
  neuronLayer: (p: P5, opts: NeuronLayerOpts) => void;
  connectBundle: (p: P5, opts: ConnectBundleOpts) => void;
  pixelGrid: (p: P5, opts: PixelGridOpts) => void;
  confidenceBar: (p: P5, opts: ConfidenceBarOpts) => void;

  // ── chart vocabulary ──────────────────────────────────────────────
  axes: (p: P5, opts: AxesOpts) => void;
  plotLine: (p: P5, opts: PlotLineOpts) => void;

  // ── 3D ────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scene3d: (THREE: any, container: HTMLElement, opts?: Scene3DOpts) => Scene3D;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flatSphere: (THREE: any, r: number, color: RGB, wire?: boolean) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flatLine: (THREE: any, pts: number[][], color: RGB) => any;
}
