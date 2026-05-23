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

export interface ScenePlan {
  id: string;
  title: string;
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
 *     function mount(container: HTMLElement, libs: RenderLibs): () => void
 *
 * It must mount its animation into `container` using the provided libs and
 * RETURN a cleanup function that tears everything down (remove canvas /
 * renderer, cancel rAF, dispose geometry). The render host wraps the string
 * with `new Function("container", "libs", code)` and calls the cleanup on
 * unmount or before mounting the next scene.
 *
 * 2d example body:
 *   const sketch = (p) => { p.setup = () => p.createCanvas(...); p.draw = () => {...}; };
 *   const inst = new libs.p5(sketch, container);
 *   return () => inst.remove();
 *
 * 3d example body:
 *   const r = new libs.THREE.WebGLRenderer({ antialias: true });
 *   container.appendChild(r.domElement);
 *   let raf; const loop = () => { ...; raf = requestAnimationFrame(loop); }; loop();
 *   return () => { cancelAnimationFrame(raf); r.dispose(); r.domElement.remove(); };
 */
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

export type RenderModule = (
  container: HTMLElement,
  libs: RenderLibs,
) => () => void;

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
