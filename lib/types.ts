/**
 * Mira shared contract. Single source of truth for the UI <-> API boundary.
 * Both the frontend (render host, palette) and the backend (agent fan-out)
 * import from here. Do not redefine these shapes anywhere else.
 */

import type { Kit } from "@/lib/kit";

/** 2D scenes render with p5.js, 3D scenes with three.js. */
export type Renderer = "2d" | "3d";

export type GenerateMode = "new" | "mutate";

export interface ScenePhase {
  id: string;
  /** What this phase is meant to show, in one line. */
  intent: string;
  renderer: Renderer;
  approxDurationMs: number;
}

/**
 * The hand-tuned scene archetypes a live scene can be rendered as. The
 * orchestrator picks one per query; the archetype is a beautiful, kit-composed
 * renderer the model FILLS with structured content rather than writing code.
 */
export type SceneType =
  | "flow" // directed flow / network: process, pipeline, cause→effect
  | "cycle" // a loop of stages: heartbeat, water cycle, request/response
  | "layered" // stacked layers with signals: hierarchies, networks, propagation
  | "timeline" // ordered steps along a track: sequences, protocols, histories
  | "comparison"; // bars / quantities: comparisons and magnitudes

/**
 * Structured, per-phase content the chosen archetype fills itself with. The
 * orchestrator emits one item per phase (1:1 with narration cues). Fields are
 * optional so a single shape serves every archetype; each archetype reads the
 * fields it needs and ignores the rest.
 */
export interface SceneContentItem {
  /** Primary label (node title, stage name, layer title, bar label). */
  label: string;
  /** Uppercase mono sub-label / category. */
  sublabel?: string;
  /** A short value or readout (e.g. "4.75%", "12 ms", "ATP"). */
  value?: string;
  /** 0..1 magnitude for comparison/bar archetypes. */
  magnitude?: number;
}

export interface ScenePlan {
  id: string;
  title: string;
  /** Which hand-tuned archetype renders this scene. */
  sceneType: SceneType;
  /** Per-phase structured content, 1:1 with `phases` and narration cues. */
  content: SceneContentItem[];
  phases: ScenePhase[];
}

export interface NarrationCue {
  phaseId: string;
  text: string;
  /** When this line should start speaking, ms from scene start. */
  startMs: number;
}

/**
 * The renderable artifact for one scene.
 *
 * `code` is the BODY of a function with this exact signature:
 *
 *     function mount(container: HTMLElement, libs: RenderLibs): SceneController
 *
 * It must mount its animation into `container` using the provided libs and
 * RETURN a `SceneController` — `{ setPhase(phaseIndex): void; dispose(): void }`.
 * The render host wraps the string with `new Function("container","libs",code)`,
 * calls `setPhase(phase)` whenever the external phase index changes (phase
 * boundaries are driven by narration, NOT the scene's own clock), and calls
 * `dispose()` on unmount or before mounting the next scene.
 *
 * Scenes render CUMULATIVELY up to the current phase index (phase 0 visible;
 * phase 1 adds the next element; …) and may run their own rAF for smooth
 * easing WITHIN a phase, but the phase BOUNDARIES come from setPhase. The number
 * of phases equals the number of narration cues (1:1), so phase N aligns with
 * spoken cue N.
 *
 * 2d example body:
 *   let phase = 0;
 *   const sketch = (p) => { p.setup = () => p.createCanvas(...); p.draw = () => {... use phase ...}; };
 *   const inst = new libs.p5(sketch, container);
 *   return { setPhase: (n) => { phase = n; }, dispose: () => inst.remove() };
 *
 * Legacy support: a body that returns a bare cleanup function is still accepted
 * (treated as a no-op setPhase + that function as dispose), so hand-authored
 * cache bundles on the old contract keep working.
 */
export interface SceneController {
  /** Advance to (cumulatively reveal up to) the given phase index. */
  setPhase: (phaseIndex: number) => void;
  /**
   * Live-tune a named parameter (driven by SceneControls sliders). Optional so
   * legacy code-string controllers and parameter-free sims don't have to
   * implement it; the SimHost guards the call.
   */
  setParam?: (key: string, value: number) => void;
  /** Tear everything down: remove canvas/renderer, cancel rAF, dispose geometry. */
  dispose: () => void;
}

