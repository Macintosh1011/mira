/**
 * Mira Kit — public entry point.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOST INJECTION CONTRACT (read this when wiring the render host)
 * ─────────────────────────────────────────────────────────────────────────
 * The kit is a STATELESS bundle of p5 drawing primitives. Construct it ONCE
 * and inject it into `RenderLibs` as `kit`, alongside p5/THREE/gsap. Every
 * primitive takes the live p5 instance `p` (or, for 3D, the THREE namespace)
 * as its first argument, so the kit itself needs no p5 instance at build time.
 *
 * In lib/types.ts, add to RenderLibs:
 *     import type { Kit } from "@/lib/kit";
 *     export interface RenderLibs { p5: any; THREE: any; gsap: any; kit: Kit; }
 *
 * In lib/render/libs.ts (loadRenderLibs), after resolving the dynamic imports:
 *     import { createKit } from "@/lib/kit";
 *     cache = {
 *       p5: p5Mod.default,
 *       THREE: threeMod,
 *       gsap: gsapMod.gsap ?? gsapMod.default,
 *       kit: createKit(),
 *     };
 *
 * That's it. `createKit()` takes no arguments and returns a `Kit`. Generated
 * render-module bodies then call `libs.kit.grid(p)`, `libs.kit.node(p, {...})`,
 * etc. inside their p5 sketch. The kit holds no mutable state across calls, so
 * sharing one instance across every scene is safe.
 *
 * Determinism: pass animation progress explicitly (a normalized `reveal`/`t`
 * 0..1, or a seconds clock for dash flow). Identical inputs always render an
 * identical frame, so scenes are scrubbable and reproducible.
 * ─────────────────────────────────────────────────────────────────────────
 */
export { createKit } from "./kit";
export type {
  Kit,
  Palette,
  EaseSet,
  Ease,
  RGB,
  RGBA,
  P5,
  NodeOpts,
  FlowEdgeOpts,
  SignalOpts,
  GaugeOpts,
  ArrowEdgeOpts,
  StageNodeOpts,
  BarOpts,
  NeuronOpts,
  NeuronLayerOpts,
  GridOpts,
  LabelOpts,
  ValueFlipOpts,
  DeltaTriOpts,
  ConfidenceBarOpts,
  ConnectBundleOpts,
  PixelGridOpts,
  PhaseDotsOpts,
  AxesOpts,
  PlotLineOpts,
  Point2,
  AxesProOpts,
  PlotOpts,
  VectorOpts,
  ReadoutOpts,
  LegendItem,
  LegendOpts,
  GridlinesOpts,
  BracketOpts,
  DimensionOpts,
  KatexLike,
  EquationOpts,
  EquationHandle,
  Scene3D,
  Scene3DOpts,
} from "./types";
