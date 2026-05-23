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

export interface ArrowEdgeOpts {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Clock in seconds for the flowing dash. */
  t: number;
  color?: RGB;
  /** Overall edge opacity 0..1 (reveal). Defaults to 1. */
  reveal?: number;
  /** Draw a directional arrowhead at the (x2,y2) end. Defaults true. */
  head?: boolean;
  /** Curve the edge: perpendicular bow height in px (0 = straight). */
  curve?: number;
}

export interface StageNodeOpts {
  x: number;
  y: number;
  /** Pill radius in px. Defaults 46. */
  r?: number;
  /** Big label inside the pill. */
  label: string;
  /** Uppercase mono sub-label above the label. */
  sublabel?: string;
  /** Short value/readout below the label. */
  value?: string;
  color?: RGB;
  /** Reveal 0..1 (scale + opacity). */
  reveal?: number;
  /** Active glow 0..1 — the "current beat" highlight. */
  active?: number;
  /** Optional ordinal badge (1-based) drawn at the pill's top edge. */
  index?: number;
}

export interface BarOpts {
  x: number;
  /** Baseline y (bottom of the bar). */
  y: number;
  w: number;
  /** Full height at value=1, in px. */
  maxH: number;
  /** 0..1 fill fraction. */
  value: number;
  label?: string;
  /** Short value readout drawn above the bar (e.g. "72%"). */
  readout?: string;
  color?: RGB;
  /** Grow-in progress 0..1. */
  reveal?: number;
  /** Active highlight 0..1. */
  active?: number;
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

/** A 2D point in data space (the units the sim thinks in, not pixels). */
export interface Point2 {
  x: number;
  y: number;
}

export interface AxesProOpts {
  /** Plot box: top-left + size, in canvas px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Data-space domain. Defaults [0,1] on both axes. */
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /** Tick count per axis (segments). Defaults 5. */
  ticks?: number;
  /** Axis titles (drawn outside the box). */
  xLabel?: string;
  yLabel?: string;
  /** Unit suffix appended to each tick number (e.g. "s", "%"). */
  xUnit?: string;
  yUnit?: string;
  /** Decimal places for tick numbers. Defaults inferred from the domain. */
  decimals?: number;
  /** Faint interior gridlines at each tick. Defaults true. */
  gridlines?: boolean;
  /** Reveal 0..1 (axes draw on, ticks/labels fade in after). */
  reveal?: number;
  color?: RGB;
}

export interface PlotOpts {
  /** Plot box matching an `axesPro` call, in canvas px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Points in DATA space (same domain you passed to `axesPro`). */
  points: Point2[];
  /** Data-space domain. Must match the axes for the curve to register. */
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /** Draw-on progress 0..1 (the curve unspools left-to-right along the path). */
  drawProgress?: number;
  color?: RGB;
  /** Glowing leading-edge dot. Defaults true. */
  head?: boolean;
  /** Stroke weight. Defaults 1.5. */
  weight?: number;
  /** Translucent fill from the curve down to the x-axis baseline. */
  fillArea?: boolean;
  /** Clip points to the box (off by default — curves may overshoot the frame). */
  clip?: boolean;
}

export interface VectorOpts {
  /** Tail (origin) in canvas px. */
  x: number;
  y: number;
  /** Components in canvas px (dx right, dy down — screen space). */
  dx: number;
  dy: number;
  color?: RGB;
  /** Text drawn at the head. If omitted, no label. Pass "" for none. */
  label?: string;
  /** Append the numeric magnitude |v| after the label. Defaults false. */
  showMagnitude?: boolean;
  /** Reveal 0..1 (shaft draws on, head + label fade in). */
  reveal?: number;
  /** Arrowhead size in px. Defaults 10. */
  headSize?: number;
  /** Stroke weight. Defaults 1.5. */
  weight?: number;
  /** Decimals for the magnitude readout. Defaults 1. */
  decimals?: number;
}

export interface ReadoutOpts {
  x: number;
  y: number;
  /** Uppercase mono caption above the value. */
  label: string;
  /** The value — number or pre-formatted string. */
  value: number | string;
  /** Unit suffix (e.g. "Hz", "m/s"). */
  unit?: string;
  color?: RGB;
  /** Decimals when `value` is a number. Defaults 2. */
  decimals?: number;
  /** Value text size. Defaults 24. */
  size?: number;
  align?: "left" | "center" | "right";
  /** Reveal 0..1 (fade + small rise). */
  reveal?: number;
  /** Draw a faint card behind the readout. Defaults false. */
  boxed?: boolean;
}

export interface LegendItem {
  color: RGB;
  label: string;
}

export interface LegendOpts {
  /** Top-left of the legend block, in canvas px. */
  x: number;
  y: number;
  items: LegendItem[];
  /** Row height in px. Defaults 22. */
  rowH?: number;
  /** Swatch style. "line" = dash, "dot" = filled circle. Defaults "line". */
  swatch?: "line" | "dot";
  /** Reveal 0..1 (rows stagger in). */
  reveal?: number;
  /** Draw a faint card behind the legend. Defaults false. */
  boxed?: boolean;
}

export interface GridlinesOpts {
  /** Plot box, in canvas px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Vertical line count. Defaults 8. */
  cols?: number;
  /** Horizontal line count. Defaults 5. */
  rows?: number;
  color?: RGB;
  /** Line opacity 0..1. Defaults 0.05. */
  alpha?: number;
  /** Reveal 0..1. */
  reveal?: number;
}

export interface BracketOpts {
  /** Span endpoints in canvas px. The bracket runs from (x1,y1) to (x2,y2). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Perpendicular depth of the bracket lips in px. Defaults 8. */
  depth?: number;
  /** Optional label drawn at the bracket's mid-span, outside the lips. */
  label?: string;
  color?: RGB;
  /** Reveal 0..1. */
  reveal?: number;
  /** Flip which side the lips/label sit on. Defaults false. */
  flip?: boolean;
}

export interface DimensionOpts {
  /** Measured span endpoints in canvas px. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Value drawn at the mid-span (number formatted, or a string). */
  value: number | string;
  /** Unit suffix when `value` is a number. */
  unit?: string;
  /** Offset of the dimension line from the span, perpendicular, in px. */
  offset?: number;
  color?: RGB;
  /** Decimals when `value` is a number. Defaults 1. */
  decimals?: number;
  /** Reveal 0..1 (extension + dim line draw on, value fades in). */
  reveal?: number;
}

/** Minimal shape of the KaTeX namespace the kit needs (sim passes `libs.katex`). */
export interface KatexLike {
  renderToString: (tex: string, options?: Record<string, unknown>) => string;
}

export interface EquationOpts {
  /** Anchor in canvas px (interpreted per `align` / `baseline`). */
  x: number;
  y: number;
  /** The LaTeX source (no surrounding $). */
  latex: string;
  /** Font size in px. Defaults 22. */
  size?: number;
  /** Text color. Defaults palette.fg. */
  color?: RGB;
  /** Opacity 0..1. Defaults 1. */
  alpha?: number;
  /** Horizontal anchor. Defaults "center". */
  align?: "left" | "center" | "right";
  /** Vertical anchor of (x,y) against the box. Defaults "middle". */
  baseline?: "top" | "middle" | "bottom";
  /** Render display (block) math vs inline. Defaults true (display). */
  display?: boolean;
}

/** Handle returned by `kit.equation` for managing a single overlaid equation. */
export interface EquationHandle {
  /** The overlay DOM node (a positioned <div> inside the canvas container). */
  el: HTMLElement;
  /** Re-render with new options (cheap; reuses the same node). */
  update: (opts: EquationOpts) => void;
  /** Remove the node from the DOM. Call on scene dispose. */
  remove: () => void;
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