/* ───────────────────────────────────────────────────────────────────────────
   INTERACTIVE SIMULATION CONTRACT
   ───────────────────────────────────────────────────────────────────────────
   A `Sim` is a real, hand-built interactive simulation MODULE (e.g. a literal
   car-following model for "phantom traffic jam"), NOT a generated code string.
   Sims live in lib/sims/<id>.ts, register in lib/sims/index.ts under their id,
   and are resolved by the SimHost at render time.

   The orchestrator may emit a `simId` + `SceneContent` instead of `code`; when
   it does, the SimHost takes the sim path and the legacy code-string path is
   skipped. Both paths produce a `SceneController` the render host drives the
   same way (setPhase on the narration beat, setParam on a slider change).
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * One live, user-tunable knob a Sim exposes. The SceneControls panel renders
 * exactly one slider per spec and calls back through to `setParam(key, value)`.
 */
export interface ControlSpec {
  /** Stable key passed to `SceneController.setParam`. */
  key: string;
  /** Human label shown beside the slider. */
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Optional unit suffix shown in the readout (e.g. "s", "%", "cars/km"). */
  unit?: string;
}

/**
 * Structured, model-facing content for a Sim. The orchestrator fills this
 * (title, per-beat phase copy, initial parameter overrides, an optional
 * KaTeX equation) and the Sim reads what it needs. `phases` are 1:1 with the
 * narration cues, exactly like the archetype path's content array.
 */
export interface SceneContent {
  title: string;
  phases: { label: string; sublabel?: string; value?: string }[];
  /** Initial parameter overrides keyed by ControlSpec.key (else `default`). */
  params?: Record<string, number>;
  /** KaTeX source rendered as an overlay equation, when the sim wants one. */
  equation?: string;
}

/**
 * Libraries injected into every Sim's `create`. Superset of RenderLibs with
 * `katex` added for equation rendering. Sims receive this; legacy code-string
 * modules receive the narrower RenderLibs (which SimLibs structurally extends).
 */
export interface SimLibs extends RenderLibs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  katex: any;
}

/**
 * A registered interactive simulation. `create` mounts the sim into the
 * container and returns a SceneController; the host then drives setPhase on the
 * narration beat and setParam when a control changes. `dispose` must cancel any
 * rAF, remove canvases/renderers, and free geometry.
 */
export interface Sim {
  /** Stable registry id (e.g. "traffic-jam"). Matches SceneBundle.simId. */
  id: string;
  /** Display title (fallback when content.title is absent). */
  title: string;
  /** Tunable knobs, one slider each. Empty array for a non-interactive sim. */
  controls: ControlSpec[];
  create: (
    container: HTMLElement,
    libs: SimLibs,
    content: SceneContent,
  ) => SceneController;
}

export interface SceneBundle {
  sceneId: string;
  renderer: Renderer;
  /**
   * Legacy freeform/archetype render body (a `(container, libs) =>
   * SceneController` body string). Present when the scene is rendered via the
   * code path; absent when it's rendered via a registered Sim.
   */
  code: string;
  narration: NarrationCue[];
  /**
   * When set, the scene renders through the interactive-sim path: SimHost
   * resolves `simId` from the SIMS registry and calls its `create` with
   * `content`. Takes precedence over `code`.
   */
  simId?: string;
  content?: SceneContent;
}

/** Libraries injected into every generated render module. */
export interface RenderLibs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p5: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  THREE: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gsap: any;
  kit: Kit;
}

/**
 * What a compiled scene body evaluates to. New scenes return a SceneController;
 * legacy bodies may return a bare cleanup function. The compile layer normalizes
 * both to a SceneController before the render host drives them.
 */
export type RenderModule = (
  container: HTMLElement,
  libs: RenderLibs,
) => SceneController | (() => void);

export interface GenerateRequest {
  query: string;
  mode: GenerateMode;
  /** Required when mode === "mutate": the scene being morphed. */
  previousSceneId?: string;
}

/**
 * Server-sent events streamed from POST /api/generate (text/event-stream,
 * one JSON object per `data:` line). The UI consumes them in order:
 * plan -> code chunks -> code_done -> narration cues -> verify -> done.
 */
export type GenerateEvent =
  | { type: "plan"; plan: ScenePlan }
  | { type: "code_chunk"; sceneId: string; delta: string }
  | { type: "code_done"; sceneId: string; code: string; renderer: Renderer }
  | { type: "narration"; cue: NarrationCue }
  | { type: "verify"; status: "ok" | "warn" | "block"; note?: string }
  | { type: "error"; message: string }
  | { type: "done"; bundle: SceneBundle };
