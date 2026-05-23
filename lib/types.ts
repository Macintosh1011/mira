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
  /** Tear everything down: remove canvas/renderer, cancel rAF, dispose geometry. */
  dispose: () => void;
}

export interface SceneBundle {
  sceneId: string;
  renderer: Renderer;
  code: string;
  narration: NarrationCue[];
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