  // ── archetype vocabulary (cycle / timeline / comparison) ──────────
  /** Directed edge with an arrowhead + flowing dash; optionally curved. */
  arrowEdge: (p: P5, opts: ArrowEdgeOpts) => void;
  /** Compact stage pill for cycle/timeline beats (lighter than `node`). */
  stageNode: (p: P5, opts: StageNodeOpts) => void;
  /** A single vertical bar for the comparison archetype. */
  bar: (p: P5, opts: BarOpts) => void;

  // ── network vocabulary (NN topic) ─────────────────────────────────
  neuron: (p: P5, opts: NeuronOpts) => void;
  neuronLayer: (p: P5, opts: NeuronLayerOpts) => void;
  connectBundle: (p: P5, opts: ConnectBundleOpts) => void;
  pixelGrid: (p: P5, opts: PixelGridOpts) => void;
  confidenceBar: (p: P5, opts: ConfidenceBarOpts) => void;

  // ── chart vocabulary ──────────────────────────────────────────────
  axes: (p: P5, opts: AxesOpts) => void;
  plotLine: (p: P5, opts: PlotLineOpts) => void;

  // ── technical vocabulary (charts / physics / readouts) ────────────
  /** Labeled axes with tick marks + numeric units over a data domain. */
  axesPro: (p: P5, opts: AxesProOpts) => void;
  /** A line/curve plot mapped from a data domain, drawing on with a glow head. */
  plot: (p: P5, opts: PlotOpts) => void;
  /** An arrow/vector in screen space with an optional magnitude label. */
  vector: (p: P5, opts: VectorOpts) => void;
  /** A technical numeric readout (mono caption + big value + unit). */
  readout: (p: P5, opts: ReadoutOpts) => void;
  /** A color-keyed legend block. */
  legend: (p: P5, opts: LegendOpts) => void;
  /** Standalone interior gridlines (no axes). */
  gridlines: (p: P5, opts: GridlinesOpts) => void;
  /** A span bracket with an optional label (annotates a range). */
  bracket: (p: P5, opts: BracketOpts) => void;
  /** An engineering dimension line (extension lines + value at mid-span). */
  dimension: (p: P5, opts: DimensionOpts) => void;
  /**
   * Render a LaTeX equation as a positioned HTML overlay above the canvas.
   * Pass the KaTeX namespace (the host injects it as `libs.katex`) and the p5
   * container so the kit can place the overlay over the canvas. Returns a
   * handle you reuse across frames (call `.update` per frame, `.remove` on
   * dispose) — see the doc on the implementation for why this beats canvas.
   */
  equation: (
    katex: KatexLike,
    container: HTMLElement,
    opts: EquationOpts,
  ) => EquationHandle;
  /**
   * Pure helper: KaTeX → HTML string + intended absolute placement. For hosts
   * that own their own overlay layer and don't want the kit touching the DOM.
   */
  equationHtml: (
    katex: KatexLike,
    opts: EquationOpts,
  ) => { html: string; left: number; top: number; transform: string };

  // ── 3D ────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scene3d: (THREE: any, container: HTMLElement, opts?: Scene3DOpts) => Scene3D;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flatSphere: (THREE: any, r: number, color: RGB, wire?: boolean) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flatLine: (THREE: any, pts: number[][], color: RGB) => any;
}
